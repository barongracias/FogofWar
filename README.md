# Fog of Travel

Turn your Google Maps Timeline export into an interactive fog-of-war map. Visited areas glow through the darkness; everywhere you have never been stays hidden under animated fog.

No Google Maps API key required. The renderer uses [MapLibre GL](https://maplibre.org/) with free tile providers (MapLibre demo tiles and CartoCDN dark-matter).

## What it does

- Reads your Google Takeout `location-history.json` and snaps GPS visits to [H3](https://h3geo.org/) hex cells.
- Splits history into a **total** bucket and **per-year** buckets so you can scrub through time with a slider.
- Pre-computes map tiles as local JSON files; Next.js API routes serve them at runtime — no database required.
- Renders a dark frosted-glass UI with heatmap, hex-fill, and outline layers that shift colour with recency.

## Required environment variables

None. The app reads data from the local filesystem (`data/` directory). No API keys or secrets are needed.

## How to run locally

### 1. Install dependencies

```bash
npm install
```

### 2. Add your Timeline export

Obtain your location history via **Google Takeout** (select Location History, then download). Place the JSON file at:

```
data/uploads/location-history.json
```

The file should be a JSON array of visit/activity objects from Google Maps Timeline.

### 3. Ingest the data

```bash
npm run ingest
```

The ingest script reads `location-history.json`, aggregates coordinates into H3 cells, and writes:

| Path | Description |
|---|---|
| `data/tiles/location-history/<bucket>/cells.json` | Aggregated cells per bucket |
| `data/tiles/location-history/<bucket>/tiles/{z}/{x}/{y}.json` | Pre-computed tiles (zoom 4–14) |
| `data/meta/location-history.json` | Metadata: buckets, zoom range, stats, bounds |
| `data/routes/location-history/<bucket>/route.json` | Chronological route line per bucket |

Ingest takes a few seconds for a few years of data; a full decade may take 30–60 seconds.

### 4. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The map loads your visited cells automatically.

## Controls

| Control | Description |
|---|---|
| **Base** | Toggle between World overview and City Detail (dark-matter) basemap |
| **View** | Switch to all-time total view |
| **Year slider** | Scrub through years; colour ramp shifts warm to cool with recency |
| **Fog** | Adjust the fog overlay opacity |
| **Glow scale** | Scale the halo radius around visited dots |
| **Density** | Scale fill opacity and heatmap intensity |
| **Route** | Toggle a chronological path line over your visits |
| **Fit to data** | Fly the camera to the bounds of the selected bucket |

## Stack

- **Next.js 14** (App Router) — page, layout, and API routes for `/api/meta`, `/api/tiles`, `/api/path`
- **MapLibre GL** — open-source WebGL map renderer
- **H3-js** — Uber's hierarchical hex grid for snapping GPS points to cells
- **polygon-clipping** — union of hex outlines per tile for clean region borders
- Node.js ingest script (`scripts/ingest-json.js`) — plain `node`, no build step

## Project structure

```
app/
  layout.tsx          Root layout with frosted-glass header
  page.tsx            Map page and all interactive controls
  globals.css         Design tokens and component styles
  api/
    meta/route.ts     Dataset metadata endpoint
    cells/route.ts    Raw cells endpoint (used by ingest tooling)
    path/route.ts     Route line endpoint
    tiles/[bucket]/[z]/[x]/[y]/route.ts   Tile endpoint
scripts/
  ingest-json.js      Ingest script — run with npm run ingest
data/
  uploads/            Drop location-history.json here
  tiles/              Generated tile JSON (git-ignored)
  meta/               Generated metadata JSON (git-ignored)
  routes/             Generated route JSON (git-ignored)
```
