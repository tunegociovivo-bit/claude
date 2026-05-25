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
import { getWahaConfig, getWhatsappProvider } from "@/lib/leads/waha";
import { evoConnect } from "@/lib/leads/evolution";

async function requireAdmin(workspaceId: string, userId: string | undefined) {
  if (!userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const me = await prisma.membership.findFirst({ where: { workspaceId, userId } });
  if (!me || me.role !== "ADMIN") throw new ApiError(403, "forbidden", "Solo admins");
}

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  await requireAdmin(api.workspaceId, api.userId);

  // Evolution: el QR viene como data URL base64 en /instance/connect.
  if ((await getWhatsappProvider(api.workspaceId)) === "evolution") {
    const r = await evoConnect(api.workspaceId);
    if (!r.ok || !r.base64) {
      return NextResponse.json(
        {
          ok: false,
          message: r.error ?? "QR no disponible (la instancia puede estar ya conectada).",
          count: r.count ?? null,
          state: r.state ?? null
        },
        { status: 409 }
      );
    }
    const m = /^data:(image\/[a-z.+-]+);base64,(.*)$/i.exec(r.base64);
    const b64 = m ? m[2] : r.base64;
    const ct = m ? m[1] : "image/png";
    const buf = Buffer.from(b64, "base64");
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: { "Content-Type": ct, "Cache-Control": "no-store" }
    });
  }

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
