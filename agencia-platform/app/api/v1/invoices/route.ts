import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/admin";
import { invoiceCreateSchema } from "@/lib/api/schemas";
import { buildInvoiceData } from "@/lib/invoicing/persist";
import { sendInvoiceAutomatically } from "@/lib/invoicing/send";

export const GET = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  await requireAdmin(api);
  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;
  const clientId = url.searchParams.get("clientId") ?? undefined;
  const issuerId = url.searchParams.get("issuerId") ?? undefined;
  const q = url.searchParams.get("q")?.trim();
  const trash = url.searchParams.get("trash") === "1";

  const where: any = { workspaceId: api.workspaceId, deletedAt: trash ? { not: null } : null };
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

  const items = await prisma.invoice.findMany({
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
      deliveryError: true,
      paidAt: true,
      deletedAt: true,
      clientSnapshot: true,
      client: { select: { id: true, name: true } },
      issuer: { select: { id: true, name: true } }
    },
    orderBy: [{ number: "desc" }, { createdAt: "desc" }],
    take: 500
  });
  const sequence = (number: string | null) => Number(number?.match(/(\d+)(?!.*\d)/)?.[1] ?? -1);
  items.sort((a, b) => sequence(b.number) - sequence(a.number)
    || String(a.number ?? "").localeCompare(String(b.number ?? ""), "es", { numeric: true }));
  return NextResponse.json({ items });
});

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  await requireAdmin(api);
  const body = await req.json().catch(() => null);
  const parsed = invoiceCreateSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const shouldSend = parsed.data.status === "SENT";
  const creationKey = req.headers.get("idempotency-key")?.trim().slice(0, 120) || null;
  const creationHash = createHash("sha256").update(JSON.stringify(parsed.data)).digest("hex");
  const input = shouldSend ? { ...parsed.data, status: "ISSUED" as const } : parsed.data;
  let result: { invoice: any; created: boolean } | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      result = await prisma.$transaction(async (tx) => {
        const existing = creationKey
          ? await tx.invoice.findUnique({
              where: { workspaceId_creationKey: { workspaceId: api.workspaceId, creationKey } }
            })
          : null;
        if (existing) {
          if (existing.creationHash && existing.creationHash !== creationHash) {
            throw new ApiError(409, "idempotency_conflict", "La clave de creación ya se utilizó con otros datos");
          }
          return { invoice: existing, created: false };
        }
        const data = await buildInvoiceData({
          workspaceId: api.workspaceId,
          input,
          transactionClient: tx
        });
        const invoice = await tx.invoice.create({
          data: { ...data, workspaceId: api.workspaceId, creationKey, creationHash }
        });
        return { invoice, created: true };
      }, { isolationLevel: "Serializable" });
      break;
    } catch (error: any) {
      if (error?.code === "CUSTOM_INVOICE_NUMBER_SEQUENCE") {
        throw new ApiError(409, "invoice_number_sequence", error.message);
      }
      if (error?.code === "P2002" && parsed.data.number) {
        throw new ApiError(409, "duplicate_invoice_number", "Ese número de factura ya existe");
      }
      if ((error?.code !== "P2002" && error?.code !== "P2034") || attempt === 2) throw error;
    }
  }
  if (!result) throw new Error("No se pudo crear la factura de forma atómica");
  let { invoice, created } = result;
  if (invoice.creationHash && invoice.creationHash !== creationHash) {
    throw new ApiError(409, "idempotency_conflict", "La clave de creación ya se utilizó con otros datos");
  }
  if (shouldSend && invoice.status !== "SENT") {
    try {
      await sendInvoiceAutomatically(api.workspaceId, invoice, `invoice:${creationKey ?? invoice.id}:send`);
      invoice = await prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: "SENT", sentAt: new Date(), deliveryError: null }
      });
    } catch (error: any) {
      const deliveryError = String(error?.message ?? "No se pudo enviar la factura").slice(0, 500);
      invoice = await prisma.invoice.update({ where: { id: invoice.id }, data: { deliveryError } });
    }
  }
  return NextResponse.json(invoice, { status: created ? 201 : 200 });
});
