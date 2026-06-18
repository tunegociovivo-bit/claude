/**
 * GET /api/v1/leads/waha-qr[?session=<canal>]
 *
 * Proxy de la imagen del QR de WAHA para vincular el teléfono, añadiendo la
 * X-Api-Key en el servidor (no se expone al navegador). Solo admins.
 *
 * Multi-número: con ?session=<nombre> devuelve el QR de ESE canal (debe estar
 * dado de alta en Ajustes → números). Si la sesión/instancia no existe aún en
 * WAHA/Evolution, se crea y arranca al vuelo — conectar un número nuevo es
 * "añadir en Ajustes + escanear su QR", sin tocar el servidor.
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

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  await requireAdmin(api.workspaceId, api.userId);

  // Canal concreto (multi-número): solo nombres dados de alta en Ajustes.
  const requested = new URL(req.url).searchParams.get("session")?.trim() || null;
  if (requested) {
    const { getLeadChannels } = await import("@/lib/leads/channels");
    const channels = await getLeadChannels(api.workspaceId);
    if (!channels.some((c) => c.name === requested)) {
      return NextResponse.json(
        { ok: false, message: `El número "${requested}" no está en Ajustes. Añádelo y guarda antes de conectar.` },
        { status: 400 }
      );
    }
  }

  // Evolution: el QR viene como data URL base64 en /instance/connect.
  if ((await getWhatsappProvider(api.workspaceId)) === "evolution") {
    const r = await evoConnect(api.workspaceId, requested ?? undefined);
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

  const sessionName = requested ?? cfg.session;
  const s = encodeURIComponent(sessionName);
  const headers = { "X-Api-Key": cfg.apiKey, Accept: "image/png" };
  const candidates = [
    `${cfg.baseUrl}/api/${s}/auth/qr?format=image`,
    `${cfg.baseUrl}/api/sessions/${s}/auth/qr?format=image`
  ];

  async function tryQr(): Promise<NextResponse | null> {
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
    return null;
  }

  let img = await tryQr();
  let diag = "";
  if (!img) {
    // La sesión puede no existir todavía (número nuevo): créala/arráncala y
    // reintenta. Capturamos el error de WAHA para diagnosticar (p. ej. WAHA Core
    // solo permite 1 sesión → aquí saldría el motivo real).
    const jsonHeaders = { "X-Api-Key": cfg.apiKey, "Content-Type": "application/json" };
    try {
      const createResp = await fetch(`${cfg.baseUrl}/api/sessions`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ name: sessionName, start: true })
      });
      if (!createResp.ok) {
        const t = (await createResp.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 220);
        diag = ` · WAHA /sessions → ${createResp.status}: ${t}`;
      }
    } catch (e: any) {
      diag = ` · No se pudo contactar con WAHA: ${e?.message ?? e}`;
    }
    await fetch(`${cfg.baseUrl}/api/sessions/${s}/start`, { method: "POST", headers: jsonHeaders }).catch(() => {});
    for (let i = 0; i < 3 && !img; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      img = await tryQr();
    }
  }
  if (img) return img;

  return NextResponse.json(
    { ok: false, message: `QR no disponible aún. Espera unos segundos y pulsa "Actualizar QR".${diag}` },
    { status: 409 }
  );
});
