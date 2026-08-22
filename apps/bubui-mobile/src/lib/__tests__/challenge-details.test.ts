import { describe, expect, it } from "vitest";
import { challengeActionCopy, challengePriceBreakdown, challengePriceCopy, formatEuro } from "../challenge-details";

describe("friend challenge details", () => {
  it("explica la accion local con direccion", () => {
    expect(challengeActionCopy({ mode: "local", businessName: "Roman Trainer", address: "Calle Sol 1" }))
      .toContain("Calle Sol 1");
  });

  it("genera mensaje de WhatsApp con el nombre del amigo", () => {
    const copy = challengeActionCopy({ mode: "online", businessName: "Roman Trainer", inviterName: "Ana", recipientName: "Luis", serviceTitle: "Entrenamiento personal", description: "Plan de tres meses", discountPct: 16, price: 250 });
    expect(copy).toContain("Ana");
    expect(copy).toContain("Luis");
    expect(copy).toContain("Roman Trainer");
    expect(copy).toContain("*16%*");
    expect(copy).toContain("250,00");
    expect(copy).toContain("40,00");
    expect(copy).toContain("210,00");
    expect(copy).toContain("Entrenamiento personal");
  });

  it("omite importes inexistentes sin empobrecer el mensaje", () => {
    const copy = challengeActionCopy({ mode: "online", businessName: "Negocio Vivo", discountPct: 15 });
    expect(copy).toContain("Negocio Vivo");
    expect(copy).toContain("*15%*");
    expect(copy).not.toContain("Precio original");
    expect(copy).not.toContain("undefined");
  });

  it("muestra precio, descuento y ahorro", () => {
    expect(challengePriceCopy(80, 15)).toEqual("80,00 € · ahorras 12,00 € · pagas 68,00 €");
  });

  it("calcula y formatea el precio final destacado", () => {
    expect(challengePriceBreakdown(250, 16)).toEqual({ original: 250, savings: 40, final: 210 });
    expect(formatEuro(210)).toBe("210,00 €");
  });
});
