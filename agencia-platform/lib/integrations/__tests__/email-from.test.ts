/**
 * Remitente de email: el dominio negociovivo.com está verificado en Resend, así que el From
 * por defecto y el FORZADO de leads deben ser info@negociovivo.com (evita el 403 testing-only
 * de onboarding@resend.dev). Se verifica el PAYLOAD a Resend con `fetch` mockeado — NO se
 * envía ningún correo real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendEmail, getFromAddress, DEFAULT_FROM, LEADS_FROM } from "../email";

const ORIG = { ...process.env };
let lastBody: any = null;

beforeEach(() => {
  lastBody = null;
  process.env.RESEND_API_KEY = "re_test_key";
  delete process.env.EMAIL_FROM;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: any) => {
    lastBody = JSON.parse(init.body);
    return { ok: true, json: async () => ({ id: "email-1" }) } as any;
  }));
});
afterEach(() => {
  process.env = { ...ORIG };
  vi.unstubAllGlobals();
});

describe("remitente por defecto verificado", () => {
  it("DEFAULT_FROM / LEADS_FROM usan info@negociovivo.com", () => {
    expect(DEFAULT_FROM).toContain("info@negociovivo.com");
    expect(LEADS_FROM).toContain("info@negociovivo.com");
    expect(DEFAULT_FROM).not.toContain("resend.dev");
  });
  it("getFromAddress() por defecto → info@negociovivo.com (ya no onboarding@resend.dev)", () => {
    expect(getFromAddress()).toBe(DEFAULT_FROM);
    expect(getFromAddress()).not.toContain("resend.dev");
  });
});

describe("payload a Resend (sin enviar de verdad — fetch mockeado)", () => {
  it("sin `from` → usa el default verificado info@negociovivo.com", async () => {
    await sendEmail({ to: "cliente@example.com", subject: "s", html: "<p>h</p>" });
    expect(lastBody.from).toBe("Negocio Vivo <info@negociovivo.com>");
  });
  it("leads con `from: LEADS_FROM` → SIEMPRE info@negociovivo.com", async () => {
    await sendEmail({ to: "lead@example.com", subject: "s", html: "<p>h</p>", from: LEADS_FROM });
    expect(lastBody.from).toBe("Negocio Vivo <info@negociovivo.com>");
    expect(lastBody.from).not.toContain("resend.dev");
  });
  it("`from` forzado gana incluso si EMAIL_FROM apunta a otro remitente", async () => {
    process.env.EMAIL_FROM = "Otro <otro@dominio.com>";
    await sendEmail({ to: "lead@example.com", subject: "s", html: "<p>h</p>", from: LEADS_FROM });
    expect(lastBody.from).toBe("Negocio Vivo <info@negociovivo.com>");
  });
  it("Reply-To se mantiene solo si se aporta", async () => {
    await sendEmail({ to: "lead@example.com", subject: "s", html: "<p>h</p>", from: LEADS_FROM, replyTo: "ventas@negociovivo.com" });
    expect(lastBody.reply_to).toBe("ventas@negociovivo.com");
    // sin replyTo no se incluye la clave
    lastBody = null;
    await sendEmail({ to: "x@example.com", subject: "s", html: "<p>h</p>" });
    expect("reply_to" in lastBody).toBe(false);
  });
});
