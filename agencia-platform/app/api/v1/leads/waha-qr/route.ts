/**
 * GET /api/v1/leads/waha-qr
 *
 * Proxy de la imagen del QR de WAHA para vincular el teléfono, añadiendo la
 * X-Api-Key en el servidor (no se expone al navegador). Solo sirve cuando la
 * sesión está en SCAN_QR_CODE. Solo admins.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { getWahaConfig } from "@/lib/leads/waha";

async function requireAdmin(workspaceId: string, userId: string | undefined) {
  if (!userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const me = await prisma.membership.findFirst({ where: { workspaceId, userId } });
  if (!me || me.role !== "ADMIN") throw new ApiError(403, "forbidden", "Solo admins");
}

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  await requireAdmin(api.workspaceId, api.userId);

  let cfg;
  try {
    cfg = await getWahaConfig(api.workspaceId);
  } catch (e: any) {
    return NextResponse.json({ ok: false, message: e?.message ?? "WAHA no configurado." }, { status: 400 });
  }

  const s = encodeURIComponent(cfg.session);
  const headers = { "X-Api-Key": cfg.apiKey, Accept: "image/png" };
  const candidates = [
    `${cfg.baseUrl}/api/${s}/auth/qr?format=image`,
    `${cfg.baseUrl}/api/sessions/${s}/auth/qr?format=image`
  ];

  for (const url of candidates) {
    let resp: Response;
    try {
      resp = await fetch(url, { headers });
    } catch {
      continue;
    }
    const ct = resp.headers.get("content-type") ?? "";
    if (resp.ok && ct.startsWith("image/")) {
      const buf = Buffer.from(await resp.arrayBuffer());
      return new NextResponse(new Uint8Array(buf), {
        status: 200,
        headers: { "Content-Type": ct, "Cache-Control": "no-store" }
      });
    }
  }

  return NextResponse.json(
    { ok: false, message: "QR no disponible. La sesión no está esperando escaneo (reinicia primero)." },
    { status: 409 }
  );
});
