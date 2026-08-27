import { describe, expect, it } from "vitest";
import { isTrustedOwnerPhone, normalizeTrustedPhone } from "../trusted-recipient";

describe("trusted owner phone", () => {
  it("acepta únicamente las variantes normalizadas del teléfono autorizado", () => {
    expect(isTrustedOwnerPhone("+34 680 167 881")).toBe(true);
    expect(isTrustedOwnerPhone("0034 680167881")).toBe(true);
    expect(isTrustedOwnerPhone("680167881")).toBe(true);
    expect(normalizeTrustedPhone("+34 680 167 881")).toBe("34680167881");
  });

  it("no autoaprueba teléfonos parecidos ni otros destinatarios", () => {
    expect(isTrustedOwnerPhone("+34 680 167 882")).toBe(false);
    expect(isTrustedOwnerPhone("68016788")).toBe(false);
    expect(isTrustedOwnerPhone("")).toBe(false);
  });
});
