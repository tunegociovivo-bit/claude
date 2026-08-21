import { describe, expect, it } from "vitest";
import { WHATSAPP_PACKAGES, whatsappChatUrl } from "../whatsapp-target";

describe("selector de WhatsApp", () => {
  it("distingue WhatsApp normal y Business por paquete Android", () => {
    expect(WHATSAPP_PACKAGES.consumer).toBe("com.whatsapp");
    expect(WHATSAPP_PACKAGES.business).toBe("com.whatsapp.w4b");
  });

  it("normaliza teléfono y conserva el mensaje", () => {
    expect(whatsappChatUrl("+34 600 12 34 56", "Quiero aceptar el reto"))
      .toBe("https://wa.me/34600123456?text=Quiero%20aceptar%20el%20reto");
  });
});
