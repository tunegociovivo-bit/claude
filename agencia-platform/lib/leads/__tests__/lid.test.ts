import { describe, expect, it } from "vitest";
import { realPhoneFromMeta } from "../lid";

describe("realPhoneFromMeta", () => {
  it("extrae el teléfono alternativo que NOWEB envía junto al LID", () => {
    expect(realPhoneFromMeta({
      payload: {
        from: "158501590556885@lid",
        _data: { key: { remoteJidAlt: "34600111222@s.whatsapp.net" } }
      }
    })).toBe("34600111222");
  });

  it("acepta la estructura Info de los webhooks NOWEB/GOWS", () => {
    expect(realPhoneFromMeta({
      payload: {
        from: "158501590556885@lid",
        _data: { Info: { Sender: "34600999888@s.whatsapp.net" } }
      }
    })).toBe("34600999888");
  });
});
