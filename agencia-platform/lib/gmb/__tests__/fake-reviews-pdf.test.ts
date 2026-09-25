import { describe, expect, it } from "vitest";
import { buildFakeReviewPdf, pdfText } from "../fake-reviews/pdf";

const L = "https://www.google.com/maps/reviews/data=!4m8!14m7!1m6!2m5!1sChZDSUhNMG9nS0VJQ0FnSURmbm9lU3R3RRAB!2m1!1s0x0:0xcd83b4dcd5044859!3m1!1s2@1:CIHM0ogKEICAgIDfnoeStwE%7C%7C?hl=es";
const rv = (t: string, r = 1) => ({ rating: r, date: "2025-07-11", text: t, link: L, title: "Burger King", comp: 0 });
const res: any = {
  mode: "manual",
  params: { negThreshold: 2 },
  client: { title: "Cliente", address: "Calle 1", rating: 2.8, reviews: 200, mapsUrl: L, type: "Restaurante" },
  competitors: [{ title: "Burger King", address: "Calle 2", rating: 4, reviews: 900 }],
  stats: { clientNeg: 3, authorsCrossPos: 1, high: 1, medium: 0 },
  impact: {},
  findings: ["Hallazgo"],
  authors: [{ cid: "1", name: "Perfil", link: L, thumbnail: "", localGuide: false, totalReviews: 3, score: 70, level: "alto", crossPos: 1, gapDays: 1, signals: [{ key: "x", points: 40, label: "Valoró positivamente a la competencia" }], clientReviews: [rv("x ".repeat(2000))], compReviews: [rv("", 5)], profile: null }],
  policy: { checked: 3, aiUsed: false, findings: [{ reviewId: "r", author: "A", authorLink: L, rating: 1, date: "2026-01-01", text: "sabe a mierda 🤮", link: L, likelihood: "alta", summary: "", violations: [{ category: "lenguaje_obsceno", evidence: "mierda", explanation: "Lenguaje soez" }] }] }
};

describe("PDF de reseñas", () => {
  it("genera los tres PDFs (con textos muy largos) sin errores", async () => {
    for (const k of ["cliente", "google", "carta"] as const) {
      const buf = await buildFakeReviewPdf(k, res, { agency: "Negocio Vivo" });
      expect(buf.subarray(0, 4).toString()).toBe("%PDF");
    }
  });
  it("sustituye emojis por su descripción y conserva las estrellas", () => {
    expect(pdfText("malo 🤮 1★")).toBe("malo [emoji: vomitando] 1★");
  });
});
