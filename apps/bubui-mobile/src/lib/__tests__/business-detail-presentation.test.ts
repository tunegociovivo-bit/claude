import { describe, expect, it } from "vitest";
import {
  businessContactLinks,
  businessDiscountCopy,
  couponExpiryCopy,
  resolveBusinessHero,
} from "../business-detail-presentation";

describe("business detail presentation", () => {
  it("uses the cover as the hero and keeps the logo separate", () => {
    expect(resolveBusinessHero({ coverImageUrl: "https://cdn.test/cover.jpg", logoUrl: "https://cdn.test/logo.png" })).toEqual({
      heroUrl: "https://cdn.test/cover.jpg",
      logoUrl: "https://cdn.test/logo.png",
    });
  });

  it("shows a clear discount explanation even for a small discount", () => {
    expect(businessDiscountCopy(2)).toEqual({
      badge: "-2%",
      title: "Ahorra un 2% en este negocio",
      detail: "Presenta y canjea tu cupón Bubui para obtener el descuento.",
    });
  });

  it("always expresses coupon expiry in rounded-up days", () => {
    expect(couponExpiryCopy(350)).toBe("Tu cupón caduca en 15 días");
    expect(couponExpiryCopy(1)).toBe("Tu cupón caduca en 1 día");
  });

  it("returns every configured public contact without empty entries", () => {
    expect(businessContactLinks({
      websiteUrl: "https://negociovivo.app",
      instagramUrl: "https://instagram.com/negociovivo",
      facebookUrl: "https://facebook.com/negociovivo",
      tiktokUrl: null,
      whatsapp: "+34600111222",
    })).toEqual([
      { kind: "website", label: "Web", url: "https://negociovivo.app" },
      { kind: "instagram", label: "Instagram", url: "https://instagram.com/negociovivo" },
      { kind: "facebook", label: "Facebook", url: "https://facebook.com/negociovivo" },
      { kind: "whatsapp", label: "WhatsApp", url: "https://wa.me/34600111222" },
    ]);
  });
});
