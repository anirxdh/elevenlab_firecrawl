"""
Firecrawl service: wraps the Firecrawl v1 API to provide scrape, extract, and
crawl capabilities with SSRF protection and in-memory URL caching.
"""

import asyncio
import ipaddress
import os
import time
from urllib.parse import urlparse

from firecrawl import FirecrawlApp

CACHE_TTL_SECONDS = 300  # 5 minutes

# Hosts that must always be blocked regardless of IP parsing outcome
BLOCKED_HOSTS = {"localhost", "127.0.0.1", "0.0.0.0", "::1"}


def _is_private_url(url: str) -> bool:
    """Return True if the URL targets a private/internal/loopback address."""
    parsed = urlparse(url)
    hostname = parsed.hostname or ""
    if hostname in BLOCKED_HOSTS:
        return True
    try:
        ip = ipaddress.ip_address(hostname)
        return ip.is_private or ip.is_loopback or ip.is_link_local
    except ValueError:
        # hostname is a domain name — not an IP, so not obviously private
        pass
    return False


class FirecrawlService:
    """Async-friendly wrapper around the synchronous Firecrawl v1 client.

    All network I/O is dispatched to a thread pool via ``asyncio.to_thread``
    so FastAPI's event loop is never blocked.
    """

    def __init__(self) -> None:
        api_key = os.getenv("FIRECRAWL_API_KEY")
        if not api_key:
            raise ValueError("FIRECRAWL_API_KEY not set")
        # Use the v1 proxy so legacy method names (scrape_url, async_crawl_url,
        # check_crawl_status, extract) are available on self.client.
        unified = FirecrawlApp(api_key=api_key)
        self.client = unified.v1  # type: ignore[attr-defined]
        self._cache: dict[str, tuple[float, str]] = {}

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _validate_url(self, url: str) -> None:
        """Raise ValueError if *url* points to a private/internal resource."""
        if _is_private_url(url):
            raise ValueError(f"Rejected private/internal URL: {url}")

    def _get_cached(self, url: str) -> str | None:
        """Return cached content for *url* if still fresh, otherwise None."""
        entry = self._cache.get(url)
        if entry is None:
            return None
        ts, content = entry
        if (time.time() - ts) < CACHE_TTL_SECONDS:
            return content
        # Entry expired — evict and signal a miss
        del self._cache[url]
        return None

    def _set_cached(self, url: str, content: str) -> None:
        self._cache[url] = (time.time(), content)

    def invalidate_cache(self, url: str) -> None:
        """Remove *url* from the cache (no-op if not present)."""
        self._cache.pop(url, None)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def scrape(self, url: str) -> str:
        """Scrape *url* and return its Markdown content.

        Results are cached for ``CACHE_TTL_SECONDS`` seconds to avoid
        redundant network calls for the same URL within a session.
        """
        self._validate_url(url)

        cached = self._get_cached(url)
        if cached is not None:
            return cached

        result = await asyncio.to_thread(
            self.client.scrape_url,
            url,
            formats=["markdown"],
            only_main_content=True,
        )

        # Handle both pydantic-model responses (real client) and plain dicts
        # (mocks in tests).
        if isinstance(result, dict):
            markdown = result.get("markdown", "")
        else:
            markdown = getattr(result, "markdown", "") or ""

        self._set_cached(url, markdown)
        return markdown

    async def extract(
        self,
        urls: list[str],
        prompt: str,
        schema: dict | None = None,
    ) -> dict:
        """Extract structured data from *urls* using an AI prompt.

        Args:
            urls:   List of URLs to extract data from.
            prompt: Natural-language description of what to extract.
            schema: Optional JSON schema that constrains the output shape.

        Returns:
            A plain dict containing the extracted data.
        """
        for url in urls:
            self._validate_url(url)

        kwargs: dict = {"prompt": prompt}
        if schema is not None:
            kwargs["schema"] = schema

        result = await asyncio.to_thread(
            self.client.extract,
            urls,
            **kwargs,
        )

        if isinstance(result, dict):
            return result
        return result.__dict__

    async def start_crawl(self, url: str, limit: int = 100) -> str:
        """Start an async crawl job for *url* and return its job ID."""
        self._validate_url(url)

        job = await asyncio.to_thread(
            self.client.async_crawl_url,
            url,
            limit=limit,
        )

        if isinstance(job, dict):
            return job.get("id", "")
        return getattr(job, "id", "") or ""

    async def get_crawl_status(self, job_id: str) -> dict:
        """Return the current status of crawl job *job_id* as a plain dict."""
        result = await asyncio.to_thread(
            self.client.check_crawl_status,
            job_id,
        )

        if isinstance(result, dict):
            return result
        return result.__dict__


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

firecrawl_service: FirecrawlService | None = None


def get_firecrawl_service() -> FirecrawlService:
    """Return the cached FirecrawlService singleton, creating it on first call."""
    global firecrawl_service
    if firecrawl_service is None:
        firecrawl_service = FirecrawlService()
    return firecrawl_service
