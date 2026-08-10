/**
 * Tests de la BÚSQUEDA por contenido de mensaje en el inbox de leads.
 * Cubre: fragmentos parciales, mayúsculas/minúsculas, normalización de espacios,
 * mensajes entrantes y salientes, término corto, sin resultados, adjuntado del
 * fragmento a la conversación (por teléfono y por leadId) y aislamiento de
 * tenant en las cláusulas `where`.
 */
import { describe, it, expect } from "vitest";
import {
  normalizeSearch,
  isSearchable,
  makeSnippet,
  collectSearchMatches,
  searchWhereInbox,
  searchWhereOutbound,
  buildConversations,
  MIN_SEARCH_CHARS,
  type RawInboxMsg,
  type RawConvMeta
} from "../inbox-conversations";

describe("normalizeSearch / isSearchable", () => {
  it("recorta, colapsa espacios y pasa a minúsculas", () => {
    expect(normalizeSearch("  Hola   MUNDO  ")).toBe("hola mundo");
    expect(normalizeSearch("\tPresupuesto\n")).toBe("presupuesto");
    expect(normalizeSearch(null)).toBe("");
  });
  it(`exige un mínimo de ${MIN_SEARCH_CHARS} caracteres (sobre el término normalizado)`, () => {
    expect(isSearchable("ho")).toBe(false); // 2 < 3
    expect(isSearchable("  a  ")).toBe(false); // "a" = 1
    expect(isSearchable("   sí   ")).toBe(false); // "sí" = 2
    expect(isSearchable("hola")).toBe(true); // 4
    expect(isSearchable("  presupuesto ")).toBe(true);
  });
});

describe("makeSnippet — fragmento legible", () => {
  it("encuentra coincidencia PARCIAL a mitad de palabra, sin distinguir mayúsculas", () => {
    const s = makeSnippet("El PRESUPUESTO para la reforma es 1200", "presu");
    expect(s).toContain("PRESUPUESTO");
  });
  it("normaliza espacios del término", () => {
    expect(makeSnippet("quiero el presupuesto ya", "  PRESU   PUESTO ")).toBeNull(); // 'presu puesto' no está literal
    expect(makeSnippet("quiero el presupuesto ya", "  PRESUPUESTO ")).toContain("presupuesto");
  });
  it("añade elipsis cuando recorta y devuelve null si no aparece", () => {
    const long = "a".repeat(60) + " diana " + "b".repeat(60);
    const s = makeSnippet(long, "diana")!;
    expect(s.startsWith("…")).toBe(true);
    expect(s.endsWith("…")).toBe(true);
    expect(makeSnippet("nada que ver", "xyz")).toBeNull();
  });
});

describe("collectSearchMatches — entrantes y salientes, sin duplicados", () => {
  it("casa en mensaje ENTRANTE (body) y adjunta teléfono + leadId + fragmento", () => {
    const r = collectSearchMatches(
      { inbox: [{ phoneNormalized: "34600111222", fromPhone: "34600111222", leadId: "lead-1", body: "Necesito un presupuesto urgente" }], outbound: [] },
      "presupuesto"
    );
    expect(r.matchedPhones.has("34600111222")).toBe(true);
    expect(r.matchedLeadIds.has("lead-1")).toBe(true);
    expect(r.snippetByPhone.get("34600111222")?.source).toBe("inbound");
    expect(r.snippetByPhone.get("34600111222")?.snippet).toContain("presupuesto");
  });
  it("casa en mensaje SALIENTE (renderedMessage) marcando source=outbound", () => {
    const r = collectSearchMatches(
      { inbox: [], outbound: [{ phoneNormalized: "34600999888", leadId: "lead-2", renderedMessage: "Te paso el PRESUPUESTO adjunto" }] },
      "presupuesto"
    );
    expect(r.matchedPhones.has("34600999888")).toBe(true);
    expect(r.snippetByPhone.get("34600999888")?.source).toBe("outbound");
  });
  it("sin coincidencias → conjuntos vacíos", () => {
    const r = collectSearchMatches({ inbox: [{ phoneNormalized: "1", fromPhone: "1", leadId: null, body: "hola" }], outbound: [] }, "zzz");
    expect(r.matchedPhones.size).toBe(0);
    expect(r.matchedLeadIds.size).toBe(0);
  });
  it("no duplica: dos mensajes del mismo teléfono → un solo teléfono", () => {
    const r = collectSearchMatches(
      { inbox: [
        { phoneNormalized: "34600111222", fromPhone: "34600111222", leadId: null, body: "presupuesto 1" },
        { phoneNormalized: "34600111222", fromPhone: "34600111222", leadId: null, body: "otro presupuesto" }
      ], outbound: [] },
      "presupuesto"
    );
    expect(r.matchedPhones.size).toBe(1);
  });
});

describe("aislamiento multi-tenant en las cláusulas where", () => {
  it("searchWhereInbox / searchWhereOutbound SIEMPRE incluyen workspaceId + contains insensitive", () => {
    const wi = searchWhereInbox("ws-1", "  Presupuesto ");
    expect(wi.workspaceId).toBe("ws-1");
    expect(wi.body).toEqual({ contains: "presupuesto", mode: "insensitive" });
    const wo = searchWhereOutbound("ws-2", "Oferta");
    expect(wo.workspaceId).toBe("ws-2");
    expect(wo.renderedMessage).toEqual({ contains: "oferta", mode: "insensitive" });
  });
});

describe("buildConversations — adjunta el fragmento a la conversación", () => {
  const now = new Date("2026-06-15T12:00:00Z");
  const mkMsg = (phone: string, body: string, leadId: string | null): RawInboxMsg => ({
    phoneNormalized: phone, fromPhone: phone, direction: "in", body, meta: null, read: true,
    instanceName: "sonia4", classification: null, receivedAt: now, lead: leadId ? { id: leadId, name: "Bar", phone } : null
  });
  const metas: RawConvMeta[] = [];

  it("adjunta matchSnippet por TELÉFONO", () => {
    const items = buildConversations([mkMsg("34600111222", "hola", "lead-1")], metas, {
      optoutPhones: new Set(), optoutLeadIds: new Set(),
      snippetByPhone: new Map([["34600111222", { snippet: "…presupuesto…", source: "inbound" }]])
    });
    expect(items[0].matchSnippet).toBe("…presupuesto…");
    expect(items[0].matchSource).toBe("inbound");
  });

  it("adjunta matchSnippet por LEAD ID cuando el match vino por lead (campaña)", () => {
    const items = buildConversations([mkMsg("34600111222", "hola", "lead-1")], metas, {
      optoutPhones: new Set(), optoutLeadIds: new Set(),
      snippetByLeadId: new Map([["lead-1", { snippet: "oferta especial", source: "outbound" }]])
    });
    expect(items[0].matchSnippet).toBe("oferta especial");
    expect(items[0].matchSource).toBe("outbound");
  });

  it("se combina con el filtro de bloqueados (no rompe el adjuntado)", () => {
    const items = buildConversations([mkMsg("34600111222", "hola", "lead-1")], metas, {
      optoutPhones: new Set(["34600111222"]), optoutLeadIds: new Set(), blocked: "blocked",
      snippetByPhone: new Map([["34600111222", { snippet: "…x…", source: "inbound" }]])
    });
    expect(items).toHaveLength(1);
    expect(items[0].optedOut).toBe(true);
    expect(items[0].matchSnippet).toBe("…x…");
  });
});
