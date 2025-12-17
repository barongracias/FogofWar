"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import * as h3 from "h3-js";

const DEFAULT_STYLE = "https://demotiles.maplibre.org/style.json";

type CellsResponse = {
  cells: {
    resolution: number;
    cells: { id: string; count: number }[];
  };
  meta: {
    bounds?: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  };
};

export default function Home() {
  return (
    <div className="page">
      <section className="panel">
        <h2>Drop your data</h2>
        <p>
          Place your Google Timeline JSON at <code>data/uploads/location-history.json</code>. This
          build currently ingests JSON only (no .tgz).
        </p>
        <p className="note">
          Run <code>npm run ingest</code> to aggregate the file into H3 cells and write derived data
          to <code>data/tiles/location-history/</code> and metadata to{" "}
          <code>data/meta/location-history.json</code>. Then reload this page.
        </p>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Fog-of-war map</h2>
          <p className="note">
            Loads aggregated cells from <code>/api/cells</code>. Bright hexes mark visited areas; the
            rest stays foggy.
          </p>
        </div>
        <FogOfWarMap />
      </section>
    </div>
  );
}

function FogOfWarMap() {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstance = useRef<maplibregl.Map | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CellsResponse | null>(null);
  const fitBoundsOnce = useRef(false);

  useEffect(() => {
    if (!mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapRef.current,
      style: DEFAULT_STYLE,
      center: [0, 20],
      zoom: 1.5,
      attributionControl: true
    });
    mapInstance.current = map;

    return () => {
      map.remove();
      mapInstance.current = null;
    };
  }, []);

  useEffect(() => {
    async function load() {
      setStatus("loading");
      setError(null);
      try {
        const res = await fetch("/api/cells");
        if (!res.ok) {
          throw new Error(`API error ${res.status}`);
        }
        const json = (await res.json()) as CellsResponse;
        setData(json);
        setStatus("ready");
      } catch (err: any) {
        console.error(err);
        setError(err?.message || "Failed to load cells");
        setStatus("error");
      }
    }
    load();
  }, []);

  useEffect(() => {
    if (!data || !mapInstance.current) return;

    const map = mapInstance.current;
    const features = data.cells.cells.map((cell) => h3CellToFeature(cell.id, cell.count));
    const fc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features
    };

    const sourceId = "visited-cells";
    if (map.getSource(sourceId)) {
      const source = map.getSource(sourceId) as maplibregl.GeoJSONSource;
      source.setData(fc);
    } else {
      map.addSource(sourceId, {
        type: "geojson",
        data: fc
      });
      map.addLayer({
        id: "visited-fill",
        type: "fill",
        source: sourceId,
        paint: {
          "fill-color": "#f2c94c",
          "fill-opacity": 0.65,
          "fill-outline-color": "#f59e0b"
        }
      });
    }

    if (data.meta?.bounds && !fitBoundsOnce.current) {
      fitBoundsOnce.current = true;
      const { minLat, maxLat, minLon, maxLon } = data.meta.bounds;
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
  }, [data]);

  return <div ref={mapRef} className="map-canvas" />;
}

function h3CellToFeature(cellId: string, count: number): GeoJSON.Feature {
  const boundary = h3.cellToBoundary(cellId, true);
  const coordinates = [boundary.map(([lat, lon]) => [lon, lat])];
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates
    },
    properties: {
      id: cellId,
      count
    }
  };
}
