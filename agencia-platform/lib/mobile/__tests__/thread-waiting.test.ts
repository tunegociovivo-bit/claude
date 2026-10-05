import { describe, expect, it } from "vitest";
import { threadWaitingReason, type WaitingJob } from "../thread-waiting";

const now = new Date("2026-10-06T10:00:00Z");
const msg = (over: Record<string, unknown> = {}) => ({ kind: "comment_thread", version: 1, threadId: "22222222-2222-4222-8222-222222222222", order: 2, total: 2, postUrl: "https://www.facebook.com/x", guide: "g", author: "A", mode: "comment", replyToOrder: null, replyToAuthor: null, replyToText: null, parentJobId: null, previousJobId: null, text: "Hola", outcome: "pending", detail: null, ...over }) as any;
const job = (over: Partial<WaitingJob> = {}): WaitingJob => ({ id: "j2", status: "QUEUED", deviceSerial: "S", scheduledAt: new Date(now.getTime() - 1000), lastError: null, message: msg(), ...over });
const ctx = (over: Record<string, unknown> = {}) => ({ now, byId: new Map<string, WaitingJob>(), online: () => true, blocked: () => null, ...over });

describe("por qué no se publica un mensaje", () => {
  it("pantalla cerrada", () => { expect(threadWaitingReason(job(), ctx({ online: () => false }))).toMatch(/pantalla/); });
  it("motivo de la política", () => { expect(threadWaitingReason(job(), ctx({ blocked: () => "Fuera del horario permitido" }))).toMatch(/horario/); });
  it("programado", () => { expect(threadWaitingReason(job({ scheduledAt: new Date(now.getTime() + 3_600_000) }), ctx())).toMatch(/Programado/); });
  it("espera a su comentario original", () => {
    const parent = job({ id: "j1", status: "QUEUED", message: msg({ order: 1 }) });
    const reason = threadWaitingReason(job({ message: msg({ mode: "reply", replyToOrder: 1, parentJobId: "j1" }) }), ctx({ byId: new Map([["j1", parent]]) }));
    expect(reason).toMatch(/#1/);
  });
  it("pendiente de aprobar", () => { expect(threadWaitingReason(job({ status: "PENDING_APPROVAL" }), ctx())).toMatch(/aprobar/); });
  it("publicado no tiene motivo", () => { expect(threadWaitingReason(job({ status: "COMPLETED" }), ctx())).toBeNull(); });
});
