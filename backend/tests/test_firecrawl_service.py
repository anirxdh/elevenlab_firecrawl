"""Tests for FirecrawlService: scrape, caching, SSRF protection, and cache invalidation."""

import pytest
from unittest.mock import patch, MagicMock

from backend.services.firecrawl_service import FirecrawlService


@pytest.fixture
def service():
    """Create a FirecrawlService with a mocked API key (no real HTTP calls)."""
    with patch.dict("os.environ", {"FIRECRAWL_API_KEY": "fc-test-key"}):
        return FirecrawlService()


class TestFirecrawlService:
    @pytest.mark.asyncio
    async def test_scrape_returns_markdown(self, service):
        mock_result = {"markdown": "# Test Page\nSome content"}
        with patch.object(service.client, "scrape_url", return_value=mock_result):
            result = await service.scrape("https://example.com")
            assert result == "# Test Page\nSome content"

    @pytest.mark.asyncio
    async def test_scrape_caches_results(self, service):
        mock_result = {"markdown": "cached content"}
        with patch.object(service.client, "scrape_url", return_value=mock_result) as mock_scrape:
            await service.scrape("https://example.com")
            await service.scrape("https://example.com")
            assert mock_scrape.call_count == 1

    @pytest.mark.asyncio
    async def test_scrape_rejects_private_ips(self, service):
        with pytest.raises(ValueError, match="private"):
            await service.scrape("http://192.168.1.1/admin")

    @pytest.mark.asyncio
    async def test_scrape_rejects_localhost(self, service):
        with pytest.raises(ValueError, match="private"):
            await service.scrape("http://localhost:3000")

    def test_cache_invalidation(self, service):
        service._cache["https://example.com"] = (0, "old")
        service.invalidate_cache("https://example.com")
        assert "https://example.com" not in service._cache

    # ------------------------------------------------------------------
    # Additional coverage
    # ------------------------------------------------------------------

    @pytest.mark.asyncio
    async def test_scrape_rejects_loopback_ip(self, service):
        with pytest.raises(ValueError, match="private"):
            await service.scrape("http://127.0.0.1/secret")

    @pytest.mark.asyncio
    async def test_scrape_cache_miss_after_invalidation(self, service):
        """After invalidation the next scrape should call the upstream API."""
        mock_result = {"markdown": "fresh content"}
        with patch.object(service.client, "scrape_url", return_value=mock_result) as mock_scrape:
            await service.scrape("https://example.com")
            service.invalidate_cache("https://example.com")
            await service.scrape("https://example.com")
            assert mock_scrape.call_count == 2

    @pytest.mark.asyncio
    async def test_scrape_returns_pydantic_model_markdown(self, service):
        """Service handles pydantic-model responses (not only dicts) from real client."""
        mock_doc = MagicMock()
        mock_doc.markdown = "# Pydantic Result"
        # Make isinstance(result, dict) return False
        mock_doc.__class__ = type("FakeDoc", (), {})

        with patch.object(service.client, "scrape_url", return_value=mock_doc):
            result = await service.scrape("https://example.com")
            assert result == "# Pydantic Result"

    @pytest.mark.asyncio
    async def test_scrape_different_urls_not_shared_cache(self, service):
        """Two different URLs should each call the API once."""
        mock_a = {"markdown": "page A"}
        mock_b = {"markdown": "page B"}

        call_count = 0

        def side_effect(url, **kwargs):
            nonlocal call_count
            call_count += 1
            return mock_a if "example.com" in url else mock_b

        with patch.object(service.client, "scrape_url", side_effect=side_effect):
            result_a = await service.scrape("https://example.com")
            result_b = await service.scrape("https://other.com")
            assert result_a == "page A"
            assert result_b == "page B"
            assert call_count == 2

    @pytest.mark.asyncio
    async def test_extract_rejects_private_url(self, service):
        with pytest.raises(ValueError, match="private"):
            await service.extract(["http://10.0.0.1/data"], prompt="get data")

    @pytest.mark.asyncio
    async def test_extract_returns_dict(self, service):
        mock_result = {"name": "Claude", "version": "3"}
        with patch.object(service.client, "extract", return_value=mock_result):
            result = await service.extract(
                ["https://example.com"],
                prompt="Extract name and version",
            )
            assert result == {"name": "Claude", "version": "3"}

    @pytest.mark.asyncio
    async def test_start_crawl_rejects_private_url(self, service):
        with pytest.raises(ValueError, match="private"):
            await service.start_crawl("http://localhost/admin")

    @pytest.mark.asyncio
    async def test_start_crawl_returns_job_id(self, service):
        mock_job = {"id": "crawl-abc-123"}
        with patch.object(service.client, "async_crawl_url", return_value=mock_job):
            job_id = await service.start_crawl("https://example.com", limit=50)
            assert job_id == "crawl-abc-123"

    @pytest.mark.asyncio
    async def test_get_crawl_status_returns_dict(self, service):
        mock_status = {"status": "completed", "completed": 10, "total": 10}
        with patch.object(service.client, "check_crawl_status", return_value=mock_status):
            result = await service.get_crawl_status("crawl-abc-123")
            assert result["status"] == "completed"

    def test_invalidate_cache_no_op_for_missing_url(self, service):
        """invalidate_cache should not raise when URL is not in cache."""
        service.invalidate_cache("https://not-cached.com")  # must not raise

    def test_init_raises_without_api_key(self):
        """FirecrawlService raises ValueError when FIRECRAWL_API_KEY is absent."""
        with patch.dict("os.environ", {}, clear=True):
            # Ensure the key is truly absent
            import os
            os.environ.pop("FIRECRAWL_API_KEY", None)
            with pytest.raises(ValueError, match="FIRECRAWL_API_KEY"):
                FirecrawlService()
