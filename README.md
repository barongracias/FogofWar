# Fog of Travel — Google Maps Timeline Fog-of-War Map

Turn your Google Maps Timeline export into an RPG-style fog-of-war map. Visited areas light up with a glowing heatmap; everywhere else stays hidden under animated fog.

No Google Maps API key required. The map uses [MapLibre GL](https://maplibre.org/) with free tile providers (MapLibre demo tiles and CartoCDN dark-matter).

## What it does

- Reads your Google Takeout `location-history.json` and aggregates GPS visits into H3 hex cells (~6–9 m resolution).
- Splits data into a **total** bucket and **per-year** buckets so you can scrub through time.
- Serves pre-computed tiles from local JSON files via Next.js API routes.
- Renders the map with a dark space/RPG aesthetic: visited cells glow, an animated fog overlay covers the rest.

## Quick start

### 1. Install dependencies

```bash
npm install
```

### 2. Add your Timeline data

Place your Google Takeout JSON file at:

```
data/uploads/location-history.json
```

The file should be a JSON array of visit/activity entries exported from Google Maps Timeline (Google Takeout > Location History > Semantic Location History, merged into one array, or the single combined `location-history.json` file).

### 3. Run the ingest script

```bash
npm run ingest
```

This reads `location-history.json`, aggregates coordinates into H3 cells, and writes:

| Path | Description |
|---|---|
| `data/tiles/location-history/<bucket>/cells.json` | Aggregated cells per bucket (`total` or a year like `2019`) |
| `data/tiles/location-history/<bucket>/tiles/{z}/{x}/{y}.json` | Pre-computed map tiles (zoom 4–14) |
| `data/meta/location-history.json` | Metadata: available buckets, zoom range, stats, bounds |
| `data/routes/location-history/<bucket>/route.json` | Chronological route line per bucket |

Ingest typically takes a few seconds for a few years of data.

### 4. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The map will load your visited cells automatically.

## Controls

| Control | Description |
|---|---|
| **Base** | Toggle between World overview and City Detail (dark-matter) basemap |
| **View** | Switch between all-time total and per-year buckets |
| **Year slider** | Scrub through years; color ramp shifts warm → cool with recency |
| **Fog** | Adjust the fog overlay opacity |
| **Glow scale** | Scale the halo radius around visited dots |
| **Density** | Scale fill opacity / heatmap intensity |
| **Route** | Toggle a chronological path line |
| **Fit to data** | Fly the camera to the bounds of the selected bucket |

## No API key needed

MapLibre GL is open-source and the bundled tile providers (MapLibre demo tiles, CartoCDN) are free for development use. No Google Maps API key or any paid credentials are required.

## Stack

- **Next.js 14** (App Router) — page, API routes for `/api/meta`, `/api/tiles`, `/api/path`
- **MapLibre GL** — open-source WebGL map renderer
- **H3-js** — Uber's hierarchical hex grid for snapping GPS points
- **polygon-clipping** — union of hex outlines per tile for clean borders
- Node.js ingest script (`scripts/ingest-json.js`) — no build step, runs with plain `node`

## Repo structure

```
app/              Next.js app (layout, page, globals.css)
api/              Next.js API route handlers (meta, tiles, path)
scripts/
  ingest-json.js  Ingest script — run with npm run ingest
data/
  uploads/        Drop location-history.json here
  tiles/          Generated tile JSON (git-ignored)
  meta/           Generated metadata JSON (git-ignored)
  routes/         Generated route JSON (git-ignored)
docs/
  architecture.md Detailed design notes
```
