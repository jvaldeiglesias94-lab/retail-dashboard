"""Phase 1 merge: friend's Places-API Excel + our scraper parquet
            -> C:\\projects\\stores_v2.parquet (canonical 19-col schema).

Rules (per project plan):
  - Adopt friend's 19-column schema as base.
  - US-only (drop ~71 non-US from friend's file).
  - Class of trade mapped from brand via the original Retail Universe.xlsx.
  - Dedupe key: (brand_lower, normalized_address, city_lower, state, zip5).
  - Tie-breaker on duplicate group: keep the row with the MOST non-null fields.
"""
from __future__ import annotations

import json
import re
import sys
import time
from collections import defaultdict
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from data import STATE_TO_ZONE  # noqa: E402

FRIEND_XLSX = "/sessions/brave-loving-euler/mnt/projects/master_clean_output.xlsx"
MINE_PARQUET = "/sessions/brave-loving-euler/mnt/projects/scraper/stores.parquet"
RETAIL_UNIVERSE = "/sessions/brave-loving-euler/mnt/projects/Retail Universe.xlsx"
OUT_PARQUET = "/sessions/brave-loving-euler/mnt/projects/stores_v2.parquet"
OUT_REPORT = "/sessions/brave-loving-euler/mnt/projects/MERGE_REPORT.md"

# Canonical 19-col schema (friend's columns, in their order).
CANON_COLS = [
    "brand", "store_name",
    "address_line_1", "address_line_2",
    "city", "state", "zip_code", "country",
    "phone", "website",
    "store_locator_url", "google_maps_url",
    "latitude", "longitude",
    "source_type", "source_url",
    "extraction_date", "status", "notes",
]


def load_class_of_trade_map() -> dict[str, str]:
    """Pull (brand -> class_of_trade) from the original Retail Universe Excel,
    plus a few obvious overrides for buckets that only appear in friend's data.
    """
    wb = pd.read_excel(RETAIL_UNIVERSE, sheet_name="Stores", header=2)
    # Sheet has columns: 'Store Name', 'Type of Store', (blank), 'Store Count Total Across USA'
    wb = wb[["Store Name", "Type of Store"]].dropna(subset=["Store Name"])
    m: dict[str, str] = {}
    for _, row in wb.iterrows():
        name = str(row["Store Name"]).strip()
        cot  = str(row["Type of Store"]).strip()
        if name and cot:
            m[name.lower()] = cot
    # explicit overrides for friend-only buckets
    m.setdefault("convenience stores", "Convenience")
    m.setdefault("fitness gyms", "Fitness Gym")
    return m


_WS = re.compile(r"\s+")
_PUNCT = re.compile(r"[.,]")


def norm_addr(s) -> str:
    if pd.isna(s): return ""
    return _WS.sub(" ", _PUNCT.sub("", str(s).lower())).strip()


def norm_zip(s) -> str:
    if pd.isna(s): return ""
    digits = re.sub(r"\D", "", str(s))
    return digits[:5].zfill(5) if 1 <= len(digits) <= 9 else ""


def to_canonical_friend(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    # already in 19-col format; just enforce columns + dtype
    for c in CANON_COLS:
        if c not in out.columns:
            out[c] = pd.NA
    return out[CANON_COLS]


def to_canonical_mine(df: pd.DataFrame, cot_map: dict[str, str]) -> pd.DataFrame:
    out = pd.DataFrame()
    out["brand"] = df["retail_account"]
    out["store_name"] = df["retail_account"]
    out["address_line_1"] = df["address"]
    out["address_line_2"] = pd.NA
    out["city"] = df["city"]
    out["state"] = df["state"]
    out["zip_code"] = df["zip_code"]
    out["country"] = "US"
    out["phone"] = pd.NA
    out["website"] = pd.NA
    out["store_locator_url"] = pd.NA
    out["google_maps_url"] = df["google_maps_url"]
    out["latitude"] = df["latitude"]
    out["longitude"] = df["longitude"]
    out["source_type"] = "direct_scrape"
    out["source_url"] = pd.NA
    out["extraction_date"] = pd.NA
    out["status"] = "valid"
    out["notes"] = pd.NA
    return out[CANON_COLS]


def main():
    t0 = time.monotonic()

    print("loading friend's Excel...", flush=True)
    friend_raw = pd.read_excel(FRIEND_XLSX, sheet_name="stores")
    print(f"  rows: {len(friend_raw)}")

    print("loading mine parquet...", flush=True)
    mine_raw = pd.read_parquet(MINE_PARQUET)
    print(f"  rows: {len(mine_raw)}")

    cot_map = load_class_of_trade_map()
    print(f"loaded class_of_trade map: {len(cot_map)} brands")

    # to canonical
    friend_c = to_canonical_friend(friend_raw)
    mine_c   = to_canonical_mine(mine_raw, cot_map)

    # US-only filter on friend
    before = len(friend_c)
    friend_c = friend_c[friend_c["country"].astype(str).str.upper() == "US"].copy()
    print(f"friend US-only: {len(friend_c)} (dropped {before - len(friend_c)} non-US)")

    # concat
    combined = pd.concat([friend_c, mine_c], ignore_index=True)
    print(f"concatenated: {len(combined)}")

    # dedupe
    combined["_brand_key"] = combined["brand"].astype(str).str.lower().str.strip()
    combined["_addr_key"]  = combined["address_line_1"].apply(norm_addr)
    combined["_city_key"]  = combined["city"].astype(str).str.lower().str.strip()
    combined["_state_key"] = combined["state"].astype(str).str.upper().str.strip()
    combined["_zip_key"]   = combined["zip_code"].apply(norm_zip)
    # non-null score for tie-break (more populated rows win)
    combined["_score"] = combined[CANON_COLS].notna().sum(axis=1)

    combined = combined.sort_values("_score", ascending=False)
    deduped = combined.drop_duplicates(
        subset=["_brand_key", "_addr_key", "_city_key", "_state_key", "_zip_key"],
        keep="first",
    ).copy()
    deduped = deduped.drop(columns=["_brand_key","_addr_key","_city_key","_state_key","_zip_key","_score"])
    deduped = deduped.reset_index(drop=True)
    print(f"after dedupe: {len(deduped)} (removed {len(combined) - len(deduped)} duplicates)")

    # Per-source breakdown of who survived
    by_source = deduped["source_type"].value_counts(dropna=False).to_dict()
    print(f"by source_type after dedupe: {by_source}")

    # write
    deduped.to_parquet(OUT_PARQUET, compression="zstd")
    sz = Path(OUT_PARQUET).stat().st_size
    print(f"wrote {OUT_PARQUET}  rows={len(deduped)}  size={sz:,} bytes")

    # report
    per_brand = deduped["brand"].value_counts()
    per_state = deduped["state"].value_counts()

    # who came from where, per-brand
    by_source_per_brand = (
        deduped.groupby(["brand", "source_type"]).size().unstack(fill_value=0)
    )

    lines = [
        "# Merge Report — Phase 1",
        "",
        f"Generated: {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime())}",
        "",
        "## Inputs",
        f"- friend's Excel (`master_clean_output.xlsx`): **{len(friend_raw):,}** rows",
        f"- our parquet (`stores.parquet`): **{len(mine_raw):,}** rows",
        f"- class-of-trade lookup (`Retail Universe.xlsx`): {len(cot_map)} brands mapped",
        "",
        "## Steps",
        "1. Adopted friend's 19-col schema as canonical.",
        "2. Mapped our 9-col rows into 19-col with `source_type='direct_scrape'`.",
        f"3. Dropped {before - len(friend_c)} non-US rows from friend's file.",
        f"4. Concatenated → {len(combined):,} rows.",
        f"5. Dedupe key: `(brand, address, city, state, zip5)` — kept row with most non-null fields. Removed {len(combined) - len(deduped):,} duplicates.",
        "",
        "## Output",
        f"- `C:\\projects\\stores_v2.parquet` — **{len(deduped):,} unique stores**, {len(deduped.columns)} cols",
        "",
        "## Per-source breakdown",
    ]
    for k, v in by_source.items():
        lines.append(f"- `{k}`: {v:,} rows")
    lines += [
        "",
        "## Per-brand breakdown (top 30)",
        "",
        "| Brand | Final | from places_api | from direct_scrape |",
        "|---|---:|---:|---:|",
    ]
    for brand in per_brand.head(30).index:
        final = int(per_brand[brand])
        src = by_source_per_brand.loc[brand] if brand in by_source_per_brand.index else None
        api = int(src.get("places_api", 0)) if src is not None else 0
        scr = int(src.get("direct_scrape", 0)) if src is not None else 0
        lines.append(f"| {brand} | {final:,} | {api:,} | {scr:,} |")
    lines += [
        "",
        f"... and {max(0, len(per_brand) - 30)} more brands",
        "",
        "## Top 15 states",
        "",
        "| State | Stores |",
        "|---|---:|",
    ]
    for st in per_state.head(15).index:
        lines.append(f"| {st} | {int(per_state[st]):,} |")
    lines += [
        "",
        f"Total unique states: **{per_state.shape[0]}**",
        f"Lat/lon coverage: **{deduped['latitude'].notna().sum():,} / {len(deduped):,}** ({100*deduped['latitude'].notna().mean():.1f}%)",
        f"Phone coverage: **{deduped['phone'].notna().sum():,} / {len(deduped):,}** ({100*deduped['phone'].notna().mean():.1f}%)",
        f"Website coverage: **{deduped['website'].notna().sum():,} / {len(deduped):,}** ({100*deduped['website'].notna().mean():.1f}%)",
    ]
    Path(OUT_REPORT).write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {OUT_REPORT}")
    print(f"elapsed: {time.monotonic()-t0:.1f}s")


if __name__ == "__main__":
    main()
