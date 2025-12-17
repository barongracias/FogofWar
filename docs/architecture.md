# Architecture and Build Strategy

Fog-of-war map for Google Maps Timeline history. This document captures goals, choices, and implementation steps for ingestion, tiles, APIs, and rendering.

## Goals
- Show visited areas on a map with an RPG-style fog overlay; unvisited stays greyed out.
- No time-based playback; focus on coverage only.
- Keep raw location data private; only aggregated grid/tile data is exposed to the client.
- Handle ~10 years of daily timeline data without loading everything into memory.

## Non-goals (for now)
- Time scrubbing, streaks, or trip segmentation.
- Sharing/redaction flows beyond coarse aggregation.
- Mobile native client; web-first.

## Stack and key packages
- Next.js (App Router) with API routes for upload, metadata, and tile serving.
- Node/TypeScript ingestion worker (can run as a route handler, background job, or script).
- MapLibre GL client for custom WebGL rendering of fog + visited cells.
- Grid: H3 (via `h3-js`), target res 13–14 (~6–9 m edges).
- Streaming libs: `tar-stream` or `node:tar` + `node:zlib` for `.tgz`; `clarinet` or `jsonparse` for streaming JSON.
- Storage: disk/object storage for raw uploads (optional short retention) and generated tiles; disk-backed KV (SQLite/Better-SQLite3 or Level/LMDB) for aggregating cell counts.

## Data ingestion pipeline (current JSON-only MVP)
1) **Input**: place `data/uploads/location-history.json` (single JSON array of visits).  
2) **Parse**: read JSON, extract `visit.topCandidate.placeLocation` (`geo:lat,lon`), weight by `probability` (topCandidate, fallback to visit).  
3) **Grid + aggregate**: map to H3 at res 13; sum weights per cell.  
4) **Metadata**: bounds, counts, totals.  
5) **Outputs**: `data/tiles/location-history/cells.json` and `data/meta/location-history.json`.  
6) **API**: `GET /api/cells` serves the derived data to the map.

Memory note: current approach loads the JSON once (22 MB scale). When adding .tgz support, switch to streaming parse + disk-backed aggregation.

## Tile generation
- **Format**: start with JSON tiles for debuggability; optionally add MVT later.
- **Keying**: tiles at `/{datasetId}/{z}/{x}/{y}.json` (or `.mvt`).
- **Contents (JSON example)**:
  ```json
  {
    "cells": [
      { "id": "87283080dffffff", "w": 12 }
    ]
  }
  ```
  - `id`: H3 cell id; `w`: visit weight (count).
- **Aggregation for low zoom**: for z below the native grid resolution, pre-aggregate into coarser H3 res (e.g., res 9–11) to avoid overdraw.
- **Compression**: enable gzip/br on responses; store tiles compressed if desired.
- **Generation pass**: iterate all cell counts from the KV store, assign them to z/x/y buckets, and flush to disk.
- **Metadata endpoint**: `GET /api/meta/:datasetId` returns bounds, available zooms, and tile URL template.

## API surface (proposed)
- `GET /api/cells` — serves aggregated cells + metadata for the current dataset (`location-history`).
- (later) `POST /api/upload` — accept `.tgz`, kick off ingestion, return `datasetId`.
- (later) `GET /api/meta/:datasetId`, `GET /api/tiles/:datasetId/:z/:y` — for true tiling and multiple datasets.

## Client rendering (fog-of-war)
- **Basemap**: desaturated/grey raster style to keep focus on reveal layer.
- **Fog layer**: full-screen dark/grey overlay.
- **Visited layer**: MapLibre custom layer drawing H3 hexes from tiles. Use warm glow (amber/cyan) with slight blur to simulate 1–5 m reveal radius.
- **Opacity controls**: slider for fog opacity; toggle to show/hide visited layer for comparison.
- **Hover**: tooltip showing visit weight; snap to nearest hex center.
- **Performance**: request tiles based on viewport; throttle requests; cap zoom at data resolution.

## Storage and paths
- `data/uploads/{datasetId}/raw.tgz` (optional; delete after processing).
- `data/tiles/{datasetId}/{z}/{x}/{y}.json` (or `.mvt`).
- `data/meta/{datasetId}.json` for bounds/zoom info.
- `data/tmp/` for intermediate KV (SQLite/Level/LMDB file).

## Performance and quality considerations
- Streaming all the way to avoid O(N) memory.
- Use bounded batch writes to the KV store; avoid per-point fs writes.
- Consider parallel parsing per file entry if CPU bound, but keep memory caps.
- Validate files by size/mime; reject oversized uploads or request chunked uploads if needed.
- If tile volume is large, pre-gzip and serve with `Cache-Control` + `ETag`.

## Privacy and security
- Do not expose raw traces to the client—only aggregated cells.
- Offer a switch to delete raw uploads after tiles are produced.
- Use coarse grids for any shared/exported view (not in scope now).
- Keep dataset IDs unguessable; enforce per-user auth (to be added with auth provider of choice).

## Next implementation steps
1) Scaffold Next.js App Router with MapLibre GL client page.  
2) Add `POST /api/upload` with streaming gunzip/tar and streaming JSON parse.  
3) Implement H3 aggregation backed by disk KV; emit metadata.  
4) Generate JSON tiles and serve via `GET /api/tiles`.  
5) Connect client map to metadata + tile endpoints; add fog styling and controls.  
6) Add cleanup/retention jobs and basic health metrics.
