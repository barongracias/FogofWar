// Aggregates location-history.json into H3 cells for total and per-year buckets.
// Input: data/uploads/location-history.json (array of visits)
// Output:
//   data/tiles/location-history/<bucket>/cells.json (bucket = "total" or year)
//   data/meta/location-history.json (metadata + available buckets)
//
// Run: npm run ingest

const fs = require("fs/promises");
const path = require("path");
const h3 = require("h3-js");

const INPUT_FILE = path.join(process.cwd(), "data", "uploads", "location-history.json");
const DATASET_ID = "location-history";
const TILES_ROOT = path.join(process.cwd(), "data", "tiles", DATASET_ID);
const META_DIR = path.join(process.cwd(), "data", "meta");
const RESOLUTION = 13; // ~6–9 m edges
const TILE_MIN_Z = 4;
const TILE_MAX_Z = 14;

async function main() {
  await fs.mkdir(TILES_ROOT, { recursive: true });
  await fs.mkdir(META_DIR, { recursive: true });

  let raw;
  try {
    raw = await fs.readFile(INPUT_FILE, "utf8");
  } catch (err) {
    console.error(`Unable to read input file at ${INPUT_FILE}. Place your JSON there.`);
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error("Failed to parse JSON. Ensure the file is a JSON array of visits.", err);
    process.exit(1);
  }

  if (!Array.isArray(parsed)) {
    console.error("Expected top-level JSON array.");
    process.exit(1);
  }

  // Map bucket -> Map(cellId -> weight)
  const bucketMaps = new Map();
  const bucketStats = new Map();

  const ensureBucket = (bucket) => {
    if (!bucketMaps.has(bucket)) {
      bucketMaps.set(bucket, new Map());
      bucketStats.set(bucket, {
        seenPoints: 0,
        usedPoints: 0,
        totalWeight: 0,
        bounds: {
          minLat: Infinity,
          maxLat: -Infinity,
          minLon: Infinity,
          maxLon: -Infinity
        }
      });
    }
    return {
      map: bucketMaps.get(bucket),
      stats: bucketStats.get(bucket)
    };
  };

  let globalSeen = 0;
  let globalUsed = 0;

  for (const entry of parsed) {
    // Build candidate coordinates from visit and activity entries.
    const coordsList = [];
    const visit = entry?.visit;
    const top = visit?.topCandidate;
    const place = top?.placeLocation || visit?.placeLocation;
    const bucketYear = parseYear(entry?.startTime || entry?.endTime);
    const probVisit = parseProbability(top?.probability ?? visit?.probability);

    const visitCoords = parseGeo(place);
    if (visitCoords) coordsList.push({ coords: visitCoords, weight: normalizeWeight(probVisit) });

    // Activity entries may have start/end with geo strings or lat/lon fields.
    const act = entry?.activity;
    if (act) {
      const actProb = parseProbability(act?.topCandidate?.probability);
      const w = normalizeWeight(actProb);
      const startCoords = parseGeo(act.start);
      const endCoords = parseGeo(act.end);
      if (startCoords) coordsList.push({ coords: startCoords, weight: w });
      if (endCoords) coordsList.push({ coords: endCoords, weight: w });
    }

    if (!coordsList.length) continue;

    for (const { coords, weight } of coordsList) {
      const cell = h3.latLngToCell(coords.lat, coords.lon, RESOLUTION);

      for (const bucket of ["total", bucketYear].filter(Boolean)) {
        const { map, stats } = ensureBucket(bucket);
        const current = map.get(cell) ?? 0;
        map.set(cell, current + weight);
        stats.usedPoints += 1;
        stats.totalWeight += weight;
        stats.bounds.minLat = Math.min(stats.bounds.minLat, coords.lat);
        stats.bounds.maxLat = Math.max(stats.bounds.maxLat, coords.lat);
        stats.bounds.minLon = Math.min(stats.bounds.minLon, coords.lon);
        stats.bounds.maxLon = Math.max(stats.bounds.maxLon, coords.lon);
        stats.seenPoints += 1;
      }
      globalUsed += 1;
      globalSeen += 1;
    }
  }

  const availableBuckets = Array.from(bucketMaps.keys()).sort((a, b) => {
    if (a === "total") return -1;
    if (b === "total") return 1;
    return Number(a) - Number(b);
  });

  const tileCounts = {};

  for (const bucket of availableBuckets) {
    const cells = Array.from(bucketMaps.get(bucket).entries()).map(([id, count]) => ({
      id,
      count
    }));
    const out = {
      resolution: RESOLUTION,
      cells
    };
    const bucketDir = path.join(TILES_ROOT, bucket);
    await fs.mkdir(bucketDir, { recursive: true });
    await fs.writeFile(path.join(bucketDir, "cells.json"), JSON.stringify(out, null, 2));
    const stats = bucketStats.get(bucket);
    stats.cellCount = cells.length;

    // Generate tiled JSON
    tileCounts[bucket] = await buildTilesForBucket(bucket, cells);
  }

  const metaBuckets = {};
  for (const bucket of availableBuckets) {
    metaBuckets[bucket] = {
      ...bucketStats.get(bucket),
      tileCount: tileCounts[bucket],
      tileZooms: { min: TILE_MIN_Z, max: TILE_MAX_Z }
    };
  }

  const meta = {
    datasetId: DATASET_ID,
    resolution: RESOLUTION,
    sourceFile: INPUT_FILE,
    availableBuckets,
    buckets: metaBuckets,
    global: {
      seenPoints: globalSeen,
      usedPoints: globalUsed
    },
    tileZooms: { min: TILE_MIN_Z, max: TILE_MAX_Z },
    tileTemplate: `/api/tiles/${DATASET_ID}/{bucket}/{z}/{x}/{y}`
  };

  await fs.writeFile(path.join(META_DIR, `${DATASET_ID}.json`), JSON.stringify(meta, null, 2));

  console.log("Ingestion complete.");
  console.log(`Total seen entries: ${globalSeen}, used: ${globalUsed}`);
  console.log(`Buckets: ${availableBuckets.join(", ")}`);
}

function parseGeo(geo) {
  // Accept multiple shapes:
  // - string "geo:lat,lon" or "lat,lon"
  // - array [lat, lon]
  // - object with {lat, lon} | {latitude, longitude} | {lng, lat} | {latE7, lngE7} | {latitudeE7, longitudeE7}
  if (!geo) return null;

  if (typeof geo === "string") {
    const raw = geo.trim();
    const prefix = "geo:";
    const withoutPrefix = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
    const parts = withoutPrefix.split(",");
    if (parts.length !== 2) return null;
    const lat = parseFloat(parts[0]);
    const lon = parseFloat(parts[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
  }

  if (Array.isArray(geo) && geo.length >= 2) {
    const [lat, lon] = geo;
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  }

  if (typeof geo === "object") {
    const lat =
      geo.lat ?? geo.latitude ?? geo.latE7 / 1e7 ?? geo.latitudeE7 / 1e7 ?? null;
    const lon =
      geo.lon ?? geo.lng ?? geo.longitude ?? geo.lonE7 / 1e7 ?? geo.lngE7 / 1e7 ?? geo.longitudeE7 / 1e7 ?? null;
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  }

  return null;
}

function parseProbability(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const num = parseFloat(value);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

function normalizeWeight(prob) {
  if (Number.isFinite(prob)) {
    // Prevent zeroed cells; clamp to minimum 1.
    return Math.max(prob, 1);
  }
  return 1;
}

async function buildTilesForBucket(bucket, cells) {
  const tilesDir = path.join(TILES_ROOT, bucket, "tiles");
  await fs.mkdir(tilesDir, { recursive: true });
  const tileMap = new Map(); // key -> array of cells

  for (const cell of cells) {
    const [lat, lon] = h3.cellToLatLng(cell.id);
    for (let z = TILE_MIN_Z; z <= TILE_MAX_Z; z++) {
      const { x, y } = lngLatToTile(lon, lat, z);
      const key = `${z}/${x}/${y}`;
      if (!tileMap.has(key)) tileMap.set(key, []);
      tileMap.get(key).push(cell);
    }
  }

  for (const [key, list] of tileMap.entries()) {
    const [z, x, y] = key.split("/");
    const dir = path.join(tilesDir, z, x);
    await fs.mkdir(dir, { recursive: true });
    const payload = { cells: list };
    await fs.writeFile(path.join(dir, `${y}.json`), JSON.stringify(payload));
  }
  return tileMap.size;
}

function lngLatToTile(lon, lat, zoom) {
  const tileCount = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * tileCount);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * tileCount
  );
  const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
  return {
    x: clamp(x, 0, tileCount - 1),
    y: clamp(y, 0, tileCount - 1)
  };
}

function parseYear(value) {
  if (!value || typeof value !== "string") return null;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return null;
  return new Date(t).getUTCFullYear().toString();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
