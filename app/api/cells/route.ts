import { NextResponse } from "next/server";
import path from "path";
import { promises as fs } from "fs";

const DATASET_ID = "location-history";

export async function GET() {
  try {
    const cellsPath = path.join(process.cwd(), "data", "tiles", DATASET_ID, "cells.json");
    const metaPath = path.join(process.cwd(), "data", "meta", `${DATASET_ID}.json`);
    const [cellsRaw, metaRaw] = await Promise.all([
      fs.readFile(cellsPath, "utf8"),
      fs.readFile(metaPath, "utf8")
    ]);

    const cells = JSON.parse(cellsRaw);
    const meta = JSON.parse(metaRaw);
    return NextResponse.json({ cells, meta });
  } catch (err) {
    console.error("cells endpoint error", err);
    return NextResponse.json(
      { error: "Cells not available. Run `npm run ingest` after placing location-history.json." },
      { status: 500 }
    );
  }
}
