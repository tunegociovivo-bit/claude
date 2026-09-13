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
    expect(items[0].androidProxy).toEqual({
      host: "example.com",
      port: 8080,
      requiresIpAuthorization: true,
      source: "global"
    });
    expect(items[1]).toMatchObject({ key: "movil-2", deviceSerial: "USB-2", proxyConfigured: true });
    expect(items[1].androidProxy).toEqual({
      host: "example.com",
      port: 8081,
      requiresIpAuthorization: true,
      source: "number"
    });
    expect(JSON.stringify(items)).not.toContain("secret@");
    expect(JSON.stringify(items)).not.toContain("other-secret");
  });

  it("hereda en Android el proxy global cuando el número no tiene uno propio", () => {
    const items = sharedPhonesFromLeads({
      wahaProxy: "http://proxy.example.test:3128",
      channels: [{ name: "xiaomi", phone: "+34600000003", deviceSerial: "USB-X" }]
    });

    expect(items[1].androidProxy).toEqual({
      host: "proxy.example.test",
      port: 3128,
      requiresIpAuthorization: false,
      source: "global"
    });
  });

  it("no propone a Android un proxy SOCKS incompatible", () => {
    const items = sharedPhonesFromLeads({
      channels: [{ name: "xiaomi", proxy: "socks5://user:pass@proxy.example.test:1080" }]
    });

    expect(items[1]).toMatchObject({ proxyConfigured: true, androidProxy: null });
    expect(JSON.stringify(items)).not.toContain("user");
    expect(JSON.stringify(items)).not.toContain("pass");
  });

  it("sanea nombres de sesión y normaliza números", () => {
    expect(sanitizeMobileSessionName(" Sonia Málaga 13 ")).toBe("Sonia-Malaga-13");
    expect(normalizedPhone("+34 600-000-001")).toBe("34600000001");
  });
});
