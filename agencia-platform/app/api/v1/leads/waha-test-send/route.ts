/**
 * POST /api/v1/leads/waha-test-send  { phone: "+34600112233" }
 *
 * Envía un WhatsApp de PRUEBA al número indicado usando la misma ruta que las
 * campañas (sendText → WAHA/Evolution) y devuelve la respuesta CRUDA del
 * proveedor. Sirve para distinguir, de un vistazo:
 *   - Entregado de verdad (devuelve messageId real) vs
 *   - Falso positivo (WAHA responde 200 sin ID → la sesión no entrega).
 *
 * Solo admins. No toca la cola ni los topes anti-baneo (es un disparo manual).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { normalizePhone, sendText, getWahaConfig } from "@/lib/leads/waha";

async function requireAdmin(workspaceId: string, userId: string | undefined) {
  if (!userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const me = await prisma.membership.findFirst({ where: { workspaceId, userId } });
  if (!me || me.role !== "ADMIN") throw new ApiError(403, "forbidden", "Solo admins");
}

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  await requireAdmin(api.workspaceId, api.userId);

  let bodyJson: any = {};
  try {
    bodyJson = await req.json();
  } catch {
    /* body opcional */
  }
  const cc = (await getWahaConfig(api.workspaceId).catch(() => null))?.countryCode ?? "34";
  const phone = normalizePhone(String(bodyJson?.phone ?? ""), cc);
  if (!phone) {
    return NextResponse.json(
      { ok: false, code: "bad_phone", message: "Indica un teléfono válido (con prefijo, p.ej. +34600112233)." },
      { status: 400 }
    );
  }

  const text =
    typeof bodyJson?.text === "string" && bodyJson.text.trim()
      ? String(bodyJson.text)
      : "✅ Mensaje de prueba de NV Leads Pro. Si lo recibes, el envío por WhatsApp funciona correctamente.";

  try {
    const out = await sendText({ workspaceId: api.workspaceId, phoneNormalized: phone, text });
    return NextResponse.json({
      ok: true,
      phone,
      messageId: out.messageId,
      raw: out.raw ?? null,
      message: `Enviado a ${phone}. ID: ${out.messageId}. Comprueba que ha llegado a ese teléfono.`
    });
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      code: "send_failed",
      phone,
      message: e?.message ?? String(e)
    });
  }
});
