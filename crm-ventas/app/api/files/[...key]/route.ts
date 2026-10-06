import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyFileSignature } from "@/lib/storage/r2";

export const dynamic = "force-dynamic";

// Sirve archivos guardados en BD con URL firmada (HMAC + caducidad). Pública a
// propósito: Meta, WordPress y las <img>/<video> del CRM descargan por esta URL.
// Admite peticiones Range (Safari/iOS las exige para reproducir vídeo) leyendo
// solo el trozo pedido de la base de datos.
async function serve(req: NextRequest, params: { key: string[] }, head: boolean) {
  const key = (params.key ?? []).join("/");
  const exp = Number(req.nextUrl.searchParams.get("e"));
  const sig = req.nextUrl.searchParams.get("s") ?? "";
  if (!key || !verifyFileSignature(key, exp, sig)) {
    return NextResponse.json({ error: "Enlace caducado o no válido" }, { status: 403 });
  }
  const file = await prisma.storedFile.findUnique({ where: { key }, select: { contentType: true, size: true } });
  if (!file) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const maxAge = Math.max(0, Math.min(86400, Math.floor(exp - Date.now() / 1000)));
  const base: Record<string, string> = {
    "Content-Type": file.contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": `private, max-age=${maxAge}`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };

  const range = req.headers.get("range");
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (m && (m[1] !== "" || m[2] !== "")) {
    let start: number;
    let end: number;
    if (m[1] === "") {
      // bytes=-N → los últimos N bytes
      const suffix = Number(m[2]);
      start = Math.max(0, file.size - suffix);
      end = file.size - 1;
    } else {
      start = Number(m[1]);
      end = m[2] === "" ? file.size - 1 : Math.min(Number(m[2]), file.size - 1);
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= file.size) {
      return new NextResponse(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${file.size}` } });
    }
    const length = end - start + 1;
    const headers = { ...base, "Content-Length": String(length), "Content-Range": `bytes ${start}-${end}/${file.size}` };
    if (head) return new NextResponse(null, { status: 206, headers });
    const rows = await prisma.$queryRaw<Array<{ chunk: Buffer }>>`SELECT substring("data" from CAST(${start + 1} AS integer) for CAST(${length} AS integer)) AS "chunk" FROM "StoredFile" WHERE "key" = ${key}`;
    if (!rows[0]) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    return new NextResponse(Buffer.from(rows[0].chunk), { status: 206, headers });
  }

  const headers = { ...base, "Content-Length": String(file.size) };
  if (head) return new NextResponse(null, { status: 200, headers });
  const full = await prisma.storedFile.findUnique({ where: { key }, select: { data: true } });
  if (!full) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  return new NextResponse(Buffer.from(full.data), { status: 200, headers });
}

export async function GET(req: NextRequest, { params }: { params: { key: string[] } }) {
  return serve(req, params, false);
}

export async function HEAD(req: NextRequest, { params }: { params: { key: string[] } }) {
  return serve(req, params, true);
}
