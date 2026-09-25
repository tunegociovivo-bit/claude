import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/ai/anthropic", () => ({ complete: vi.fn(), completeJson: vi.fn(), DEFAULT_MODEL: "test-model" }));

import { ruleViolations, mergeFinding } from "@/lib/gmb/fake-reviews/policy";
import { initState, tick, type JobState } from "@/lib/gmb/fake-reviews/job";
import { SerpApiClient } from "@/lib/integrations/serpapi";
import { buildGoogleCase, fallbackLetter } from "@/lib/gmb/fake-reviews/google";
import { buildFakeReviewPdf, pdfText } from "@/lib/gmb/fake-reviews/pdf";
import type { AnalysisParams, Place } from "@/lib/gmb/fake-reviews/core";
import type { AnalysisResults } from "@/lib/gmb/fake-reviews/analyzer";

const cats = (t: string) => ruleViolations(t).map((v) => v.category).sort();

describe("reglas de contenido", () => {
  it("detecta insultos, soeces, odio, emojis y datos personales", () => {
    expect(cats("Son unos gilipollas y unos cabrones")).toEqual(["acoso_insultos"]);
    expect(cats("Qué mierda de sitio, joder")).toEqual(["lenguaje_obsceno"]);
    expect(cats("Atendidos por un sudaca maleducado")).toContain("odio_discriminacion");
    expect(cats("Pésimo 🖕🖕")).toEqual(["lenguaje_obsceno"]);
    expect(cats("Llamad al encargado al 612 345 678 y quejaos")).toEqual(["informacion_personal"]);
    expect(cats("Trabajé aquí dos años y es un desastre")).toEqual(["conflicto_interes"]);
    expect(cats("Visitad www.otrositio.com")).toEqual(["spam_enlaces"]);
    expect(cats("La comida estaba fría y tardaron mucho")).toEqual([]);
    expect(cats("")).toEqual([]);
  });

  it("no confunde palabras que contienen términos (palabra completa)", () => {
    expect(cats("Muy computadora de campo y putativo")).toEqual([]);
  });

  it("las descalificaciones débiles solo dan probabilidad baja salvo que la IA las confirme", () => {
    const base = { reviewId: "r", author: "A", authorLink: "", rating: 1, date: "2026-01-01", text: "Son unos inútiles", link: "" };
    const weak = mergeFinding(base, ruleViolations(base.text), { likelihood: "ninguna", summary: "", violations: [] });
    expect(weak?.likelihood).toBe("baja");
    const confirmed = mergeFinding(base, ruleViolations(base.text), {
      likelihood: "alta", summary: "Insulta al personal", violations: [{ category: "acoso_insultos", evidence: "inútiles", explanation: "Descalifica al personal" }]
    });
    expect(confirmed?.likelihood).toBe("alta");
    expect(mergeFinding({ ...base, text: "Normalito" }, [], { likelihood: "ninguna", summary: "", violations: [] })).toBeNull();
  });

  it("pdfText sustituye emojis que las fuentes no pueden pintar", () => {
    expect(pdfText("Fatal 🖕💩")).toBe("Fatal [emoji: dedo corazón][emoji: excremento]");
  });
});

const NOW = Math.floor(Date.parse("2026-09-20T00:00:00Z") / 1000);
const place = (o: Partial<Place>): Place => ({ title: "", address: "Calle 1", rating: 4.2, reviews: 100, type: "Restaurante", dataId: "", placeId: "", lat: 36.5, lng: -4.8, thumbnail: "", mapsUrl: "https://maps/x", ...o });
const CLIENT = place({ title: "Bar Sol", dataId: "0xaaaaaa:0x111111" });

function transport() {
  const texts = ["Son unos gilipollas", "Qué mierda de sitio 💩", "La comida tardó bastante", "", "Llamad al 612 345 678"];
  const reviews = texts.map((t, i) => ({
    rating: 1, iso_date: new Date((NOW - (i + 1) * 86400 * 10) * 1000).toISOString(), snippet: t, review_id: `r${i}`, link: `https://maps/r${i}`,
    user: { name: `U${i}`, link: `https://www.google.com/maps/contrib/${1000 + i}`, contributor_id: String(1000 + i), reviews: 20 }
  }));
  reviews.push({ rating: 5, iso_date: new Date(NOW * 1000).toISOString(), snippet: "Genial", review_id: "p", link: "", user: { name: "P", link: "", contributor_id: "9", reviews: 3 } });
  return async (p: any) => ({ place_info: { title: CLIENT.title }, reviews });
}

const params = (o: Partial<AnalysisParams> = {}): AnalysisParams => ({
  mode: "policy", policy: true, client: CLIENT, competitors: [], negThreshold: 2, posThreshold: 4, windowDays: 30, dateFrom: "", deep: false, ai: false,
  maxClientPages: 5, maxCompPages: 5, maxDeep: 10, ...o
});

async function run(p: AnalysisParams, classify: any) {
  const state: JobState = initState(p);
  const api = new SerpApiClient("k", { cacheDays: 0, transport: transport() });
  const deps = { api, classify };
  let res: AnalysisResults | null = null;
  for (let i = 0; i < 50 && state.phase !== "done"; i++) {
    const r = await tick(p, state, deps as any);
    if (r) res = r;
  }
  return { state, res: res!, calls: api.calls };
}

describe("revisión de contenido en el análisis", () => {
  it("modo 'Revisión de contenido': sólo lee las negativas del cliente y combina reglas + IA", async () => {
    const classify = vi.fn(async (_b: string, items: any[]) => ({
      results: items.map((it) =>
        it.id === "r2"
          ? { id: it.id, likelihood: "media", summary: "No describe la visita", violations: [{ category: "fuera_de_tema", evidence: "tardó", explanation: "Queja genérica" }] }
          : { id: it.id, likelihood: "ninguna", summary: "", violations: [] }
      )
    }));
    const { res, calls } = await run(params(), classify);
    expect(calls).toBe(1);
    expect(classify).toHaveBeenCalledTimes(1);
    expect(classify.mock.calls[0][1]).toHaveLength(4); // la reseña sin texto no se envía
    const byId = Object.fromEntries(res.policy!.findings.map((f) => [f.reviewId, f]));
    expect(byId.r0.likelihood).toBe("alta");
    expect(byId.r1.violations.map((v) => v.category)).toContain("lenguaje_obsceno");
    expect(byId.r4.violations[0].category).toBe("informacion_personal");
    expect(byId.r2.likelihood).toBe("media");
    expect(res.policy!.aiUsed).toBe(true);
    expect(res.mode).toBe("policy");
  });

  it("si la IA falla, sigue con las reglas y lo avisa", async () => {
    const { res } = await run(params(), async () => { throw new Error("sin clave"); });
    expect(res.policy!.aiUsed).toBe(false);
    expect(res.policy!.findings.length).toBe(3);
    expect(res.warnings!.join(" ")).toContain("sin clave");
  });

  it("caso para Google, escrito de respaldo y PDFs", async () => {
    const { res } = await run(params(), null);
    const gc = buildGoogleCase(res);
    expect(gc.removals.length).toBe(3);
    const letter = fallbackLetter(res, gc, { agency: "Negocio Vivo", contact: "David" });
    expect(letter).toContain("Asunto:");
    expect(letter).toContain("https://maps/r0");
    expect(letter).toContain("Acoso");
    for (const kind of ["cliente", "google", "carta"] as const) {
      const pdf = await buildFakeReviewPdf(kind, res, { agency: "Negocio Vivo" });
      expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
      expect(pdf.length).toBeGreaterThan(2000);
    }
  });
});
