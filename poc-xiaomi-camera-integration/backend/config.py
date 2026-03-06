# Copyright (C) 2025 Xiaomi Corporation
# This software may be used and distributed according to the terms of the Xiaomi Miloco License Agreement.

"""
PoC Configuration.
"""

import os

# Server configuration
SERVER_HOST: str = os.environ.get("SERVER_HOST", "0.0.0.0")
SERVER_PORT: int = int(os.environ.get("SERVER_PORT", "8080"))
SERVER_LOG_LEVEL: str = os.environ.get("SERVER_LOG_LEVEL", "info")

# Frontend URL for CORS and OAuth2 redirect
FRONTEND_URL: str = os.environ.get("FRONTEND_URL", "http://localhost:5173")

# OAuth2 redirect URI - must match Xiaomi OAuth2 whitelist for this client_id.
# For miot_kit default client_id, use https://127.0.0.1 (localhost hostnames are rejected).
OAUTH2_REDIRECT_URI: str = os.environ.get(
    "OAUTH2_REDIRECT_URI", "https://127.0.0.1"
)

# Xiaomi cloud server region: cn, de, us, ru, tw, sg, in, i2
CLOUD_SERVER: str = os.environ.get("CLOUD_SERVER", "cn")

# Camera stream frame interval in milliseconds
FRAME_INTERVAL: int = int(os.environ.get("FRAME_INTERVAL", "500"))

# Cache directory for miot_kit
CACHE_DIR: str = os.environ.get("CACHE_DIR", "/tmp/poc-camera-cache")
