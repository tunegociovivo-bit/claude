import { describe, expect, it } from "vitest";
import { identifyMetaBillingAccount, isTrustedMetaBillingSender } from "../meta-billing-match";

describe("identifyMetaBillingAccount", () => {
  const accountIds = ["290451863303865", "2074249599540370"];

  it("identifies an account when Meta only prints the account ID inside the PDF", () => {
    expect(
      identifyMetaBillingAccount({
        messageText: "Tu recibo de Meta está adjunto.",
        pdfText: "RECIBO DE PAGO\nIdentificador de la cuenta publicitaria: 290 451 863 303 865",
        accountIds,
      }),
    ).toBe("290451863303865");
  });

  it("keeps the match unambiguous when the message and PDF contain the same account", () => {
    expect(
      identifyMetaBillingAccount({
        messageText: "Cuenta publicitaria 2074249599540370",
        pdfText: "Account ID: 207-424-959-954-0370",
        accountIds,
      }),
    ).toBe("2074249599540370");
  });

  it("rejects a document that mentions more than one configured account", () => {
    expect(
      identifyMetaBillingAccount({
        messageText: "Resumen de varias cuentas",
        pdfText: "290451863303865 y 2074249599540370",
        accountIds,
      }),
    ).toBeNull();
  });

  it("does not build an account ID by joining unrelated numeric fields", () => {
    expect(
      identifyMetaBillingAccount({
        messageText: "Referencia 2904-5186",
        pdfText: "Importe 3.303,86; referencia 5",
        accountIds: ["290451863303865"],
      }),
    ).toBeNull();
  });

  it("only accepts billing messages from Meta-controlled domains", () => {
    expect(isTrustedMetaBillingSender(["receipt@facebookmail.com"])).toBe(true);
    expect(isTrustedMetaBillingSender(["billing@support.meta.com"])).toBe(true);
    expect(isTrustedMetaBillingSender(["fake-facebookmail.com@attacker.example"])).toBe(false);
  });
});
