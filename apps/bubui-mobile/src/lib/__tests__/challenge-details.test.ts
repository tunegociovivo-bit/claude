import { describe, expect, it } from "vitest";
import { challengeActionCopy, challengePriceBreakdown, challengePriceCopy, formatEuro } from "../challenge-details";

describe("friend challenge details", () => {
  it("explica la accion local con direccion", () => {
    expect(challengeActionCopy({ mode: "local", businessName: "Roman Trainer", address: "Calle Sol 1" }))
      .toContain("Calle Sol 1");
  });

  it("genera mensaje de WhatsApp con el nombre del amigo", () => {
    const copy = challengeActionCopy({ mode: "online", businessName: "Roman Trainer", inviterName: "Ana" });
    expect(copy).toContain("Ana");
    expect(copy).toContain("Roman Trainer");
  });

  it("muestra precio, descuento y ahorro", () => {
    expect(challengePriceCopy(80, 15)).toEqual("80,00 € · ahorras 12,00 € · pagas 68,00 €");
  });

  it("calcula y formatea el precio final destacado", () => {
    expect(challengePriceBreakdown(250, 16)).toEqual({ original: 250, savings: 40, final: 210 });
    expect(formatEuro(210)).toBe("210,00 €");
  });
});
