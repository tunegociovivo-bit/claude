import { NextResponse } from "next/server";
import { buildBipiIconPng } from "@/lib/bipi/icon";

export const dynamic = "force-static";

export async function GET() {
  const png = await buildBipiIconPng({ size: 512, maskable: true });
  return new NextResponse(png as any, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable"
    }
  });
}
