# Copyright (C) 2025 Xiaomi Corporation
# This software may be used and distributed according to the terms of the Xiaomi Miloco License Agreement.

"""
Camera manager for the PoC.
Wraps miot_kit camera functionality to manage camera discovery and streaming.
"""

import json
import logging
from collections import OrderedDict
from typing import Dict, List, Optional

from fastapi.websockets import WebSocketState
from fastapi import WebSocket

from miot.types import MIoTCameraInfo, MIoTCameraStatus, MIoTCameraVideoQuality

from auth import get_auth_manager
from config import FRAME_INTERVAL

logger = logging.getLogger(__name__)

# Maximum concurrent WebSocket connections per camera channel
_CAMERA_CONNECT_COUNT_MAX = 4


def _camera_info_to_dict(info: MIoTCameraInfo) -> dict:
    """Convert MIoTCameraInfo to a serializable dictionary."""
    return {
        "did": info.did,
        "name": info.name,
        "model": info.model,
        "online": info.online,
        "channel_count": info.channel_count,
        "camera_status": info.camera_status.value,
        "camera_status_name": info.camera_status.name,
        "home_name": info.home_name,
        "room_name": info.room_name,
        "local_ip": info.local_ip,
        "lan_status": info.lan_status,
    }


async def get_camera_list() -> List[dict]:
    """Discover and return all cameras from Xiaomi Home.

    Returns:
        List of camera info dictionaries.
    """
    auth = get_auth_manager()
    client = auth.client
    if not client:
        raise RuntimeError("MIoT client not initialized")

    # First get devices with cloud online status
    devices = await client.get_devices_async()
    
    # Then get camera-specific info (unfortunately this overwrites online status)
    cameras = await client.get_cameras_async()
    
    # Restore the cloud online status from devices
    for did, camera_info in cameras.items():
        if did in devices:
            camera_info.online = devices[did].online
    
    logger.info("Discovered %d cameras", len(cameras))
    return [_camera_info_to_dict(info) for info in cameras.values()]


class VideoStreamManager:
    """Manages WebSocket connections for video streaming.

    Each camera channel can have multiple concurrent WebSocket viewers.
    When the first viewer connects, the camera stream is started.
    When the last viewer disconnects, the camera stream is stopped.
    """

    # key: "camera_id.channel", value: {conn_id: websocket}
    _connections: Dict[str, OrderedDict]
    _connection_counter: int

    def __init__(self) -> None:
        self._connections = {}
        self._connection_counter = 0

    async def new_connection(
        self,
        websocket: WebSocket,
        camera_id: str,
        channel: int,
    ) -> str:
        """Register a new WebSocket connection for a camera channel.

        Starts the camera stream if this is the first connection.

        Args:
            websocket: The WebSocket connection.
            camera_id: Camera device ID.
            channel: Camera channel number.

        Returns:
            Connection ID string.
        """
        camera_tag = f"{camera_id}.{channel}"
        is_first = camera_tag not in self._connections or not self._connections[camera_tag]

        if is_first:
            self._connections[camera_tag] = OrderedDict()
            await self._start_stream(camera_id, channel)
            logger.info("Started video stream for %s", camera_tag)

        conn_id = str(self._connection_counter)
        self._connection_counter += 1
        self._connections[camera_tag][conn_id] = websocket
        logger.info("New connection %s for camera %s", conn_id, camera_tag)

        # Enforce max connections per camera channel
        if len(self._connections[camera_tag]) > _CAMERA_CONNECT_COUNT_MAX:
            logger.warning("Too many connections for %s, removing oldest", camera_tag)
            _, old_ws = self._connections[camera_tag].popitem(last=False)
            try:
                if old_ws.client_state == WebSocketState.CONNECTED:
                    await old_ws.close()
            except Exception as err:  # pylint: disable=broad-exception-caught
                logger.error("Error closing old WebSocket: %s", err)

        return conn_id

    async def close_connection(
        self, camera_id: str, channel: int, conn_id: str
    ) -> None:
        """Remove a WebSocket connection.

        Stops the camera stream when the last connection is removed.

        Args:
            camera_id: Camera device ID.
            channel: Camera channel number.
            conn_id: Connection ID to remove.
        """
        camera_tag = f"{camera_id}.{channel}"
        if camera_tag not in self._connections:
            return

        ws = self._connections[camera_tag].pop(conn_id, None)
        if ws:
            try:
                if ws.client_state == WebSocketState.CONNECTED:
                    await ws.close()
            except Exception as err:  # pylint: disable=broad-exception-caught
                logger.error("Error closing WebSocket: %s", err)

        if not self._connections[camera_tag]:
            del self._connections[camera_tag]
            await self._stop_stream(camera_id, channel)
            logger.info("Stopped video stream for %s (no more connections)", camera_tag)

    async def _start_stream(self, camera_id: str, channel: int) -> None:
        """Start a camera video stream.

        Follows the same pattern as miloco_server:
        1. Look up camera info from the cameras buffer
        2. Create a camera instance (idempotent – returns existing if already created)
        3. Register raw-video callback then start the camera

        Args:
            camera_id: Camera device ID.
            channel: Camera channel number.
        """
        auth = get_auth_manager()
        client = auth.client
        if not client:
            raise RuntimeError("MIoT client not initialized")

        # Resolve camera info (must have been fetched by get_camera_list() already)
        cameras = client.cameras_info
        camera_info = cameras.get(camera_id)
        if camera_info is None:
            # Try refreshing once
            cameras = await client.get_cameras_async()
            camera_info = cameras.get(camera_id)
        if camera_info is None:
            raise RuntimeError(f"Camera {camera_id} not found")

        # Create or retrieve the camera instance
        camera_instance = await client.create_camera_instance_async(
            camera_info, frame_interval=FRAME_INTERVAL
        )

        async def on_raw_video(
            did: str, data: bytes, ts: int, seq: int, ch: int
        ) -> None:
            await self._on_video_frame(did, data, ch)

        async def on_status_changed(did: str, status: MIoTCameraStatus) -> None:
            """Forward camera connection status to all WebSocket clients."""
            camera_tag = f"{camera_id}.{channel}"
            if camera_tag not in self._connections:
                return
            msg = json.dumps({
                "type": "camera_status",
                "status": status.value,
                "status_name": status.name,
            })
            for ws in list(self._connections[camera_tag].values()):
                try:
                    await ws.send_text(msg)
                except Exception as err:  # pylint: disable=broad-exception-caught
                    logger.debug("Failed to send status update to client: %s", err)

        await camera_instance.register_raw_video_async(
            callback=on_raw_video, channel=channel
        )
        await camera_instance.register_status_changed_async(callback=on_status_changed)
        await camera_instance.start_async(
            qualities=MIoTCameraVideoQuality.HIGH,
            enable_reconnect=True,
        )

    async def _stop_stream(self, camera_id: str, channel: int) -> None:
        """Stop a camera video stream.

        Args:
            camera_id: Camera device ID.
            channel: Camera channel number.
        """
        auth = get_auth_manager()
        client = auth.client
        if not client:
            return

        camera_instance = await client.camera_client.get_camera_instance_async(camera_id)
        if camera_instance:
            await camera_instance.unregister_raw_video_async(channel=channel)
            await camera_instance.unregister_status_changed_async()
            await camera_instance.stop_async()

    async def _on_video_frame(
        self, camera_id: str, data: bytes, channel: int
    ) -> None:
        """Broadcast a video frame to all connected WebSocket clients.

        Args:
            camera_id: Camera device ID.
            data: Raw H.264/H.265 frame bytes.
            channel: Camera channel number.
        """
        camera_tag = f"{camera_id}.{channel}"
        if camera_tag not in self._connections:
            return

        dead_connections = []
        for conn_id, ws in list(self._connections[camera_tag].items()):
            try:
                await ws.send_bytes(data)
            except Exception as err:  # pylint: disable=broad-exception-caught
                logger.error("Error sending frame to %s: %s", conn_id, err)
                dead_connections.append(conn_id)

        for conn_id in dead_connections:
            self._connections[camera_tag].pop(conn_id, None)

        if not self._connections[camera_tag]:
            del self._connections[camera_tag]
            await self._stop_stream(camera_id, channel)


# Singleton instance
_stream_manager: Optional[VideoStreamManager] = None


def get_stream_manager() -> VideoStreamManager:
    """Get the singleton VideoStreamManager instance."""
    global _stream_manager  # pylint: disable=global-statement
    if _stream_manager is None:
        _stream_manager = VideoStreamManager()
    return _stream_manager
