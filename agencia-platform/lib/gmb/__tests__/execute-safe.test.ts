import { describe, it, expect, vi } from "vitest";
import { planSafeEffect, applySafeEffect } from "../execute-safe";

describe("planSafeEffect — solo efectos internos reversibles", () => {
  it("acción externa → blocked (nunca se ejecuta como interna)", () => {
    expect(planSafeEffect({ module: "reviews", type: "reply_reviews", external: true }).kind).toBe("blocked");
  });
  it("contenido → content_draft", () => {
    expect(planSafeEffect({ module: "content", type: "schedule_posts", external: false }).kind).toBe("content_draft");
    expect(planSafeEffect({ module: "presence", type: "add_photos", external: false }).kind).toBe("content_draft");
  });
  it("citaciones → nap_packets", () => {
    expect(planSafeEffect({ module: "citations", type: "fix_inconsistencies", external: false }).kind).toBe("nap_packets");
  });
  it("otros internos → note", () => {
    expect(planSafeEffect({ module: "presence", type: "add_description", external: false }).kind).toBe("note");
  });
});

function mkPrisma() {
  const db: any = { gmbPost: [], gmbClient: [{ id: "cl1", workspaceId: "w1", name: "Café", address: "C/ X 1", phone: "952000000", website: "cafe.es" }], gmbNapProfile: [], gmbCitation: [], gmbCitationEvent: [] };
  return {
    _db: db,
    gmbPost: { create: vi.fn(async ({ data }: any) => { const r = { id: `p${db.gmbPost.length + 1}`, ...data }; db.gmbPost.push(r); return r; }) },
    gmbClient: { findFirst: vi.fn(async ({ where }: any) => db.gmbClient.find((c: any) => c.id === where.id && c.workspaceId === where.workspaceId) ?? null) },
    gmbNapProfile: { findFirst: vi.fn(async () => null) },
    gmbCitation: { findMany: vi.fn(async ({ where }: any) => db.gmbCitation.filter((c: any) => c.workspaceId === where.workspaceId && c.clientId === where.clientId && where.status.in.includes(c.status))), updateMany: vi.fn(async ({ where, data }: any) => { let n = 0; for (const c of db.gmbCitation) if (c.id === where.id && c.workspaceId === where.workspaceId && where.status.in.includes(c.status)) { Object.assign(c, data); n++; } return { count: n }; }) },
    gmbCitationEvent: { create: vi.fn(async ({ data }: any) => { db.gmbCitationEvent.push(data); return data; }) }
  };
}

describe("applySafeEffect — reversible + idempotente", () => {
  it("content_draft crea un GmbPost draft (no publica)", async () => {
    const p = mkPrisma();
    const r = await applySafeEffect(p as any, "w1", { id: "a1", clientId: "cl1", module: "content", type: "schedule_posts", title: "Programar posts", external: false }, "u1");
    expect(r.ok).toBe(true);
    expect(r.result.kind).toBe("content_draft");
    expect(p._db.gmbPost[0].status).toBe("draft");
  });
  it("idempotente: si ya hay result, no recrea", async () => {
    const p = mkPrisma();
    const r = await applySafeEffect(p as any, "w1", { id: "a1", clientId: "cl1", module: "content", type: "schedule_posts", title: "X", external: false, result: { kind: "content_draft", postId: "p_prev" } }, "u1");
    expect(r.result.postId).toBe("p_prev");
    expect(p.gmbPost.create).not.toHaveBeenCalled();
  });
  it("nap_packets prepara citaciones y genera paquetes + evento", async () => {
    const p = mkPrisma();
    p._db.gmbCitation.push({ id: "c1", workspaceId: "w1", clientId: "cl1", directorySlug: "paginas-amarillas", status: "not_found" });
    const r = await applySafeEffect(p as any, "w1", { id: "a1", clientId: "cl1", module: "citations", type: "fix_inconsistencies", title: "Corregir", external: false }, "u1");
    expect(r.result.kind).toBe("nap_packets");
    expect(r.result.prepared).toBe(1);
    expect(p._db.gmbCitation[0].status).toBe("prepared");
    expect(p._db.gmbCitationEvent.length).toBe(1);
  });
  it("acción externa → bloqueada, sin efectos", async () => {
    const p = mkPrisma();
    const r = await applySafeEffect(p as any, "w1", { id: "a1", clientId: "cl1", module: "reviews", type: "reply_reviews", title: "X", external: true }, "u1");
    expect(r.ok).toBe(false);
    expect(p.gmbPost.create).not.toHaveBeenCalled();
  });
});
