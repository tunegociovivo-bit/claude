import { describe, expect, it } from "vitest";
import { normalizeBusinessPhone } from "../business-phone";

describe("normalizeBusinessPhone", () => {
  it("añade el prefijo español a un móvil local", () => expect(normalizeBusinessPhone("600 123 456")).toBe("+34600123456"));
  it("conserva un número internacional", () => expect(normalizeBusinessPhone("+44 7700 900123")).toBe("+447700900123"));
  it("rechaza valores incompletos", () => expect(normalizeBusinessPhone("12345")).toBeNull());
});
