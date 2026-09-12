import { describe, expect, it } from "vitest";
import {
  normalizedPhone,
  sanitizeMobileSessionName,
  sharedPhonesFromLeads
} from "../shared-phones";

describe("shared phone inventory", () => {
  it("expone el inventario sin revelar las URLs de proxy", () => {
    const items = sharedPhonesFromLeads({
      principalPhone: "+34 600 000 001",
      wahaProxy: "http://secret@example.com:8080",
      channels: [{
        name: "movil-2",
        label: "Móvil 2",
        phone: "+34600000002",
        proxy: "http://other-secret@example.com:8081",
        deviceSerial: "USB-2"
      }]
    });

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ principal: true, proxyConfigured: true });
    expect(items[1]).toMatchObject({ key: "movil-2", deviceSerial: "USB-2", proxyConfigured: true });
    expect(JSON.stringify(items)).not.toContain("secret@");
  });

  it("sanea nombres de sesión y normaliza números", () => {
    expect(sanitizeMobileSessionName(" Sonia Málaga 13 ")).toBe("Sonia-Malaga-13");
    expect(normalizedPhone("+34 600-000-001")).toBe("34600000001");
  });
});
