// Ingest a single JSON file at data/uploads/location-history.json,
// aggregate visits into H3 cells, and write derived data to data/tiles and data/meta.

const fs = require("fs/promises");
const path = require("path");
const h3 = require("h3-js");

const INPUT_FILE = path.join(process.cwd(), "data", "uploads", "location-history.json");
const DATASET_ID = "location-history";
const OUTPUT_DIR = path.join(process.cwd(), "data", "tiles", DATASET_ID);
const META_DIR = path.join(process.cwd(), "data", "meta");
const RESOLUTION = 13; // ~6–9 m edges

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
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

  const counts = new Map();
  const bounds = {
    minLat: Infinity,
    maxLat: -Infinity,
    minLon: Infinity,
    maxLon: -Infinity
  };

  let seen = 0;
  let used = 0;
  let totalWeight = 0;

  for (const entry of parsed) {
    seen += 1;
    const visit = entry?.visit;
    const top = visit?.topCandidate;
    const place = top?.placeLocation || visit?.placeLocation;
    const coords = parseGeo(place);
    if (!coords) continue;

    // Prefer topCandidate probability; fallback to visit.probability; default 1.
    const prob = parseProbability(top?.probability ?? visit?.probability);
    const weight = Number.isFinite(prob) ? prob : 1;

    const cell = h3.latLngToCell(coords.lat, coords.lon, RESOLUTION);
    const current = counts.get(cell) ?? 0;
    counts.set(cell, current + weight);
    used += 1;
    totalWeight += weight;

    bounds.minLat = Math.min(bounds.minLat, coords.lat);
    bounds.maxLat = Math.max(bounds.maxLat, coords.lat);
    bounds.minLon = Math.min(bounds.minLon, coords.lon);
    bounds.maxLon = Math.max(bounds.maxLon, coords.lon);
  }

  const cells = Array.from(counts.entries()).map(([id, count]) => ({ id, count }));
  const out = {
    resolution: RESOLUTION,
    cells
  };

  const meta = {
    datasetId: DATASET_ID,
    sourceFile: INPUT_FILE,
    cellResolution: RESOLUTION,
    cellCount: cells.length,
    totalWeight,
    seenPoints: seen,
    usedPoints: used,
    bounds
  };

  await fs.writeFile(path.join(OUTPUT_DIR, "cells.json"), JSON.stringify(out, null, 2));
  await fs.writeFile(path.join(META_DIR, `${DATASET_ID}.json`), JSON.stringify(meta, null, 2));

  console.log(`Ingestion complete.`);
  console.log(`Seen entries: ${seen}, used: ${used}, unique cells: ${cells.length}`);
  console.log(`Output: ${path.join(OUTPUT_DIR, "cells.json")}`);
}

function parseGeo(geo) {
  if (!geo || typeof geo !== "string") return null;
  // Format: "geo:lat,lon"
  const raw = geo.trim();
  const prefix = "geo:";
  if (!raw.startsWith(prefix)) return null;
  const parts = raw.slice(prefix.length).split(",");
  if (parts.length !== 2) return null;
  const lat = parseFloat(parts[0]);
  const lon = parseFloat(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function parseProbability(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const num = parseFloat(value);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
