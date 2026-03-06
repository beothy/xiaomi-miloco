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

### Development Mode

**1. Backend**

```bash
# From the repository root
cd poc-xiaomi-camera-integration/backend

# Install miot_kit (from parent repo)
pip install ../../miot_kit

# Install backend dependencies
pip install -r requirements.txt

# Copy and edit environment variables
cp ../.env.example ../.env
# Edit ../.env as needed

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
2. Click **"Login with Xiaomi Home"** – a popup will open with the Xiaomi
   authorization page.
3. Sign in with your Xiaomi Home account and grant access.
4. The popup closes and you are redirected to the Dashboard.
5. Your cameras are listed with their status.
6. Click **▶ Play** on any online camera to start the live stream.
7. Click **■ Stop** to close the stream.

## Configuration

Copy `.env.example` to `.env` and adjust the values:

| Variable            | Default                  | Description                                          |
|---------------------|--------------------------|------------------------------------------------------|
| `SERVER_HOST`       | `0.0.0.0`                | Backend bind address                                 |
| `SERVER_PORT`       | `8080`                   | Backend port                                         |
| `SERVER_LOG_LEVEL`  | `info`                   | Log verbosity (debug/info/warning/error)             |
| `FRONTEND_URL`      | `http://localhost:5173`  | Frontend origin (for CORS)                           |
| `OAUTH2_REDIRECT_URI` | `https://127.0.0.1`    | Must match a URI registered in Xiaomi OAuth2 Service |
| `CLOUD_SERVER`      | `cn`                     | Xiaomi cloud region (cn/de/us/ru/tw/sg/in/i2)        |
| `FRAME_INTERVAL`    | `500`                    | Camera frame interval in ms                          |

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

| Method    | Path                    | Description                               |
|-----------|-------------------------|-------------------------------------------|
| `GET`     | `/api/auth/login_url`   | Get Xiaomi OAuth2 authorization URL       |
| `GET`     | `/api/auth/callback`    | OAuth2 redirect callback (code + state)   |
| `GET`     | `/api/auth/status`      | Check authentication status + user info   |
| `GET`     | `/api/cameras`          | List all discovered cameras               |
| `WS`      | `/api/ws/stream`        | Stream H.264/H.265 frames for a camera    |

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
