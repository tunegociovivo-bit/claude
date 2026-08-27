import { describe, expect, it } from "vitest";
import { embeddedInvoiceContactEmail, embeddedInvoiceContactName } from "../holded-sync";

describe("embeddedInvoiceContactName", () => {
  it("reads the standard Holded contactName field", () => {
    expect(embeddedInvoiceContactName({ contactName: "  Cliente Uno  " })).toBe("Cliente Uno");
  });

  it("reads the lowercase variant returned by some documents", () => {
    expect(embeddedInvoiceContactName({ contactname: "Cliente Dos" })).toBe("Cliente Dos");
  });

  it("skips empty variants in favor of a populated value", () => {
    expect(embeddedInvoiceContactName({ contactName: " ", contactname: "Cliente Alternativo" })).toBe("Cliente Alternativo");
  });

  it("reads a nested contact object", () => {
    expect(embeddedInvoiceContactName({ contact: { id: "abc", name: "Cliente Tres" } })).toBe("Cliente Tres");
  });

  it("falls back to the nested trade name", () => {
    expect(embeddedInvoiceContactName({ contact: { name: "", tradeName: "Nombre comercial" } })).toBe("Nombre comercial");
  });
});

describe("embeddedInvoiceContactEmail", () => {
  it("reads the recipient email embedded in a Holded document", () => {
    expect(embeddedInvoiceContactEmail({ contact: { email: "tantrausuaya@gmail.com" } }))
      .toBe("tantrausuaya@gmail.com");
  });
});
