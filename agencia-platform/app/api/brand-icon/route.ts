/**
 * GET /favicon.png  → logo del workspace como PNG.
 *
 * Devuelve el `workspace.logo` del primer workspace de la BD
 * (esta instancia es single-tenant por dominio) servido como PNG.
 * Si no hay workspace o no tiene logo, fallback a /public/icon-192.png.
 *
 * El metadata.icons del layout apunta aquí en lugar del PNG estático.
 * Así, cuando el admin cambia el logo en /admin/workspace, el favicon
 * y el icono PWA reflejan el cambio en 5 min (cache server) sin tener
 * que tocar archivos.
 *
 * También sirve para apple-touch-icon, manifest icons, etc.
 *
 * Query opcional ?size=192|512 para distinguir en logs (no afecta al
 * binario — el cliente reescala).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Cache módulo para no leer la BD + fetch del logo en cada hit del
// favicon (browsers piden bastantes veces). TTL 5min.
let cached: { at: number; body: Buffer; contentType: string } | null = null;
const TTL_MS = 5 * 60_000;

async function fetchWorkspaceLogo(): Promise<{ body: Buffer; contentType: string } | null> {
  try {
    const ws = await prisma.workspace.findFirst({
      orderBy: { createdAt: "asc" },
      select: { logo: true }
    });
    const url = ws?.logo?.trim();
    if (!url) return null;
    // El logo del workspace suele ser HTTPS firmado de R2. Si es
    // relative (poco probable), abortamos al fallback estático.
    if (!/^https?:\/\//i.test(url)) return null;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    const contentType = r.headers.get("content-type") ?? "image/png";
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length === 0 || buf.length > 5 * 1024 * 1024) return null;
    return { body: buf, contentType };
  } catch {
    return null;
  }
}

function readFallback(): { body: Buffer; contentType: string } {
  try {
    const buf = readFileSync(join(process.cwd(), "public", "icon-192.png"));
    return { body: buf, contentType: "image/png" };
  } catch {
    // Si ni el fallback está, 1px transparente PNG inline.
    const tiny = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      "base64"
    );
    return { body: tiny, contentType: "image/png" };
  }
}

export async function GET() {
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) {
    return new NextResponse(new Uint8Array(cached.body), {
      status: 200,
      headers: {
        "Content-Type": cached.contentType,
        "Cache-Control": "public, max-age=300, stale-while-revalidate=600"
      }
    });
  }
  const fromDb = await fetchWorkspaceLogo();
  const result = fromDb ?? readFallback();
  cached = { at: now, body: result.body, contentType: result.contentType };
  return new NextResponse(new Uint8Array(result.body), {
    status: 200,
    headers: {
      "Content-Type": result.contentType,
      "Cache-Control": "public, max-age=300, stale-while-revalidate=600"
    }
  });
}
