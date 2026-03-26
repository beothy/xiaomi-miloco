# Next Steps

## Status as of 2026-03-25

### PoC – What works
- ✅ OAuth2 login (EU `de` region)
- ✅ Camera discovery (Bedroom + Living Room C301)
- ✅ Real-time H.265 HEVC streaming at ~15 fps via P2P (WSL2 native, mirrored networking)
- ✅ Multi-camera dashboard

### Known issue – Connection drops after ~1 hour

**Symptom:** Camera streams work initially but drop after some time. Backend logs show:

```
ERROR_PPCS_SESSION_CLOSED_REMOTE
miot_camera_start result -> -2
get reconnect timeout, <did>, 6
get reconnect timeout, <did>, 12
get reconnect timeout, <did>, 24
...
```

**Root cause:**
1. The access token is fetched once at startup and passed to the C library (`libmiot_camera_lite.so`).
2. The C library calls `de.mico.api.mijia.tech` for device info on every reconnect attempt.
3. After ~1 hour the token expires — the HTTP call times out (curl error 28), `miot_camera_start` returns `-2`.
4. The exponential back-off kicks in (`CAMERA_RECONNECT_TIME_MIN=3` → doubles each failure up to `CAMERA_RECONNECT_TIME_MAX=1200`), so the stream never recovers.

**Workaround (now):** Restart the backend — this gets a fresh token.

---

## Tomorrow – Fix connection drop (token refresh)

### Plan

**Goal:** Keep streams alive indefinitely without manual restarts.

The fix lives in `backend/camera_manager.py` and involves detecting a stale token
and reinitialising the `MIoTCameraClient` with a fresh one.

**Steps:**

1. **Detect the stuck state**  
   In `VideoStreamManager`, hook `on_status_changed`. When a camera status becomes
   `DISCONNECTED` and the reconnect failure count exceeds a threshold (e.g. 3 failures
   that all returned result `-2`), trigger a token refresh.

2. **Refresh the token**  
   The `MIoTClient` instance (from `auth.py`) must stay alive in the manager. Call
   `miot_client.refresh_token()` (or re-use the existing token refresh path). The
   `MIoTCameraClient` is constructed with a token — you can't update it in place;
   you must tear it down and recreate it.

3. **Reinitialise the camera client**  
   ```python
   # Pseudocode
   await camera_client.stop_async()
   camera_client = MIoTCameraClient(new_token, region)
   await camera_client.start_async(...)
   ```
   Re-register all active cameras after reinit.

4. **Test**  
   Let the stream run for >1 hour and confirm automatic recovery.

### Key files to touch

| File | What to change |
|------|----------------|
| `backend/camera_manager.py` | Add failure counter per camera, detect `-2` pattern, call reinit |
| `backend/auth.py` | Expose `refresh_token()` or keep `MIoTClient` accessible to manager |

### Relevant miot_kit code

- `miot_kit/miot/camera.py` — `__try_start_async()`, `__get_try_start_timeout()`, `__on_status_changed()`
- `miot_kit/miot/camera.py` — `CAMERA_RECONNECT_TIME_MIN = 3`, `CAMERA_RECONNECT_TIME_MAX = 1200`

---

## Next major goal – Home Assistant custom integration

After the PoC is stable, the plan is to build a proper HA custom component.

### Target platform
- **Development:** WSL2 on Windows 11 (current, confirmed working)
- **Production homelab:** Mac Mini (darwin arm64 — `miot_kit` bundles macOS libs too)

### Architecture sketch

```
custom_components/xiaomi_miloco_camera/
    __init__.py          platform setup, entry unload
    config_flow.py       OAuth2 config flow (reuse auth.py pattern)
    camera.py            HA Camera entity — JPEG snapshots via miot_kit
    coordinator.py       DataUpdateCoordinator — polls device list + status
    const.py             domain, config keys
    manifest.json
```

**Streaming approach:**
- HA Camera entities support `async_camera_image()` (snapshot) and RTSP/go2rtc proxy.
- Simplest path: expose the JPEG snapshot endpoint and let HA handle thumbnails.
- Better UX: forward the raw H.265 frame stream to [go2rtc](https://github.com/AlexxIT/go2rtc) as a custom source → live stream in HA dashboard via WebRTC.

**Token refresh:**
- Same architecture as the PoC fix above — implemented in the coordinator's refresh cycle.

**Open question:**
- `libmiot_camera_lite.so` is a Linux x86_64 binary. On arm64 Mac Mini, the macOS
  `.dylib` equivalent is bundled instead. Confirm `miot_kit` loads the correct binary
  at runtime on macOS (`miot_kit/miot/`) before building HA integration.
