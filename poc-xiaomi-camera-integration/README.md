# Xiaomi Camera Integration PoC

A standalone Proof of Concept (PoC) that demonstrates extracting and reusing
`miot_kit` to integrate Xiaomi cameras (specifically C301) with a simple web UI.

## Features

- 🔐 **OAuth2 login** with Xiaomi Home (popup-based flow)
- 📷 **Camera discovery** – lists all cameras from your Xiaomi Home account
- 🎬 **Live streaming** – H.264/H.265 video via WebSocket + WebCodecs API
- 🔁 **Auto-reconnect** on stream failure
- 📡 **Multi-camera** – view multiple cameras simultaneously
- 🐳 **Docker** – easy one-command deployment

## Architecture

```
Browser (React)
    │
    │  REST  /api/auth/*  /api/cameras
    │  WS    /api/ws/stream
    ▼
FastAPI backend (main.py)
    │
    ├── auth.py          OAuth2 flow via miot_kit
    ├── camera_manager.py  Camera discovery & streaming via miot_kit
    └── config.py        Environment-based configuration
         │
         └── miot_kit   Xiaomi MIoT SDK (from parent repo)
```

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 20+ (for frontend development)
- A Xiaomi Home account with at least one camera

### Python Virtual Environment Setup

It's recommended to use a Python virtual environment to isolate dependencies.

**Creating a Virtual Environment:**

```bash
# From the repository root (recommended: create .venv at the repo root
# so it is shared between miloco_server and this PoC)
python -m venv .venv

# Activate the virtual environment
# On Windows (PowerShell):
.\.venv\Scripts\Activate.ps1

# On Windows (Command Prompt):
.venv\Scripts\activate.bat

# On macOS/Linux / WSL2:
source .venv/bin/activate
```

Once activated, your terminal prompt should show `(.venv)` at the beginning.

### Development Mode

**1. Backend (with virtual environment)**

```bash
# From the repository root, ensure venv is activated
# (You should see (venv) in your terminal prompt)

cd poc-xiaomi-camera-integration/backend

# Install miot_kit (from parent repo) and backend dependencies
pip install ../../miot_kit
pip install -r requirements.txt

# Copy and edit environment variables
cp ../.env.example ../.env
# Edit ../.env – set CLOUD_SERVER to your region (cn/de/us/…)

# Start backend
python main.py
```

The backend will start at `http://localhost:8080`.

**2. Frontend**

```bash
cd poc-xiaomi-camera-integration/frontend
npm install
npm run dev
```

The frontend dev server starts at `http://localhost:5173`.
API calls are proxied to `http://localhost:8080` automatically.

Open your browser at `http://localhost:5173`.

### Docker Compose

```bash
cd poc-xiaomi-camera-integration

# Copy environment file
cp .env.example .env

# Build and start all services
docker compose up --build
```

The application will be available at `http://localhost:5173`.

## Usage

1. Open `http://localhost:5173` in **Chrome 94+** or **Edge 94+**
   (WebCodecs API is required for video decoding).
2. Select your Xiaomi account region (CN / Europe / US / …) and click
   **"Login with Xiaomi Home"**.
3. A popup opens with the Xiaomi OAuth2 authorization page.
4. Sign in and grant access.
5. The popup auto-closes and you are redirected to the Dashboard.
6. Your cameras are listed with their online status and an iOS-style on/off toggle.
7. Click the **▶** overlay on any online camera to start the live stream.
8. Click **■** (bottom-left of the video) to stop the stream.

## Login Flow (technical)

The login uses Xiaomi's OAuth2 popup flow with an official relay service as the
redirect target.

```
Browser (popup)                   Xiaomi OAuth                  Backend (FastAPI)
      │                                 │                              │
      │── open popup ──────────────────>│                              │
      │                                 │                              │
      │  GET /api/auth/login_url        │                              │
      │<─────────────────────────────────────────────────────────────>│
      │  redirect_uri = https://mico.api.mijia.tech/login_redirect    │
      │                                 │                              │
      │── login + grant access ────────>│                              │
      │                                 │                              │
      │<── redirect to relay ───────────│                              │
      │  https://mico.api.mijia.tech/login_redirect?code=…&state=…    │
      │                                 │                              │
      │  [relay reads cookie "authRedirectUrl" = http://127.0.0.1:8080]
      │── redirect to backend ──────────────────────────────────────> │
      │  http://127.0.0.1:8080/api/miot/xiaomi_home_callback          │
      │                    ?code=…&state=…                            │
      │                                                                │
      │<─────────── Xiaomi-styled success page (auto-closes) ─────────│
      │  (window.close() fires after 0 ms when STATUS_PLACEHOLDER=true)
      │                                                                │
      │  parent page detects popup closed                             │
      │── GET /api/auth/status ───────────────────────────────────── >│
      │<── { authenticated: true } ──────────────────────────────────│
      │  navigate to /dashboard                                        │
```

**First-time setup — setting the relay cookie:**
The relay page (`mico.api.mijia.tech/login_redirect`) needs a one-time
configuration: it must know your local backend URL. On first login you will see
an input asking for the "Xiaomi Miloco webpage address". Enter:

```
http://127.0.0.1:8080
```

and click **"Click to jump"**. The relay stores this in a browser cookie
(`authRedirectUrl`) valid for one year, so you only need to do this once per
browser.

> **Note:** The relay always appends `/api/miot/xiaomi_home_callback` to the
> stored URL, so entering just `http://127.0.0.1:8080` is enough — do **not**
> include the path.

**Fallback — if the relay cookie is not set:**
If the popup closes without completing the flow, the app will attempt to read
the authorization code automatically:

1. **Clipboard (auto):** If you clicked the copy button on the relay page, the
   app decodes the base64 JSON from the clipboard and completes login silently.
2. **Clipboard (manual button):** The "Complete Login from Clipboard" button
   reads the same clipboard data on demand.
3. **URL paste:** Paste the full `https://127.0.0.1/?code=…&state=…` redirect
   URL into the text field and click "Complete Login from Redirect URL".

## Configuration

Copy `.env.example` to `.env` and adjust the values:

| Variable              | Default                                        | Description                                                   |
|-----------------------|------------------------------------------------|---------------------------------------------------------------|
| `SERVER_HOST`         | `0.0.0.0`                                      | Backend bind address                                          |
| `SERVER_PORT`         | `8080`                                         | Backend port (**must stay 8080** — the Xiaomi relay hardcodes this port) |
| `SERVER_LOG_LEVEL`    | `info`                                         | Log verbosity (debug/info/warning/error)                      |
| `FRONTEND_URL`        | `http://localhost:5173`                        | Frontend origin (used for CORS)                               |
| `OAUTH2_REDIRECT_URI` | `https://mico.api.mijia.tech/login_redirect`   | OAuth2 redirect target — use the Xiaomi relay for seamless login |
| `CLOUD_SERVER`        | `de`                                           | Xiaomi cloud region (cn/de/us/ru/tw/sg/in/i2)                 |
| `FRAME_INTERVAL`      | `33`                                           | Camera frame interval in ms (33 ≈ 30 fps; lower = more CPU)   |

`OAUTH2_REDIRECT_URI` must be one of the URIs whitelisted for the default `miot_kit`
client ID. Two valid values:
- `https://mico.api.mijia.tech/login_redirect` — **recommended** (seamless auto-close)
- `https://127.0.0.1` — fallback (requires manual URL paste or clipboard copy)

> `https://localhost/…` is rejected by Xiaomi with `invalid redirect uri`.

## Development Workflow

### Prerequisites

- Python 3.11+ with a virtual environment (the repo uses `.venv_wsl` inside WSL2)
- Node.js 20+
- WSL2 with `networkingMode=mirrored` (required for camera P2P — see [CONNECTIVITY_ISSUE.md](CONNECTIVITY_ISSUE.md))

### Backend

The backend is a FastAPI server that must run **inside WSL2** (not Docker Desktop)
for the camera P2P connection to work.

**Install dependencies (once, or after `requirements.txt` changes):**
```bash
wsl -d Ubuntu -- bash -c "
  cd /mnt/c/Users/<you>/dev/git/xiaomi-miloco
  source .venv_wsl/bin/activate
  pip install ./miot_kit
  pip install -r poc-xiaomi-camera-integration/backend/requirements.txt
"
```

**Start the backend:**
```bash
wsl -d Ubuntu -- bash -c "
  cd /mnt/c/Users/<you>/dev/git/xiaomi-miloco/poc-xiaomi-camera-integration/backend
  source ../../.venv_wsl/bin/activate
  python main.py
"
```

**Restart the backend** (kills any existing process on port 8080 first):
```bash
wsl -d Ubuntu -- bash -c "
  fuser -k 8080/tcp 2>/dev/null
  sleep 1
  cd /mnt/c/Users/<you>/dev/git/xiaomi-miloco/poc-xiaomi-camera-integration/backend
  source ../../.venv_wsl/bin/activate
  python main.py
"
```

The backend reads configuration from `../.env` (one level up, i.e.
`poc-xiaomi-camera-integration/.env`) via `python-dotenv`. Changing `.env`
requires a restart to take effect.

### Frontend

The frontend is a React + Vite app. In development it proxies API calls to
`http://localhost:8080`. For production it is compiled to static files served
directly by the backend.

**Install dependencies (once):**
```bash
cd poc-xiaomi-camera-integration/frontend
npm install
```

**Start the dev server** (hot-reload, proxies to backend on 8080):
```bash
cd poc-xiaomi-camera-integration/frontend
npm run dev
# → http://localhost:5173
```

**Build for production** (outputs to `frontend/dist/`, served by backend at `/`):
```bash
cd poc-xiaomi-camera-integration/frontend
npx vite build
```

You must rebuild after any frontend source change when testing against the
production backend (`http://localhost:8080` directly, not the dev server).

**No restart needed for frontend changes in dev mode** — Vite's HMR picks them up
automatically. A rebuild is only needed for production.

## Project Structure

```
poc-xiaomi-camera-integration/
├── backend/
│   ├── main.py            FastAPI server (REST + WebSocket endpoints)
│   ├── auth.py            OAuth2 authentication handler
│   ├── camera_manager.py  Camera discovery and stream management
│   ├── config.py          Environment-based configuration
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── App.jsx            Root component with routing & auth check
│   │   ├── pages/
│   │   │   ├── Login.jsx      OAuth2 login page (popup flow)
│   │   │   └── Dashboard.jsx  Camera list & stream dashboard
│   │   ├── components/
│   │   │   ├── CameraList.jsx  Camera grid with status badges
│   │   │   └── VideoPlayer.jsx WebCodecs-based H.264/H.265 player
│   │   └── utils/
│   │       └── websocket.js   WebSocket utility for video streams
│   ├── package.json
│   ├── vite.config.js
│   ├── nginx.conf
│   ├── index.html
│   └── Dockerfile
├── docker-compose.yml
├── .env.example
└── README.md
```

## API Reference

| Method    | Path                                  | Description                                          |
|-----------|---------------------------------------|------------------------------------------------------|
| `GET`     | `/api/auth/login_url`                 | Get Xiaomi OAuth2 authorization URL                  |
| `GET`     | `/api/auth/callback`                  | OAuth2 redirect callback (postMessage flow)          |
| `GET`     | `/api/miot/xiaomi_home_callback`      | OAuth2 relay callback (auto-close flow)              |
| `GET`     | `/api/auth/status`                    | Check authentication status + user info              |
| `POST`    | `/api/auth/logout`                    | Clear server-side session (invalidates token)        |
| `POST`    | `/api/auth/exchange`                  | Manually exchange OAuth2 code+state for a token      |
| `GET`     | `/api/cameras`                        | List all discovered cameras                          |
| `GET`     | `/api/devices/{did}/spec`             | Resolve MIoT property spec for a device              |
| `POST`    | `/api/devices/{did}/props/values`     | Batch-read current property values                   |
| `POST`    | `/api/devices/{did}/prop/set`         | Set a single device property                         |
| `WS`      | `/api/ws/stream`                      | Stream H.264/H.265 frames for a camera               |

### WebSocket stream URL

```
ws://localhost:8080/api/ws/stream?camera_id=<did>&channel=<n>
```

Frames are sent as binary messages containing raw H.264/H.265 AnnexB NAL units.

## Browser Requirements

The video player uses the **WebCodecs API** which requires:

- Chrome 94+ or Edge 94+
- **Secure context** (HTTPS or `localhost`)

Firefox is not supported for video playback (WebCodecs is not available).

## Supported Cameras

Tested with **Xiaomi C301**. Should work with any Xiaomi camera supported by
`miot_kit` (cameras that appear in Xiaomi Home).

## Troubleshooting

If cameras are listed correctly but the video stream never plays (stuck on
"Connecting…" / `PPCS_Connect errorcode: -3` in the backend log), see
**[CONNECTIVITY_ISSUE.md](CONNECTIVITY_ISSUE.md)** for a full root-cause analysis and
step-by-step solutions. The most common cause is running the backend inside
Docker Desktop on Windows, which blocks the P2P UDP connection the camera stream
requires.

**Confirmed working on Windows 11:** run the backend natively inside WSL2 with
`networkingMode=mirrored` in `%USERPROFILE%\.wslconfig`. See Option 2 in
CONNECTIVITY_ISSUE.md.  The AI engine (GPU-dependent) can remain in Docker; only the
camera backend needs to be native.

If the stream plays but drops after several minutes with `ERROR_PPCS_SESSION_CLOSED_REMOTE`
in the logs, the access token passed to the C library at startup has expired (~1 hour).
Restarting the backend resets the token. A proper fix (automatic token refresh + client
reinit) is tracked in [NEXT_STEPS.md](NEXT_STEPS.md).
