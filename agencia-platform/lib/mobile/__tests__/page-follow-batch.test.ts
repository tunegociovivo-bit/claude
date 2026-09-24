import { describe, expect, it } from "vitest";
import {
  createPageFollowBatch,
  normalizePageFollowEntries,
  parsePageFollowBatch,
  samePageFollowTargets,
  serializePageFollowBatch
} from "../page-follow-batch";
import { mobileAutomationDraftSchema } from "../automation-policy";

describe("lote para seguir páginas", () => {
  it("normaliza URL, dominios sin protocolo y @usuario, sin duplicados", () => {
    expect(normalizePageFollowEntries("facebook", "https://www.facebook.com/NegocioVivo\nfacebook.com/otra, @marca\nhttps://www.facebook.com/NegocioVivo/")).toEqual([
      "https://www.facebook.com/NegocioVivo",
      "https://facebook.com/otra",
      "https://www.facebook.com/marca"
    ]);
    expect(normalizePageFollowEntries("tiktok", ["@creador"])).toEqual(["https://www.tiktok.com/@creador"]);
    expect(normalizePageFollowEntries("instagram", ["usuario.ig"])).toEqual(["https://www.instagram.com/usuario.ig/"]);
  });

  it("rechaza entradas que no son URL ni usuario", () => {
    expect(() => normalizePageFollowEntries("facebook", ["hola mundo!"])).toThrow();
  });

  it("serializa y conserva la identidad de las páginas", () => {
    const batch = createPageFollowBatch("facebook", ["https://www.facebook.com/a", "https://www.facebook.com/b"]);
    const parsed = parsePageFollowBatch(serializePageFollowBatch(batch));
    expect(parsed.pages.map((page) => page.outcome)).toEqual(["pending", "pending"]);
    expect(samePageFollowTargets(batch, { ...batch, pages: batch.pages.map((page) => ({ ...page, outcome: "followed" as const })) })).toBe(true);
    expect(samePageFollowTargets(batch, { ...batch, pages: [batch.pages[0]!] })).toBe(false);
  });

  it("valida el borrador: dominio de la plataforma y sin exigir hechos", () => {
    const base = { platform: "facebook", sourceKind: "PAGE_FOLLOW", idempotencyKey: crypto.randomUUID(), phoneKey: "p", deviceSerial: "d", facts: "" };
    expect(mobileAutomationDraftSchema.safeParse({ ...base, pages: ["https://www.facebook.com/NegocioVivo"] }).success).toBe(true);
    expect(mobileAutomationDraftSchema.safeParse({ ...base, pages: ["https://www.instagram.com/x/"] }).success).toBe(false);
    expect(mobileAutomationDraftSchema.safeParse({ ...base, pages: [] }).success).toBe(false);
    expect(mobileAutomationDraftSchema.safeParse({ ...base, platform: "google_maps", pages: ["https://www.google.com/maps"] }).success).toBe(false);
  });
});
