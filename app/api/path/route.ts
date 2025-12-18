import { NextResponse } from "next/server";
import path from "path";
import { promises as fs } from "fs";

const DATASET_ID = "location-history";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const bucket = searchParams.get("bucket") || "total";
  try {
    const routePath = path.join(
      process.cwd(),
      "data",
      "routes",
      DATASET_ID,
      bucket,
      "route.json"
    );
    const raw = await fs.readFile(routePath, "utf8");
    const json = JSON.parse(raw);
    return NextResponse.json(json);
  } catch (err: any) {
    if (err && err.code === "ENOENT") {
      return NextResponse.json({ coords: [] }, { status: 404 });
    }
    console.error("route endpoint error", err);
    return NextResponse.json({ error: "Failed to load route" }, { status: 500 });
  }
}
