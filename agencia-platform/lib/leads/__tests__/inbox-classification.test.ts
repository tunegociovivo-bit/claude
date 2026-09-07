import { describe, expect, it } from "vitest";
import { applyDeterministicClassificationGuard, classifyHeuristic } from "../inbox";

describe("lead inbox classification safeguards", () => {
  it.each([
    "Hola! Tengo agenda siempre llena no me interesa posicionarme gracias!",
    "En principio no me interesa. Gracias",
    "Gracias, pero ahora mismo no estamos interesados",
    "No necesito servicios de marketing"
  ])("overrides a false interested result for an explicit rejection: %s", (message) => {
    expect(applyDeterministicClassificationGuard(message, {
      classification: "interested",
      confidence: 0.7,
      reason: "IA"
    }).classification).toBe("positive_no");
  });

  it("recognises a business-hours acknowledgement as an automatic reply", () => {
    const message = "Gracias por contactarnos. Nuestro horario de atención es de 9.00h a 21.00h. Lo antes posible nos pondremos en contacto con usted.";
    expect(applyDeterministicClassificationGuard(message, {
      classification: "interested",
      confidence: 0.7,
      reason: "IA"
    }).classification).toBe("auto_reply");
  });

  it("keeps an unambiguous positive reply as interested", () => {
    const message = "Sí, me interesa. Llámame mañana y me cuentas";
    expect(applyDeterministicClassificationGuard(message, {
      classification: "interested",
      confidence: 0.92,
      reason: "Interés explícito"
    }).classification).toBe("interested");
  });

  it("applies the same rejection protection to the no-AI fallback", () => {
    expect(classifyHeuristic("Hola, pero no me interesa posicionarme, gracias").classification).toBe("positive_no");
  });

  it.each([
    "No me llames ahora; mañana a las 10 sí",
    "No necesito SEO, pero sí campañas de Meta",
    "No nos interesa Google, pero queremos hablar de redes"
  ])("does not discard positive contrast or a temporary objection: %s", (message) => {
    expect(applyDeterministicClassificationGuard(message, {
      classification: "interested",
      confidence: 0.9,
      reason: "Interés en una alternativa o momento concreto"
    }).classification).toBe("interested");
  });

  it("prioritises a clear automatic acknowledgement over rejection vocabulary", () => {
    const message = "No necesitamos que responda. Gracias por contactarnos. Nuestro horario de atención es de 9 a 21h y nos pondremos en contacto.";
    expect(applyDeterministicClassificationGuard(message, {
      classification: "interested",
      confidence: 0.7,
      reason: "IA"
    }).classification).toBe("auto_reply");
  });

  it.each([
    "No me contactéis más, pero sí eliminad mis datos",
    "No me escribas nunca, pero sí confirma la baja"
  ])("never weakens a permanent opt-out because it contains 'pero sí': %s", (message) => {
    expect(applyDeterministicClassificationGuard(message, {
      classification: "interested",
      confidence: 0.9,
      reason: "IA"
    }).classification).toBe("opt_out");
  });
});
