import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/admin";
import { computeExpenseTotals } from "@/lib/invoicing/expenses";
import { expenseSchema } from "../schema";

export const GET = withApi({ scope: "*", rate: "admin" }, async (_req, { api, params }) => {
  await requireAdmin(api);
  const expense = await prisma.expense.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null }
  });
  if (!expense) throw new ApiError(404, "not_found", "Gasto no encontrado");
  return NextResponse.json(expense);
});

export const PATCH = withApi({ scope: "*", rate: "admin" }, async (req, { api, params }) => {
  await requireAdmin(api);
  const current = await prisma.expense.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null }
  });
  if (!current) throw new ApiError(404, "not_found", "Gasto no encontrado");

  const body = await req.json().catch(() => null);
  const parsed = expenseSchema.partial().safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const d = parsed.data;

  if (d.issuerId) {
    const issuer = await prisma.invoiceIssuer.findFirst({
      where: { id: d.issuerId, workspaceId: api.workspaceId, deletedAt: null },
      select: { id: true }
    });
    if (!issuer) throw new ApiError(400, "bad_issuer", "Empresa no válida");
  }

  const baseCents = d.baseCents ?? current.baseCents;
  const taxRate = d.taxRate ?? current.taxRate;
  const { taxCents, totalCents } = computeExpenseTotals(baseCents, taxRate);

  const updated = await prisma.expense.update({
    where: { id: current.id },
    data: {
      ...(d.issuerId !== undefined ? { issuerId: d.issuerId ?? null } : {}),
      ...(d.date !== undefined ? { date: d.date ? new Date(d.date) : new Date() } : {}),
      ...(d.category !== undefined ? { category: d.category } : {}),
      ...(d.supplier !== undefined ? { supplier: d.supplier ?? null } : {}),
      ...(d.supplierTaxId !== undefined ? { supplierTaxId: d.supplierTaxId ?? null } : {}),
      ...(d.concept !== undefined ? { concept: d.concept ?? null } : {}),
      ...(d.currency !== undefined ? { currency: d.currency } : {}),
      ...(d.paymentMethod !== undefined ? { paymentMethod: d.paymentMethod } : {}),
      ...(d.status !== undefined ? { status: d.status } : {}),
      ...(d.deductible !== undefined ? { deductible: d.deductible } : {}),
      ...(d.notes !== undefined ? { notes: d.notes ?? null } : {}),
      ...(d.fileUrl !== undefined ? { fileUrl: d.fileUrl ?? null } : {}),
      baseCents: Math.round(baseCents),
      taxRate,
      taxCents,
      totalCents
    }
  });
  return NextResponse.json(updated);
});

export const DELETE = withApi({ scope: "*", rate: "destructive" }, async (_req, { api, params }) => {
  await requireAdmin(api);
  const current = await prisma.expense.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null }
  });
  if (!current) throw new ApiError(404, "not_found", "Gasto no encontrado");
  await prisma.expense.update({ where: { id: current.id }, data: { deletedAt: new Date() } });
  return NextResponse.json({ ok: true });
});
