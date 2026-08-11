/**
 * Regresión FASE 1 · Punto 7 — cron auth: comparación en tiempo constante,
 * cabecera-solo por defecto, y secreto en URL solo con flag de transición.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cronAuthOk } from "../cron-auth";

const ORIG = { ...process.env };
const PATH = "https://hub.example/api/cron/test-noncatalog"; // fuera del CRON_CATALOG → sin efectos BD

beforeEach(() => {
  delete process.env.INTERNAL_CRON_TOKEN;
  delete process.env.CRON_SECRET;
  delete process.env.CRON_ALLOW_QUERY_SECRET;
});
afterEach(() => {
  process.env = { ...ORIG };
});

function reqWith(headers: Record<string, string>, url = PATH): Request {
  return new Request(url, { headers });
}

describe("cronAuthOk", () => {
  it("false si no hay ningún token configurado", () => {
    expect(cronAuthOk(reqWith({ authorization: "Bearer whatever" }))).toBe(false);
  });

  it("acepta Authorization: Bearer <INTERNAL_CRON_TOKEN>", () => {
    process.env.INTERNAL_CRON_TOKEN = "tok-internal-123456";
    expect(cronAuthOk(reqWith({ authorization: "Bearer tok-internal-123456" }))).toBe(true);
  });

  it("acepta x-cron-secret y también el CRON_SECRET legacy", () => {
    process.env.CRON_SECRET = "legacy-secret-abcdef";
    expect(cronAuthOk(reqWith({ "x-cron-secret": "legacy-secret-abcdef" }))).toBe(true);
  });

  it("rechaza token incorrecto", () => {
    process.env.INTERNAL_CRON_TOKEN = "tok-internal-123456";
    expect(cronAuthOk(reqWith({ authorization: "Bearer nope" }))).toBe(false);
    expect(cronAuthOk(reqWith({ "x-cron-secret": "nope" }))).toBe(false);
  });

  it("por defecto IGNORA el secreto en la URL (?secret=)", () => {
    process.env.INTERNAL_CRON_TOKEN = "tok-internal-123456";
    const url = `${PATH}?secret=tok-internal-123456`;
    expect(cronAuthOk(reqWith({}, url))).toBe(false);
  });

  it("acepta ?secret= SOLO con CRON_ALLOW_QUERY_SECRET=true (transición)", () => {
    process.env.INTERNAL_CRON_TOKEN = "tok-internal-123456";
    process.env.CRON_ALLOW_QUERY_SECRET = "true";
    const url = `${PATH}?secret=tok-internal-123456`;
    expect(cronAuthOk(reqWith({}, url))).toBe(true);
  });
});
