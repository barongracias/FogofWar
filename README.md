# g-maps-timeline (fog-of-war)

Turn your Google Maps Timeline history into an RPG-style fog-of-war map. Upload your Google Takeout `.tgz`, process it into tiles, and view explored areas on a greyscale map while unexplored areas stay fogged.

## Status
- Planning/docs only. Implementation will follow the design in `docs/architecture.md`.

## Core idea
- Ingest Google Timeline exports, filter noisy points, snap them to a small grid (~6–9 m), and aggregate visits.
- Precompute tiles that only expose aggregated grid cells (no raw traces).
- Render a MapLibre GL map with a fog overlay: visited cells light up; the rest stays greyed out.

## Stack (proposed)
- Next.js (App Router) with API routes for upload, processing, and tile serving.
- Node/TypeScript streaming ingestion for `.tgz` + JSON parsing, H3 grid aggregation, and tile generation.
- MapLibre GL client with a custom layer for the fog/reveal effect.
- Storage: disk/object storage for raw uploads (optional short retention) and generated tiles; disk-backed KV (SQLite/Level/LMDB) for grid counts during processing.

## Data flow (high level)
1) User uploads Google Takeout `.tgz` containing Semantic Location History JSON.  
2) Server streams untar + JSON parse; drops low-accuracy points; dedupes near-identical consecutive points.  
3) Points are snapped to an H3 grid (res 13–14) and aggregated to visit counts.  
4) Aggregated cells are emitted as JSON or vector tiles keyed by `z/x/y` and stored.  
5) The client map requests metadata (bounds, max zoom) and tiles for the current viewport, revealing only visited cells over a foggy basemap.

## Repo structure
- `README.md` — this file.  
- `docs/architecture.md` — detailed design for ingestion, tiles, API, and rendering (fog-of-war).  
- (to be added) `app/` (Next.js), `scripts/` (ingestion worker), `data/` (generated tiles).

## Drop your data
- Place your Timeline JSON at `data/uploads/location-history.json` (single file ingest for now).
- Run `npm run ingest` to aggregate into H3 cells.
- Generated data:
  - Cells: `data/tiles/location-history/cells.json`
  - Metadata: `data/meta/location-history.json`
  - API: `GET /api/cells` (used by the map)

## Next steps
- Flesh out ingestion to accept .tgz and streaming parses.
- Add fog styling polish (desaturated basemap, animations), opacity controls, and dataset selection.
- Add retention/cleanup and upload endpoints once ready.
