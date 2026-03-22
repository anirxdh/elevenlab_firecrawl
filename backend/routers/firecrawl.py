from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from backend.services.firecrawl_service import get_firecrawl_service

router = APIRouter(prefix="/firecrawl", tags=["firecrawl"])


class ScrapeRequest(BaseModel):
    url: str


class ExtractRequest(BaseModel):
    urls: list[str]
    prompt: str
    schema_def: dict | None = None


class CrawlRequest(BaseModel):
    url: str
    limit: int = 100


@router.post("/scrape")
async def scrape_url(req: ScrapeRequest):
    try:
        service = get_firecrawl_service()
        markdown = await service.scrape(req.url)
        return {"success": True, "markdown": markdown}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Scrape failed: {str(e)}")


@router.post("/extract")
async def extract_data(req: ExtractRequest):
    try:
        service = get_firecrawl_service()
        result = await service.extract(req.urls, req.prompt, req.schema_def)
        return {"success": True, "data": result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Extract failed: {str(e)}")


@router.post("/crawl")
async def start_crawl(req: CrawlRequest):
    try:
        service = get_firecrawl_service()
        job_id = await service.start_crawl(req.url, req.limit)
        return {"success": True, "job_id": job_id}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Crawl failed: {str(e)}")


@router.get("/crawl/{job_id}")
async def get_crawl_status(job_id: str):
    try:
        service = get_firecrawl_service()
        status = await service.get_crawl_status(job_id)
        return {"success": True, **status}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Status check failed: {str(e)}")
