import { describe, it, expect } from "vitest";
import { conversationDestination, postMatchesKeyword } from "../conversation-search";
import { mobileAutomationDraftSchema } from "../automation-policy";
import { conversationScanConfigSchema } from "../facebook-conversations";
import { commentWithinDateRange } from "../facebook-comment-dates";
const draft = { platform: "facebook", sourceKind: "COMMENT_DISCOVERY", idempotencyKey: "a0000000-0000-4000-8000-000000000001", phoneKey: "one", deviceSerial: "phone", facts: "", replyGuidance: "Mi opinión sobre las franquicias" };
describe("búsqueda de conversaciones sin URL", () => {
  it("acepta palabra clave, todos los grupos y texto legado en destino sin exigir URL", () => {
    for (const value of [{ searchTerm: "franquicias" }, {}, { targetUrl: "franquicias" }]) expect(mobileAutomationDraftSchema.safeParse({ ...draft, ...value }).success).toBe(true);
    expect(conversationDestination("franquicias")).toEqual({ targetUrl: "", searchTerm: "franquicias" });
  });
  it("no convierte protocolos inseguros ni URLs ajenas en destinos permitidos", () => {
    for (const targetUrl of ["javascript:alert(1)", "https://evil.test/path", "http://facebook.com/groups/1"]) expect(mobileAutomationDraftSchema.safeParse({ ...draft, targetUrl }).success).toBe(false);
  });
  it("valida fechas reales, orden e intervalo completo", () => {
    expect(mobileAutomationDraftSchema.safeParse({ ...draft, dateFrom: "2026-08-16", dateTo: "2026-09-16" }).success).toBe(true);
    for (const range of [{ dateFrom: "2026-09-16", dateTo: "2026-08-16" }, { dateFrom: "2026-02-31", dateTo: "2026-09-16" }, { dateTo: "2026-09-16" }]) {
      expect(mobileAutomationDraftSchema.safeParse({ ...draft, ...range }).success).toBe(false);
      expect(conversationScanConfigSchema.safeParse({ replyGuidance: draft.replyGuidance, ...range }).success).toBe(false);
    }
  });
  it("aplica fechas inclusivas y omite comentarios fuera del periodo o sin fecha", () => {
    const ref = Date.parse("2026-09-16T12:00:00Z");
    for (const label of ["1 de septiembre de 2026", "16 de septiembre de 2026", "2 d"]) expect(commentWithinDateRange(label, "2026-09-01", "2026-09-16", ref)).toBe(true);
    for (const label of ["31 de agosto de 2026", "17 de septiembre de 2026", "", "40 d"]) expect(commentWithinDateRange(label, "2026-09-01", "2026-09-16", ref)).toBe(false);
    expect(commentWithinDateRange("1 sem", "2026-09-01", "2026-09-05", ref)).toBe(false);
  });
  it("filtra publicaciones por palabras clave sin depender de acentos ni mayúsculas", () => {
    expect(postMatchesKeyword("Franquicias de alimentación rentables", "FRANQUICIAS alimentación")).toBe(true);
    expect(postMatchesKeyword("Un viaje al Caribe", "franquicias")).toBe(false);
    expect(postMatchesKeyword("Cualquier publicación", "")).toBe(true);
  });
});
