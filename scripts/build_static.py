"""Build static/data.json for Vercel-style static deployment.

Embeds the entire stores dataset (meta + rows in short-key wire format)
into a single JSON file the frontend loads once. After load, all filtering
happens in the browser. No backend needed.

Run from C:\\projects\\dashboard:
    python scripts/build_static.py

Output:
    static/data.json   — { meta, stores }
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import pandas as pd

from data import (
    ZONES,
    STATE_TO_ZONE,
    SCHEMA_VERSION,
    load_stores,
    stores_to_records,
)

OUT = ROOT / "static" / "data.json"


def main() -> None:
    t0 = time.monotonic()
    df = load_stores()
    print(f"loaded parquet: {len(df)} rows", flush=True)

    # Build meta payload (same shape as /api/meta)
    meta = {
        "retailers": sorted(df["retail_account"].dropna().unique().tolist()),
        "states":    sorted(df["state"].dropna().unique().tolist()),
        "zones":     ZONES,
        "clusters":  sorted(df["cluster"].dropna().unique().tolist()),
        "total_rows": int(len(df)),
        "schema_version": SCHEMA_VERSION,
    }

    # Convert all stores to short-key wire format. limit=None means all rows.
    stores = stores_to_records(df, limit=10**9)
    print(f"records (with lat/lon): {len(stores)}", flush=True)

    payload = {
        "meta": meta,
        "stores": stores,
        "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    # Compact JSON to keep the file small (no indentation, no spaces).
    OUT.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")

    sz = OUT.stat().st_size
    print(f"wrote {OUT}  size={sz:,} bytes ({sz/1024/1024:.2f} MB)", flush=True)
    print(f"elapsed: {time.monotonic()-t0:.1f}s", flush=True)


if __name__ == "__main__":
    main()
