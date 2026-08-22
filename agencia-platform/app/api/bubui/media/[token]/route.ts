import { NextResponse } from "next/server";
import { downloadBuffer } from "@/lib/storage/r2";
import { verifyPublicMedia } from "@/lib/bubui/public-media";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const sig = new URL(req.url).searchParams.get("sig") || "";
  const key = verifyPublicMedia(token, sig);
  if (!key) return NextResponse.json({ error: "Contenido no válido" }, { status: 403 });
  try {
    const body = await downloadBuffer(key);
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800"
      }
    });
  } catch {
    return NextResponse.json({ error: "Contenido no encontrado" }, { status: 404 });
  }
}
