import { beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  admin: vi.fn(),
  load: vi.fn(),
  summary: vi.fn(),
  prisma: { bubuiCustomer: { findUnique: vi.fn() }, bubuiBusiness: { findUnique: vi.fn() } }
}));
vi.mock("@/lib/bubui/admin", () => ({ adminTokenOk: h.admin }));
vi.mock("@/lib/db/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/bubui/activity", async (orig) => ({
  ...(await orig<typeof import("@/lib/bubui/activity")>()),
  loadCustomerActivity: h.load,
  loadCustomerActivitySummary: h.summary
}));

import { GET } from "@/app/api/bubui/admin/customers/[id]/activity/route";

const call = (qs = "", id = "c1") =>
  GET(new Request(`https://hub.negociovivo.app/api/bubui/admin/customers/${id}/activity${qs}`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  h.admin.mockResolvedValue(true);
  h.load.mockResolvedValue({ items: [], nextBefore: null });
  h.summary.mockResolvedValue({ scans: 0 });
  h.prisma.bubuiCustomer.findUnique.mockResolvedValue({ id: "c1", plan: "free", planExpiresAt: null, referredById: null, firstBusinessId: null });
});

it("solo lo ve un admin del Hub", async () => {
  h.admin.mockResolvedValue(false);
  expect((await call()).status).toBe(401);
  expect(h.load).not.toHaveBeenCalled();
});

it("filtra por tipos válidos e ignora los desconocidos", async () => {
  await call("?kinds=scan,share,inventado&limit=20");
  expect(h.load).toHaveBeenCalledWith("c1", { before: null, limit: 20, kinds: ["scan", "share"] });
});

it("la primera página trae la ficha y los totales; las siguientes solo eventos", async () => {
  const first = await (await call()).json();
  expect(first).toMatchObject({ customer: { id: "c1", plusActive: false }, summary: { scans: 0 }, items: [] });

  const next = await (await call("?before=2026-10-01T10:00:00.000Z")).json();
  expect(next).toEqual({ items: [], nextBefore: null });
  expect(h.summary).toHaveBeenCalledTimes(1);
});

it("rechaza un cursor de fecha inválido y un usuario inexistente", async () => {
  expect((await call("?before=ayer")).status).toBe(400);
  h.load.mockResolvedValue(null);
  expect((await call()).status).toBe(404);
});
