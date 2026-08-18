import { describe, it, expect } from "vitest";
import { computePostTransition, validateDraft } from "../content-workflow";
import { buildGrowthReport, monthPeriod } from "../report";
import { mediaHash, findDuplicateMedia, isDuplicateHash } from "../media";

describe("content-workflow — publicar exige aprobación previa", () => {
  it("draft→submit→approve→schedule; publish solo desde scheduled", () => {
    expect(computePostTransition("draft", "submit")).toMatchObject({ ok: true, next: "pending_approval" });
    expect(computePostTransition("pending_approval", "approve", { actorId: "u1" })).toMatchObject({ ok: true, next: "approved" });
    expect(computePostTransition("approved", "schedule", { scheduledAt: "2030-01-01" })).toMatchObject({ ok: true, next: "scheduled" });
    expect(computePostTransition("scheduled", "publish")).toMatchObject({ ok: true, next: "published" });
  });
  it("no se puede publicar sin pasar por scheduled (approved→publish inválido)", () => {
    expect(computePostTransition("approved", "publish").ok).toBe(false);
    expect(computePostTransition("draft", "publish").ok).toBe(false);
  });
  it("aprobar sin actor humano falla; programar sin fecha falla", () => {
    expect(computePostTransition("pending_approval", "approve").ok).toBe(false);
    expect(computePostTransition("approved", "schedule").ok).toBe(false);
  });
});

describe("validateDraft", () => {
  it("contenido obligatorio, URL válida, fecha futura", () => {
    expect(validateDraft({ content: "" }).ok).toBe(false);
    expect(validateDraft({ content: "hola", imageUrl: "ftp://x" }).ok).toBe(false);
    const now = new Date("2026-01-01T00:00:00Z");
    expect(validateDraft({ content: "hola", scheduledAt: "2025-01-01" }, now).ok).toBe(false);
    const v = validateDraft({ content: "hola", postType: "offer", scheduledAt: "2026-06-01T10:00:00Z" }, now);
    expect(v.ok).toBe(true);
    expect(v.normalized.postType).toBe("offer");
  });
});

describe("growth report — datos reales, sin invención", () => {
  it("arma highlights desde las dimensiones", () => {
    const period = monthPeriod("2026-08");
    const r = buildGrowthReport({
      client: { name: "Café" }, period,
      presence: { score: 62, breakdown: { profile: 80 } },
      citations: { total: 3, published: 1, inconsistent: 1, notFound: 1 },
      rank: [{ keyword: "x", avgPosition: 4, top3Count: 2, visibilityShare: 70 }],
      reviews: { total: 5, positive: 3, negative: 1, avgScore: 0.3, pendingResponse: 2 },
      content: { published: 1, scheduled: 2, drafts: 3 },
      actions: { open: 2, done: 1, total: 3 }
    }, "2026-08-16T00:00:00Z");
    expect(r.highlights.some((h) => h.includes("62/100"))).toBe(true);
    expect(r.period.label).toMatch(/2026/);
    expect(r.generatedAtIso).toBe("2026-08-16T00:00:00Z");
  });
  it("sin rankings medidos → highlight honesto", () => {
    const r = buildGrowthReport({ client: { name: "X" }, period: monthPeriod("2026-08"), presence: { score: 0, breakdown: {} }, citations: { total: 0, published: 0, inconsistent: 0, notFound: 0 }, rank: [], reviews: { total: 0, positive: 0, negative: 0, avgScore: 0, pendingResponse: 0 }, content: { published: 0, scheduled: 0, drafts: 0 }, actions: { open: 0, done: 0, total: 0 } }, "2026-08-16T00:00:00Z");
    expect(r.highlights.some((h) => /sin mediciones/i.test(h))).toBe(true);
  });
});

describe("media dedupe", () => {
  it("hash estable + detecta duplicados por hash/URL", () => {
    expect(mediaHash("http://x/a.jpg")).toBe(mediaHash("http://x/a.jpg"));
    const dups = findDuplicateMedia([{ id: "1", url: "a", hash: "h1" }, { id: "2", url: "b", hash: "h1" }, { id: "3", url: "c" }]);
    expect(dups.has("2")).toBe(true);
    expect(dups.has("3")).toBe(false);
    expect(isDuplicateHash([{ id: "1", url: "a", hash: "h1" }], "h1")).toBe(true);
  });
});
