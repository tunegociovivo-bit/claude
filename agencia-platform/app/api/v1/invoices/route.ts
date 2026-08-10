import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/admin";
import { invoiceCreateSchema } from "@/lib/api/schemas";
import { buildInvoiceData } from "@/lib/invoicing/persist";

export const GET = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  await requireAdmin(api);
  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;
  const clientId = url.searchParams.get("clientId") ?? undefined;
  const issuerId = url.searchParams.get("issuerId") ?? undefined;
  const q = url.searchParams.get("q")?.trim();
  const page = Math.max(Number(url.searchParams.get("page")) || 1, 1);
  const pageSize = Math.min(Math.max(Number(url.searchParams.get("pageSize")) || 50, 10), 100);

  const where: any = { workspaceId: api.workspaceId, deletedAt: null };
  if (type) where.type = type;
  if (status) where.status = status;
  if (clientId) where.clientId = clientId;
  if (issuerId) where.issuerId = issuerId;
  if (q) {
    where.OR = [
      { number: { contains: q, mode: "insensitive" } },
      { client: { name: { contains: q, mode: "insensitive" } } }
    ];
  }

  const [items, total] = await prisma.$transaction([
    prisma.invoice.findMany({
    where,
    select: {
      id: true,
      type: true,
      status: true,
      series: true,
      number: true,
      issueDate: true,
      dueDate: true,
      currency: true,
      paymentMethod: true,
      totalCents: true,
      paidCents: true,
      recurring: true,
      paidAt: true,
      client: { select: { id: true, name: true } },
      issuer: { select: { id: true, name: true } }
    },
    orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.invoice.count({ where })
  ]);
  return NextResponse.json({ items, pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) } });
});

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  await requireAdmin(api);
  const body = await req.json().catch(() => null);
  const parsed = invoiceCreateSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const data = await buildInvoiceData({ workspaceId: api.workspaceId, input: parsed.data });
  const invoice = await prisma.$transaction(async (tx) => {
    const created = await tx.invoice.create({ data: { ...data, workspaceId: api.workspaceId } });
    await tx.invoiceEvent.create({
      data: {
        workspaceId: api.workspaceId,
        invoiceId: created.id,
        type: created.number ? "INVOICE_ISSUED" : "INVOICE_CREATED",
        actorId: api.userId,
        data: { status: created.status, number: created.number }
      }
    });
    return created;
  });
  return NextResponse.json(invoice, { status: 201 });
});
