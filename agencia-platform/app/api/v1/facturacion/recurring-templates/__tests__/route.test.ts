/**
 * Slice A — rutas recurrentes: flag, admin-only, tenant, preview NO escribe,
 * commit idempotente.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const { authenticateMock, prisma } = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  prisma: {
    membership: { findFirst: vi.fn() },
    recurringInvoiceTemplate: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() }
  }
}));
vi.mock("@/lib/db/prisma", () => ({ prisma }));
vi.mock("@/lib/api/auth", async (importActual) => {
  const actual = (await importActual()) as any;
  return { ...actual, authenticate: authenticateMock };
});
vi.mock("@/lib/api/rate-limit", () => ({ rateLimit: () => ({ ok: true, remaining: 100, resetAt: Date.now() + 60_000 }) }));

import { POST as PREVIEW } from "../import/preview/route";
import { POST as COMMIT } from "../import/commit/route";
import { GET as LIST } from "../route";

const CSV = "externalId,clientName,description,unitPrice,taxRate\nT1,Acme,Cuota,100,21";
const ORIG = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.HUB_RECURRING_INVOICES;
  authenticateMock.mockResolvedValue({ workspaceId: "w1", userId: "u1", scopes: new Set(["*"]) });
  prisma.membership.findFirst.mockResolvedValue({ role: "ADMIN" });
  prisma.recurringInvoiceTemplate.findFirst.mockResolvedValue(null);
  prisma.recurringInvoiceTemplate.create.mockResolvedValue({});
  prisma.recurringInvoiceTemplate.findMany.mockResolvedValue([]);
});
afterEach(() => {
  process.env = { ...ORIG };
});

const preview = (body: any) => PREVIEW(new NextRequest("https://h/x", { method: "POST", body: JSON.stringify(body) }), { params: {} });
const commit = (body: any) => COMMIT(new NextRequest("https://h/x", { method: "POST", body: JSON.stringify(body) }), { params: {} });
const list = () => LIST(new NextRequest("https://h/api/v1/facturacion/recurring-templates", { method: "GET" }), { params: {} });

describe("preview", () => {
  it("flag off → 404", async () => {
    process.env.HUB_RECURRING_INVOICES = "off";
    expect((await preview({ format: "csv", content: CSV })).status).toBe(404);
  });
  it("no-admin → 403", async () => {
    prisma.membership.findFirst.mockResolvedValue({ role: "MEMBER" });
    expect((await preview({ format: "csv", content: CSV })).status).toBe(403);
  });
  it("admin: devuelve preview y NO escribe en BD", async () => {
    const body = await (await preview({ format: "csv", content: CSV })).json();
    expect(body.valid).toBe(1);
    expect(prisma.recurringInvoiceTemplate.create).not.toHaveBeenCalled();
    expect(prisma.recurringInvoiceTemplate.updateMany).not.toHaveBeenCalled();
  });
  it("format inválido → 400", async () => {
    expect((await preview({ format: "xml", content: "" })).status).toBe(400);
  });
});

describe("commit — idempotente, solo draft, tenant", () => {
  it("crea drafts válidos con workspaceId", async () => {
    const body = await (await commit({ format: "csv", content: CSV, source: "CSV_IMPORT" })).json();
    expect(body.created).toBe(1);
    const data = prisma.recurringInvoiceTemplate.create.mock.calls[0][0].data;
    expect(data.workspaceId).toBe("w1");
    expect(data.status).toBe("draft");
  });
  it("reimport con mismo checksum → sin cambios (idempotente)", async () => {
    // primer commit para conocer el checksum
    const first = await (await commit({ format: "csv", content: CSV })).json();
    const checksum = prisma.recurringInvoiceTemplate.create.mock.calls[0][0].data.checksum;
    // segundo commit: la fila ya existe con el mismo checksum
    prisma.recurringInvoiceTemplate.findFirst.mockResolvedValue({ id: "e1", checksum });
    prisma.recurringInvoiceTemplate.create.mockClear();
    const second = await (await commit({ format: "csv", content: CSV })).json();
    expect(second.unchanged).toBe(1);
    expect(prisma.recurringInvoiceTemplate.create).not.toHaveBeenCalled();
  });
  it("filas inválidas no se persisten (skippedInvalid)", async () => {
    const bad = "externalId,clientName,description,unitPrice,taxRate\nB,,C,abc,21";
    const body = await (await commit({ format: "csv", content: bad })).json();
    expect(body.created).toBe(0);
    expect(body.skippedInvalid).toBe(1);
  });
});

describe("list — admin, tenant", () => {
  it("consulta scoped por workspace", async () => {
    await list();
    // listTemplates hace 2 findMany; ambos con workspaceId
    for (const call of prisma.recurringInvoiceTemplate.findMany.mock.calls) {
      expect(call[0].where.workspaceId).toBe("w1");
    }
  });
});
