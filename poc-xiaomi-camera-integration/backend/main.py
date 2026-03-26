"""
PoC FastAPI server for Xiaomi camera integration.

Endpoints:
  GET  /api/auth/login_url        - Get Xiaomi OAuth2 login URL
  GET  /api/auth/callback         - OAuth2 callback (receives code & state)
  GET  /api/auth/status           - Check authentication status
  GET  /api/cameras               - List discovered cameras
  WS   /api/ws/stream             - WebSocket video stream for a camera
"""

import logging
import os
import sys
from typing import Any

import uvicorn
from fastapi import FastAPI, WebSocket, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.websockets import WebSocketDisconnect
from pydantic import BaseModel

from config import (
    FRONTEND_URL,
    SERVER_HOST,
    SERVER_PORT,
    SERVER_LOG_LEVEL,
)
from auth import get_auth_manager
from camera_manager import get_camera_list, get_stream_manager
from miot.types import MIoTSetPropertyParam, MIoTActionParam, MIoTGetPropertyParam

logging.basicConfig(
    level=getattr(logging, SERVER_LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Xiaomi Camera PoC",
    description="Standalone PoC for Xiaomi camera integration using miot_kit",
    version="1.0.0",
)

# Allow requests from the React dev server and the same origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL, "http://localhost:5173", "http://localhost:8080"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Auth endpoints
# ---------------------------------------------------------------------------


class OAuthCodeExchangeRequest(BaseModel):
    """OAuth2 code exchange request payload."""

    code: str
    state: str
    region: str = "cn"  # Cloud server region (cn, de, us, ru, tw, sg, in, i2)


class SetPropertyRequest(BaseModel):
    """Request to set a device property."""

    siid: int
    piid: int
    value: Any


class CallActionRequest(BaseModel):
    """Request to call a device action."""

    siid: int
    aiid: int
    in_: list = []  # Action input parameters


class GetPropertyRequest(BaseModel):
    """A single siid/piid pair for batch property reads."""

    siid: int
    piid: int


@app.get("/api/auth/login_url", summary="Get Xiaomi OAuth2 login URL")
async def get_login_url(region: str = Query("cn")):
    """Return the Xiaomi Home OAuth2 authorization URL for the specified region."""
    auth = get_auth_manager()
    try:
        url = await auth.get_login_url(region=region)
        return {"login_url": url}
    except Exception as err:  # pylint: disable=broad-exception-caught
        logger.error("Failed to generate login URL: %s", err)
        raise HTTPException(status_code=500, detail=str(err)) from err


@app.get("/api/auth/callback", summary="OAuth2 callback", response_class=HTMLResponse)
async def oauth_callback(code: str = Query(...), state: str = Query(...)):
    """Handle the OAuth2 redirect from Xiaomi Home."""
    auth = get_auth_manager()
    try:
        oauth_info = await auth.process_callback(code=code, state=state)
        user_info = oauth_info.user_info
        nickname = user_info.nickname if user_info else "Unknown"
        html = f"""
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <title>Login Successful</title>
          <style>
            body {{ font-family: sans-serif; display: flex; align-items: center;
                   justify-content: center; height: 100vh; margin: 0;
                   background: #f0f2f5; }}
            .card {{ background: white; border-radius: 12px; padding: 40px 48px;
                    box-shadow: 0 4px 24px rgba(0,0,0,.1); text-align: center; }}
            h2 {{ color: #1677ff; margin-bottom: 8px; }}
            p {{ color: #555; margin-bottom: 24px; }}
            button {{ background: #1677ff; color: white; border: none;
                     border-radius: 6px; padding: 10px 24px; font-size: 15px;
                     cursor: pointer; }}
            button:hover {{ background: #0958d9; }}
          </style>
        </head>
        <body>
          <div class="card">
            <h2>&#10003; Login Successful</h2>
            <p>Welcome, <strong>{nickname}</strong>! You can close this window.</p>
            <button onclick="window.close()">Close</button>
          </div>
          <script>
            // Notify the opener window that login is complete, then close.
            if (window.opener) {{
              window.opener.postMessage({{ type: 'XIAOMI_LOGIN_SUCCESS' }}, '*');
              setTimeout(() => window.close(), 1500);
            }}
          </script>
        </body>
        </html>
        """
        return HTMLResponse(content=html)
    except Exception as err:  # pylint: disable=broad-exception-caught
        logger.error("OAuth callback failed: %s", err)
        html = f"""
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <title>Login Failed</title>
          <style>
            body {{ font-family: sans-serif; display: flex; align-items: center;
                   justify-content: center; height: 100vh; margin: 0;
                   background: #f0f2f5; }}
            .card {{ background: white; border-radius: 12px; padding: 40px 48px;
                    box-shadow: 0 4px 24px rgba(0,0,0,.1); text-align: center; }}
            h2 {{ color: #ff4d4f; margin-bottom: 8px; }}
            p {{ color: #555; margin-bottom: 24px; }}
          </style>
        </head>
        <body>
          <div class="card">
            <h2>&#10007; Login Failed</h2>
            <p>{str(err)}</p>
          </div>
          <script>
            if (window.opener) {{
              window.opener.postMessage({{ type: 'XIAOMI_LOGIN_FAILED', error: '{str(err)}' }}, '*');
            }}
          </script>
        </body>
        </html>
        """
        return HTMLResponse(content=html, status_code=400)


@app.post("/api/auth/logout", summary="Log out and invalidate session")
async def logout():
    """Clear the server-side session so subsequent /api/auth/status calls return unauthenticated."""
    auth = get_auth_manager()
    await auth.logout_async()
    return {"authenticated": False}


@app.get("/api/auth/status", summary="Check authentication status")
async def auth_status():
    """Return whether the user is authenticated and basic user info."""
    auth = get_auth_manager()
    if not auth.is_authenticated:
        return {"authenticated": False}
    try:
        valid = await auth.check_token()
        if not valid:
            return {"authenticated": False}
        user_info = auth.oauth_info.user_info
        return {
            "authenticated": True,
            "user": {
                "uid": user_info.uid if user_info else None,
                "nickname": user_info.nickname if user_info else None,
                "icon": user_info.icon if user_info else None,
            },
        }
    except Exception as err:  # pylint: disable=broad-exception-caught
        logger.error("Failed to check auth status: %s", err)
        return {"authenticated": False}


@app.post("/api/auth/exchange", summary="Exchange OAuth2 code and state")
async def exchange_oauth_code(payload: OAuthCodeExchangeRequest):
    """Exchange OAuth2 code/state for token when callback cannot be hosted locally."""
    auth = get_auth_manager()
    try:
        oauth_info = await auth.process_callback(
            code=payload.code, 
            state=payload.state, 
            region=payload.region
        )
        user_info = oauth_info.user_info
        return {
            "authenticated": True,
            "user": {
                "uid": user_info.uid if user_info else None,
                "nickname": user_info.nickname if user_info else None,
                "icon": user_info.icon if user_info else None,
            },
        }
    except Exception as err:  # pylint: disable=broad-exception-caught
        logger.error("OAuth code exchange failed: %s", err)
        raise HTTPException(status_code=400, detail=str(err)) from err


# ---------------------------------------------------------------------------
# Xiaomi OAuth relay callback
# ---------------------------------------------------------------------------

@app.get("/miot/xiaomi_home_callback", response_class=HTMLResponse, include_in_schema=False)
@app.get("/api/miot/xiaomi_home_callback", summary="Xiaomi OAuth relay callback", response_class=HTMLResponse)
async def xiaomi_home_callback(code: str = Query(...), state: str = Query(...)):
    """
    Receives the OAuth2 redirect from https://mico.api.mijia.tech/login_redirect.

    The Xiaomi relay service forwards the user's browser here after they grant
    access on the Xiaomi login page.  This endpoint exchanges the code for a
    token and renders an auto-closing success/error page.
    """
    template_path = os.path.join(os.path.dirname(__file__), "templates", "miot_login_callback.html")
    with open(template_path, encoding="utf-8") as f:
        template = f.read()

    auth = get_auth_manager()
    try:
        oauth_info = await auth.process_callback(code=code, state=state)
        user_info = oauth_info.user_info
        nickname = user_info.nickname if user_info else "Xiaomi User"
        html = (
            template
            .replace("TITLE_PLACEHOLDER", "Authorization Successful")
            .replace("CONTENT_PLACEHOLDER", f"Welcome, {nickname}! This window will close automatically.")
            .replace("BUTTON_PLACEHOLDER", "Close")
            .replace("STATUS_PLACEHOLDER", "true")
        )
        return HTMLResponse(content=html)
    except Exception as err:  # pylint: disable=broad-exception-caught
        logger.error("OAuth relay callback failed: %s", err)
        html = (
            template
            .replace("TITLE_PLACEHOLDER", "Authorization Failed")
            .replace("CONTENT_PLACEHOLDER", f"Login failed: {err}")
            .replace("BUTTON_PLACEHOLDER", "Close")
            .replace("STATUS_PLACEHOLDER", "false")
        )
        return HTMLResponse(content=html, status_code=400)


# ---------------------------------------------------------------------------
# Camera endpoints
# ---------------------------------------------------------------------------

@app.get("/api/cameras", summary="List discovered cameras")
async def list_cameras():
    """Return a list of Xiaomi cameras discovered from the user's home."""
    auth = get_auth_manager()
    if not auth.is_authenticated:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        cameras = await get_camera_list()
        # Eagerly start all camera instances so the relay connection is established
        # before any viewer connects (mirrors miloco_server behavior).
        await get_stream_manager().start_all_cameras_async()
        return {"cameras": cameras}
    except Exception as err:  # pylint: disable=broad-exception-caught
        logger.error("Failed to list cameras: %s", err)
        raise HTTPException(status_code=500, detail=str(err)) from err


@app.get("/api/devices/{did}/properties", summary="Get common properties for a device")
async def list_device_properties(did: str):
    """Return known camera control properties for a device.
    
    Returns a list of common siid/piid values that control camera features
    like recording, guard mode, night vision, etc.
    """
    auth = get_auth_manager()
    if not auth.is_authenticated:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    try:
        # Get the device info
        devices = await auth.client.get_devices_async()
        if did not in devices:
            raise ValueError(f"Device {did} not found")
        
        device = devices[did]
        logger.info("Device: %s (model: %s, name: %s)", did, device.model, device.name)
        
        # Return common camera control properties
        # These are standard MIoT spec properties for cameras
        common_properties = {
            "did": did,
            "model": device.model,
            "name": device.name,
            "properties": [
                {
                    "description": "Guard mode (security/monitoring on/off)",
                    "siid": 2,
                    "piid": 1,
                    "type": "boolean",
                    "test_value": True
                },
                {
                    "description": "Camera power/enable",
                    "siid": 2,
                    "piid": 2,
                    "type": "boolean",
                    "test_value": True
                },
                {
                    "description": "Status indicator light",
                    "siid": 3,
                    "piid": 1,
                    "type": "boolean",
                    "test_value": False
                },
                {
                    "description": "Recording mode",
                    "siid": 4,
                    "piid": 1,
                    "type": "boolean or enum",
                    "test_value": True
                },
                {
                    "description": "Motion detection/tracking",
                    "siid": 4,
                    "piid": 2,
                    "type": "boolean",
                    "test_value": True
                },
                {
                    "description": "Night vision/infrared",
                    "siid": 5,
                    "piid": 1,
                    "type": "enum",
                    "test_value": "Auto"
                }
            ],
            "hint": "Try these siid/piid combinations. If one returns 'success': true, it controls that feature. You can find exact specs at: /backend/cache/miot_specs/spec_std_lib.dict"
        }
        
        return common_properties
    except Exception as err:  # pylint: disable=broad-exception-caught
        logger.error("Failed to list properties: %s", err)
        raise HTTPException(status_code=500, detail=str(err)) from err


@app.post("/api/devices/{did}/prop/set", summary="Set device property")
async def set_device_property(did: str, payload: SetPropertyRequest):
    """Set a boolean property on a device (e.g., enable/disable recording).
    
    Args:
        did: Device ID from the URL path
        payload: Request with siid (service instance ID), piid (property instance ID), and value
        
    Returns:
        Result from the cloud API
    """
    auth = get_auth_manager()
    if not auth.is_authenticated:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    try:
        client = auth.client
        if not client or not client.http_client:
            raise RuntimeError("MIoT client not initialized")
        
        # Create a property param with the device ID from the URL
        param = MIoTSetPropertyParam(
            did=did,
            siid=payload.siid,
            piid=payload.piid,
            value=payload.value
        )
        
        result = await client.http_client.set_prop_async(param=param)
        logger.info("Set property: did=%s siid=%d piid=%d value=%s -> %s", 
                   did, payload.siid, payload.piid, payload.value, result)
        
        return {"success": True, "result": result}
    except Exception as err:  # pylint: disable=broad-exception-caught
        logger.error("Failed to set property: %s", err)
        raise HTTPException(status_code=500, detail=str(err)) from err


_CURATED_PROPERTIES = frozenset([
    "guard-mode", "on", "camera-status", "indicator-light",
    "recording-mode", "motion-detection", "night-shot", "image-rollover",
    "time-watermark", "wdr-mode", "glimmer-full-color", "motion-tracking",
    "local-storage", "hdr-mode", "human-tracking", "ai-frame",
])


@app.get("/api/devices/{did}/spec", summary="Get device MIoT spec properties")
async def get_device_spec(did: str):
    """Resolve all MIoT properties for a device via MIoTSpecParser.

    Returns services with their properties, each including siid/piid,
    format, access flags, enum value lists, and a 'curated' flag for
    well-known camera control properties.
    """
    auth = get_auth_manager()
    if not auth.is_authenticated:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        client = auth.client
        if not client:
            raise RuntimeError("MIoT client not initialized")

        devices = await client.get_devices_async()
        if did not in devices:
            raise HTTPException(status_code=404, detail=f"Device {did} not found")

        urn = devices[did].urn
        if not urn:
            raise HTTPException(status_code=422, detail="Device has no URN — cannot resolve spec")

        spec_device = await client.spec_parser.parse_async(urn)
        if spec_device is None:
            raise HTTPException(status_code=422, detail=f"Could not parse spec for URN: {urn}")

        services = []
        for svc in spec_device.services:
            properties = []
            for prop in svc.properties:
                value_list = None
                if prop.value_list:
                    value_list = [
                        {"value": item.value, "label": item.name}
                        for item in prop.value_list
                    ]
                value_range = None
                if prop.value_range:
                    value_range = {
                        "min": prop.value_range.min_,
                        "max": prop.value_range.max_,
                        "step": prop.value_range.step,
                    }
                properties.append({
                    "piid": prop.iid,
                    "name": prop.name,
                    "description": prop.description,
                    "format": prop.format,
                    "readable": prop.readable,
                    "writable": prop.writable,
                    "unit": prop.unit,
                    "value_list": value_list,
                    "value_range": value_range,
                    "curated": prop.name in _CURATED_PROPERTIES,
                })
            services.append({
                "siid": svc.iid,
                "name": svc.name,
                "description": svc.description,
                "properties": properties,
            })

        return {"did": did, "urn": urn, "services": services}
    except HTTPException:
        raise
    except Exception as err:  # pylint: disable=broad-exception-caught
        logger.error("Failed to get device spec: %s", err)
        raise HTTPException(status_code=500, detail=str(err)) from err


@app.post("/api/devices/{did}/props/values", summary="Batch read property values")
async def get_device_props_values(did: str, payload: list[GetPropertyRequest]):
    """Batch-read current values for a list of siid/piid pairs.

    Returns each property with its current value and a status code.
    code=0 means success; any other code means the property is not
    supported or readable on this device.
    """
    auth = get_auth_manager()
    if not auth.is_authenticated:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        client = auth.client
        if not client or not client.http_client:
            raise RuntimeError("MIoT client not initialized")

        params = [
            MIoTGetPropertyParam(did=did, siid=req.siid, piid=req.piid)
            for req in payload
        ]
        results = await client.http_client.get_props_async(params=params)

        # Normalise result: ensure each entry has siid/piid/value/code
        normalised = []
        for item in (results or []):
            normalised.append({
                "siid": item.get("siid"),
                "piid": item.get("piid"),
                "value": item.get("value"),
                "code": item.get("code", -1),
            })
        return normalised
    except Exception as err:  # pylint: disable=broad-exception-caught
        logger.error("Failed to batch-read properties: %s", err)
        raise HTTPException(status_code=500, detail=str(err)) from err


@app.post("/api/devices/{did}/action", summary="Call device action")
async def call_device_action(did: str, payload: CallActionRequest):
    """Call an action on a device (e.g., pan camera left/right, tilt up/down).
    
    Args:
        did: Device ID from the URL path
        payload: Request with siid (service instance ID), aiid (action instance ID), 
                and optional in_ (list of input parameters)
        
    Returns:
        Result from the cloud API
    """
    auth = get_auth_manager()
    if not auth.is_authenticated:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    try:
        client = auth.client
        if not client or not client.http_client:
            raise RuntimeError("MIoT client not initialized")
        
        # Create an action param
        param = MIoTActionParam(
            did=did,
            siid=payload.siid,
            aiid=payload.aiid,
            in_=payload.in_
        )
        
        result = await client.http_client.action_async(param=param)
        logger.info("Called action: did=%s siid=%d aiid=%d -> %s", 
                   did, payload.siid, payload.aiid, result)
        
        return {"success": True, "result": result}
    except Exception as err:  # pylint: disable=broad-exception-caught
        logger.error("Failed to call action: %s", err)
        raise HTTPException(status_code=500, detail=str(err)) from err


# ---------------------------------------------------------------------------
# WebSocket video stream
# ---------------------------------------------------------------------------

@app.websocket("/api/ws/stream")
async def video_stream(
    websocket: WebSocket,
    camera_id: str = Query(...),
    channel: int = Query(default=0),
):
    """WebSocket endpoint that streams raw H.264/H.265 frames for a camera.

    Query params:
        camera_id: Camera device ID.
        channel: Camera channel number (default 0).
    """
    auth = get_auth_manager()
    stream_mgr = get_stream_manager()
    conn_id = None
    try:
        await websocket.accept()

        if not auth.is_authenticated:
            await websocket.close(code=4001, reason="Not authenticated")
            return

        conn_id = await stream_mgr.new_connection(
            websocket=websocket,
            camera_id=camera_id,
            channel=channel,
        )
        logger.info("WebSocket connected: camera=%s channel=%d conn=%s", camera_id, channel, conn_id)

        # Keep alive — wait for client to disconnect or send a close message
        while True:
            try:
                msg = await websocket.receive_text()
                logger.debug("Received from client: %s", msg)
            except WebSocketDisconnect:
                logger.info("Client disconnected: %s", conn_id)
                break
            except Exception as err:  # pylint: disable=broad-exception-caught
                logger.error("WebSocket receive error: %s", err)
                break
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected: camera=%s channel=%d", camera_id, channel)
    except Exception as err:  # pylint: disable=broad-exception-caught
        logger.error("WebSocket error: %s", err)
        try:
            await websocket.close(code=1011, reason=str(err))
        except Exception:  # pylint: disable=broad-exception-caught
            pass
    finally:
        if conn_id:
            await stream_mgr.close_connection(
                camera_id=camera_id, channel=channel, conn_id=conn_id
            )


# ---------------------------------------------------------------------------
# Startup / shutdown
# ---------------------------------------------------------------------------

@app.on_event("startup")
async def startup_event():
    """Initialize AuthManager on startup."""
    logger.info("Starting Xiaomi Camera PoC backend...")
    auth = get_auth_manager()
    await auth.init_async()
    logger.info("Backend ready")


@app.on_event("shutdown")
async def shutdown_event():
    """Clean up on shutdown."""
    auth = get_auth_manager()
    await auth.deinit_async()
    logger.info("Backend shut down")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=SERVER_HOST,
        port=SERVER_PORT,
        log_level=SERVER_LOG_LEVEL,
        reload=False,
    )
