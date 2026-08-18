import { describe, it, expect } from "vitest";
import { contactHash, normalizeContact, canSend, renderTemplate, checkCompliance, defaultTemplate } from "../review-acquisition";

describe("normalizeContact + hash", () => {
  it("email/teléfono válidos; hash estable", () => {
    expect(normalizeContact({ email: "A@B.com" })).toEqual({ kind: "email", value: "a@b.com" });
    expect(normalizeContact({ phone: "+34 952 79 66 58" })).toEqual({ kind: "phone", value: "34952796658" });
    expect(normalizeContact({ phone: "123" })).toBeNull();
    expect(contactHash("a@b.com")).toBe(contactHash("A@B.COM"));
  });
});

describe("canSend — consentimiento, supresión y rate limit obligatorios", () => {
  it("sin consentimiento → bloqueado", () => {
    expect(canSend({ consent: false, suppressed: false })).toMatchObject({ ok: false, reason: "sin_consentimiento" });
  });
  it("suprimido → bloqueado aunque haya consentimiento", () => {
    expect(canSend({ consent: true, suppressed: true })).toMatchObject({ ok: false, reason: "suprimido" });
  });
  it("rate limit: no reenvía dentro de la ventana", () => {
    const now = new Date("2026-08-17T12:00:00Z");
    expect(canSend({ consent: true, suppressed: false, lastSentAt: "2026-08-17T10:00:00Z", sentCount: 1 }, { minHoursBetween: 72, now })).toMatchObject({ ok: false, reason: "rate_limit" });
  });
  it("tope de reenvíos", () => {
    expect(canSend({ consent: true, suppressed: false, sentCount: 2 }, { maxSends: 2 })).toMatchObject({ ok: false, reason: "limite_reenvios" });
  });
  it("ok con consentimiento, sin supresión ni límites", () => {
    expect(canSend({ consent: true, suppressed: false }).ok).toBe(true);
  });
});

describe("checkCompliance — sin incentivos ni review gating", () => {
  it("detecta incentivos", () => {
    expect(checkCompliance("Deja una reseña y te damos un descuento").ok).toBe(false);
    expect(checkCompliance("Reseña y entra en el sorteo").ok).toBe(false);
  });
  it("detecta review gating", () => {
    expect(checkCompliance("Si estás contento, deja reseña; si no, escríbenos").ok).toBe(false);
  });
  it("plantilla por defecto es conforme", () => {
    expect(checkCompliance(defaultTemplate()).ok).toBe(true);
  });
});

describe("renderTemplate", () => {
  it("sustituye variables", () => {
    const out = renderTemplate("Hola {nombre}, reseña {negocio}: {enlace} · baja {optout}", { nombre: "Ana", negocio: "Café", enlace: "u", optout: "o" });
    expect(out).toBe("Hola Ana, reseña Café: u · baja o");
  });
});
