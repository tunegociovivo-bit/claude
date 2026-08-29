import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const createdInvoice = {
  id: "generated-1",
  workspaceId: "workspace-1",
  number: "INV-2026-0002",
  status: "ISSUED",
  clientSnapshot: { email: "billing@example.com" },
  issuerSnapshot: { name: "Rixus Solutions L.L.C." },
  lines: [],
  currency: "USD"
  };
  const template = {
  id: "template-1",
  workspaceId: "workspace-1",
  type: "NORMAL",
  status: "SENT",
  series: "INV",
  number: "INV-2026-0001",
  issuerId: "issuer-1",
  clientId: "client-1",
  issuerSnapshot: createdInvoice.issuerSnapshot,
  clientSnapshot: createdInvoice.clientSnapshot,
  issueDate: new Date("2026-08-28T00:00:00.000Z"),
  dueDate: new Date("2026-09-27T00:00:00.000Z"),
  currency: "USD",
  paymentMethod: "TRANSFER",
  lines: [],
  subtotalCents: 64972,
  discountCents: 0,
  taxCents: 0,
  totalCents: 64972,
  notes: null,
  terms: null,
  recurring: true,
  deletedAt: null,
  recurrenceConfig: {
    intervalUnit: "DAYS",
    intervalValue: 1,
    nextRunAt: "2026-08-29T00:00:00.000Z"
  }
  };
  const invoiceUpdate = vi.fn();
  const txInvoiceCreate = vi.fn(async () => createdInvoice);
  const prisma = {
    invoice: {
      findMany: vi.fn(async () => [template]),
      findUnique: vi.fn(async () => null),
      update: invoiceUpdate
    },
    $transaction: vi.fn(async (callback: any) => callback({
      invoice: {
        findUnique: vi.fn(async () => null),
        create: txInvoiceCreate
      }
    }))
  };
  return { createdInvoice, invoiceUpdate, prisma, sendInvoiceAutomatically: vi.fn(), template, txInvoiceCreate };
});
const { createdInvoice, invoiceUpdate, sendInvoiceAutomatically, txInvoiceCreate } = mocks;

vi.mock("@/lib/db/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/invoicing/numbering", () => ({ assignInvoiceNumber: vi.fn(async () => "INV-2026-0002") }));
vi.mock("@/lib/invoicing/send", () => ({ sendInvoiceAutomatically: mocks.sendInvoiceAutomatically }));

import { runRecurringInvoices } from "@/lib/invoicing/recurring";

describe("recurring invoice delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invoiceUpdate.mockResolvedValue({});
    txInvoiceCreate.mockResolvedValue(createdInvoice);
    mocks.prisma.invoice.findMany.mockResolvedValue([mocks.template]);
    mocks.prisma.invoice.findUnique.mockResolvedValue(null);
    mocks.prisma.$transaction.mockImplementation(async (callback: any) => callback({
      invoice: { findUnique: vi.fn(async () => null), create: txInvoiceCreate }
    }));
  });

  it("emails a generated occurrence when its recurring template is configured as SENT", async () => {
    await runRecurringInvoices(new Date("2026-08-29T12:00:00.000Z"));

    expect(sendInvoiceAutomatically).toHaveBeenCalledWith(
      "workspace-1",
      createdInvoice,
      "invoice:recurring:template-1:2026-08-29T00:00:00.000Z:send"
    );
    expect(invoiceUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "generated-1" },
      data: expect.objectContaining({ status: "SENT", deliveryError: null })
    }));
  });

  it("delivers an existing unsent occurrence after a concurrent creation collision", async () => {
    mocks.prisma.$transaction.mockRejectedValueOnce({ code: "P2002" });
    mocks.prisma.invoice.findUnique.mockResolvedValueOnce(createdInvoice as any);

    await runRecurringInvoices(new Date("2026-08-29T12:00:00.000Z"));

    expect(sendInvoiceAutomatically).toHaveBeenCalledWith(
      "workspace-1",
      createdInvoice,
      "invoice:recurring:template-1:2026-08-29T00:00:00.000Z:send"
    );
  });

  it("continues with later templates when one email fails", async () => {
    const secondTemplate = { ...mocks.template, id: "template-2" };
    mocks.prisma.invoice.findMany.mockResolvedValueOnce([mocks.template, secondTemplate]);
    sendInvoiceAutomatically.mockRejectedValueOnce(new Error("recipient rejected")).mockResolvedValueOnce(undefined);

    await runRecurringInvoices(new Date("2026-08-29T12:00:00.000Z"));

    expect(sendInvoiceAutomatically).toHaveBeenCalledTimes(2);
  });

  it("repairs an older generated occurrence left in ISSUED state", async () => {
    const pending = {
      ...createdInvoice,
      creationKey: "recurring:template-1:2026-08-29T00:00:00.000Z",
      recurringSourceId: "template-1"
    };
    mocks.prisma.invoice.findMany.mockImplementation(async (args: any) =>
      args?.where?.recurringSourceId ? [pending] : []
    );
    mocks.prisma.invoice.findUnique.mockResolvedValueOnce(mocks.template as any);

    await runRecurringInvoices(new Date("2026-08-30T12:00:00.000Z"));

    expect(sendInvoiceAutomatically).toHaveBeenCalledWith(
      "workspace-1",
      pending,
      "invoice:recurring:template-1:2026-08-29T00:00:00.000Z:send"
    );
  });
});
