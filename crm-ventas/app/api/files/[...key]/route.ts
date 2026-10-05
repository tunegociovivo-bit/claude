import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyFileSignature } from "@/lib/storage/r2";

export const dynamic = "force-dynamic";

// Sirve archivos guardados en BD con URL firmada (HMAC + caducidad). Pública a
// propósito: Meta, WordPress y las <img> del CRM descargan por esta URL.
async function serve(req: NextRequest, params: { key: string[] }, head: boolean) {
  const key = (params.key ?? []).join("/");
  const exp = Number(req.nextUrl.searchParams.get("e"));
  const sig = req.nextUrl.searchParams.get("s") ?? "";
  if (!key || !verifyFileSignature(key, exp, sig)) {
    return NextResponse.json({ error: "Enlace caducado o no válido" }, { status: 403 });
  }
  const file = await prisma.storedFile.findUnique({
    where: { key },
    select: head ? { contentType: true, size: true } : { contentType: true, size: true, data: true },
  });
  if (!file) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const maxAge = Math.max(0, Math.min(86400, Math.floor(exp - Date.now() / 1000)));
  const headers = {
    "Content-Type": file.contentType,
    "Content-Length": String(file.size),
    "Cache-Control": `private, max-age=${maxAge}`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
  if (head) return new NextResponse(null, { status: 200, headers });
  return new NextResponse(Buffer.from((file as any).data), { status: 200, headers });
}

export async function GET(req: NextRequest, { params }: { params: { key: string[] } }) {
  return serve(req, params, false);
}

export async function HEAD(req: NextRequest, { params }: { params: { key: string[] } }) {
  return serve(req, params, true);
}
