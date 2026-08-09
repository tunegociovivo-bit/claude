/**
 * Config de cobro SEPA de un cliente — actualizar (opt-in). Solo ADMIN + CSRF.
 * Si llega un IBAN completo, se GUARDA SOLO ENMASCARADO (nunca el completo ni
 * credenciales). El resto son referencias (mandato, plantilla Santander) y flags.
 *  PATCH { sepaEnabled?, sepaMandateRef?, sepaMandateActive?, sepaSantanderTemplate?, iban?, clearIban? }
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { ApiError } from "@/lib/api/auth";
import { assertSameOrigin } from "@/lib/api/csrf";
import { prisma } from "@/lib/db/prisma";
import { maskIban } from "@/lib/facturacion/sepa/iban";

export const dynamic = "force-dynamic";

const schema = z.object({
  sepaEnabled: z.boolean().optional(),
  sepaMandateRef: z.string().max(140).nullable().optional(),
  sepaMandateActive: z.boolean().optional(),
  sepaSantanderTemplate: z.string().max(140).nullable().optional(),
  iban: z.string().max(60).optional(), // IBAN completo → se enmascara y NO se guarda entero
  clearIban: z.boolean().optional()
});

export const PATCH = withApi({ scope: "*", rate: "admin" }, async (req, { params, api }) => {
  await requireAdmin(api);
  assertSameOrigin(req);
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const d = parsed.data;

  const client = await prisma.client.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null },
    select: { id: true }
  });
  if (!client) throw new ApiError(404, "not_found", "Cliente no encontrado");

  const data: any = {};
  if (d.sepaEnabled !== undefined) data.sepaEnabled = d.sepaEnabled;
  if (d.sepaMandateRef !== undefined) data.sepaMandateRef = d.sepaMandateRef?.trim() || null;
  if (d.sepaMandateActive !== undefined) data.sepaMandateActive = d.sepaMandateActive;
  if (d.sepaSantanderTemplate !== undefined) data.sepaSantanderTemplate = d.sepaSantanderTemplate?.trim() || null;
  if (d.clearIban) data.sepaIbanMasked = null;
  else if (typeof d.iban === "string" && d.iban.trim()) {
    const masked = maskIban(d.iban);
    if (!masked) throw new ApiError(400, "bad_iban", "IBAN con formato no válido");
    data.sepaIbanMasked = masked; // SOLO la máscara; el IBAN completo NO se persiste
  }

  const updated = await prisma.client.update({
    where: { id: client.id },
    data,
    select: {
      id: true, name: true, sepaEnabled: true, sepaMandateRef: true,
      sepaMandateActive: true, sepaSantanderTemplate: true, sepaIbanMasked: true
    }
  });
  return NextResponse.json({ ok: true, client: updated });
});
