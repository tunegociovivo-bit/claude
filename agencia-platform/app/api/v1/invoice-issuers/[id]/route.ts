import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/admin";
import { invoiceIssuerUpdateSchema } from "@/lib/api/schemas";
import { issuerValidationError } from "@/lib/invoicing/core";

export const PATCH = withApi({ scope: "*", rate: "admin" }, async (req, { api, params }) => {
  await requireAdmin(api);
  const current = await prisma.invoiceIssuer.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null }
  });
  if (!current) throw new ApiError(404, "not_found", "Emisor no encontrado");

  const body = await req.json().catch(() => null);
  const parsed = invoiceIssuerUpdateSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  // Valida contra el resultado final (lo nuevo fusionado con lo actual).
  const fiscalErr = issuerValidationError({
    taxId: parsed.data.taxId ?? current.taxId,
    iban: parsed.data.iban !== undefined ? parsed.data.iban : current.iban,
    countryCode: parsed.data.countryCode ?? current.countryCode
  });
  if (fiscalErr) throw new ApiError(400, "validation_error", fiscalErr);

  if (parsed.data.isDefault) {
    await prisma.invoiceIssuer.updateMany({
      where: { workspaceId: api.workspaceId },
      data: { isDefault: false }
    });
  }
  const updated = await prisma.invoiceIssuer.update({ where: { id: current.id }, data: parsed.data });
  return NextResponse.json(updated);
});

export const DELETE = withApi({ scope: "*", rate: "destructive" }, async (_req, { api, params }) => {
  await requireAdmin(api);
  const current = await prisma.invoiceIssuer.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null }
  });
  if (!current) throw new ApiError(404, "not_found", "Emisor no encontrado");
  await prisma.invoiceIssuer.update({ where: { id: current.id }, data: { deletedAt: new Date() } });
  return NextResponse.json({ ok: true });
});
