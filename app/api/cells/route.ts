import { NextResponse } from "next/server";
import path from "path";
import { promises as fs } from "fs";

const DATASET_ID = "location-history";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const bucket = searchParams.get("bucket") || "total";
  try {
    const metaPath = path.join(process.cwd(), "data", "meta", `${DATASET_ID}.json`);
    const metaRaw = await fs.readFile(metaPath, "utf8");
    const meta = JSON.parse(metaRaw);

    const availableBuckets: string[] = meta?.availableBuckets || [];
    if (!availableBuckets.includes(bucket)) {
      return NextResponse.json(
        { error: `Bucket '${bucket}' not found. Available: ${availableBuckets.join(", ")}` },
        { status: 400 }
      );
    }

    const cellsPath = path.join(process.cwd(), "data", "tiles", DATASET_ID, bucket, "cells.json");
    const cellsRaw = await fs.readFile(cellsPath, "utf8");
    const cells = JSON.parse(cellsRaw);

    return NextResponse.json({
      bucket,
      availableBuckets,
      meta: {
        datasetId: meta.datasetId,
        resolution: meta.resolution,
        bucketStats: meta.buckets?.[bucket] ?? null
      },
      cells
    });
  } catch (err) {
    console.error("cells endpoint error", err);
    return NextResponse.json(
      {
        error:
          "Cells not available. Ensure data/uploads/location-history.json exists and run `npm run ingest`."
      },
      { status: 500 }
    );
  }
}
