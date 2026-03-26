# Copyright (C) 2025 Xiaomi Corporation
# This software may be used and distributed according to the terms of the Xiaomi Miloco License Agreement.

"""
PoC Configuration.
"""

import os

from dotenv import load_dotenv

# Load .env from the project root (one level up from the backend folder)
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

# Server configuration
SERVER_HOST: str = os.environ.get("SERVER_HOST", "0.0.0.0")
SERVER_PORT: int = int(os.environ.get("SERVER_PORT", "8080"))
SERVER_LOG_LEVEL: str = os.environ.get("SERVER_LOG_LEVEL", "info")

# Frontend URL for CORS and OAuth2 redirect
FRONTEND_URL: str = os.environ.get("FRONTEND_URL", "http://localhost:5173")

# OAuth2 redirect URI - must match Xiaomi OAuth2 whitelist for this client_id.
# Uses the Xiaomi relay (mico.api.mijia.tech) which forwards the browser to
# http://127.0.0.1:8080/miot/xiaomi_home_callback — requires the server on port 8080.
OAUTH2_REDIRECT_URI: str = os.environ.get(
    "OAUTH2_REDIRECT_URI", "https://mico.api.mijia.tech/login_redirect"
)

# Xiaomi cloud server region: cn, de, us, ru, tw, sg, in, i2
CLOUD_SERVER: str = os.environ.get("CLOUD_SERVER", "de")

# Camera stream frame interval in milliseconds (33 ≈ 30 fps)
FRAME_INTERVAL: int = int(os.environ.get("FRAME_INTERVAL", "33"))

# Cache directory for miot_kit
CACHE_DIR: str = os.environ.get("CACHE_DIR", "/tmp/poc-camera-cache")
