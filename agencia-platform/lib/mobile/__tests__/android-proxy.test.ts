import { describe, expect, it } from "vitest";
import {
  formatAndroidProxy,
  normalizeAndroidProxy,
  parseAndroidProxy
} from "../android-proxy";

describe("android proxy", () => {
  it("normaliza un host y un puerto seguros", () => {
    expect(normalizeAndroidProxy(" GW.Example.COM ", "10002")).toEqual({
      host: "gw.example.com",
      port: 10002
    });
  });

  it("acepta IPv4 válida y rechaza una inválida", () => {
    expect(formatAndroidProxy(normalizeAndroidProxy("192.168.1.20", 8080))).toBe("192.168.1.20:8080");
    expect(() => normalizeAndroidProxy("999.168.1.20", 8080)).toThrow(/host|IP/i);
  });

  it("rechaza credenciales, protocolos y puertos fuera de rango", () => {
    expect(() => normalizeAndroidProxy("http://user:pass@example.com", 8080)).toThrow(/sin http/i);
    expect(() => normalizeAndroidProxy("user@example.com", 8080)).toThrow(/sin http/i);
    expect(() => normalizeAndroidProxy("example.com", 70000)).toThrow(/puerto/i);
  });

  it("interpreta la configuración devuelta por Android", () => {
    expect(parseAndroidProxy("proxy.example.com:3128")).toEqual({ host: "proxy.example.com", port: 3128 });
    expect(parseAndroidProxy(":0")).toBeNull();
    expect(parseAndroidProxy("null")).toBeNull();
  });
});
