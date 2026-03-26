# Camera Handling in Xiaomi Miloco

This document explains how Xiaomi Miloco discovers Xiaomi cameras, what information it can retrieve from them, and what controls it has over them.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Authentication and OAuth2](#2-authentication-and-oauth2)
3. [Camera Discovery](#3-camera-discovery)
   - 3.1 [Supported Device Classes](#31-supported-device-classes)
   - 3.2 [Multi-Channel Cameras](#32-multi-channel-cameras)
   - 3.3 [Explicitly Unsupported Models (Denylist)](#33-explicitly-unsupported-models-denylist)
4. [Camera Information](#4-camera-information)
   - 4.1 [Static Device Metadata](#41-static-device-metadata)
   - 4.2 [Live / Dynamic State](#42-live--dynamic-state)
   - 4.3 [Media Frame Metadata](#43-media-frame-metadata)
5. [Camera Controls](#5-camera-controls)
   - 5.1 [Lifecycle: Create, Start, Stop, Destroy](#51-lifecycle-create-start-stop-destroy)
   - 5.2 [Stream Quality](#52-stream-quality)
   - 5.3 [Audio](#53-audio)
   - 5.4 [PIN Code / Device Lock](#54-pin-code--device-lock)
   - 5.5 [Automatic Reconnection](#55-automatic-reconnection)
   - 5.6 [Access Token Refresh](#56-access-token-refresh)
6. [Media Data Streams](#6-media-data-streams)
   - 6.1 [Raw Video (H.264 / H.265)](#61-raw-video-h264--h265)
   - 6.2 [Raw Audio](#62-raw-audio)
   - 6.3 [Decoded JPEG Snapshots](#63-decoded-jpeg-snapshots)
   - 6.4 [Decoded PCM Audio](#64-decoded-pcm-audio)
7. [LAN Discovery and Status](#7-lan-discovery-and-status)
8. [How Miloco Uses Camera Data](#8-how-miloco-uses-camera-data)
   - 8.1 [Vision for the AI Agent (Chat)](#81-vision-for-the-ai-agent-chat)
   - 8.2 [Trigger Rules](#82-trigger-rules)
   - 8.3 [Live Video Streaming (Web UI)](#83-live-video-streaming-web-ui)
9. [Component / Layer Map](#9-component--layer-map)

---

## 1. Architecture Overview

```
Web UI (React)
  └─ DeviceItem / VideoPlayer          live H.264/H.265 frames over WebSocket
       │
       └─ Backend REST + WebSocket API  (FastAPI – miloco_server)
            │
            ├─ MiotController  ←────  HTTP endpoints + WS /miot/ws/video_stream
            ├─ MiotService
            ├─ MiotProxy  ──────────── manages CameraVisionHandler per camera
            │
            └─ miot_kit  (Python wrapper around libmiot_camera_lite)
                 ├─ MIoTClient           top-level entry point
                 ├─ MIoTCamera           pool of MIoTCameraInstance objects
                 ├─ MIoTCameraInstance   per-camera lifecycle + callbacks
                 ├─ MIoTMediaDecoder     background thread: H.264/H.265→JPEG,
                 │                       Opus/G.711→PCM
                 └─ libmiot_camera_lite  native shared library (Linux/macOS/Windows,
                                         x86_64 / arm64 / arm32)
```

The native library handles the P2P signalling and RTSP-like protocol to the camera, completely opaque to the Python layer. The Python layer receives raw NAL-unit frames via C function callbacks and routes them to registered async callbacks in the event loop.

---

## 2. Authentication and OAuth2

All camera functionality requires a valid Xiaomi Home OAuth2 access token.

| Step | Code location | Detail |
|------|---------------|--------|
| Generate login URL | `MIoTOAuth2Client.gen_auth_url()` (`miot_kit/miot/cloud.py`) | Builds `https://account.xiaomi.com/oauth2/authorize` URL with `client_id`, `redirect_uri`, `state` |
| Exchange code for token | `MIoTOAuth2Client.get_access_token_async(code)` | POST to `mico.api.mijia.tech/app/v2/mico/oauth/get_token` |
| Refresh token | `MIoTOAuth2Client.refresh_access_token_async(refresh_token)` | Same endpoint with `refresh_token` |
| Auto-refresh | `MiotProxy._start_token_refresh_task()` | Background task checks every 5 minutes; refreshes when token expires in ≤ 30 minutes |
| Update camera library | `MIoTCamera.update_access_token_async(token)` | Pushes new token into native lib via `miot_camera_update_access_token` |

Tokens are persisted to a local KV store (`AuthConfigKeys.MIOT_TOKEN_INFO_KEY`) so they survive restarts.

Supported cloud-server regions: `cn`, `de`, `us`, `ru`, `sg`, `i2` (India).

---

## 3. Camera Discovery

### 3.1 Supported Device Classes

Camera discovery is done through `MIoTClient.get_cameras_async()` (`miot_kit/miot/client.py`). It:

1. Fetches all devices from the Xiaomi Home cloud via `get_devices_async()`.
2. Filters by *device class* (the second `.`-separated segment of the model string, e.g. `xiaomi.camera.082ac1` → class `camera`).
3. Applies the allow/deny lists from `miot_kit/miot/configs/camera_extra_info.yaml`.

The three device classes that pass the filter are:

| Class | Example models |
|-------|----------------|
| `camera` | All Xiaomi-branded cameras not on the denylist |
| `wifispeaker` | Xiaomi smart home screens (e.g. `xiaomi.wifispeaker.oh11`) |
| `controller` | Xiaomi smart central control screens (e.g. `xiaomi.controller.oh10p`) |

The `wifispeaker` and `controller` classes are explicitly **allowlisted** (only specific models pass); the `camera` class is implicitly allowed (all models that are not on the denylist pass).

### 3.2 Multi-Channel Cameras

Several dual-lens models expose two independent video channels. The `channel_count` field is read from `camera_extra_info.yaml`. Models with `channel_count: 2`:

| Model ID | Product name |
|----------|-------------|
| `chuangmi.camera.068ac1` | 小白智能户外摄像机Q2 双摄照明版 |
| `chuangmi.camera.111ac1` | 小白智能摄像机 A2双摄版 |
| `chuangmi.camera.72ac1` | 小米智能摄像机C300双摄版 |
| `isa.camera.cw501d` | 小米室外摄像机 4 双摄版 |
| `isa.camera.hlmax` | 小米室外摄像机CW500双摄版 |
| `mxiang.camera.c500ch` | 小米智能摄像机C500双摄版 |
| `xiaomi.camera.082ac1` | 小米智能摄像机 4 双摄版 |

All other supported camera models default to `channel_count: 1`.

### 3.3 Explicitly Unsupported Models (Denylist)

Older and third-party vendor models are blocked. Reasons fall into two categories:

* **Year restriction** – pre-2021 hardware (2017–2020).
* **Unsupported vendor** – e.g. 上海创米数联智能科技 (Chuangmi old vendor), xiaovv, xzh.

Examples of denied models (see full list in `camera_extra_info.yaml`):

```yaml
chuangmi.camera.v2:  # 2017, unsupported vendor
chuangmi.camera.ipc009:  # 2018, unsupported vendor
isa.camera.hlc6:  # 2020
xiaovv.camera.ptz:  # 2020, unsupported vendor
```

---

## 4. Camera Information

### 4.1 Static Device Metadata

Returned by `get_cameras_async()` / `get_miot_camera_list()` as `MIoTCameraInfo` (extends `MIoTDeviceInfo`).

| Field | Type | Description |
|-------|------|-------------|
| `did` | `str` | Unique device ID |
| `name` | `str` | Human-readable device name |
| `uid` | `str` | Owner user ID |
| `urn` | `str` | Device URN (type identifier) |
| `model` | `str` | Full model string (e.g. `xiaomi.camera.082ac1`) |
| `manufacturer` | `str` | Manufacturer name |
| `connect_type` | `int` | Connection type code |
| `pid` | `int` | Product ID |
| `token` | `str` | Device token (used internally) |
| `online` | `bool` | Cloud-reported online status |
| `voice_ctrl` | `int` | Voice control status |
| `order_time` | `int` | Timestamp when device was bound |
| `sub_devices` | `dict` | Sub-device map (e.g. sensor nodes) |
| `is_set_pincode` | `int` | `1` if PIN code protection is enabled |
| `pincode_type` | `int` | PIN type |
| `home_id` | `str?` | Home this camera belongs to |
| `home_name` | `str?` | Human-readable home name |
| `room_id` | `str?` | Room this camera is in |
| `room_name` | `str?` | Human-readable room name |
| `rssi` | `int?` | Wi-Fi signal strength |
| `ssid` | `str?` | Wi-Fi network name |
| `bssid` | `str?` | Wi-Fi BSSID |
| `icon` | `str?` | URL of device icon image |
| `parent_id` | `str?` | Parent device ID |
| `owner_id` | `str?` | Owner user ID (may differ from uid for shared devices) |
| `owner_nickname` | `str?` | Owner display name |
| `fw_version` | `str?` | Firmware version |
| `mcu_version` | `str?` | MCU firmware version |
| `platform` | `str?` | Platform / chip identifier |
| `channel_count` | `int` | Number of video channels |

### 4.2 Live / Dynamic State

Updated after establishing a connection to the camera.

| Field | Type | Values | How obtained |
|-------|------|--------|--------------|
| `camera_status` | `MIoTCameraStatus` | `DISCONNECTED=1`, `CONNECTING=2`, `RE_CONNECTING=3`, `CONNECTED=4`, `ERROR=5` | `get_status_async()` / `__on_status_changed()` callback |
| `online` | `bool` | derived: `True` iff `camera_status == CONNECTED` | Updated automatically on every status change |
| `lan_status` | `bool?` | LAN reachability | `MIoTLan.ping_async()` + mDNS/UDP probe |
| `local_ip` | `str?` | LAN IP address | Set when LAN device is discovered |

#### Status-change callback

Register an async callback to receive real-time status updates:

```python
await camera_instance.register_status_changed_async(
    callback=async_on_status_changed   # async def f(did: str, status: MIoTCameraStatus)
)
```

The native library invokes this callback on every connection state transition.

### 4.3 Media Frame Metadata

Each frame delivered from the native library carries a header (`_MIoTCameraFrameHeaderC`):

| Field | Type | Description |
|-------|------|-------------|
| `codec_id` | `MIoTCameraCodec` | `VIDEO_H264=4`, `VIDEO_HEVC/H265=5`, `AUDIO_PCM=1024`, `AUDIO_G711U=1026`, `AUDIO_G711A=1027`, `AUDIO_OPUS=1032` |
| `length` | `uint32` | Payload size in bytes |
| `timestamp` | `uint64` | Camera presentation timestamp |
| `sequence` | `uint32` | Monotonically increasing frame counter |
| `frame_type` | `MIoTCameraFrameType` | `FRAME_P=0` (inter-frame), `FRAME_I=1` (keyframe) |
| `channel` | `uint8` | Channel index (0-based) |

---

## 5. Camera Controls

### 5.1 Lifecycle: Create, Start, Stop, Destroy

```
MIoTCamera.create_camera_async(camera_info)   → MIoTCameraInstance
    │
MIoTCameraInstance.start_async(...)           → connects, registers C callbacks, starts decoders
    │
    └─ stream data flows via registered callbacks
    │
MIoTCameraInstance.stop_async()               → disconnects, stops decoders
    │
MIoTCameraInstance.destroy_async()            → stop + free C instance + clear callbacks
```

At the `MIoTCamera` pool level, identical methods are available by `did`:

```python
await camera_client.create_camera_async(camera_info)
await camera_client.start_camera_async(did, qualities=..., enable_audio=..., pin_code=...)
await camera_client.stop_camera_async(did)
await camera_client.destroy_camera_async(did)
await camera_client.get_camera_status_async(did)   # → MIoTCameraStatus
```

Miloco's `MiotProxy` creates an instance per camera on `refresh_cameras()` and calls `start_async(enable_reconnect=True)` immediately, keeping all cameras permanently connected while they are online.

### 5.2 Stream Quality

Controlled via `MIoTCameraVideoQuality`:

| Value | Constant | Typical use |
|-------|----------|-------------|
| `1` | `LOW` | Default (lower bandwidth) |
| `3` | `HIGH` | Live streaming in the web UI |

When starting a camera, one quality level is passed per channel:

```python
await camera_instance.start_async(
    qualities=MIoTCameraVideoQuality.HIGH         # single value → applied to all channels
    # or
    qualities=[MIoTCameraVideoQuality.HIGH, MIoTCameraVideoQuality.LOW]  # per-channel list
)
```

The quality array is passed directly to the native library via `_MIoTCameraConfigC.video_qualities`.

### 5.3 Audio

Audio streaming is **opt-in** and disabled by default.

```python
await camera_instance.start_async(enable_audio=True)
```

When `enable_audio=True`, the `MIoTMediaDecoder` also initialises an audio pipeline. Supported input codecs: Opus, G.711-μ (PCMU), G.711-A (PCMA). Output is decoded to PCM at 16 kHz mono (via `AudioResampler`).

### 5.4 PIN Code / Device Lock

If `is_set_pincode > 0` on the camera's metadata, the device is locked. A 4-digit PIN must be supplied:

```python
await camera_instance.start_async(pin_code="1234")
```

The web UI shows a lock icon and refuses to start the stream without a PIN. The `MIoTCamera.start_camera_async()` method validates that the PIN is exactly 4 characters before passing it to the native library.

### 5.5 Automatic Reconnection

The library implements exponential back-off reconnection, controlled by two constants in `miot_kit/miot/const.py`:

| Constant | Value | Description |
|----------|-------|-------------|
| `CAMERA_RECONNECT_TIME_MIN` | `3` seconds | Initial reconnect delay |
| `CAMERA_RECONNECT_TIME_MAX` | `1200` seconds (20 min) | Maximum reconnect delay |

Enable with:

```python
await camera_instance.start_async(enable_reconnect=True)
```

On `DISCONNECTED` status callback, the instance schedules a `__try_start_async()` task with the current timeout, then doubles it on each failure (capped at `CAMERA_RECONNECT_TIME_MAX`). A successful connection resets the delay to `CAMERA_RECONNECT_TIME_MIN`.

### 5.6 Access Token Refresh

The access token must be pushed into the native library whenever it is refreshed:

```python
await camera_client.update_access_token_async(new_token)
# Calls: lib.miot_camera_update_access_token(token_bytes)
```

`MiotProxy._start_token_refresh_task()` runs a background loop that calls this automatically every 5 minutes (or immediately when expiry is ≤ 30 minutes away).

---

## 6. Media Data Streams

All data delivery is callback-based. Callbacks are registered on a `MIoTCameraInstance` and dispatched via `asyncio.run_coroutine_threadsafe` from the C callback thread into the main event loop.

### 6.1 Raw Video (H.264 / H.265)

Register to receive raw NAL-unit buffers (AnnexB format) suitable for direct WebSocket delivery:

```python
async def on_raw_video(did: str, data: bytes, ts: int, seq: int, channel: int):
    ...

reg_id = await camera_instance.register_raw_video_async(
    callback=on_raw_video,
    channel=0,         # 0-based channel index
    multi_reg=False    # True allows multiple simultaneous registrations per channel
)
```

Unregister with `unregister_raw_video_async(channel, reg_id)`.

The native library fires `_MIOT_CAMERA_ON_RAW_DATA` for every incoming frame. Frames with `codec_id` ∈ {`VIDEO_H264`, `VIDEO_HEVC`} are routed to the raw-video callbacks. Frames with recognised audio codec IDs are routed to raw-audio callbacks. Unknown codec IDs are logged and dropped.

### 6.2 Raw Audio

```python
async def on_raw_audio(did: str, data: bytes, ts: int, seq: int, channel: int):
    ...

reg_id = await camera_instance.register_raw_audio_async(
    callback=on_raw_audio, channel=0
)
```

Audio codec IDs: `AUDIO_OPUS=1032`, `AUDIO_G711U=1026`, `AUDIO_G711A=1027`.

### 6.3 Decoded JPEG Snapshots

The `MIoTMediaDecoder` background thread decodes incoming H.264/H.265 frames using PyAV and converts each video frame to JPEG (quality 90). Delivery is throttled by `frame_interval` (default **500 ms**).

```python
async def on_jpg(did: str, data: bytes, ts: int, channel: int):
    # data is a complete JPEG file
    ...

await camera_instance.register_decode_jpg_async(callback=on_jpg, channel=0)
```

`MiotProxy` / `CameraVisionHandler` uses this callback to maintain a **size-limited, TTL-based in-memory image queue** per channel:

* Maximum size: `camera_img_cache_max_size` (derived from the larger of `chat.vision_use_img_count` and `trigger_rule_runner.vision_use_img_count` from `server_config.yaml`).
* TTL: `frame_interval × cache_max_size / 1000 × 2` seconds (minimum 1 second).

Recent frames are retrieved by `MiotProxy.get_recent_camera_img(camera_id, channel, n)`, which returns a `CameraImgSeq` that can be serialised to base64 or saved to disk.

**Hardware acceleration**: `MIoTMediaDecoder` will use `h264_v4l2m2m` / `hevc_v4l2m2m` if detected via `ffmpeg -hwaccels`.

### 6.4 Decoded PCM Audio

```python
async def on_pcm(did: str, data: bytes, ts: int, channel: int):
    # data is 16-bit signed little-endian PCM, 16 kHz, mono
    ...

await camera_instance.register_decode_pcm_async(callback=on_pcm, channel=0)
```

Only Opus decoding is implemented in `MIoTMediaDecoder` (`AudioCodecContext.create("opus", "r")`); G.711 variants are received as raw audio but not yet decoded to PCM in the decoder thread.

---

## 7. LAN Discovery and Status

`MIoTLan` (`miot_kit/miot/lan.py`) performs network-layer discovery to determine whether a camera is reachable on the local network. This supplements the cloud-reported `online` flag.

* Uses **mDNS** and a custom **UDP keepalive probe** mechanism.
* When a LAN device comes online, `local_ip` is populated on the `MIoTDeviceInfo`.
* `lan_status` (`bool`) reflects current LAN reachability.
* `MIoTClient.refresh_cameras_status_async()` triggers a LAN ping (rate-limited to at most once per `MIoTLan.OT_PROBE_INTERVAL_MIN`).

The system maintains two independent "online" indicators:
1. **Cloud online** – polled via `get_devices_async()`.
2. **LAN status** – detected locally via mDNS/UDP.

---

## 8. How Miloco Uses Camera Data

### 8.1 Vision for the AI Agent (Chat)

When a user sends a message in the AI Hub and cameras are selected, `MiotService.get_miot_cameras_img()` is called:

1. It collects camera `did` + `channel` pairs for all selected cameras.
2. Calls `MiotProxy.get_recent_camera_img(did, channel, n)` for each, retrieving the last `n` JPEG frames from the in-memory queue.
3. Returns a list of `CameraImgSeq` objects.
4. The calling chat agent serialises these images (base64 or file paths) and passes them as vision inputs to the visual LLM.

The number of frames requested (`vision_use_img_count`) is configured in `config/server_config.yaml`.

### 8.2 Trigger Rules

Rules in the *Rules Management* page define:

* **Active cameras** – which cameras provide visual context.
* **Trigger condition** – natural language, evaluated by the LLM against the latest camera frames.
* **Execution action** – device controls, scenes, notifications, MCP tool calls.

`TriggerRuleRunner` periodically (every `trigger_rule_runner.interval_seconds`) evaluates all active rules:

1. Fetches recent JPEG frames for each rule's cameras via `MiotService.get_miot_cameras_img()`.
2. Calls the visual LLM with the frames and the trigger condition.
3. If the condition is met, executes the configured action.

### 8.3 Live Video Streaming (Web UI)

The backend exposes a **WebSocket endpoint**:

```
GET /api/miot/ws/video_stream?camera_id=<did>&channel=<n>
```

Implemented in `MIoTVideoStreamManager` (`miloco_server/controller/miot_controller.py`):

* On the **first** WebSocket connection for a `camera_id.channel` pair, calls `MiotService.start_video_stream()` → `MiotProxy.start_camera_raw_stream()` → `CameraVisionHandler.register_raw_stream()`.
* Raw H.264/H.265 NAL-unit bytes are forwarded directly to **all** connected WebSocket clients.
* On the **last** WebSocket disconnect, calls `stop_video_stream()` → `unregister_raw_stream()`.
* Maximum **4 concurrent WebSocket connections** per `camera_id.channel` pair per user token. Oldest connection is closed when the limit is exceeded.

The web UI's `VideoPlayer` component (`web_ui/src/pages/Instant/components/VideoPlayer/index.jsx`) receives the binary frames and decodes them client-side using the browser **WebCodecs API** (`VideoDecoder`), rendering directly onto a `<canvas>`. Key behaviours:

* Auto-detects codec from NAL headers (`h264` vs `h265`).
* Drops frames until the first I-frame (keyframe sync).
* Requires Chrome 94+ or Edge 94+ (WebCodecs) over HTTPS or localhost.
* Supports channel switching on multi-channel cameras.

---

## 9. Component / Layer Map

```
miot_kit/miot/configs/camera_extra_info.yaml
  └── allow_classes, extra_info (channel_count), allowlist, denylist

miot_kit/miot/types.py
  ├── MIoTCameraInfo          (static + live metadata)
  ├── MIoTCameraStatus        (DISCONNECTED / CONNECTING / RE_CONNECTING / CONNECTED / ERROR)
  ├── MIoTCameraVideoQuality  (LOW=1 / HIGH=3)
  ├── MIoTCameraCodec         (VIDEO_H264=4, VIDEO_HEVC=5, AUDIO_*)
  ├── MIoTCameraFrameType     (FRAME_P=0, FRAME_I=1)
  └── MIoTCameraFrameData     (full frame with metadata)

miot_kit/miot/camera.py
  ├── MIoTCameraInstance      (per-camera: start/stop/destroy, register callbacks)
  └── MIoTCamera              (pool: create/get/destroy instances, token update)

miot_kit/miot/decoder.py
  └── MIoTMediaDecoder        (background thread: H.264/H.265 → JPEG, Opus → PCM 16kHz mono)

miot_kit/miot/client.py
  └── MIoTClient              (top-level: auth, devices, cameras, scenes, LAN)

miloco_server/proxy/miot_proxy.py
  └── MiotProxy               (app-level cache, CameraVisionHandler per camera,
                               token auto-refresh task)

miloco_server/utils/carmera_vision_handler.py
  └── CameraVisionHandler     (per-camera: JPEG queue, raw-stream registration)

miloco_server/service/miot_service.py
  └── MiotService             (business logic: list cameras, start/stop video,
                               get images for LLM)

miloco_server/controller/miot_controller.py
  ├── GET  /miot/camera_list          → list cameras
  ├── GET  /miot/refresh_miot_cameras → refresh camera list from cloud
  └── WS   /miot/ws/video_stream      → live H.264/H.265 stream (MIoTVideoStreamManager)

web_ui/src/pages/Instant/
  ├── DeviceList   → fetches camera list, renders DeviceItem grid
  ├── DeviceItem   → play/stop toggle, channel switch, zoom
  └── VideoPlayer  → WebCodecs decoder, canvas rendering, WebSocket client
```
