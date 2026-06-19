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
    const jsonHeaders = { "X-Api-Key": cfg.apiKey, "Content-Type": "application/json" };
    const post = (p: string) => fetch(`${cfg.baseUrl}${p}`, { method: "POST", headers: jsonHeaders });
    const del = (p: string) => fetch(`${cfg.baseUrl}${p}`, { method: "DELETE", headers: jsonHeaders });
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const coreLimit = (t: string) => /WAHA Core|PLUS version|more then one|more than one/i.test(t);

    // 1) ¿Existe ya la sesión y en qué estado está? (Antes se hacía POST /sessions
    //    a ciegas → si ya existía, WAHA devolvía 422 "already exists" y el QR no
    //    aparecía nunca.) Ahora decidimos según el estado real.
    let status: string | null = null;
    try {
      const sresp = await fetch(`${cfg.baseUrl}/api/sessions/${s}`, { headers: jsonHeaders });
      if (sresp.ok) status = (await sresp.json().catch(() => null))?.status ?? null;
    } catch {}

    if (status === "WORKING") {
      return NextResponse.json(
        { ok: false, message: `El número "${sessionName}" ya está vinculado y funcionando. No necesita escanear QR.` },
        { status: 409 }
      );
    }

    if (!status) {
      // No existe → crearla y arrancarla.
      try {
        const r = await fetch(`${cfg.baseUrl}/api/sessions`, {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({ name: sessionName, start: true })
        });
        if (!r.ok) {
          const t = (await r.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 220);
          diag = coreLimit(t)
            ? " · Tu servidor WAHA es la versión Core (gratuita), que SOLO permite 1 número (el principal). " +
              "Para conectar varios números necesitas WAHA Plus (de pago). Más info: https://waha.devlike.pro"
            : ` · WAHA /sessions → ${r.status}: ${t}`;
        }
      } catch (e: any) {
        diag = ` · No se pudo contactar con WAHA: ${e?.message ?? e}`;
      }
    } else if (status === "FAILED" || status === "STOPPED") {
      // Existe pero con credenciales rotas / parada → fuerza un QR nuevo:
      // logout (limpia la auth rota) + start (arranca de cero → SCAN_QR_CODE).
      try { await post(`/api/sessions/${s}/logout`); } catch {}
      try { await post(`/api/sessions/${s}/start`); } catch {}
    }
    // status SCAN_QR_CODE o STARTING → no tocamos; solo esperamos el QR abajo.

    // 2) Arranca (idempotente) y sondea el QR.
    await post(`/api/sessions/${s}/start`).catch(() => {});
    for (let i = 0; i < 4 && !img; i++) {
      await sleep(1500);
      img = await tryQr();
    }

    // 3) Último recurso: si la sesión existía pero seguimos sin QR, resetéala
    //    entera (delete + create) para salir de un estado atascado.
    if (!img && status) {
      try { await del(`/api/sessions/${s}`); } catch {}
      try {
        const r = await fetch(`${cfg.baseUrl}/api/sessions`, {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({ name: sessionName, start: true })
        });
        if (!r.ok) {
          const t = (await r.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 220);
          if (coreLimit(t)) {
            diag =
              " · Tu servidor WAHA es la versión Core (gratuita), que SOLO permite 1 número (el principal). " +
              "Para conectar varios números necesitas WAHA Plus (de pago). Más info: https://waha.devlike.pro";
          }
        }
      } catch {}
      for (let i = 0; i < 4 && !img; i++) {
        await sleep(1500);
        img = await tryQr();
      }
    }
  }
  if (img) return img;

  return NextResponse.json(
    { ok: false, message: `QR no disponible aún. Espera unos segundos y pulsa "Actualizar QR".${diag}` },
    { status: 409 }
  );
});
