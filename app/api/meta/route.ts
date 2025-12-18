import { NextResponse } from "next/server";
import path from "path";
import { promises as fs } from "fs";

const DATASET_ID = "location-history";

export async function GET() {
  try {
    const metaPath = path.join(process.cwd(), "data", "meta", `${DATASET_ID}.json`);
    const metaRaw = await fs.readFile(metaPath, "utf8");
    const meta = JSON.parse(metaRaw);
    return NextResponse.json({
      datasetId: meta.datasetId,
      availableBuckets: meta.availableBuckets,
      tileZooms: meta.tileZooms,
      tileTemplate: meta.tileTemplate,
      buckets: meta.buckets
    });
  } catch (err) {
    console.error("meta endpoint error", err);
    return NextResponse.json(
      {
        error:
          "Metadata not available. Ensure data/uploads/location-history.json exists and run `npm run ingest`."
      },
      { status: 500 }
    );
  }
}
