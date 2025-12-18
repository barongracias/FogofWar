"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import * as h3 from "h3-js";

const BASE_STYLES = [
  {
    id: "world",
    label: "World",
    url: "https://demotiles.maplibre.org/style.json"
  },
  {
    id: "city",
    label: "City Detail",
    url: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
  }
];

type BucketStats = {
  seenPoints: number;
  usedPoints: number;
  totalWeight: number;
  cellCount: number;
  bounds?: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  tileCount?: number;
  tileZooms?: { min: number; max: number };
};

type MetaResponse = {
  datasetId: string;
  availableBuckets: string[];
  tileZooms?: { min: number; max: number };
  tileTemplate?: string;
  buckets?: Record<string, BucketStats>;
};

type TileKey = { z: number; x: number; y: number };
type TilePayload = { cells: { id: string; count: number }[] };

export default function Home() {
  return (
    <div className="page">
      <section className="panel">
        <div className="panel-header">
          <h2>Fog-of-war map</h2>
          <p className="note">Loads tiled cells per viewport. Bright hexes mark visited areas.</p>
        </div>
        <FogOfWarMap />
      </section>
    </div>
  );
}

function FogOfWarMap() {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstance = useRef<maplibregl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [selectedBucket, setSelectedBucket] = useState<string>("total");
  const [fogOpacity, setFogOpacity] = useState<number>(0.35);
  const [glowScale, setGlowScale] = useState<number>(1);
  const [tileZoom, setTileZoom] = useState<number>(10);
  const [baseStyle, setBaseStyle] = useState(BASE_STYLES[0]);
  const [styleVersion, setStyleVersion] = useState(0);
  const fitBoundsOnce = useRef(false);
  // Map caching to avoid re-fetching tiles in view
  const tileCache = useRef<Map<string, TilePayload>>(new Map<string, TilePayload>());
  const requestSeq = useRef(0);

  const clearSources = useCallback(() => {
    const map = mapInstance.current;
    if (!map) return;
    const emptyFc: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
    const polySourceId = "visited-cells-polys";
    const pointSourceId = "visited-cells-points";
    (map.getSource(polySourceId) as maplibregl.GeoJSONSource | undefined)?.setData(emptyFc);
    (map.getSource(pointSourceId) as maplibregl.GeoJSONSource | undefined)?.setData(emptyFc);
  }, []);

  useEffect(() => {
    if (mapInstance.current) return;
    const container = mapRef.current;
    if (!container) return;

    const map = new maplibregl.Map({
      container,
      style: baseStyle.url,
      center: [0, 20],
      zoom: 1.5,
      attributionControl: true
    });
    mapInstance.current = map;
    map.on("load", () => setMapLoaded(true));

    return () => {
      map.remove();
      mapInstance.current = null;
      setMapLoaded(false);
    };
  }, []);

  // Switch base style and re-add layers
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    map.setStyle(baseStyle.url);
    map.once("styledata", () => {
      setStyleVersion((v) => v + 1);
      fitBoundsOnce.current = false;
      clearSources();
      tileCache.current.clear();
    });
  }, [baseStyle, clearSources]);

  // Load metadata
  useEffect(() => {
    async function loadMeta() {
      setStatus("loading");
      setError(null);
      try {
        const res = await fetch("/api/meta");
        if (!res.ok) throw new Error(`API error ${res.status}`);
        const json = (await res.json()) as MetaResponse;
        setMeta(json);
        if (json.availableBuckets?.includes("total")) {
          setSelectedBucket("total");
        } else if (json.availableBuckets?.length) {
          setSelectedBucket(json.availableBuckets[0]);
        }
        if (json.tileZooms) {
          setTileZoom(json.tileZooms.min ?? 10);
        }
        setStatus("ready");
      } catch (err: any) {
        console.error(err);
        setError(err?.message || "Failed to load metadata");
        setStatus("error");
      }
    }
    loadMeta();
  }, []);

  // Add sources/layers once
  useEffect(() => {
    if (!mapLoaded || !mapInstance.current) return;
    const map = mapInstance.current;
    const polySourceId = "visited-cells-polys";
    const pointSourceId = "visited-cells-points";
    const emptyFc: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
    if (!map.getSource(polySourceId)) {
      map.addSource(polySourceId, { type: "geojson", data: emptyFc });
    }
    if (!map.getSource(pointSourceId)) {
      map.addSource(pointSourceId, { type: "geojson", data: emptyFc });
    }

    if (!map.getLayer("visited-dots")) {
      map.addLayer({
        id: "visited-dots",
        type: "circle",
        source: pointSourceId,
        paint: {
          "circle-color": "transparent",
          "circle-stroke-color": [
            "interpolate",
            ["linear"],
            ["get", "count"],
            0,
            "#7df9ff",
            10,
            "#5be5ff",
            30,
            "#a855f7",
            60,
            "#f7a8ff"
          ],
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            0,
            2,
            4,
            3.5,
            6,
            5,
            10,
            8
          ],
          "circle-opacity": 0,
          "circle-stroke-width": 1.4,
          "circle-stroke-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            0,
            0.2,
            4,
            0.35,
            7,
            0.7,
            10,
            1
          ]
        },
        layout: { visibility: "visible" }
      });
    }

    if (!map.getLayer("visited-glow")) {
      map.addLayer({
        id: "visited-glow",
        type: "fill",
        source: polySourceId,
        paint: {
          "fill-color": [
            "interpolate",
            ["linear"],
            ["get", "count"],
            0,
            "#0ea5e9",
            5,
            "#22d3ee",
            20,
            "#a855f7",
            50,
            "#f472b6"
          ],
          "fill-opacity": 0.4,
          "fill-outline-color": "#0ea5e9",
          "fill-blur": 2.5
        }
      });
    }

    if (!map.getLayer("visited-fill")) {
      map.addLayer({
        id: "visited-fill",
        type: "fill",
        source: polySourceId,
        paint: {
          "fill-color": [
            "interpolate",
            ["linear"],
            ["get", "count"],
            0,
            "#22d3ee",
            10,
            "#38bdf8",
            30,
            "#a855f7",
            60,
            "#f472b6"
          ],
          "fill-opacity": 0.78,
          "fill-outline-color": "#f472b6",
          "fill-blur": 0.8
        },
        layout: { visibility: "visible" }
      });
    }
  }, [mapLoaded, styleVersion]);

  // Tile loading on move/bucket change
  useEffect(() => {
    if (!mapInstance.current || !mapLoaded || !meta || !selectedBucket) return;

    const map = mapInstance.current;
    const minZ = meta.tileZooms?.min ?? 4;
    const maxZ = meta.tileZooms?.max ?? 14;
    const clampZoom = (z: number) => Math.min(Math.max(Math.floor(z), minZ), maxZ);

    const loadTiles = async () => {
      const seq = ++requestSeq.current;
      const zoom = clampZoom(map.getZoom());
      setTileZoom(zoom);
      const bounds = map.getBounds();
      const tilesToLoad = tilesForBounds(bounds, zoom);
      const missing = tilesToLoad.filter((t) => !tileCache.current.has(tileKeyToString(t)));

      await Promise.all(
        missing.map(async (t) => {
          const keyStr = tileKeyToString(t);
          try {
            const res = await fetch(
              `/api/tiles/${encodeURIComponent(selectedBucket)}/${t.z}/${t.x}/${t.y}`
            );
            if (!res.ok) return;
            const json = (await res.json()) as { cells: { id: string; count: number }[] };
            tileCache.current.set(keyStr, json);
          } catch (err) {
            console.warn("tile fetch failed", keyStr, err);
          }
        })
      );

      if (seq !== requestSeq.current) return;

      const combinedCells: { id: string; count: number }[] = [];
      for (const t of tilesToLoad) {
        const cached = tileCache.current.get(tileKeyToString(t));
        if (cached?.cells?.length) combinedCells.push(...cached.cells);
      }

      const polyFeatures = combinedCells
        .filter((cell) => cell.count > 0)
        .map((cell) => h3CellToFeature(cell.id, cell.count))
        .filter(Boolean) as GeoJSON.Feature[];

      const pointFeatures = combinedCells
        .filter((cell) => cell.count > 0)
        .map((cell) => h3CellToPointFeature(cell.id, cell.count))
        .filter(Boolean) as GeoJSON.Feature[];

      const polySource = map.getSource("visited-cells-polys") as maplibregl.GeoJSONSource;
      const pointSource = map.getSource("visited-cells-points") as maplibregl.GeoJSONSource;
      polySource?.setData({ type: "FeatureCollection", features: polyFeatures });
      pointSource?.setData({ type: "FeatureCollection", features: pointFeatures });

      // Fit to bounds first time for bucket
      if (meta.buckets?.[selectedBucket]?.bounds && !fitBoundsOnce.current) {
        fitBoundsOnce.current = true;
        const { minLat, maxLat, minLon, maxLon } = meta.buckets[selectedBucket].bounds!;
        if (
          [minLat, maxLat, minLon, maxLon].every(
            (v) => typeof v === "number" && Number.isFinite(v)
          )
        ) {
          map.fitBounds(
            [
              [minLon, minLat],
              [maxLon, maxLat]
            ],
            { padding: 40, duration: 1000 }
          );
        }
      }
    };

    const handleMove = () => {
      loadTiles();
    };

    map.on("moveend", handleMove);
    loadTiles();

    return () => {
      map.off("moveend", handleMove);
    };
  }, [mapLoaded, meta, selectedBucket, styleVersion]);

  const years = useMemo(() => {
    const buckets = meta?.availableBuckets ?? [];
    return buckets.filter((b) => b !== "total").sort((a, b) => Number(a) - Number(b));
  }, [meta]);

  const sliderValue = useMemo(() => {
    if (selectedBucket === "total") return 0;
    const idx = years.indexOf(selectedBucket);
    return idx >= 0 ? idx : 0;
  }, [selectedBucket, years]);

  const bucketStats = meta?.buckets?.[selectedBucket];

  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !mapLoaded) return;

    if (mapRef.current) {
      mapRef.current.parentElement?.style.setProperty("--fog-opacity", fogOpacity.toString());
    }

    const radiusScale = Math.min(Math.max(glowScale, 0.6), 1.2);
    map.setPaintProperty("visited-dots", "circle-radius", [
      "interpolate",
      ["linear"],
      ["zoom"],
      0,
      3 * radiusScale,
      4,
      5 * radiusScale,
      6,
      7.5 * radiusScale,
      10,
      12 * radiusScale
    ]);
  }, [fogOpacity, glowScale, mapLoaded]);

  return (
    <div className="map-wrapper">
      <div className="controls">
        <div className="control-row">
          <span className="label">Base</span>
          {BASE_STYLES.map((s) => (
            <button
              key={s.id}
              className={`chip ${baseStyle.id === s.id ? "chip--active" : ""}`}
              onClick={() => setBaseStyle(s)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="control-row">
          <span className="label">View</span>
          <button
            className={`chip ${selectedBucket === "total" ? "chip--active" : ""}`}
            onClick={() => {
              setSelectedBucket("total");
              fitBoundsOnce.current = false;
              tileCache.current.clear();
              clearSources();
            }}
          >
            All years
          </button>
        </div>
        {years.length > 0 ? (
          <div className="control-row">
            <span className="label">Year</span>
            <input
              type="range"
              min={0}
              max={Math.max(0, years.length - 1)}
              step={1}
              value={sliderValue}
              onChange={(e) => {
                const idx = Number(e.target.value);
                const year = years[idx];
                if (year) {
                  setSelectedBucket(year);
                  fitBoundsOnce.current = false;
                  tileCache.current.clear();
                  clearSources();
                }
              }}
            />
            <span className="label">{selectedBucket === "total" ? "All" : selectedBucket}</span>
          </div>
        ) : (
          <p className="note">No year buckets available. Run ingest first.</p>
        )}
        <div className="control-row">
          <span className="label">Fog</span>
          <input
            type="range"
            min={0}
            max={0.8}
            step={0.02}
            value={fogOpacity}
            onChange={(e) => setFogOpacity(Number(e.target.value))}
          />
          <span className="label">{fogOpacity.toFixed(2)}</span>
        </div>
        <div className="control-row">
          <span className="label">Glow scale</span>
          <input
            type="range"
            min={0.5}
            max={1.2}
            step={0.05}
            value={glowScale}
            onChange={(e) => setGlowScale(Number(e.target.value))}
          />
          <span className="label">{glowScale.toFixed(1)}x</span>
        </div>
        {bucketStats && (
          <div className="stats">
            <div>
              <span className="stat-label">Cells</span>
              <span className="stat-value">{bucketStats.cellCount ?? "–"}</span>
            </div>
            <div>
              <span className="stat-label">Points</span>
              <span className="stat-value">{bucketStats.usedPoints ?? "–"}</span>
            </div>
            <div>
              <span className="stat-label">Zoom</span>
              <span className="stat-value">z{tileZoom}</span>
            </div>
          </div>
        )}
        {status === "loading" && <p className="note">Loading bucket…</p>}
        {status === "ready" && !bucketStats && <p className="note">No data for this bucket.</p>}
        {error && <p className="error">{error}</p>}
      </div>
      <div className="map-canvas">
        <div ref={mapRef} className="map-canvas__inner" />
        <div className="map-overlay" />
      </div>
    </div>
  );
}

function h3CellToFeature(cellId: string, count: number): GeoJSON.Feature {
  const boundary = h3.cellToBoundary(cellId, true);
  const ring = boundary.map(([lat, lon]) => [lon, lat]);
  if (ring.length) {
    const [firstLon, firstLat] = ring[0];
    const [lastLon, lastLat] = ring[ring.length - 1];
    if (firstLon !== lastLon || firstLat !== lastLat) {
      ring.push([firstLon, firstLat]);
    }
  }
  const coordinates = [ring];
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates
    },
    properties: { id: cellId, count }
  };
}

function h3CellToPointFeature(cellId: string, count: number): GeoJSON.Feature {
  const [lat, lon] = h3.cellToLatLng(cellId);
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lon, lat] },
    properties: { id: cellId, count }
  };
}

function tilesForBounds(bounds: maplibregl.LngLatBounds, z: number): TileKey[] {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  const xMin = long2tile(sw.lng, z);
  const xMax = long2tile(ne.lng, z);
  const yMin = lat2tile(ne.lat, z);
  const yMax = lat2tile(sw.lat, z);
  const tiles: TileKey[] = [];
  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) {
      tiles.push({ z, x, y });
    }
  }
  return tiles;
}

function long2tile(lon: number, zoom: number) {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
}

function lat2tile(lat: number, zoom: number) {
  const latRad = (lat * Math.PI) / 180;
  return Math.floor(
    (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * Math.pow(2, zoom)
  );
}

function tileKeyToString(t: TileKey) {
  return `${t.z}/${t.x}/${t.y}`;
}
