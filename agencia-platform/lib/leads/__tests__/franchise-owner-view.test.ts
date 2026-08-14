/**
 * Modelo de PRESENTACIÓN del titular de franquicia. Demuestra que un `rawData.franchiseOwner`
 * ENRIQUECIDO (como el único Eroski que dio resultado) se mapea a una vista con TODOS los campos
 * que la tabla/panel muestran, que "con resultado" = evidencia útil real (no solo status done), y
 * que el filtro y la insignia clasifican coherentemente.
 */
import { describe, it, expect } from "vitest";
import { toOwnerView, classifyOwnerState, ownerHasEvidence, ownerStateMeta, matchesOwnerFilter, classifyContactState, isContactable, matchesLeadFilter } from "../franchise-owner-view";

// Resultado real enriquecido (franquiciado local confirmado con sociedad, CIF, responsable y fuentes).
const ENRICHED = {
  status: "done",
  attempts: 0,
  classification: "franchise",
  confidence: "high",
  operatorName: "SUPERMERCADOS DEL SUR SL",
  taxId: "B12345678",
  ownerName: "Juan Pérez García",
  ownerRole: "Administrador único",
  operatorWebsite: "supermercadosdelsur.es",
  emails: ["info@supermercadosdelsur.es"],
  phones: ["952 12 34 56"],
  sources: [
    { url: "https://www.borme.es/anuncio/123", title: "BORME" },
    { url: "not-a-url", title: "descartada" },
    { url: "https://supermercadosdelsur.es/aviso-legal", title: "Aviso legal" }
  ],
  explanation: "El establecimiento lo explota un franquiciado local (BORME + aviso legal).",
  researchedAt: "2026-08-14T10:00:00.000Z",
  processedAt: "2026-08-14T10:00:05.000Z"
};

// "done" del antiguo fallo silencioso: marcado hecho pero SIN evidencia útil (stale-empty).
const STALE_EMPTY = { status: "done", classification: "unconfirmed", confidence: "low", explanation: "No hay evidencia suficiente.", sources: [] };

describe("classifyOwnerState / ownerHasEvidence", () => {
  it("un done con operador/CIF es done_data (evidencia real)", () => {
    expect(ownerHasEvidence(ENRICHED)).toBe(true);
    expect(classifyOwnerState(ENRICHED)).toBe("done_data");
  });
  it("un done sin evidencia es done_empty (no cuenta como resultado)", () => {
    expect(ownerHasEvidence(STALE_EMPTY)).toBe(false);
    expect(classifyOwnerState(STALE_EMPTY)).toBe("done_empty");
  });
  it("queued/error/none se clasifican por status", () => {
    expect(classifyOwnerState({ status: "queued" })).toBe("queued");
    expect(classifyOwnerState({ status: "error", lastError: "x" })).toBe("error");
    expect(classifyOwnerState(undefined)).toBe("none");
    expect(classifyOwnerState({})).toBe("none");
  });
});

describe("toOwnerView: el enriquecido LLEGA con todos los campos mostrables", () => {
  it("mapea operador, CIF, responsable, web, emails, teléfonos, confianza, explicación y fuentes", () => {
    const v = toOwnerView(ENRICHED)!;
    expect(v).not.toBeNull();
    expect(v.state).toBe("done_data");
    expect(v.hasEvidence).toBe(true);
    expect(v.classification).toBe("franchise");
    expect(v.confidence).toBe("high");
    expect(v.operatorName).toBe("SUPERMERCADOS DEL SUR SL");
    expect(v.taxId).toBe("B12345678");
    expect(v.ownerName).toBe("Juan Pérez García");
    expect(v.ownerRole).toBe("Administrador único");
    expect(v.operatorWebsite).toBe("supermercadosdelsur.es");
    expect(v.emails).toEqual(["info@supermercadosdelsur.es"]);
    expect(v.phones).toEqual(["952 12 34 56"]);
    expect(v.explanation).toContain("franquiciado local");
    expect(v.processedAt).toBe("2026-08-14T10:00:05.000Z");
    // Fuentes: solo URLs http(s) válidas y clicables; se descarta la basura.
    expect(v.sources).toHaveLength(2);
    expect(v.sources.map((s) => s.url)).toEqual([
      "https://www.borme.es/anuncio/123",
      "https://supermercadosdelsur.es/aviso-legal"
    ]);
  });
  it("stale-empty se ve como investigado SIN evidencia", () => {
    const v = toOwnerView(STALE_EMPTY)!;
    expect(v.state).toBe("done_empty");
    expect(v.hasEvidence).toBe(false);
    expect(v.operatorName).toBeNull();
    expect(v.sources).toEqual([]);
  });
  it("error conserva el último motivo para mostrarlo", () => {
    const v = toOwnerView({ status: "error", lastError: "anthropic_unconfigured", attempts: 2 })!;
    expect(v.state).toBe("error");
    expect(v.lastError).toBe("anthropic_unconfigured");
  });
  it("un lead sin investigar no infla el payload (null)", () => {
    expect(toOwnerView(undefined)).toBeNull();
    expect(toOwnerView({})).toBeNull();
  });
});

describe("insignia y filtro por fila", () => {
  it("meta por estado", () => {
    expect(ownerStateMeta("done_data").tone).toBe("emerald");
    expect(ownerStateMeta("done_empty").tone).toBe("slate");
    expect(ownerStateMeta("error").tone).toBe("rose");
    expect(ownerStateMeta("none").short).toBe("");
  });
  it("«con resultado» = SOLO evidencia real; «sin resultado» = vacío o error", () => {
    expect(matchesOwnerFilter("done_data", "with")).toBe(true);
    expect(matchesOwnerFilter("done_empty", "with")).toBe(false);
    expect(matchesOwnerFilter("done_empty", "without")).toBe(true);
    expect(matchesOwnerFilter("error", "without")).toBe(true);
    expect(matchesOwnerFilter("done_data", "without")).toBe(false);
    expect(matchesOwnerFilter("none", "with")).toBe(false);
    // "all" nunca filtra.
    for (const s of ["none", "queued", "error", "done_empty", "done_data"] as const) {
      expect(matchesOwnerFilter(s, "all")).toBe(true);
    }
  });
});

describe("FASE 2 — contacto: clasificación, vista y filtro «Contactables»", () => {
  const withContact = (contact: any) => ({ ...ENRICHED, contact });
  it("classifyContactState / isContactable", () => {
    expect(classifyContactState(ENRICHED)).toBe("none"); // aún no ejecutada
    expect(classifyContactState(withContact({ status: "queued" }))).toBe("queued");
    expect(classifyContactState(withContact({ status: "actionable_contact" }))).toBe("actionable_contact");
    expect(classifyContactState(withContact({ status: "identified_no_contact" }))).toBe("identified_no_contact");
    expect(classifyContactState(withContact({ status: "provider_error" }))).toBe("provider_error");
    expect(isContactable(withContact({ status: "actionable_contact" }))).toBe(true);
    expect(isContactable(withContact({ status: "identified_no_contact" }))).toBe(false);
  });
  it("toOwnerView expone estado + canales de contacto", () => {
    const fo = withContact({
      status: "actionable_contact",
      channels: [{ type: "email", value: "info@sergisa.es", source: "web_oficial", confidence: "high", verified: { status: "valid", score: 96 }, person: "Sergio", role: "Admin", sourceUrl: "https://sergisa.es", foundAt: "2026-08-14T12:00:00Z" }],
      explanation: "1 canal accionable"
    });
    const v = toOwnerView(fo)!;
    expect(v.contactState).toBe("actionable_contact");
    expect(v.contactable).toBe(true);
    expect(v.contactChannels).toHaveLength(1);
    expect(v.contactChannels[0]).toMatchObject({ type: "email", value: "info@sergisa.es", source: "web_oficial", confidence: "high" });
    expect(v.contactChannels[0].verified).toMatchObject({ status: "valid", score: 96 });
  });
  it("filtro «Contactables» = fase de contacto accionable (no solo identificado)", () => {
    const contactable = toOwnerView(withContact({ status: "actionable_contact", channels: [] }));
    const identifiedOnly = toOwnerView(ENRICHED); // done_data pero contactState none
    expect(matchesLeadFilter(contactable, "contactable")).toBe(true);
    expect(matchesLeadFilter(identifiedOnly, "contactable")).toBe(false);
    // «with» (titular identificado) sí incluye al identificado sin contacto.
    expect(matchesLeadFilter(identifiedOnly, "with")).toBe(true);
    expect(matchesLeadFilter(null, "contactable")).toBe(false);
    expect(matchesLeadFilter(null, "all")).toBe(true);
  });
});
