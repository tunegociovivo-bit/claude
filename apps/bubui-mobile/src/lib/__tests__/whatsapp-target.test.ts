import { describe, expect, it } from "vitest";
import { WHATSAPP_PACKAGES, canRemindChallengeFriend, whatsappAppUrl, whatsappChatUrl } from "../whatsapp-target";

describe("selector de WhatsApp", () => {
  it("distingue WhatsApp normal y Business por paquete Android", () => {
    expect(WHATSAPP_PACKAGES.consumer).toBe("com.whatsapp");
    expect(WHATSAPP_PACKAGES.business).toBe("com.whatsapp.w4b");
  });

  it("normaliza teléfono y conserva el mensaje", () => {
    expect(whatsappChatUrl("+34 600 12 34 56", "Quiero aceptar el reto"))
      .toBe("https://wa.me/34600123456?text=Quiero%20aceptar%20el%20reto");
  });
  it("solo permite recordar a quien se registró pero todavía no usó el cupón", () => {
    expect(canRemindChallengeFriend({ registered: true, redeemed: false })).toBe(true);
    expect(canRemindChallengeFriend({ registered: true, redeemed: true })).toBe(false);
    expect(canRemindChallengeFriend(undefined)).toBe(false);
  });
  it("crea un URI nativo que evita el salto web de wa.me", () => {
    expect(whatsappAppUrl("+34 600 12 34 56", "Acepto el reto"))
      .toBe("whatsapp://send?phone=34600123456&text=Acepto%20el%20reto");
  });
});
