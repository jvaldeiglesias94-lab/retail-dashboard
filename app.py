"""FastAPI app for the retail store dashboard (slice A — backend)."""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from data import (
    apply_filters,
    get_meta,
    load_stores,
    stats_by,
    stores_to_records,
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    load_stores()
    get_meta()
    yield


app = FastAPI(
    title="Retail Store Dashboard API",
    version="1.0.0",
    docs_url="/docs",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://localhost(:\d+)?$",
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)

LIMIT_DEFAULT = 50_000
LIMIT_MAX = 100_000


@app.get("/healthz")
def healthz() -> dict:
    df = load_stores()
    return {"status": "ok", "rows": int(len(df))}


@app.get("/api/meta")
def api_meta() -> dict:
    return get_meta()


@app.get("/api/stores")
def api_stores(
    retailer: Optional[list[str]] = Query(default=None),
    state: Optional[list[str]] = Query(default=None),
    zone: Optional[list[str]] = Query(default=None),
    cluster: Optional[list[str]] = Query(default=None),
    limit: int = Query(default=LIMIT_DEFAULT, ge=1, le=LIMIT_MAX),
) -> JSONResponse:
    df = load_stores()
    filtered = apply_filters(
        df, retailers=retailer, states=state, zones=zone, clusters=cluster,
    )
    records = stores_to_records(filtered, limit=limit)
    return JSONResponse({"count": len(records), "stores": records})


@app.get("/api/stats")
def api_stats(
    by: str = Query(..., pattern="^(zone|state|retailer|cluster)$"),
    retailer: Optional[list[str]] = Query(default=None),
    state: Optional[list[str]] = Query(default=None),
    zone: Optional[list[str]] = Query(default=None),
    cluster: Optional[list[str]] = Query(default=None),
) -> dict:
    df = load_stores()
    filtered = apply_filters(
        df, retailers=retailer, states=state, zones=zone, clusters=cluster,
    )
    try:
        return {"by": by, "counts": stats_by(filtered, by)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


_STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
_INDEX_HTML = os.path.join(_STATIC_DIR, "index.html")

if os.path.isdir(_STATIC_DIR):
    app.mount("/static", StaticFiles(directory=_STATIC_DIR), name="static")

    @app.get("/")
    def root() -> FileResponse:
        return FileResponse(_INDEX_HTML)
