/**
 * Configuración de email robusta: reconoce la clave por ENV o por la BÓVEDA del workspace.
 * Regresión del incidente "falta RESEND_API_KEY" cuando la clave está en la bóveda y no en env.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { prisma, decryptMock } = vi.hoisted(() => ({
  prisma: { workspace: { findUnique: vi.fn() } },
  decryptMock: vi.fn()
}));
vi.mock("@/lib/db/prisma", () => ({ prisma }));
vi.mock("@/lib/ai/crypto", () => ({ decryptSecret: decryptMock }));

import { emailConfigStatus, isEmailConfigured } from "../email";

const ORIG = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.RESEND_API_KEY;
  prisma.workspace.findUnique.mockResolvedValue({ settings: {} });
});
afterEach(() => { process.env = { ...ORIG }; });

describe("emailConfigStatus", () => {
  it("ENV var presente → configured, source=env (sin tocar la bóveda)", async () => {
    process.env.RESEND_API_KEY = "re_test";
    const s = await emailConfigStatus("w1");
    expect(s).toEqual({ configured: true, source: "env" });
    expect(prisma.workspace.findUnique).not.toHaveBeenCalled();
  });
  it("sin ENV pero con clave en la BÓVEDA → configured, source=vault (arregla el incidente)", async () => {
    prisma.workspace.findUnique.mockResolvedValue({ settings: { integrations: { resend: { apiKeyEnc: "enc" } } } });
    decryptMock.mockReturnValue("re_vault_key");
    const s = await emailConfigStatus("w1");
    expect(s).toEqual({ configured: true, source: "vault" });
  });
  it("sin ENV y sin bóveda → not configured, source=none", async () => {
    const s = await emailConfigStatus("w1");
    expect(s).toEqual({ configured: false, source: "none" });
  });
  it("sin workspaceId y sin ENV → none (no revienta)", async () => {
    expect(await isEmailConfigured()).toBe(false);
  });
  it("bóveda inaccesible (throw) → none, no propaga", async () => {
    prisma.workspace.findUnique.mockRejectedValue(new Error("db"));
    expect(await isEmailConfigured("w1")).toBe(false);
  });
  it("nunca expone la clave en el resultado", async () => {
    process.env.RESEND_API_KEY = "re_secret_value";
    const s = await emailConfigStatus("w1");
    expect(JSON.stringify(s)).not.toContain("re_secret_value");
  });
});
