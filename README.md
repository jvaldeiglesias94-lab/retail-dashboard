# Retail Store Dashboard

Localhost-first dashboard that overlays ~14k US retail store points on a US map,
colored by cluster, and filterable by retailer / state / zone / cluster. See
`PLAN.md` for the full spec.

## Prerequisites

- Python 3.10+
- The parquet file at `C:\projects\scraper\stores.parquet`
  (Linux mount: `/sessions/brave-loving-euler/mnt/projects/scraper/stores.parquet`)
- A modern browser (Chrome / Edge / Firefox). Internet access is needed once for
  the CDN-loaded JS (Tailwind, MapLibre, deck.gl).

## Install

```bash
cd C:\projects\dashboard
pip install -r requirements.txt
```

## Run

```bash
cd C:\projects\dashboard
uvicorn app:app --reload --port 8001
```

Then open <http://localhost:8001/> in a browser.

## Routes

| Method | Path                                | Purpose                                           |
| ------ | ----------------------------------- | ------------------------------------------------- |
| GET    | `/`                                 | Serves `static/index.html` (the dashboard shell). |
| GET    | `/static/*`                         | Static assets (`app.js`, `map.js`, `filters.js`, `styles.css`). |
| GET    | `/healthz`                          | Liveness probe — `{"status":"ok","rows":N}`.      |
| GET    | `/api/meta`                         | Static metadata for filter UIs (retailers, states, zones, clusters, total). |
| GET    | `/api/stores`                       | Filtered store list. Query params: `retailer`, `state`, `zone`, `cluster` (all repeatable), `limit` (default 50000, max 100000). |
| GET    | `/api/stats?by=zone\|state\|retailer\|cluster` | Per-bucket counts under the same filter params.   |

## Frontend layout

- `static/index.html` — page shell, header with live counter, sidebar (`#filters`), main map (`#map`).
- `static/styles.css` — minimal custom CSS (spinner, focus rings).
- `static/app.js` — entrypoint. Fetches `/api/meta`, calls `MapViz.init` and `Filters.init`, debounces filter changes (250 ms) and re-fetches `/api/stores`.
- `static/map.js` — deck.gl `ScatterplotLayer` over MapLibre (slice C).
- `static/filters.js` — multi-select filter widgets + URL query-string sync (slice D).

## Architecture (1 paragraph)

FastAPI loads the parquet once into a pandas DataFrame at boot and serves
filtered slices as compact JSON (short keys). The browser uses deck.gl on
WebGL so 80k pins stay above 30 fps. No build step — Tailwind, MapLibre, and
deck.gl are loaded from CDNs.

## Screenshot

_TODO: add `docs/screenshot.png` once a real cluster_id lands._

```
+---------------------------------------------------+
| Retail Store Dashboard            14048 / 14048   |
+----------+----------------------------------------+
| Filters  |                                        |
|          |               MAP                      |
| Retailer |                                        |
| State    |                                        |
| Zone     |                                        |
| Cluster  |                                        |
|          |                                        |
| [Clear]  |                                        |
+----------+----------------------------------------+
```
