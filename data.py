"""Parquet loader, zone mapping, and filter helpers for the retail dashboard."""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Iterable

import pandas as pd

ZONES: list[dict] = [
    {"slug": "west_coast", "display": "West Coast",
     "states": ["CA", "OR", "WA", "AK", "HI"]},
    {"slug": "mountain_southwest", "display": "Mountain / Southwest",
     "states": ["AZ", "NM", "NV", "UT", "CO", "ID", "MT", "WY"]},
    {"slug": "plains", "display": "Plains",
     "states": ["ND", "SD", "NE", "KS", "OK", "IA", "MN", "MO"]},
    {"slug": "south_central", "display": "Texas / South Central",
     "states": ["TX", "AR", "LA"]},
    {"slug": "deep_south", "display": "Deep South",
     "states": ["MS", "AL", "GA", "FL", "SC"]},
    {"slug": "mid_atlantic", "display": "Mid-Atlantic / Southeast",
     "states": ["NC", "VA", "WV", "KY", "TN", "MD", "DE", "DC"]},
    {"slug": "northeast", "display": "Northeast",
     "states": ["NY", "PA", "NJ", "MA", "CT", "RI", "NH", "VT", "ME"]},
    {"slug": "great_lakes", "display": "Great Lakes / Midwest",
     "states": ["OH", "MI", "IN", "IL", "WI"]},
    {"slug": "caribbean_territories", "display": "Caribbean / Territories",
     "states": ["PR"]},
]

STATE_TO_ZONE: dict[str, str] = {
    state: zone["slug"]
    for zone in ZONES
    for state in zone["states"]
}

ZONE_TO_STATES: dict[str, set[str]] = {
    zone["slug"]: set(zone["states"]) for zone in ZONES
}

SCHEMA_VERSION = "v1"

_WIN_PATH = r"C:\projects\scraper\stores.parquet"
_LINUX_MOUNT = "/sessions/brave-loving-euler/mnt/projects/scraper/stores.parquet"


def _resolve_parquet_path() -> str:
    override = os.environ.get("DASHBOARD_PARQUET")
    if override:
        return override
    if os.path.exists(_WIN_PATH):
        return _WIN_PATH
    if os.path.exists(_LINUX_MOUNT):
        return _LINUX_MOUNT
    return _WIN_PATH


@lru_cache(maxsize=1)
def load_stores() -> pd.DataFrame:
    path = _resolve_parquet_path()
    df = pd.read_parquet(path)
    for col in ("retail_account", "class_of_trade", "address", "city",
                "state", "zip_code", "google_maps_url"):
        if col in df.columns:
            df[col] = df[col].astype("string")
    df["zone"] = df["state"].map(STATE_TO_ZONE).astype("string")
    df["cluster"] = df["class_of_trade"]
    # ML cluster columns (added by Phase 7). Optional - if absent, leave as NA.
    if "cluster_id" in df.columns:
        df["cluster_id"] = pd.to_numeric(df["cluster_id"], errors="coerce").astype("Int64")
    if "cluster_rank" in df.columns:
        df["cluster_rank"] = pd.to_numeric(df["cluster_rank"], errors="coerce").astype("Int64")
    df["id"] = (
        df["retail_account"].fillna("?") + "|"
        + df["address"].fillna("?") + "|"
        + df["city"].fillna("?") + "|"
        + df["state"].fillna("?") + "|"
        + df["zip_code"].fillna("?")
    ).astype("string")
    return df


def _normalize(values: Iterable[str] | None) -> list[str]:
    if not values:
        return []
    seen: set[str] = set()
    out: list[str] = []
    for v in values:
        if v is None:
            continue
        s = str(v).strip()
        if not s or s in seen:
            continue
        seen.add(s)
        out.append(s)
    return out


def apply_filters(
    df: pd.DataFrame,
    *,
    retailers: Iterable[str] | None = None,
    states: Iterable[str] | None = None,
    zones: Iterable[str] | None = None,
    clusters: Iterable[str] | None = None,
) -> pd.DataFrame:
    retailers = _normalize(retailers)
    states = _normalize(states)
    zones = _normalize(zones)
    clusters = _normalize(clusters)

    mask = pd.Series(True, index=df.index)
    if retailers:
        mask &= df["retail_account"].isin(retailers)
    if states:
        mask &= df["state"].isin(states)
    if zones:
        zone_states: set[str] = set()
        for z in zones:
            zone_states.update(ZONE_TO_STATES.get(z, set()))
        mask &= df["state"].isin(zone_states) if zone_states else False
    if clusters:
        mask &= df["cluster"].isin(clusters)
    return df.loc[mask]


def stores_to_records(df: pd.DataFrame, limit: int) -> list[dict]:
    sub = df.dropna(subset=["latitude", "longitude"])
    if limit is not None and len(sub) > limit:
        sub = sub.head(limit)
    out: list[dict] = []
    for row in sub.itertuples(index=False):
        rec = {
            "id": row.id,
            "ra": row.retail_account,
            "ct": row.class_of_trade,
            "ad": row.address,
            "ci": row.city,
            "st": row.state,
            "zp": row.zip_code,
            "la": float(row.latitude),
            "lo": float(row.longitude),
            "cl": row.cluster,
            "gm": row.google_maps_url,
        }
        # ML cluster fields if present
        cid = getattr(row, "cluster_id", None)
        crk = getattr(row, "cluster_rank", None)
        if cid is not None and pd.notna(cid):
            rec["mc"] = int(cid)
        if crk is not None and pd.notna(crk):
            rec["mr"] = int(crk)
        out.append(rec)
    return out


def stats_by(df: pd.DataFrame, dimension: str) -> dict[str, int]:
    if dimension == "zone":
        col = df["zone"]
    elif dimension == "state":
        col = df["state"]
    elif dimension == "retailer":
        col = df["retail_account"]
    elif dimension == "cluster":
        col = df["cluster"]
    else:
        raise ValueError(f"unknown dimension: {dimension}")
    counts = col.dropna().value_counts()
    return {str(k): int(v) for k, v in counts.items()}


@lru_cache(maxsize=1)
def get_meta() -> dict:
    df = load_stores()
    # Load ML cluster metadata if available (built by Phase 7 of analysis pipeline)
    ml_clusters = []
    try:
        import json as _json
        meta_path = "/sessions/brave-loving-euler/mnt/projects/analysis/cluster_meta.json"
        if not os.path.exists(meta_path):
            meta_path = r"C:\projects\analysis\cluster_meta.json"
        with open(meta_path, "r", encoding="utf-8") as f:
            cm = _json.load(f)
        ml_clusters = sorted(cm.values(), key=lambda x: x.get("rank", 99))
    except Exception:
        pass

    return {
        "retailers": sorted(df["retail_account"].dropna().unique().tolist()),
        "states": sorted(df["state"].dropna().unique().tolist()),
        "zones": ZONES,
        "clusters": sorted(df["cluster"].dropna().unique().tolist()),
        "ml_clusters": ml_clusters,
        "total_rows": int(len(df)),
        "schema_version": SCHEMA_VERSION,
    }
