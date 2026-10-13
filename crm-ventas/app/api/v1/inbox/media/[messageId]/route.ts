import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { downloadBuffer, downloadRange, objectSize } from "@/lib/storage/r2";
import { inboxError, requireInboxUser } from "@/lib/inbox/api";
import { isInlineType, safeServeType, type StoredMedia } from "@/lib/inbox/media-core";

export const dynamic = "force-dynamic";

// Archivos de WhatsApp (fotos, audios, vídeos, documentos) de los chats.
// Solo con sesión del propio negocio: pueden ser datos de salud de pacientes,
// así que no se publican con URL abierta. Admite Range (Safari/iOS lo exige
// para reproducir audio y vídeo).
async function serve(req: NextRequest, messageId: string, head: boolean) {
  const { workspaceId } = await requireInboxUser();
  const message = await prisma.message.findFirst({ where: { id: messageId, workspaceId }, select: { meta: true } });
  const media = (message?.meta as any)?.media as StoredMedia | undefined;
  const thumb = req.nextUrl.searchParams.get("v") === "thumb" && media?.thumbKey;
  const key = thumb ? media!.thumbKey : media?.key;
  if (!media || !key) return NextResponse.json({ error: "Archivo no disponible" }, { status: 404 });

  const contentType = thumb ? "image/webp" : safeServeType(media.mimetype);
  const download = req.nextUrl.searchParams.get("download") === "1" || !isInlineType(media.mimetype);
  const filename = (media.filename || `archivo.${contentType.split("/")[1] || "bin"}`).replace(/["\\\r\n]/g, "_");
  const base: Record<string, string> = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    // Caché corta y solo en el navegador del usuario (pueden ser datos de salud).
    "Cache-Control": "private, max-age=600",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  };

  const stored = await prisma.storedFile.findUnique({ where: { key }, select: { size: true } });
  const inBucket = !stored;
  let size: number;
  if (stored) size = stored.size;
  else {
    const s3Size = await objectSize(key);
    if (s3Size === null) return NextResponse.json({ error: "Archivo no disponible" }, { status: 404 });
    size = s3Size;
  }

  const range = req.headers.get("range");
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (m && (m[1] !== "" || m[2] !== "")) {
    let start: number;
    let end: number;
    if (m[1] === "") {
      start = Math.max(0, size - Number(m[2]));
      end = size - 1;
    } else {
      start = Number(m[1]);
      end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
      return new NextResponse(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${size}` } });
    }
    const length = end - start + 1;
    const headers = { ...base, "Content-Length": String(length), "Content-Range": `bytes ${start}-${end}/${size}` };
    if (head) return new NextResponse(null, { status: 206, headers });
    let chunk: Buffer;
    if (inBucket) chunk = await downloadRange(key, start, end);
    else {
      const rows = await prisma.$queryRaw<Array<{ chunk: Buffer }>>`SELECT substring("data" from CAST(${start + 1} AS integer) for CAST(${length} AS integer)) AS "chunk" FROM "StoredFile" WHERE "key" = ${key}`;
      if (!rows[0]) return NextResponse.json({ error: "Archivo no disponible" }, { status: 404 });
      chunk = Buffer.from(rows[0].chunk);
    }
    return new NextResponse(new Uint8Array(chunk), { status: 206, headers });
  }

  const headers = { ...base, "Content-Length": String(size) };
  if (head) return new NextResponse(null, { status: 200, headers });
  const full = await downloadBuffer(key);
  return new NextResponse(new Uint8Array(full), { status: 200, headers });
}

export async function GET(req: NextRequest, { params }: { params: { messageId: string } }) {
  try {
    return await serve(req, params.messageId, false);
  } catch (error) {
    return inboxError(error);
  }
}

export async function HEAD(req: NextRequest, { params }: { params: { messageId: string } }) {
  try {
    return await serve(req, params.messageId, true);
  } catch (error) {
    return inboxError(error);
  }
}
