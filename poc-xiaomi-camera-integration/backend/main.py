# Copyright (C) 2025 Xiaomi Corporation
# This software may be used and distributed according to the terms of the Xiaomi Miloco License Agreement.

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

import uvicorn
from fastapi import FastAPI, WebSocket, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.websockets import WebSocketDisconnect

from config import (
    FRONTEND_URL,
    SERVER_HOST,
    SERVER_PORT,
    SERVER_LOG_LEVEL,
)
from auth import get_auth_manager
from camera_manager import get_camera_list, get_stream_manager

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

@app.get("/api/auth/login_url", summary="Get Xiaomi OAuth2 login URL")
async def get_login_url():
    """Return the Xiaomi Home OAuth2 authorization URL."""
    auth = get_auth_manager()
    try:
        url = await auth.get_login_url()
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
        return {"cameras": cameras}
    except Exception as err:  # pylint: disable=broad-exception-caught
        logger.error("Failed to list cameras: %s", err)
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
    if not auth.is_authenticated:
        await websocket.close(code=4001, reason="Not authenticated")
        return

    stream_mgr = get_stream_manager()
    conn_id = None
    try:
        await websocket.accept()
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
