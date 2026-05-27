import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/admin";
import { EXPENSE_CATEGORIES, EXPENSE_STATUS, computeExpenseTotals } from "@/lib/invoicing/expenses";
import { PAYMENT_METHODS, CURRENCIES } from "@/lib/invoicing/core";

export const GET = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  await requireAdmin(api);
  const url = new URL(req.url);
  const issuerId = url.searchParams.get("issuerId") ?? undefined;
  const category = url.searchParams.get("category") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;
  const q = url.searchParams.get("q")?.trim();

  const where: any = { workspaceId: api.workspaceId, deletedAt: null };
  if (issuerId) where.issuerId = issuerId;
  if (category) where.category = category;
  if (status) where.status = status;
  if (q) {
    where.OR = [
      { supplier: { contains: q, mode: "insensitive" } },
      { concept: { contains: q, mode: "insensitive" } }
    ];
  }

  const items = await prisma.expense.findMany({
    where,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 1000,
    include: { issuer: { select: { id: true, name: true } } }
  });
  return NextResponse.json({ items });
});

export const expenseSchema = z.object({
  issuerId: z.string().nullish(),
  date: z.string().datetime().optional(),
  category: z.enum(EXPENSE_CATEGORIES).default("OTROS"),
  supplier: z.string().max(200).nullish(),
  supplierTaxId: z.string().max(40).nullish(),
  concept: z.string().max(5000).nullish(),
  currency: z.enum(CURRENCIES).default("EUR"),
  paymentMethod: z.enum(PAYMENT_METHODS).default("TRANSFER"),
  status: z.enum(EXPENSE_STATUS).default("PAID"),
  baseCents: z.number().int(),
  taxRate: z.number().min(0).max(100).default(21),
  deductible: z.boolean().default(true),
  notes: z.string().max(5000).nullish(),
  fileUrl: z.string().url().nullish()
});

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  await requireAdmin(api);
  const body = await req.json().catch(() => null);
  const parsed = expenseSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const d = parsed.data;

  if (d.issuerId) {
    const issuer = await prisma.invoiceIssuer.findFirst({
      where: { id: d.issuerId, workspaceId: api.workspaceId, deletedAt: null },
      select: { id: true }
    });
    if (!issuer) throw new ApiError(400, "bad_issuer", "Empresa no válida");
  }

  const { taxCents, totalCents } = computeExpenseTotals(d.baseCents, d.taxRate);
  const expense = await prisma.expense.create({
    data: {
      workspaceId: api.workspaceId,
      issuerId: d.issuerId ?? null,
      date: d.date ? new Date(d.date) : new Date(),
      category: d.category,
      supplier: d.supplier ?? null,
      supplierTaxId: d.supplierTaxId ?? null,
      concept: d.concept ?? null,
      currency: d.currency,
      paymentMethod: d.paymentMethod,
      status: d.status,
      baseCents: Math.round(d.baseCents),
      taxRate: d.taxRate,
      taxCents,
      totalCents,
      deductible: d.deductible,
      notes: d.notes ?? null,
      fileUrl: d.fileUrl ?? null
    }
  });
  return NextResponse.json(expense, { status: 201 });
});
