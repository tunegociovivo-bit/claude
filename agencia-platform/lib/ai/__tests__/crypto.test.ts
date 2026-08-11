/**
 * Regresión FASE 1 · Punto 6 — clave de cifrado dedicada y sin fallback público.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encryptSecret, decryptSecret } from "../crypto";
import { checkSecretsConfig } from "@/lib/security/secrets-config";

const ORIG = { ...process.env };
beforeEach(() => {
  delete process.env.SECRETS_ENC_KEY;
  delete process.env.NEXTAUTH_SECRET;
});
afterEach(() => {
  process.env = { ...ORIG };
});

describe("crypto — round-trip por cada clave", () => {
  it("cifra/descifra con solo NEXTAUTH_SECRET (compatibilidad actual)", () => {
    process.env.NEXTAUTH_SECRET = "a".repeat(40);
    const enc = encryptSecret("holded-key-123");
    expect(decryptSecret(enc)).toBe("holded-key-123");
  });

  it("cifra/descifra con clave dedicada SECRETS_ENC_KEY", () => {
    process.env.SECRETS_ENC_KEY = "b".repeat(40);
    const enc = encryptSecret("stripe-key-456");
    expect(decryptSecret(enc)).toBe("stripe-key-456");
  });
});

describe("crypto — rotación sin pérdida de datos", () => {
  it("dato cifrado con NEXTAUTH_SECRET sigue descifrándose tras introducir un SECRETS_ENC_KEY NUEVO", () => {
    process.env.NEXTAUTH_SECRET = "old-nextauth-secret-xxxxxxxxxxxx";
    const legacy = encryptSecret("token-antiguo");

    // Se introduce una clave dedicada NUEVA (distinta): los NUEVOS cifrados la usan…
    process.env.SECRETS_ENC_KEY = "brand-new-dedicated-key-yyyyyyyy";
    const fresh = encryptSecret("token-nuevo");

    // …y el dato antiguo se sigue leyendo (descifrado tolerante prueba ambas claves).
    expect(decryptSecret(legacy)).toBe("token-antiguo");
    expect(decryptSecret(fresh)).toBe("token-nuevo");
  });
});

describe("crypto — sin fallback público", () => {
  it("encryptSecret LANZA si no hay ninguna clave configurada", () => {
    expect(() => encryptSecret("x")).toThrow(/no configurado|SECRETS_ENC_KEY/i);
  });

  it("payload corrupto → null, no lanza", () => {
    process.env.NEXTAUTH_SECRET = "c".repeat(40);
    expect(decryptSecret("basura")).toBeNull();
    expect(decryptSecret("a.b.c")).toBeNull();
  });
});

describe("checkSecretsConfig", () => {
  it("ERROR si no hay ninguna clave", () => {
    const s = checkSecretsConfig({} as any);
    expect(s.ok).toBe(false);
    expect(s.errors.length).toBeGreaterThan(0);
  });

  it("AVISO (no error) si el vault depende de NEXTAUTH_SECRET", () => {
    const s = checkSecretsConfig({ NEXTAUTH_SECRET: "z".repeat(40) } as any);
    expect(s.ok).toBe(true);
    expect(s.vaultKeyShared).toBe(true);
    expect(s.usingDedicatedKey).toBe(false);
    expect(s.warnings.some((w) => /SECRETS_ENC_KEY/.test(w))).toBe(true);
  });

  it("OK y desacoplado con clave dedicada distinta", () => {
    const s = checkSecretsConfig({
      SECRETS_ENC_KEY: "k".repeat(40),
      NEXTAUTH_SECRET: "n".repeat(40)
    } as any);
    expect(s.ok).toBe(true);
    expect(s.usingDedicatedKey).toBe(true);
    expect(s.vaultKeyShared).toBe(false);
  });
});
