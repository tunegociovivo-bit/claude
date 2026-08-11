/**
 * Regresión FASE 1 · Punto 2 — auth Bubui fail-closed con transición.
 * Prisma mockeado: probamos la semántica de los 3 modos y la validación de token.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { prisma } = vi.hoisted(() => ({
  prisma: {
    bubuiCustomer: { findUnique: vi.fn(), update: vi.fn() },
    bubuiBusiness: { findUnique: vi.fn() }
  }
}));
vi.mock("@/lib/db/prisma", () => ({ prisma }));

import { customerAuthOk } from "../customer-auth";
import { businessTokenAllows } from "../auth";
import { customerAuthMode, businessAuthMode, decideNoToken } from "../auth-mode";

const ORIG = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.BUBUI_REQUIRE_CUSTOMER_TOKEN;
  delete process.env.BUBUI_REQUIRE_BUSINESS_TOKEN;
  delete process.env.BUBUI_CUSTOMER_AUTH_MODE;
  delete process.env.BUBUI_BUSINESS_AUTH_MODE;
});
afterEach(() => {
  process.env = { ...ORIG };
});

function req(auth?: string): Request {
  return new Request("https://bubui.app/api/bubui/customer/c1", {
    headers: auth ? { authorization: auth } : {}
  });
}

describe("auth-mode helpers", () => {
  it("default = lazy; flags legacy = strict; env explícita gana", () => {
    expect(customerAuthMode({} as any)).toBe("lazy");
    expect(customerAuthMode({ BUBUI_REQUIRE_CUSTOMER_TOKEN: "true" } as any)).toBe("strict");
    expect(customerAuthMode({ BUBUI_CUSTOMER_AUTH_MODE: "shadow" } as any)).toBe("shadow");
    expect(businessAuthMode({ BUBUI_BUSINESS_AUTH_MODE: "strict" } as any)).toBe("strict");
  });
  it("decideNoToken", () => {
    expect(decideNoToken("strict")).toEqual({ allow: false, log: false });
    expect(decideNoToken("shadow")).toEqual({ allow: true, log: true });
    expect(decideNoToken("lazy")).toEqual({ allow: true, log: false });
  });
});

describe("customerAuthOk — token presentado (SIEMPRE estricto con el token)", () => {
  it("token válido del propio cliente → true", async () => {
    prisma.bubuiCustomer.findUnique.mockResolvedValue({ apiToken: "sekret123" });
    expect(await customerAuthOk(req("Bearer c1:sekret123"), "c1")).toBe(true);
  });
  it("token de OTRO cliente → false", async () => {
    expect(await customerAuthOk(req("Bearer other:sekret123"), "c1")).toBe(false);
  });
  it("token incorrecto → false", async () => {
    prisma.bubuiCustomer.findUnique.mockResolvedValue({ apiToken: "sekret123" });
    expect(await customerAuthOk(req("Bearer c1:WRONG"), "c1")).toBe(false);
  });
});

describe("customerAuthOk — SIN token, por modo", () => {
  it("lazy (default) → true", async () => {
    expect(await customerAuthOk(req(), "c1")).toBe(true);
  });
  it("shadow → true (permite y registra)", async () => {
    process.env.BUBUI_CUSTOMER_AUTH_MODE = "shadow";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await customerAuthOk(req(), "c1")).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
  it("strict → false (fail-closed)", async () => {
    process.env.BUBUI_CUSTOMER_AUTH_MODE = "strict";
    expect(await customerAuthOk(req(), "c1")).toBe(false);
  });
  it("flag legacy BUBUI_REQUIRE_CUSTOMER_TOKEN=true → false", async () => {
    process.env.BUBUI_REQUIRE_CUSTOMER_TOKEN = "true";
    expect(await customerAuthOk(req(), "c1")).toBe(false);
  });
});

describe("businessTokenAllows", () => {
  it("negocio con apiToken → exige secreto correcto", async () => {
    prisma.bubuiBusiness.findUnique.mockResolvedValue({ apiToken: "biz-secret" });
    expect(await businessTokenAllows("Bearer b1:biz-secret", "b1")).toBe(true);
    prisma.bubuiBusiness.findUnique.mockResolvedValue({ apiToken: "biz-secret" });
    expect(await businessTokenAllows("Bearer b1:WRONG", "b1")).toBe(false);
  });
  it("negocio SIN apiToken → lazy permite, strict bloquea", async () => {
    prisma.bubuiBusiness.findUnique.mockResolvedValue({ apiToken: null });
    expect(await businessTokenAllows("Bearer b1:whatever", "b1")).toBe(true);

    process.env.BUBUI_BUSINESS_AUTH_MODE = "strict";
    prisma.bubuiBusiness.findUnique.mockResolvedValue({ apiToken: null });
    expect(await businessTokenAllows("Bearer b1:whatever", "b1")).toBe(false);
  });
  it("formato inválido o negocio inexistente → false", async () => {
    expect(await businessTokenAllows("garbage", "b1")).toBe(false);
    prisma.bubuiBusiness.findUnique.mockResolvedValue(null);
    expect(await businessTokenAllows("Bearer b1:x", "b1")).toBe(false);
  });
});
