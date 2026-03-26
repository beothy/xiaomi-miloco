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
    _cloud_server: str

    def __init__(self, cloud_server: str = CLOUD_SERVER) -> None:
        self._uuid = uuid.uuid4().hex
        self._client = None
        self._oauth_info = None
        self._cloud_server = cloud_server

    async def init_async(self) -> None:
        """Initialize the auth manager."""
        # Try to restore a previously persisted session from cache
        oauth_info: Optional[MIoTOauthInfo] = None
        try:
            os.makedirs(CACHE_DIR, exist_ok=True)
            storage = MIoTStorage(CACHE_DIR)
            uuid_key = f"{self._cloud_server}_uuid"
            oauth_key = f"{self._cloud_server}_oauth2_info"
            saved_uuid = await storage.load_async(
                domain=_STORAGE_DOMAIN, name=uuid_key, type_=str
            )
            if saved_uuid and isinstance(saved_uuid, str):
                self._uuid = saved_uuid
            saved_oauth = await storage.load_async(
                domain=_STORAGE_DOMAIN, name=oauth_key, type_=dict
            )
            if saved_oauth and isinstance(saved_oauth, dict):
                oauth_info = MIoTOauthInfo(**saved_oauth)
        except Exception:  # pylint: disable=broad-exception-caught
            pass  # Cache miss – user will authenticate manually

        self._client = MIoTClient(
            uuid=self._uuid,
            redirect_uri=OAUTH2_REDIRECT_URI,
            cache_path=CACHE_DIR,
            cloud_server=self._cloud_server,
            oauth_info=oauth_info,
        )
        await self._client.init_async()
        if oauth_info is not None:
            self._oauth_info = oauth_info
        logger.info("AuthManager initialized with region: %s", self._cloud_server)

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

    async def get_login_url(self, redirect_uri: Optional[str] = None, region: Optional[str] = None) -> str:
        """Generate OAuth2 login URL.

        Args:
            redirect_uri: Optional redirect URI override.
            region: Optional region override (cn, de, us, ru, tw, sg, in, i2).

        Returns:
            OAuth2 authorization URL.
        """
        if not self._client:
            raise RuntimeError("AuthManager not initialized")
        
        # Change region if specified
        if region and region != self._cloud_server:
            await self._set_region_async(region)
        
        url = await self._client.gen_oauth_url_async(redirect_uri=redirect_uri)
        logger.info("Generated OAuth2 login URL for region: %s", self._cloud_server)
        return url

    async def process_callback(self, code: str, state: str, region: Optional[str] = None) -> MIoTOauthInfo:
        """Process OAuth2 callback and retrieve access token.

        Args:
            code: Authorization code from OAuth2 callback.
            state: State parameter from OAuth2 callback.
            region: Optional region (cn, de, us, ru, tw, sg, in, i2).

        Returns:
            MIoTOauthInfo with access token and user info.
        """
        if not self._client:
            raise RuntimeError("AuthManager not initialized")
        
        # Change region if specified
        if region and region != self._cloud_server:
            await self._set_region_async(region)
        
        self._oauth_info = await self._client.get_access_token_async(
            code=code, state=state
        )
        # Persist credentials so the session survives server restarts
        await self._save_credentials_async()
        logger.info("OAuth2 callback processed successfully for region: %s", self._cloud_server)
        return self._oauth_info

    async def _save_credentials_async(self) -> None:
        """Persist uuid and oauth_info to cache storage."""
        if not self._oauth_info:
            return
        try:
            os.makedirs(CACHE_DIR, exist_ok=True)
            storage = MIoTStorage(CACHE_DIR)
            uuid_key = f"{self._cloud_server}_uuid"
            oauth_key = f"{self._cloud_server}_oauth2_info"
            await storage.save_async(
                domain=_STORAGE_DOMAIN, name=uuid_key, data=self._uuid
            )
            await storage.save_async(
                domain=_STORAGE_DOMAIN,
                name=oauth_key,
                data=self._oauth_info.model_dump(),
            )
        except Exception:  # pylint: disable=broad-exception-caught
            logger.warning("Failed to persist OAuth credentials to cache")

    async def _set_region_async(self, region: str) -> None:
        """Change the cloud server region and reinitialize the client.

        Args:
            region: Cloud server region (cn, de, us, ru, tw, sg, in, i2).
        """
        if region == self._cloud_server:
            return
        
        logger.info("Switching region from %s to %s", self._cloud_server, region)
        
        # Deinitialize the current client
        if self._client:
            await self._client.deinit_async()
        
        # Update region
        self._cloud_server = region
        
        # Reinitialize client with new region
        self._client = MIoTClient(
            uuid=self._uuid,
            redirect_uri=OAUTH2_REDIRECT_URI,
            cache_path=CACHE_DIR,
            cloud_server=self._cloud_server,
            oauth_info=self._oauth_info,  # Keep existing oauth_info if any
        )
        await self._client.init_async()
        logger.info("Client reinitialized for region: %s", self._cloud_server)

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

    async def logout_async(self) -> None:
        """Clear the current session from memory and from the persistent cache."""
        self._oauth_info = None
        # Delete cached credentials so the session is not restored on restart
        try:
            storage = MIoTStorage(CACHE_DIR)
            uuid_key = f"{self._cloud_server}_uuid"
            oauth_key = f"{self._cloud_server}_oauth2_info"
            await storage.remove_async(domain=_STORAGE_DOMAIN, name=uuid_key, type_=str)
            await storage.remove_async(domain=_STORAGE_DOMAIN, name=oauth_key, type_=dict)
        except Exception:  # pylint: disable=broad-exception-caught
            pass  # Best-effort cleanup
        logger.info("User logged out, session cleared")


# Singleton instance
_auth_manager: Optional[AuthManager] = None


def get_auth_manager() -> AuthManager:
    """Get the singleton AuthManager instance."""
    global _auth_manager  # pylint: disable=global-statement
    if _auth_manager is None:
        _auth_manager = AuthManager()
    return _auth_manager
