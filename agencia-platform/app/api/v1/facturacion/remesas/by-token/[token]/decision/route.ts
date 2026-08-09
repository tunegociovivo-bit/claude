/**
 * Remesas SEPA — aprobar/rechazar por TOKEN (un solo uso, transición atómica).
 * Requiere ADMIN autenticado + CSRF (origen) + confirmación explícita.
 * APROBAR NO FIRMA NI COBRA: deja la solicitud APPROVED (lista para preparar).
 *  POST { action: "approve"|"reject", confirm: true, reason? }
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { ApiError } from "@/lib/api/auth";
import { assertSameOrigin } from "@/lib/api/csrf";
import { decideByToken } from "@/lib/facturacion/sepa/remittance";

export const dynamic = "force-dynamic";

const schema = z.object({
  action: z.enum(["approve", "reject"]),
  confirm: z.literal(true),
  reason: z.string().max(500).optional()
});

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { params, api }) => {
  await requireAdmin(api);
  assertSameOrigin(req);
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", "Falta confirmación o acción válida");
  const token = String(params.token ?? "");
  const res = await decideByToken(api.workspaceId, token, {
    action: parsed.data.action,
    userId: api.userId!,
    reason: parsed.data.reason
  });
  if (!res.ok) {
    const msg =
      res.reason === "expired" ? "El enlace ha caducado" :
      res.reason === "used" ? "El enlace ya se usó" :
      res.reason === "already_decided" ? "La solicitud ya fue decidida" :
      "Solicitud no encontrada";
    throw new ApiError(409, res.reason, msg);
  }
  return NextResponse.json({ ok: true, status: res.status });
});
