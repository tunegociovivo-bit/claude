import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { authenticateMock, platformAccessMock, prisma } = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  platformAccessMock: vi.fn(),
  prisma: {
    workspace: { findUnique: vi.fn(), update: vi.fn() },
    membership: { findFirst: vi.fn() }
  }
}));

vi.mock("@/lib/db/prisma", () => ({ prisma }));
vi.mock("@/lib/platforms-server", () => ({ userCanAccessPlatform: platformAccessMock }));
vi.mock("@/lib/api/auth", async (importActual) => {
  const actual = (await importActual()) as any;
  return { ...actual, authenticate: authenticateMock };
});
vi.mock("@/lib/api/rate-limit", () => ({
  rateLimit: () => ({ ok: true, remaining: 100, resetAt: Date.now() + 60_000 })
}));

import { GET, PATCH, POST } from "../route";

const initialSettings = {
  untouched: { enabled: true },
  leads: {
    wahaSession: "default",
    principalPhone: "+34 600 000 001",
    principalDeviceSerial: "USB-1",
    wahaProxy: "http://principal-secret@example.test:8080",
    channels: [{
      name: "sonia",
      label: "Sonia",
      phone: "+34 600 000 002",
      deviceSerial: "USB-2",
      dailyLimit: 37,
      proxy: "http://channel-secret@example.test:8081",
      active: true
    }]
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  authenticateMock.mockResolvedValue({ workspaceId: "w1", userId: "u1", scopes: new Set(["*"]) });
  platformAccessMock.mockResolvedValue(true);
  prisma.workspace.findUnique.mockResolvedValue({ settings: structuredClone(initialSettings) });
  prisma.membership.findFirst.mockResolvedValue({ role: "ADMIN" });
  prisma.workspace.update.mockResolvedValue({});
});

function request(method: "GET" | "POST" | "PATCH", body?: unknown) {
  return new NextRequest("https://hub.example/api/v1/mobile/devices", {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  });
}

describe("inventario compartido de F - Móviles", () => {
  it("devuelve teléfonos y asociación USB sin revelar los proxies", async () => {
    const response = await GET(request("GET"), { params: {} });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.canManage).toBe(true);
    expect(body.items).toHaveLength(2);
    expect(body.items[1]).toMatchObject({ key: "sonia", deviceSerial: "USB-2", proxyConfigured: true });
    expect(JSON.stringify(body)).not.toContain("principal-secret");
    expect(JSON.stringify(body)).not.toContain("channel-secret");
  });

  it("añade un número en la misma configuración de Leads sin perder sus campos", async () => {
    const response = await POST(request("POST", {
      sessionName: "movil-3",
      label: "Móvil 3",
      phone: "+34 600 000 003",
      deviceSerial: "USB-3"
    }), { params: {} });
    expect(response.status).toBe(201);
    const settings = prisma.workspace.update.mock.calls[0][0].data.settings;
    expect(settings.untouched).toEqual({ enabled: true });
    expect(settings.leads.channels[0]).toMatchObject({ dailyLimit: 37, proxy: "http://channel-secret@example.test:8081" });
    expect(settings.leads.channels[1]).toMatchObject({ name: "movil-3", phone: "+34 600 000 003", deviceSerial: "USB-3" });
  });

  it("impide duplicar el número principal", async () => {
    const response = await POST(request("POST", {
      sessionName: "duplicado",
      phone: "+34600000001"
    }), { params: {} });
    expect(response.status).toBe(409);
    expect(prisma.workspace.update).not.toHaveBeenCalled();
  });

  it("mueve un Android a un solo número y conserva el proxy existente", async () => {
    const response = await PATCH(request("PATCH", {
      key: "sonia",
      deviceSerial: "USB-1"
    }), { params: {} });
    expect(response.status).toBe(200);
    const settings = prisma.workspace.update.mock.calls[0][0].data.settings;
    expect(settings.leads.principalDeviceSerial).toBeNull();
    expect(settings.leads.channels[0]).toMatchObject({
      deviceSerial: "USB-1",
      proxy: "http://channel-secret@example.test:8081",
      dailyLimit: 37
    });
  });

  it("deja el inventario en solo lectura para miembros no administradores", async () => {
    prisma.membership.findFirst.mockResolvedValue({ role: "MEMBER" });
    const getResponse = await GET(request("GET"), { params: {} });
    expect(getResponse.status).toBe(200);
    expect((await getResponse.json()).canManage).toBe(false);

    const postResponse = await POST(request("POST", {
      sessionName: "movil-3",
      phone: "+34600000003"
    }), { params: {} });
    expect(postResponse.status).toBe(403);
    expect(prisma.workspace.update).not.toHaveBeenCalled();
  });
});
