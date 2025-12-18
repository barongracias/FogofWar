"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
  global?: { seenPoints: number; usedPoints: number };
  globalCounts?: Record<string, number>;
};

type TileKey = { z: number; x: number; y: number };
type TilePayload = { cells: { id: string; count: number }[]; outlines?: number[][][] };

const NEUTRAL_RAMP = ["#7df9ff", "#38bdf8", "#a855f7", "#f472b6"];
const COOL_RAMP = ["#64f4ac", "#3bb3ff", "#6c8dff", "#9ed7ff"];
const WARM_RAMP = ["#ffd166", "#ff9b7b", "#ff70a6", "#f43f5e"];

type ColorRamp = {
  ramp: string[];
  fillStops: any[];
  glowStops: any[];
  dotStops: any[];
  heatmapColor: any[];
};

type Bounds = { minLat: number; maxLat: number; minLon: number; maxLon: number };

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

function hexToRgb(hex: string): [number, number, number] {
  const trimmed = hex.replace("#", "");
  const int = parseInt(trimmed, 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function rgbToHex([r, g, b]: [number, number, number]) {
  const toHex = (v: number) => v.toString(16).padStart(2, "0");
  return `#${toHex(Math.round(r))}${toHex(Math.round(g))}${toHex(Math.round(b))}`;
}

function mixColors(a: string, b: string, t: number) {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]);
}

function blendRamp(cool: string[], warm: string[], t: number) {
  return cool.map((c, idx) => mixColors(c, warm[idx] ?? cool[idx], t));
}

function buildColorRamp(recency: number | null): ColorRamp {
  const ramp = recency === null ? NEUTRAL_RAMP : blendRamp(COOL_RAMP, WARM_RAMP, clamp01(recency));
  const fillStops: any[] = [
    "interpolate",
    ["linear"],
    ["get", "count"],
    0,
    ramp[0],
    5,
    ramp[1],
    20,
    ramp[2],
    60,
    ramp[3]
  ];
  const glowStops: any[] = [
    "interpolate",
    ["linear"],
    ["get", "count"],
    0,
    mixColors(ramp[0], "#101424", 0.35),
    5,
    mixColors(ramp[1], "#101424", 0.2),
    20,
    mixColors(ramp[2], "#101424", 0.12),
    60,
    mixColors(ramp[3], "#101424", 0.08)
  ];
  const dotStops = fillStops;
  const heatmapColor: any[] = [
    "interpolate",
    ["linear"],
    ["heatmap-density"],
    0,
    mixColors(ramp[0], "#0a0d14", 0.35),
    0.4,
    ramp[1],
    0.7,
    ramp[2],
    1,
    ramp[3]
  ];

  return { ramp, fillStops, glowStops, dotStops, heatmapColor };
}

function normalizeBounds(bounds?: Bounds | null) {
  if (!bounds) return null;
  const isValid = (v: unknown, min: number, max: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
  const { minLat, maxLat, minLon, maxLon } = bounds;
  if (
    !isValid(minLat, -90, 90) ||
    !isValid(maxLat, -90, 90) ||
    !isValid(minLon, -180, 180) ||
    !isValid(maxLon, -180, 180)
  ) {
    return null;
  }
  const minLatN = Math.min(minLat, maxLat);
  const maxLatN = Math.max(minLat, maxLat);
  const minLonN = Math.min(minLon, maxLon);
  const maxLonN = Math.max(minLon, maxLon);
  if (minLatN === maxLatN || minLonN === maxLonN) return null;
  return { minLat: minLatN, maxLat: maxLatN, minLon: minLonN, maxLon: maxLonN };
}

export default function Home() {
  return (
    <div className="page">
      <section className="panel">
        <div className="panel-header">
          <h2>Fog-of-war map</h2>
          <p className="note">Reveals visited areas; the rest stays under fog.</p>
        </div>
        <FogOfWarMap />
      </section>
    </div>
  );
}

function FogOfWarMap() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstance = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [selectedBucket, setSelectedBucket] = useState<string>("total");
  const [fogOpacity, setFogOpacity] = useState<number>(0.35);
  const [glowScale, setGlowScale] = useState<number>(1);
  const [densityScale, setDensityScale] = useState<number>(1);
  const [tileZoom, setTileZoom] = useState<number>(10);
  const [baseStyle, setBaseStyle] = useState(BASE_STYLES[0]);
  const [styleVersion, setStyleVersion] = useState(0);
  const paramsInitialized = useRef(false);
  const fitBoundsOnce = useRef(false);
  // Map caching to avoid re-fetching tiles in view
  const tileCache = useRef<Map<string, TilePayload>>(new Map<string, TilePayload>());
  const requestSeq = useRef(0);
  const [showRoute, setShowRoute] = useState(false);
  const [routeCoords, setRouteCoords] = useState<[number, number][]>([]);

  const fetchRoute = useCallback(
    async (bucket: string) => {
      try {
        const res = await fetch(`/api/path?bucket=${encodeURIComponent(bucket)}`);
        if (res.ok) {
          const json = (await res.json()) as { coords: [number, number][] };
          setRouteCoords(json.coords || []);
        } else {
          setRouteCoords([]);
        }
      } catch {
        setRouteCoords([]);
      }
    },
    []
  );

  // Seed state from URL params once
  useEffect(() => {
    if (paramsInitialized.current) return;
    paramsInitialized.current = true;
    const bucket = searchParams.get("bucket");
    const fog = searchParams.get("fog");
    const glow = searchParams.get("glow");
    const density = searchParams.get("density");
    const base = searchParams.get("base");
    const route = searchParams.get("route");
    if (bucket) setSelectedBucket(bucket);
    if (fog) {
      const v = Number(fog);
      if (!Number.isNaN(v)) setFogOpacity(v);
    }
    if (glow) {
      const v = Number(glow);
      if (!Number.isNaN(v)) setGlowScale(v);
    }
    if (density) {
      const v = Number(density);
      if (!Number.isNaN(v)) setDensityScale(v);
    }
    if (base) {
      const found = BASE_STYLES.find((s) => s.id === base);
      if (found) setBaseStyle(found);
    }
    if (route) setShowRoute(route === "1");
  }, [searchParams]);

  // Persist view state to URL
  useEffect(() => {
    if (!paramsInitialized.current) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("bucket", selectedBucket);
    params.set("fog", fogOpacity.toFixed(2));
    params.set("glow", glowScale.toFixed(2));
    params.set("density", densityScale.toFixed(2));
    params.set("base", baseStyle.id);
    params.set("route", showRoute ? "1" : "0");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [baseStyle.id, densityScale, fogOpacity, glowScale, pathname, router, searchParams, selectedBucket, showRoute]);

  const clearSources = useCallback(() => {
    const map = mapInstance.current;
    if (!map) return;
    const emptyFc: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
    const polySourceId = "visited-cells-polys";
    const pointSourceId = "visited-cells-points";
    const outlineSourceId = "visited-outlines";
    const routeSourceId = "visited-route";
    (map.getSource(polySourceId) as maplibregl.GeoJSONSource | undefined)?.setData(emptyFc);
    (map.getSource(pointSourceId) as maplibregl.GeoJSONSource | undefined)?.setData(emptyFc);
    (map.getSource(outlineSourceId) as maplibregl.GeoJSONSource | undefined)?.setData(emptyFc);
    (map.getSource(routeSourceId) as maplibregl.GeoJSONSource | undefined)?.setData(emptyFc);
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
      popupRef.current?.remove();
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
        const available = json.availableBuckets ?? [];
        let chosenBucket: string | null = null;
        setSelectedBucket((current) => {
          if (available.includes(current)) {
            chosenBucket = current;
            return current;
          }
          if (available.includes("total")) {
            chosenBucket = "total";
            return "total";
          }
          if (available[0]) {
            chosenBucket = available[0];
            return available[0];
          }
          chosenBucket = current;
          return current;
        });
        if (showRoute && chosenBucket) {
          await fetchRoute(chosenBucket);
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
  }, [fetchRoute, showRoute]);

  // Fetch route on toggle or bucket change
  useEffect(() => {
    if (showRoute) {
      fetchRoute(selectedBucket);
    } else {
      setRouteCoords([]);
    }
  }, [fetchRoute, selectedBucket, showRoute]);

  // Add sources/layers once
  useEffect(() => {
    if (!mapLoaded || !mapInstance.current) return;
    const map = mapInstance.current;
    const polySourceId = "visited-cells-polys";
    const pointSourceId = "visited-cells-points";
    const outlineSourceId = "visited-outlines";
    const routeSourceId = "visited-route";
    const emptyFc: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
    if (!map.getSource(polySourceId)) {
      map.addSource(polySourceId, { type: "geojson", data: emptyFc });
    }
    if (!map.getSource(pointSourceId)) {
      map.addSource(pointSourceId, { type: "geojson", data: emptyFc });
    }
    if (!map.getSource(outlineSourceId)) {
      map.addSource(outlineSourceId, { type: "geojson", data: emptyFc });
    }
    if (!map.getSource(routeSourceId)) {
      map.addSource(routeSourceId, { type: "geojson", data: emptyFc });
    }

    if (!map.getLayer("visited-heatmap")) {
      map.addLayer({
        id: "visited-heatmap",
        type: "heatmap",
        source: pointSourceId,
        maxzoom: 8,
        paint: {
          "heatmap-weight": ["interpolate", ["linear"], ["get", "count"], 0, 0.25, 10, 0.7, 50, 1.2],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 0.6, 5, 1.1, 8, 1.4],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 14, 4, 26, 6, 40, 8, 58],
          "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.85, 5, 0.7, 8, 0]
        },
        layout: { visibility: "visible" }
      });
    }

    if (!map.getLayer("visited-dots")) {
      map.addLayer({
        id: "visited-dots",
        type: "circle",
        source: pointSourceId,
        minzoom: 10,
        paint: {
          "circle-color": "#38bdf8",
          "circle-stroke-color": "#7df9ff",
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 2, 4, 3.5, 6, 5, 10, 8],
          "circle-opacity": 0.9,
          "circle-stroke-width": 1.4,
          "circle-stroke-opacity": 0.7
        },
        layout: { visibility: "visible" }
      });
    }

    if (!map.getLayer("visited-glow")) {
      map.addLayer({
        id: "visited-glow",
        type: "fill",
        source: polySourceId,
        minzoom: 5,
        maxzoom: 12,
        paint: {
          "fill-color": "#22d3ee",
          "fill-opacity": 0.35 * densityScale,
          "fill-outline-color": "#0ea5e9"
        }
      });
    }

    if (!map.getLayer("visited-fill")) {
      map.addLayer({
        id: "visited-fill",
        type: "fill",
        source: polySourceId,
        minzoom: 6,
        paint: {
          "fill-color": "#38bdf8",
          "fill-opacity": 0.78 * densityScale,
          "fill-outline-color": "#0ea5e9"
        },
        layout: { visibility: "visible" }
      });
    }

    if (!map.getLayer("visited-outline")) {
      map.addLayer({
        id: "visited-outline",
        type: "line",
        source: polySourceId,
        minzoom: 7,
        paint: {
          "line-color": "#7df9ff",
          "line-width": 1.1,
          "line-opacity": 0.65,
          "line-dasharray": [2, 3]
        }
      });
    }
    if (!map.getLayer("route-line")) {
      map.addLayer({
        id: "route-line",
        type: "line",
        source: routeSourceId,
        paint: {
          "line-color": "#22d3ee",
          "line-width": 1.6,
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.35, 8, 0.75, 12, 0.85],
          "line-blur": 0.35
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
            const json = (await res.json()) as TilePayload;
            tileCache.current.set(keyStr, json);
          } catch (err) {
            console.warn("tile fetch failed", keyStr, err);
          }
        })
      );

      if (seq !== requestSeq.current) return;

      const outlines: GeoJSON.Feature[] = [];
      const polyFeatures: GeoJSON.Feature[] = [];
      const pointFeatures: GeoJSON.Feature[] = [];

      for (const t of tilesToLoad) {
        const cached = tileCache.current.get(tileKeyToString(t));
        if (cached?.cells?.length) {
          for (const cell of cached.cells) {
            if (cell.count > 0) {
              pointFeatures.push(h3CellToPointFeature(cell.id, cell.count));
              polyFeatures.push(h3CellToFeature(cell.id, cell.count));
            }
          }
        }
        const tileWeight = cached?.cells?.reduce((sum, c) => sum + (c.count || 0), 0) ?? 0;
        if (cached?.outlines?.length) {
          for (const ring of cached.outlines) {
            outlines.push({
              type: "Feature",
              geometry: { type: "Polygon", coordinates: [ring] },
              properties: { id: `${t.z}-${t.x}-${t.y}`, count: tileWeight }
            });
          }
        }
      }

      const polySource = map.getSource("visited-cells-polys") as maplibregl.GeoJSONSource;
      const pointSource = map.getSource("visited-cells-points") as maplibregl.GeoJSONSource;
      const outlineSource = map.getSource("visited-outlines") as maplibregl.GeoJSONSource;
      const routeSource = map.getSource("visited-route") as maplibregl.GeoJSONSource;

      polySource?.setData({ type: "FeatureCollection", features: polyFeatures });
      pointSource?.setData({ type: "FeatureCollection", features: pointFeatures });
      outlineSource?.setData({
        type: "FeatureCollection",
        features: outlines.length ? outlines : polyFeatures
      });
      if (routeSource) {
        if (showRoute && routeCoords.length) {
          routeSource.setData({
            type: "Feature",
            geometry: { type: "LineString", coordinates: routeCoords },
            properties: {}
          } as GeoJSON.Feature);
        } else {
          routeSource.setData({ type: "FeatureCollection", features: [] });
        }
      }

      // Fit to bounds first time for bucket
      const normBounds = normalizeBounds(meta.buckets?.[selectedBucket]?.bounds);

      if (normBounds && !fitBoundsOnce.current) {
        const { minLat, maxLat, minLon, maxLon } = normBounds;
        try {
          map.fitBounds(
            [
              [minLon, minLat],
              [maxLon, maxLat]
            ],
            { padding: 40, duration: 1000 }
          );
          fitBoundsOnce.current = true;
        } catch (err) {
          console.warn("fitBounds failed", err, normBounds);
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
  }, [mapLoaded, meta, selectedBucket, styleVersion, routeCoords, showRoute]);

  const years = useMemo(() => {
    const buckets = meta?.availableBuckets ?? [];
    return buckets.filter((b) => b !== "total").sort((a, b) => Number(a) - Number(b));
  }, [meta]);

  const sliderValue = useMemo(() => {
    if (selectedBucket === "total") return 0;
    const idx = years.indexOf(selectedBucket);
    return idx >= 0 ? idx + 1 : 0;
  }, [selectedBucket, years]);

  const numericYears = useMemo(
    () => years.map((y) => Number(y)).filter((n) => Number.isFinite(n)),
    [years]
  );

  const recencyPosition = useMemo(() => {
    if (selectedBucket === "total") return null;
    const yearNum = Number(selectedBucket);
    if (!Number.isFinite(yearNum) || numericYears.length < 2) return null;
    const min = Math.min(...numericYears);
    const max = Math.max(...numericYears);
    if (max === min) return 1;
    return clamp01((yearNum - min) / (max - min));
  }, [numericYears, selectedBucket]);

  const colorRamp = useMemo(() => buildColorRamp(recencyPosition), [recencyPosition]);
  const legendGradient = useMemo(
    () => `linear-gradient(90deg, ${colorRamp.ramp.join(", ")})`,
    [colorRamp]
  );
  const recencyLabel = useMemo(() => {
    if (recencyPosition === null) return "All-time";
    if (recencyPosition > 0.66) return `${selectedBucket} (recent)`;
    if (recencyPosition < 0.33) return `${selectedBucket} (older)`;
    return `${selectedBucket}`;
  }, [recencyPosition, selectedBucket]);

  const bucketStats = meta?.buckets?.[selectedBucket];

  const handleFitToData = useCallback(() => {
    const map = mapInstance.current;
    const normBounds = normalizeBounds(meta?.buckets?.[selectedBucket]?.bounds);
    if (!map || !normBounds) {
      return;
    }
    const { minLat, maxLat, minLon, maxLon } = normBounds;
    try {
      map.fitBounds(
        [
          [minLon, minLat],
          [maxLon, maxLat]
        ],
        { padding: 40, duration: 800 }
      );
      fitBoundsOnce.current = true;
    } catch (err) {
      console.warn("fitBounds failed (manual)", err, normBounds);
    }
  }, [meta, selectedBucket]);

  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !mapLoaded) return;

    if (mapRef.current) {
      mapRef.current.parentElement?.style.setProperty("--fog-opacity", fogOpacity.toString());
    }

    const radiusScale = Math.min(Math.max(glowScale, 0.6), 1.2);
    if (map.getLayer("visited-dots")) {
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
      map.setPaintProperty("visited-dots", "circle-color", colorRamp.dotStops);
      map.setPaintProperty("visited-dots", "circle-stroke-color", colorRamp.glowStops);
      const strokeOpacityExpr = [
        "interpolate",
        ["linear"],
        ["zoom"],
        0,
        0.2 * densityScale,
        4,
        0.35 * densityScale,
        7,
        0.7 * densityScale,
        10,
        1 * densityScale
      ];
      map.setPaintProperty("visited-dots", "circle-stroke-opacity", strokeOpacityExpr);
    }

    if (map.getLayer("visited-glow")) {
      map.setPaintProperty("visited-glow", "fill-opacity", 0.4 * densityScale);
      map.setPaintProperty("visited-glow", "fill-color", colorRamp.glowStops);
    }
    if (map.getLayer("visited-fill")) {
      map.setPaintProperty("visited-fill", "fill-opacity", 0.78 * densityScale);
      map.setPaintProperty("visited-fill", "fill-color", colorRamp.fillStops);
      map.setPaintProperty("visited-fill", "fill-outline-color", mixColors(colorRamp.ramp[1], "#0b1424", 0.35));
    }
    if (map.getLayer("visited-outline")) {
      map.setPaintProperty("visited-outline", "line-opacity", 0.9 * densityScale);
      map.setPaintProperty("visited-outline", "line-color", mixColors(colorRamp.ramp[3], "#0b1424", 0.1));
    }
    if (map.getLayer("visited-heatmap")) {
      map.setPaintProperty("visited-heatmap", "heatmap-color", colorRamp.heatmapColor);
      map.setPaintProperty("visited-heatmap", "heatmap-intensity", [
        "interpolate",
        ["linear"],
        ["zoom"],
        0,
        0.6 * densityScale * radiusScale,
        5,
        1.1 * densityScale * radiusScale,
        8,
        1.5 * densityScale * radiusScale
      ]);
      map.setPaintProperty("visited-heatmap", "heatmap-radius", [
        "interpolate",
        ["linear"],
        ["zoom"],
        0,
        14 * radiusScale,
        4,
        26 * radiusScale,
        6,
        40 * radiusScale,
        8,
        58 * radiusScale
      ]);
      map.setPaintProperty("visited-heatmap", "heatmap-opacity", [
        "interpolate",
        ["linear"],
        ["zoom"],
        0,
        0.85,
        5,
        0.7,
        8,
        0
      ]);
      map.setPaintProperty("visited-heatmap", "heatmap-weight", [
        "interpolate",
        ["linear"],
        ["get", "count"],
        0,
        0.25,
        10,
        0.7 * densityScale,
        50,
        1.3 * densityScale
      ]);
    }
    if (map.getLayer("route-line")) {
      map.setPaintProperty(
        "route-line",
        "line-opacity",
        showRoute
          ? ["interpolate", ["linear"], ["zoom"], 5, 0.35, 8, 0.75, 12, 0.85]
          : 0
      );
    }
  }, [colorRamp, densityScale, fogOpacity, glowScale, mapLoaded, showRoute]);

  useEffect(() => {
    if (!mapLoaded || !mapInstance.current) return;
    const map = mapInstance.current;
    const interactiveLayers = ["visited-fill", "visited-dots"];

    const handleMoveTooltip = (e: maplibregl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const count = Number(feature.properties?.count ?? 0);
      const id = feature.properties?.id as string | undefined;
      const [lat, lon] = id ? h3.cellToLatLng(id) : [e.lngLat.lat, e.lngLat.lng];
      if (!popupRef.current) {
        popupRef.current = new maplibregl.Popup({
          closeButton: false,
          closeOnClick: false,
          className: "fog-popup"
        });
      }
      const bucketLabel = selectedBucket === "total" ? "All years" : selectedBucket;
      map.getCanvas().style.cursor = "crosshair";
      popupRef.current
        .setLngLat([lon, lat])
        .setHTML(
          `<div class="popup-content"><div class="popup-title">${bucketLabel}</div><div class="popup-count">${count.toLocaleString()}</div><div class="popup-sub">${recencyLabel} • visits</div></div>`
        )
        .addTo(map);
    };

    const handleLeave = () => {
      map.getCanvas().style.cursor = "";
      popupRef.current?.remove();
    };

    interactiveLayers.forEach((layerId) => {
      if (map.getLayer(layerId)) {
        map.on("mousemove", layerId, handleMoveTooltip);
        map.on("mouseleave", layerId, handleLeave);
      }
    });

    return () => {
      interactiveLayers.forEach((layerId) => {
        if (map.getLayer(layerId)) {
          map.off("mousemove", layerId, handleMoveTooltip);
          map.off("mouseleave", layerId, handleLeave);
        }
      });
      handleLeave();
    };
  }, [mapLoaded, recencyLabel, selectedBucket, styleVersion]);

  return (
    <div className="map-wrapper">
      <div className="controls">
        <div className="control-row">
          <span className="label">Dataset</span>
          <select className="select" value={meta?.datasetId || "location-history"} disabled>
            <option value="location-history">location-history</option>
          </select>
        </div>
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
        <div className="control-row">
          <span className="label">Bounds</span>
          <button
            className={`chip chip--ghost ${
              meta?.buckets?.[selectedBucket]?.bounds ? "" : "chip--disabled"
            }`}
            onClick={() => {
              handleFitToData();
              fitBoundsOnce.current = true;
            }}
            disabled={!meta?.buckets?.[selectedBucket]?.bounds}
          >
            Fit to data
          </button>
        </div>
          {years.length > 0 ? (
          <div className="control-row">
            <span className="label">Year</span>
            <input
              type="range"
              min={0}
              max={Math.max(0, years.length)}
              step={1}
              value={sliderValue}
              onChange={(e) => {
                const idx = Number(e.target.value);
                if (idx <= 0) {
                  setSelectedBucket("total");
                  fitBoundsOnce.current = false;
                  tileCache.current.clear();
                  clearSources();
                  return;
                }
                const year = years[idx - 1];
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
        <div className="control-row">
          <span className="label">Route</span>
          <button
            className={`chip ${showRoute ? "chip--active" : ""}`}
            onClick={async () => {
              const next = !showRoute;
              setShowRoute(next);
              if (next) {
                await fetchRoute(selectedBucket);
              } else {
                setRouteCoords([]);
              }
            }}
          >
            {showRoute ? "On" : "Off"}
          </button>
        </div>
        <div className="control-row">
          <span className="label">Density</span>
          <input
            type="range"
            min={0.2}
            max={1.4}
            step={0.05}
            value={densityScale}
            onChange={(e) => setDensityScale(Number(e.target.value))}
          />
          <span className="label">{densityScale.toFixed(1)}x</span>
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
              <span className="stat-label">Weight</span>
              <span className="stat-value">
                {bucketStats.totalWeight ? bucketStats.totalWeight.toFixed(0) : "–"}
              </span>
            </div>
            <div>
              <span className="stat-label">Zoom</span>
              <span className="stat-value">z{tileZoom}</span>
            </div>
            {bucketStats.bounds && (
              <div>
                <span className="stat-label">Extent</span>
                <span className="stat-value">
                  {bucketStats.bounds.minLat.toFixed(2)}, {bucketStats.bounds.minLon.toFixed(2)} →{" "}
                  {bucketStats.bounds.maxLat.toFixed(2)}, {bucketStats.bounds.maxLon.toFixed(2)}
                </span>
              </div>
            )}
            {meta?.globalCounts && (
              <div>
                <span className="stat-label">Regions</span>
                <span className="stat-value">
                  {Object.entries(meta.globalCounts)
                    .map(([k, v]) => `${k}:${v}`)
                    .join("  ")}
                </span>
              </div>
            )}
          </div>
        )}
        {status === "loading" && <p className="note">Loading bucket…</p>}
        {status === "ready" && !bucketStats && <p className="note">No data for this bucket.</p>}
        {error && <p className="error">{error}</p>}
      </div>
      <div className="legend">
        <div>
          <div className="legend-label">Visit intensity</div>
          <div className="legend-bar" style={{ background: legendGradient }} />
          <div className="legend-scale">
            <span>Low</span>
            <span>High</span>
          </div>
        </div>
        <div className="legend-recency">
          <span className="legend-label">Recency</span>
          <span className="legend-recency__value">{recencyLabel}</span>
        </div>
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
