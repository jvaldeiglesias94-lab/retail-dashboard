"""External-feedback hooks for slice A (PLAN.md S10/S11).

Run with: pytest tests/test_api.py
Uses FastAPI's TestClient (no live server needed). Cross-checks counts
against pandas reading the same parquet directly.
"""

from __future__ import annotations

import os
import sys

import pandas as pd
import pytest
from fastapi.testclient import TestClient

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from app import app  # noqa: E402
from data import STATE_TO_ZONE, ZONES, load_stores  # noqa: E402


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture(scope="module")
def df() -> pd.DataFrame:
    return load_stores()


@pytest.fixture(scope="module")
def plot_df(df) -> pd.DataFrame:
    """Subset that the map can actually plot (lat AND lon non-null).

    `/api/stores` drops un-plottable rows because deck.gl crashes on null
    coords; tests therefore compare its `count` against this subset, while
    `/api/stats` and `/api/meta.total_rows` compare against the raw `df`.
    """
    return df.dropna(subset=["latitude", "longitude"])


# ---- /healthz + /api/meta -------------------------------------------------

def test_healthz(client, df):
    r = client.get("/healthz")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["rows"] == len(df)


def test_meta_shape(client, df):
    r = client.get("/api/meta")
    assert r.status_code == 200
    meta = r.json()
    assert set(meta) == {"retailers", "states", "zones", "clusters",
                         "total_rows", "schema_version"}
    assert meta["total_rows"] == len(df)
    assert meta["schema_version"] == "v1"
    assert meta["retailers"] == sorted(df["retail_account"].dropna().unique())
    assert "Walgreens" in meta["retailers"]
    assert len(meta["zones"]) == 8
    slugs = {z["slug"] for z in meta["zones"]}
    assert slugs == {"west_coast", "mountain_southwest", "plains",
                     "south_central", "deep_south", "mid_atlantic",
                     "northeast", "great_lakes"}
    for z in meta["zones"]:
        assert {"slug", "display", "states"} <= set(z)
        assert isinstance(z["states"], list) and z["states"]


def test_meta_zone_partition_covers_50_states_plus_dc():
    seen = []
    for z in ZONES:
        seen.extend(z["states"])
    assert len(seen) == len(set(seen))
    assert len(seen) == 51


# ---- /api/stores: single-filter parity with pandas -----------------------

@pytest.mark.parametrize("retailer", [
    "CVS", "Walgreens", "Target Stores", "Starbucks", "Seven Eleven",
])
def test_stores_by_retailer_matches_pandas(client, plot_df, retailer):
    r = client.get("/api/stores", params={"retailer": retailer})
    assert r.status_code == 200
    body = r.json()
    expected = int((plot_df["retail_account"] == retailer).sum())
    assert body["count"] == expected
    assert len(body["stores"]) == expected


def test_stores_by_state(client, plot_df):
    r = client.get("/api/stores", params={"state": "CA"})
    assert r.status_code == 200
    assert r.json()["count"] == int((plot_df["state"] == "CA").sum())


def test_stores_by_zone_west_coast(client, plot_df):
    r = client.get("/api/stores", params={"zone": "west_coast"})
    assert r.status_code == 200
    expected = int(plot_df["state"].isin({"CA", "OR", "WA", "AK", "HI"}).sum())
    assert r.json()["count"] == expected


def test_stores_by_zone_all_zones_match_state_isin(client, plot_df):
    for z in ZONES:
        r = client.get("/api/stores", params={"zone": z["slug"]})
        assert r.status_code == 200
        expected = int(plot_df["state"].isin(set(z["states"])).sum())
        assert r.json()["count"] == expected, z["slug"]


def test_stores_by_cluster(client, plot_df):
    r = client.get("/api/stores", params={"cluster": "Chain Drug"})
    assert r.status_code == 200
    assert r.json()["count"] == int((plot_df["class_of_trade"] == "Chain Drug").sum())


# ---- /api/stores: combined filters ---------------------------------------

def test_stores_retailer_and_state(client, plot_df):
    r = client.get("/api/stores", params={"retailer": "CVS", "state": "CA"})
    assert r.status_code == 200
    expected = int(((plot_df["retail_account"] == "CVS")
                    & (plot_df["state"] == "CA")).sum())
    assert r.json()["count"] == expected


def test_stores_multi_retailer_or_within_dim(client, plot_df):
    r = client.get(
        "/api/stores",
        params=[("retailer", "CVS"), ("retailer", "Walgreens")],
    )
    assert r.status_code == 200
    expected = int(plot_df["retail_account"].isin({"CVS", "Walgreens"}).sum())
    assert r.json()["count"] == expected


def test_stores_zone_and_retailer(client, plot_df):
    r = client.get(
        "/api/stores",
        params={"zone": "west_coast", "retailer": "Starbucks"},
    )
    assert r.status_code == 200
    wc = {"CA", "OR", "WA", "AK", "HI"}
    expected = int(((plot_df["retail_account"] == "Starbucks")
                    & plot_df["state"].isin(wc)).sum())
    assert r.json()["count"] == expected


def test_stores_empty_result_is_well_formed(client):
    r = client.get("/api/stores", params={"retailer": "Nonexistent Brand"})
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 0
    assert body["stores"] == []


def test_stores_record_shape(client):
    r = client.get("/api/stores", params={"retailer": "CVS", "limit": 1})
    body = r.json()
    assert body["count"] == 1
    rec = body["stores"][0]
    assert set(rec) == {"id", "ra", "ct", "ad", "ci", "st", "zp",
                        "la", "lo", "cl", "gm"}
    assert isinstance(rec["la"], float) and isinstance(rec["lo"], float)
    assert rec["ra"] == "CVS"


# ---- /api/stores: query validation ---------------------------------------

def test_stores_limit_caps_response(client):
    r = client.get("/api/stores", params={"limit": 5})
    body = r.json()
    assert body["count"] == 5
    assert len(body["stores"]) == 5


def test_stores_limit_over_max_rejected(client):
    r = client.get("/api/stores", params={"limit": 999999})
    assert r.status_code == 422


def test_stores_limit_zero_rejected(client):
    r = client.get("/api/stores", params={"limit": 0})
    assert r.status_code == 422


# ---- /api/stats ----------------------------------------------------------

def test_stats_by_zone(client, df):
    r = client.get("/api/stats", params={"by": "zone"})
    assert r.status_code == 200
    body = r.json()
    assert body["by"] == "zone"
    expected = (df["state"].map(STATE_TO_ZONE).dropna()
                .value_counts().to_dict())
    expected = {k: int(v) for k, v in expected.items()}
    assert body["counts"] == expected


def test_stats_by_retailer(client, df):
    r = client.get("/api/stats", params={"by": "retailer"})
    assert r.status_code == 200
    expected = {k: int(v) for k, v in df["retail_account"].value_counts().items()}
    assert r.json()["counts"] == expected


def test_stats_by_state(client, df):
    r = client.get("/api/stats", params={"by": "state"})
    assert r.status_code == 200
    expected = {k: int(v) for k, v in df["state"].value_counts().items()}
    assert r.json()["counts"] == expected


def test_stats_by_cluster(client, df):
    r = client.get("/api/stats", params={"by": "cluster"})
    assert r.status_code == 200
    expected = {k: int(v) for k, v in df["class_of_trade"].value_counts().items()}
    assert r.json()["counts"] == expected


def test_stats_respects_filters(client, df):
    r = client.get("/api/stats", params={"by": "retailer", "state": "CA"})
    body = r.json()
    expected = {k: int(v) for k, v
                in df.loc[df["state"] == "CA", "retail_account"].value_counts().items()}
    assert body["counts"] == expected


def test_stats_invalid_dimension_rejected(client):
    r = client.get("/api/stats", params={"by": "bogus"})
    assert r.status_code == 422
