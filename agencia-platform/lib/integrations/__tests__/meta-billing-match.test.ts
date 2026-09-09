import { describe, expect, it } from "vitest";
import { hasAuthenticatedMetaSender, identifyMetaBillingAccount, isScannableBillingMailbox, isTrustedMetaBillingSender } from "../meta-billing-match";

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

  it("requires a passing aligned authentication result", () => {
    const trusted = ["mail.negociovivo.com"];
    expect(hasAuthenticatedMetaSender("mail.negociovivo.com; dkim=pass header.i=@facebookmail.com; dmarc=pass header.from=facebookmail.com", trusted)).toBe(true);
    expect(hasAuthenticatedMetaSender("mail.negociovivo.com; spf=pass smtp.mailfrom=notice.meta.com", trusted)).toBe(true);
    expect(hasAuthenticatedMetaSender("mail.negociovivo.com; dkim=fail header.i=@facebookmail.com; dmarc=fail", trusted)).toBe(false);
    expect(hasAuthenticatedMetaSender("mail.negociovivo.com; dkim=pass header.i=@attacker.example", trusted)).toBe(false);
    expect(hasAuthenticatedMetaSender("attacker.example; dkim=pass header.i=@meta.com", trusted)).toBe(false);
    expect(hasAuthenticatedMetaSender("mail.negociovivo.com; dkim=pass header.i=@meta.com.attacker.example", trusted)).toBe(false);
  });

  it("scans client folders but excludes outgoing and discarded mail", () => {
    expect(isScannableBillingMailbox({ path: "INBOX.AUTOMATIC CHOICE" })).toBe(true);
    expect(isScannableBillingMailbox({ path: "INBOX.EUROSISTEMAS" })).toBe(true);
    expect(isScannableBillingMailbox({ path: "INBOX.Sent", specialUse: "\\Sent" })).toBe(false);
    expect(isScannableBillingMailbox({ path: "INBOX.Trash", specialUse: "\\Trash" })).toBe(false);
    expect(isScannableBillingMailbox({ path: "INBOX.spam", specialUse: "\\Junk" })).toBe(false);
  });
});
