/**
 * Regresión FASE 1 · Punto 1 — gate central de rol admin en withApi.
 *
 * Se mockean authenticate (para simular sesión de miembro/admin/api-key),
 * callerIsAdmin y el rate-limit; se comprueba la decisión del gate por modo,
 * por path (/api/v1/admin/*) y por la opción `admin:true`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { authenticateMock, callerIsAdminMock } = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  callerIsAdminMock: vi.fn()
}));

vi.mock("../auth", async (importActual) => {
  const actual = (await importActual()) as any;
  return { ...actual, authenticate: authenticateMock };
});
vi.mock("../permissions", () => ({ callerIsAdmin: callerIsAdminMock }));
vi.mock("../rate-limit", () => ({
  rateLimit: () => ({ ok: true, remaining: 100, resetAt: Date.now() + 60_000 })
}));

import { withApi } from "../handler";

const OK = async () => NextResponse.json({ ok: true });
const ORIG = { ...process.env };

function call(path: string, opts: any = {}) {
  const route = withApi(opts, OK);
  const req = new NextRequest(`https://hub.example${path}`, { method: "POST" });
  return route(req, { params: {} });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.HUB_ADMIN_ENFORCE;
  // Sesión de MIEMBRO por defecto (userId, sin apiKey, scope "*").
  authenticateMock.mockResolvedValue({ workspaceId: "w1", userId: "u1", scopes: new Set(["*"]) });
  callerIsAdminMock.mockResolvedValue(false);
});
afterEach(() => {
  process.env = { ...ORIG };
});

describe("gate central admin — por path /api/v1/admin/*", () => {
  it("modo enforce + miembro (no admin) → 403", async () => {
    process.env.HUB_ADMIN_ENFORCE = "enforce";
    const res = await call("/api/v1/admin/secrets");
    expect(res.status).toBe(403);
    expect(callerIsAdminMock).toHaveBeenCalled();
  });

  it("modo enforce + ADMIN → 200", async () => {
    process.env.HUB_ADMIN_ENFORCE = "enforce";
    callerIsAdminMock.mockResolvedValue(true);
    const res = await call("/api/v1/admin/secrets");
    expect(res.status).toBe(200);
  });

  it("modo log (default) + miembro → 200 (shadow, no bloquea) y avisa", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await call("/api/v1/admin/secrets");
    expect(res.status).toBe(200);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("modo off + miembro → 200 (gate desactivado, sin consultar rol)", async () => {
    process.env.HUB_ADMIN_ENFORCE = "off";
    const res = await call("/api/v1/admin/secrets");
    expect(res.status).toBe(200);
    expect(callerIsAdminMock).not.toHaveBeenCalled();
  });
});

describe("gate central admin — rutas NO admin", () => {
  it("ruta normal + miembro + enforce → 200 (gate no aplica)", async () => {
    process.env.HUB_ADMIN_ENFORCE = "enforce";
    const res = await call("/api/v1/leads");
    expect(res.status).toBe(200);
    expect(callerIsAdminMock).not.toHaveBeenCalled();
  });

  it("ruta normal con admin:true + miembro + enforce → 403", async () => {
    process.env.HUB_ADMIN_ENFORCE = "enforce";
    const res = await call("/api/v1/api-keys", { admin: true });
    expect(res.status).toBe(403);
  });
});

describe("gate central admin — API keys pasan", () => {
  it("api key (callerIsAdmin=true) sobre ruta admin + enforce → 200", async () => {
    process.env.HUB_ADMIN_ENFORCE = "enforce";
    authenticateMock.mockResolvedValue({ workspaceId: "w1", apiKeyId: "k1", scopes: new Set(["*"]) });
    callerIsAdminMock.mockResolvedValue(true); // callerIsAdmin devuelve true para api keys
    const res = await call("/api/v1/admin/secrets");
    expect(res.status).toBe(200);
  });
});
