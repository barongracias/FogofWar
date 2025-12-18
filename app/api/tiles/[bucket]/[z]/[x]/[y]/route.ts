import { NextResponse } from "next/server";
import path from "path";
import { promises as fs } from "fs";

const DATASET_ID = "location-history";

export async function GET(
  _req: Request,
  { params }: { params: { bucket: string; z: string; x: string; y: string } }
) {
  const { bucket, z, x, y } = params;
  try {
    const tilePath = path.join(
      process.cwd(),
      "data",
      "tiles",
      DATASET_ID,
      bucket,
      "tiles",
      z,
      x,
      `${y}.json`
    );
    const data = await fs.readFile(tilePath, "utf8");
    return NextResponse.json(JSON.parse(data));
  } catch (err: any) {
    if (err && err.code === "ENOENT") {
      return NextResponse.json({ cells: [], outlines: [], route: [] }, { status: 404 });
    }
    console.error("tile endpoint error", err);
    return NextResponse.json({ error: "Failed to load tile" }, { status: 500 });
  }
}
