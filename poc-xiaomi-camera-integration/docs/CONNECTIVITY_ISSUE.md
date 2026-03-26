# Camera Stream Connectivity Issue – Root Cause Assessment

## Symptom

The backend starts the camera stream without error (`try start camera, result->0`), yet
the video never arrives. The logs repeat this cycle every ~6 seconds:

```
[INFO] miot.camera: try start camera, result->0, …, enable_reconnect->True
[INFO] miot.camera: miss … CS: PPCS_Connect errorcode: -3
[INFO] miot.camera: miss … cs2 client connect error 4
[INFO] miot.camera: get reconnect timeout, <did>, 6
```

After ~60 seconds the browser closes the WebSocket and the stream is torn down cleanly.

---

## What `PPCS_Connect errorcode: -3` means

`miot_kit` uses Xiaomi's proprietary **CS2 / PPCS P2P SDK** for camera video. When
`start_async()` is called the SDK attempts to open a direct, low-latency video tunnel
between the _backend process_ and the _camera device_. It tries several methods in order:

| Step | Method | Requires |
|------|--------|----------|
| 1 | Direct LAN UDP (same subnet) | Backend and camera on the same L2 segment |
| 2 | UDP hole-punching via STUN relay | Both sides can reach each other's routable UDP port |
| 3 | TURN relay via Xiaomi's relay server | Backend can reach the relay AND the relay has capacity |

Error code **-3** (`ERROR_PPCS_FAILED_TO_CONNECT`) means all three methods were tried
and every one of them failed. The P2P tunnel was never established, so no video frames
are forwarded and the SDK re-tries on its built-in back-off timer (3 → 6 → 3 → 6 s …).

---

## Why listing cameras and toggling them on/off still works

| Operation | Transport | Direction | Notes |
|-----------|-----------|-----------|-------|
| List cameras | HTTPS REST | Outbound TCP | Cloud API call, always works through NAT |
| Set property / call action | HTTPS REST | Outbound TCP | Cloud API call, always works through NAT |
| Browser → backend WebSocket | HTTP → WS | Inbound TCP (port 8080) | Works because port 8080 is explicitly mapped |
| **Camera P2P video stream** | **UDP (CS2/PPCS)** | **Bidirectional** | **Fails – see below** |

Only the P2P stream requires the backend to be _bidirectionally reachable over UDP_.
Every other operation is a normal HTTPS call that goes _out_ from the container; those
never need inbound reachability and are unaffected by NAT.

---

## Why Docker on Windows is almost certainly the cause

### The double-NAT chain

Running Docker Desktop on Windows creates this network path between the camera and the
backend container:

```
Camera
  │
  │  (public internet / LAN)
  ▼
Home router  ← NAT layer 1
  │
  ▼
Windows host
  │
  ▼
Docker Desktop internal virtual switch / WSL2 virtual network ← NAT layer 2
  │
  ▼
Linux VM (WSL2 or Hyper-V) where containers actually run
  │
  ▼
Docker bridge (miloco-net, 172.x.x.x)  ← NAT layer 3
  │
  ▼
poc-camera-backend container
```

UDP hole-punching (STUN) works by both endpoints sending a packet to the other's
_external_ address simultaneously. For this to succeed:

1. The backend's outbound UDP packet must reach the camera – ✅ works (outbound is fine).
2. The camera's response UDP packet must reach the backend container back – ❌ fails.

The inbound UDP packet arrives at the Windows host via the home router, but:

- Docker Desktop only forwards **TCP** port 8080 from the `ports:` mapping in
  `docker-compose.yml`. **No UDP ports are mapped** – they are completely blocked.
- Even if UDP ports were mapped, Docker Desktop's virtual NIC does not support the
  dynamic port ranges that PPCS/CS2 uses (ports are negotiated via the STUN server and
  are unknown in advance).
- Even with all ports forwarded, the Windows → WSL2 NAT adds a third translation layer
  that is transparent to outbound TCP but opaque to inbound UDP hole-punching.

### Why TURN (relay) also fails

The last fallback is a TURN relay server hosted by Xiaomi. In theory the backend and the
camera both connect _outward_ to the relay, so NAT is not an issue. However:

- Xiaomi's TURN servers are rate-limited and may not be available for unofficial clients.
- The relay endpoint is negotiated over the same CS2 signalling channel that is already
  failing (RPC error 4 = "connection refused / timeout" on the signalling path).
- `rpc error: 4` in the log indicates the RPC call to the camera control plane also
  timed out, so even relay negotiation fails before the video can start.

---

## Diagram: what succeeds vs. what fails

```
Browser (Windows host)
    │  TCP (WebSocket)
    ▼
nginx container (:80)
    │  TCP (reverse proxy)
    ▼
poc-camera-backend container (:8080)   ← backend reaches this far ✅
    │
    │  CS2 / PPCS P2P  (UDP, dynamic port)
    │
    ?  ← inbound UDP blocked by double NAT ❌
    │
    ▼
Xiaomi Camera (on LAN / internet)
```

---

## Solutions

### Option 1 – Run the backend natively (recommended for Windows)

Run the Python backend directly on the Windows host (or in WSL2 with mirrored
networking) **without Docker**. The host has a real IP that the home router can forward
to, and UDP hole-punching works normally.

```powershell
# From the repo root, with venv activated
cd poc-xiaomi-camera-integration\backend
pip install ..\..\miot_kit
pip install -r requirements.txt
python main.py
```

Keep the frontend in Docker or run it with `npm run dev`.

### Option 2 – WSL2 with mirrored networking (Windows 11 22H2+)

Enable WSL2 mirrored-networking mode so WSL2 shares the Windows host IP directly.
Create `%USERPROFILE%\.wslconfig`:

```ini
[wsl2]
networkingMode=mirrored
```

Then run the backend inside WSL2 (not in a Docker container):

```bash
# Inside WSL2 terminal
cd /path/to/repo
pip install miot_kit/ poc-xiaomi-camera-integration/backend/requirements.txt
python poc-xiaomi-camera-integration/backend/main.py
```

Mirrored mode eliminates the WSL2 NAT layer, so inbound UDP hole-punching packets
can reach the backend process directly.

### Option 3 – Run on a Linux host with host networking

On a **Linux** machine (physical or VM with bridged networking), add
`network_mode: host` to the backend service so the container shares the host's
network stack and has no extra NAT layer:

```yaml
# docker-compose.yml  (Linux host only – not supported on Docker Desktop/macOS/Windows)
services:
  backend:
    network_mode: host   # remove the 'networks' and 'ports' for this service
    environment:
      - SERVER_PORT=8080
      # …
```

> ⚠️ `network_mode: host` is **silently ignored** on Docker Desktop (Windows and macOS).
> It only works on Linux hosts with native Docker Engine.

### Option 4 – Deploy to a Linux server or Raspberry Pi

Run the backend on any Linux device connected to the same local network as the cameras.
A Raspberry Pi 4 with Python 3.11 works well and eliminates all Docker networking issues:

```bash
git clone <repo>
cd repo
pip install miot_kit/ poc-xiaomi-camera-integration/backend/requirements.txt
python poc-xiaomi-camera-integration/backend/main.py
```

Point the frontend's proxy (`VITE_API_URL` or the nginx `proxy_pass`) at the
Raspberry Pi's LAN address.

### Option 5 – Same LAN segment (if camera is on the same network)

The CS2 SDK first tries direct LAN UDP before attempting hole-punching. If the backend
runs on the **same subnet** as the camera, step 1 succeeds and no hole-punching is needed.

To enable LAN mode you may need to set `enable_local` in the `start_async` call.
Check the `miot_kit` camera API for the relevant flag.

---

## Quick checklist for diagnosing your setup

1. **Are you on Docker Desktop (Windows or macOS)?**  
   → P2P UDP will not work. Use Option 1, 2, 3 (Linux), or 4 above.

2. **Are you on Docker Engine on Linux?**  
   → Add `network_mode: host` to the backend service.

3. **Is the camera on the same LAN as the backend host (not the container)?**  
   → Direct LAN mode should work; confirm the host and camera can ping each other.

4. **Is only relay available (camera is remote / different LAN)?**  
   → Xiaomi's TURN relay must be reachable and not rate-limited; this may require
   running from a machine with a stable public IP or port-forwarding UDP on the router.

5. **Is the camera online in the Xiaomi Home app?**  
   → If the camera is offline in the app, P2P will also fail from `miot_kit`.

---

## Summary

| Check | Status |
|-------|--------|
| Backend HTTP / REST APIs (list cameras, set property) | ✅ Working (outbound TCP only) |
| Browser ↔ backend WebSocket (port 8080) | ✅ Working (explicit TCP port mapping) |
| Backend ↔ camera P2P video (CS2/PPCS UDP) – Docker Desktop | ❌ Blocked by Docker Desktop double NAT |
| Running backend natively in WSL2 with mirrored networking | ✅ **Confirmed working** (H.265 HEVC stream, ~15 fps) |
| Running backend on Linux host with `network_mode: host` | ✅ Expected to work |
