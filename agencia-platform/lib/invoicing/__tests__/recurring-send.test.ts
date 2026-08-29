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
  return { createdInvoice, invoiceUpdate, prisma, sendInvoiceAutomatically: vi.fn(), txInvoiceCreate };
});
const { createdInvoice, invoiceUpdate, sendInvoiceAutomatically, txInvoiceCreate } = mocks;

vi.mock("@/lib/db/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/invoicing/numbering", () => ({ assignInvoiceNumber: vi.fn(async () => "INV-2026-0002") }));
vi.mock("@/lib/invoicing/send", () => ({ sendInvoiceAutomatically }));

import { runRecurringInvoices } from "@/lib/invoicing/recurring";

describe("recurring invoice delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invoiceUpdate.mockResolvedValue({});
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
});
