# Retail Store Dashboard — Build Spec

A localhost-first, eventually-deployable dashboard that overlays ~14k US retail
store points on a US map, colored by cluster, filterable by retailer / state /
zone / cluster.

This document is the **single source of truth** for all 4 builder agents. Read
it in full before writing any code. Quote specific section numbers in commits.

## 1. Data

- **File:** `C:\projects\scraper\stores.parquet` (also at
  `/sessions/brave-loving-euler/mnt/projects/scraper/stores.parquet` from bash).
- **Rows now:** 14,048. **Designed for:** up to 81,000.
- **Schema (9 columns):**
  - `retail_account` (string) — e.g. `Target Stores`, `CVS`, `Walgreens`,
    `Starbucks`, `Seven Eleven`
  - `class_of_trade` (string) — e.g. `Mass Merchandiser`, `Chain Drug`,
    `Convenience`, `Chain Restaurant`
  - `address` (string)
  - `city` (string)
  - `state` (string, 2-letter USPS)
  - `zip_code` (string, 5-digit)
  - `latitude` (float64, nullable)
  - `longitude` (float64, nullable)
  - `google_maps_url` (string)

A `cluster_id` column will be added later (when ML clustering runs). Until then,
**color pins by `class_of_trade`** as a fallback. Backend already exposes a
`cluster` field that defaults to `class_of_trade` so the API is stable.

## 2. Zones (8 total, all 50 states + DC)

Computed at API time from `state`, NOT stored in parquet — easy to change.

| Zone slug | Display name | States |
|---|---|---|
| `west_coast` | West Coast | CA, OR, WA, AK, HI |
| `mountain_southwest` | Mountain / Southwest | AZ, NM, NV, UT, CO, ID, MT, WY |
| `plains` | Plains | ND, SD, NE, KS, OK, IA, MN, MO |
| `south_central` | Texas / South Central | TX, AR, LA |
| `deep_south` | Deep South | MS, AL, GA, FL, SC |
| `mid_atlantic` | Mid-Atlantic / Southeast | NC, VA, WV, KY, TN, MD, DE, DC |
| `northeast` | Northeast | NY, PA, NJ, MA, CT, RI, NH, VT, ME |
| `great_lakes` | Great Lakes / Midwest | OH, MI, IN, IL, WI |

The mapping lives in `data.py` as `STATE_TO_ZONE: dict[str, str]` and
`ZONES: list[{slug, display, states}]`. Agents should NOT hardcode zone names
elsewhere.

## 3. Stack (locked — do not deviate)

- **Backend:** FastAPI + Uvicorn. Python 3.10+. Reads parquet once on startup,
  holds DataFrame in memory.
- **Frontend:** static `index.html` + vanilla JS modules + Tailwind CDN. NO
  build step. NO React/Vue/Svelte. Single page.
- **Map:** [deck.gl](https://deck.gl) `ScatterplotLayer` over
  [MapLibre GL JS](https://maplibre.org/) base map (free OSM tiles via
  `https://demotiles.maplibre.org/style.json`). Both via CDN. deck.gl handles
  80k pins on canvas/WebGL — Leaflet markers do NOT scale past ~5k.
- **CSS:** Tailwind via CDN — `https://cdn.tailwindcss.com`.
- **No paid APIs.** No Mapbox token. No Google Maps. No deps install at runtime.

## 4. File layout

```
C:\projects\dashboard\
  app.py                # FastAPI app, all routes
  data.py               # parquet loader, zone mapping, filter helpers
  requirements.txt      # fastapi, uvicorn[standard], pandas, pyarrow
  static\
    index.html          # single-page UI shell
    styles.css          # any custom CSS beyond Tailwind
    app.js              # entrypoint: orchestrates filters + map
    filters.js          # filter UI module (see slice D)
    map.js              # map module (see slice C)
  tests\
    test_api.py         # external-feedback hooks
  README.md             # 1 page: how to run, what each route does
  PLAN.md               # this file (already exists)
```

## 5. Backend API contract (slice A owns these)

All return `application/json`. CORS allowed for `http://localhost:*`.

### `GET /api/meta`
Returns the static metadata for filter UIs. Cached after first compute.
```json
{
  "retailers": ["CVS", "Seven Eleven", "Starbucks", "Target Stores", "Walgreens"],
  "states":    ["AK", "AL", ... 52 codes ...],
  "zones": [
    {"slug": "west_coast", "display": "West Coast",
     "states": ["CA","OR","WA","AK","HI"]},
    ...
  ],
  "clusters":  ["Chain Drug", "Chain Restaurant", "Convenience",
                "Mass Merchandiser"],   // class_of_trade until cluster_id exists
  "total_rows": 14048,
  "schema_version": "v1"
}
```

### `GET /api/stores`
Returns a filtered list of stores as a flat array. Optimized for map render.

**Query params (all optional, all combinable, AND semantics across params,
OR within a multi-value param):**
- `retailer` — repeatable (`?retailer=CVS&retailer=Walgreens`)
- `state` — repeatable
- `zone` — repeatable (zone slug from `/api/meta`)
- `cluster` — repeatable (matches `class_of_trade` for now)
- `limit` — int, default 50000, max 100000

**Response shape (designed to minimize JSON size for 80k pins):**
```json
{
  "count": 14048,
  "stores": [
    {
      "id": "CVS|1545 PULASKI HIGHWAY|BEAR|DE|19701",
      "ra": "CVS",
      "ct": "Chain Drug",
      "ad": "1545 PULASKI HIGHWAY",
      "ci": "BEAR",
      "st": "DE",
      "zp": "19701",
      "la": 39.62297,
      "lo": -75.68522,
      "cl": "Chain Drug",
      "gm": "https://www.google.com/maps/search/?api=1&query=39.62297,-75.68522"
    },
    ...
  ]
}
```
Short keys (`ra`/`ct`/etc.) chosen to keep JSON small. Slice C maps these to
deck.gl props.

### `GET /api/stats?by=zone|state|retailer|cluster`
Returns per-bucket counts for the same filter params as `/api/stores`. Used
by the sidebar widgets.

### `GET /healthz`
Returns `{"status": "ok", "rows": 14048}`. Used by external-feedback tests.

### Static
`GET /` → serves `static/index.html`. `GET /static/*` → static files.

## 6. UI layout (slice B owns the shell)

Single full-viewport page, two-column flex:

```
+---------------------------------------------------+
| Header: "Retail Store Dashboard"  | total: 14048  |
+----------+----------------------------------------+
| Filters  |                                        |
| sidebar  |              MAP                       |
| (320 px) |          (deck.gl + MapLibre)          |
|          |                                        |
| Retailer |                                        |
| Zone     |                                        |
| State    |                                        |
| Cluster  |                                        |
|          |                                        |
| [counts] |                                        |
+----------+----------------------------------------+
```

Mobile: sidebar collapses to a top-of-screen drawer (Tailwind `md:` breakpoint).

## 7. Filters (slice D owns these)

- All four filters are `<select multiple>` (or a small custom multi-pick widget).
- Selecting nothing in a filter = no constraint on that dimension.
- Changes are debounced 250 ms then trigger a new fetch.
- Current filter state is reflected in URL query string so links are shareable.
- A "Clear all" button in the sidebar.
- A live counter shows `{filtered_count} / {total_count} stores` at the top.

## 8. Map (slice C owns this)

- Initial view: CONUS bounds (lon -125 to -66, lat 24 to 50). On load, fit to
  data bounds.
- `ScatterplotLayer`: radius scaled by zoom (small at low zoom to avoid
  blob-overlap, larger at high zoom for clickability).
- **Color by `cluster`** field (= `class_of_trade` until ML lands). Use a
  fixed palette of 8 colors keyed in a JS const so a future cluster_id with
  ≤8 buckets just works. Fallback: gray for unknown.
- Click a pin → popup with: retailer, address, city/state/zip, "Open in Google
  Maps" link from `gm` field.
- Pin count must stay > 30 fps when panning at 80k. (Hint: deck.gl with WebGL
  handles this if `data` is a single typed array, not a JS object array.)

## 9. Reflection loop (each agent runs internally)

Every agent runs **2–3 generate→critique→refine iterations** before reporting
back. Use this loop:

```python
MAX_ITERS = 3
PASS_BAR = 8
draft = generator()
for i in range(MAX_ITERS):
    feedback = run_external_tests(draft)        # boot server, hit /api/*, screenshot
    critique = critic(spec=PLAN_MD, draft=draft, feedback=feedback)
    if all(score >= PASS_BAR for score in critique.scores.values()):
        ship(draft); break
    draft = refiner(spec=PLAN_MD, draft=draft, critique=critique, feedback=feedback)
else:
    ship(last_draft, with_open_issues=critique.open_issues)
```

Critic rubric (score each 1–10):
- **Correctness** — meets the spec sections it claims to implement
- **Performance** — will it stay smooth at 80k rows?
- **Idiomatic** — modern FastAPI / vanilla JS patterns
- **Robustness** — error paths, empty filters, null lat/lon, mobile width
- **Future-proof** — easy to swap parquet→Supabase, add filters, deploy

## 10. External feedback hooks (concrete, per slice)

| Slice | Hook |
|---|---|
| A backend | `uvicorn app:app --port 8001 &; sleep 2; curl /healthz; curl /api/meta; curl '/api/stores?retailer=Walgreens' | jq '.count'` — must equal known count from a parquet groupby. |
| B skeleton | `curl localhost:8001` returns 200; HTML contains `<div id="map">`, `<aside id="filters">`, `<header>` with total. |
| C map | Headless browser → take screenshot → verify pins visible (canvas non-blank), `window.__pinCount` debug global ≥ filtered count. |
| D filters | JS test: select retailer=Walgreens, fire change, await fetch, assert `window.__pinCount` matches backend's count for the same filter. |

## 11. Definition of done (per slice)

A — backend: `uvicorn app:app` boots, `/healthz` 200, `/api/meta` returns valid
shape, `/api/stores?retailer=X` returns correct count for at least 5 X values,
`/api/stores?zone=west_coast` correct, multi-filter combinations correct.
Tests pass.

B — skeleton: page loads at `localhost:8001`, sidebar + map area visible,
total-rows badge populated from `/api/meta`, no console errors.

C — map: pins render at correct lat/lon, color matches cluster palette,
click-popup works, FPS ≥ 30 panning a synthetic 80k dataset.

D — filters: every filter dimension narrows the result set correctly,
URL updates and is reload-safe, counter shows live count, "Clear all" works.

## 12. Hard rules

- Free / open-source only. No paid APIs.
- No build step. No npm install. CDN imports only.
- After ANY `.py` edit: `touch <file>` to invalidate fuse-mount stale .pyc.
- After ANY `Edit` tool use: re-read the file, check for syntax errors and
  null bytes; if found, `tr -d '\000' < f > /tmp/c; cp /tmp/c f; touch f`.
- Bash sandbox kills backgrounded processes — `nohup &` does NOT survive across
  bash calls. For long server tests, boot in same bash call as the curl.
- Parquet path is `C:\projects\scraper\stores.parquet` — backend must NOT
  hardcode `/sessions/...` paths (those are linux-mount specific).
