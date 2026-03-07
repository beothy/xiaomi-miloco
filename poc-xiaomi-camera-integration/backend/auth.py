# Copyright (C) 2025 Xiaomi Corporation
# This software may be used and distributed according to the terms of the Xiaomi Miloco License Agreement.

"""
OAuth2 authentication handler for the PoC.
Wraps miot_kit OAuth2 functionality.
"""

import logging
import os
import uuid
from typing import Optional

from miot.client import MIoTClient
from miot.storage import MIoTStorage
from miot.types import MIoTOauthInfo

from config import CACHE_DIR, CLOUD_SERVER, OAUTH2_REDIRECT_URI

_STORAGE_DOMAIN = "cloud_cache"
_STORAGE_UUID_KEY = f"{CLOUD_SERVER}_uuid"
_STORAGE_OAUTH_KEY = f"{CLOUD_SERVER}_oauth2_info"

logger = logging.getLogger(__name__)


class AuthManager:
    """Manages OAuth2 authentication for Xiaomi Home."""

    _client: Optional[MIoTClient]
    _oauth_info: Optional[MIoTOauthInfo]
    _uuid: str

    def __init__(self) -> None:
        self._uuid = uuid.uuid4().hex
        self._client = None
        self._oauth_info = None

    async def init_async(self) -> None:
        """Initialize the auth manager."""
        # Try to restore a previously persisted session from cache
        oauth_info: Optional[MIoTOauthInfo] = None
        try:
            os.makedirs(CACHE_DIR, exist_ok=True)
            storage = MIoTStorage(CACHE_DIR)
            saved_uuid = await storage.load_async(
                domain=_STORAGE_DOMAIN, name=_STORAGE_UUID_KEY, type_=str
            )
            if saved_uuid and isinstance(saved_uuid, str):
                self._uuid = saved_uuid
            saved_oauth = await storage.load_async(
                domain=_STORAGE_DOMAIN, name=_STORAGE_OAUTH_KEY, type_=dict
            )
            if saved_oauth and isinstance(saved_oauth, dict):
                oauth_info = MIoTOauthInfo(**saved_oauth)
        except Exception:  # pylint: disable=broad-exception-caught
            pass  # Cache miss – user will authenticate manually

        self._client = MIoTClient(
            uuid=self._uuid,
            redirect_uri=OAUTH2_REDIRECT_URI,
            cache_path=CACHE_DIR,
            cloud_server=CLOUD_SERVER,
            oauth_info=oauth_info,
        )
        await self._client.init_async()
        if oauth_info is not None:
            self._oauth_info = oauth_info
        logger.info("AuthManager initialized")

    async def deinit_async(self) -> None:
        """Deinitialize the auth manager."""
        if self._client:
            await self._client.deinit_async()
            self._client = None

    @property
    def client(self) -> Optional[MIoTClient]:
        """Get the MIoTClient instance."""
        return self._client

    @property
    def oauth_info(self) -> Optional[MIoTOauthInfo]:
        """Get current OAuth2 info."""
        return self._oauth_info

    @property
    def is_authenticated(self) -> bool:
        """Check if the user is authenticated."""
        return self._oauth_info is not None

    async def get_login_url(self, redirect_uri: Optional[str] = None) -> str:
        """Generate OAuth2 login URL.

        Args:
            redirect_uri: Optional redirect URI override.

        Returns:
            OAuth2 authorization URL.
        """
        if not self._client:
            raise RuntimeError("AuthManager not initialized")
        url = await self._client.gen_oauth_url_async(redirect_uri=redirect_uri)
        logger.info("Generated OAuth2 login URL")
        return url

    async def process_callback(self, code: str, state: str) -> MIoTOauthInfo:
        """Process OAuth2 callback and retrieve access token.

        Args:
            code: Authorization code from OAuth2 callback.
            state: State parameter from OAuth2 callback.

        Returns:
            MIoTOauthInfo with access token and user info.
        """
        if not self._client:
            raise RuntimeError("AuthManager not initialized")
        self._oauth_info = await self._client.get_access_token_async(
            code=code, state=state
        )
        # Persist credentials so the session survives server restarts
        await self._save_credentials_async()
        logger.info("OAuth2 callback processed successfully")
        return self._oauth_info

    async def _save_credentials_async(self) -> None:
        """Persist uuid and oauth_info to cache storage."""
        if not self._oauth_info:
            return
        try:
            os.makedirs(CACHE_DIR, exist_ok=True)
            storage = MIoTStorage(CACHE_DIR)
            await storage.save_async(
                domain=_STORAGE_DOMAIN, name=_STORAGE_UUID_KEY, data=self._uuid
            )
            await storage.save_async(
                domain=_STORAGE_DOMAIN,
                name=_STORAGE_OAUTH_KEY,
                data=self._oauth_info.model_dump(),
            )
        except Exception:  # pylint: disable=broad-exception-caught
            logger.warning("Failed to persist OAuth credentials to cache")

    async def refresh_token(self) -> MIoTOauthInfo:
        """Refresh the access token.

        Returns:
            Updated MIoTOauthInfo.
        """
        if not self._client or not self._oauth_info:
            raise RuntimeError("Not authenticated")
        self._oauth_info = await self._client.refresh_access_token_async(
            self._oauth_info.refresh_token
        )
        logger.info("Access token refreshed")
        return self._oauth_info

    async def check_token(self) -> bool:
        """Check if current access token is valid.

        Returns:
            True if token is valid.
        """
        if not self._client or not self._oauth_info:
            return False
        return await self._client.check_token_async()


# Singleton instance
_auth_manager: Optional[AuthManager] = None


def get_auth_manager() -> AuthManager:
    """Get the singleton AuthManager instance."""
    global _auth_manager  # pylint: disable=global-statement
    if _auth_manager is None:
        _auth_manager = AuthManager()
    return _auth_manager
