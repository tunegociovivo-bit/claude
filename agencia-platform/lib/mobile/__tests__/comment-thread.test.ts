import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
import {
  normalizeSimulation,
  parseCommentThreadMessage,
  renumberThreadScript,
  sameThreadSlot,
  serializeCommentThreadMessage,
  validateThreadScript,
  type CommentThreadMessage
} from "../comment-thread";
import { threadMessageGate } from "../automation-jobs";

const base: CommentThreadMessage = {
  kind: "comment_thread", version: 1, threadId: "7f1c1a52-6a55-4e38-9b44-1b0b2a8a3c11", order: 2, total: 3,
  postUrl: "https://www.facebook.com/post/1", guide: "franquicias", author: "Móvil 2", mode: "reply", replyToOrder: 1,
  replyToAuthor: "Móvil 1", replyToText: "¿Qué franquicia me recomendáis?", parentJobId: "job1", previousJobId: "job1",
  text: "Las de alimentación", outcome: "pending", detail: null
};

describe("conversación entre cuentas", () => {
  it("normaliza la simulación: sin autorrespuestas ni referencias al futuro", () => {
    const messages = normalizeSimulation({ messages: [
      { participant: 0, replyToOrder: null, text: "Pregunta" },
      { participant: 0, replyToOrder: 1, text: "Me respondo a mí mismo" },
      { participant: 1, replyToOrder: 5, text: "Referencia inválida" },
      { participant: 9, replyToOrder: null, text: "Participante inexistente" },
      { participant: 2, replyToOrder: 1, text: "Respuesta válida" }
    ] }, 3);
    expect(messages.map((m) => [m.participant, m.mode, m.replyToOrder])).toEqual([[0, "comment", null], [0, "comment", null], [1, "comment", null], [2, "reply", 1]]);
    expect(() => validateThreadScript(messages, 3)).not.toThrow();
  });

  it("al quitar un mensaje renumera y convierte en comentario las respuestas huérfanas", () => {
    const script = renumberThreadScript([
      { order: 2, participant: 1, mode: "reply", replyToOrder: 1, text: "hola" },
      { order: 3, participant: 0, mode: "reply", replyToOrder: 2, text: "adiós" }
    ]);
    expect(script).toEqual([
      { order: 1, participant: 1, mode: "comment", replyToOrder: null, text: "hola" },
      { order: 2, participant: 0, mode: "reply", replyToOrder: 1, text: "adiós" }
    ]);
  });

  it("solo permite cambiar el texto al aprobar", () => {
    const parsed = parseCommentThreadMessage(serializeCommentThreadMessage(base));
    expect(sameThreadSlot(parsed, { ...parsed, text: "Otro texto" })).toBe(true);
    expect(sameThreadSlot(parsed, { ...parsed, postUrl: "https://www.facebook.com/otra" })).toBe(false);
  });

  function tx(jobs: Array<{ id: string; status: string; text?: string }>) {
    return { mobileAutomationJob: { findMany: async ({ where }: { where: { id: { in: string[] } } }) => jobs.filter((job) => where.id.in.includes(job.id)) } } as never;
  }

  it("espera al mensaje anterior y cancela si el padre fue rechazado", async () => {
    const text = serializeCommentThreadMessage(base);
    expect(await threadMessageGate(tx([{ id: "job1", status: "PENDING_APPROVAL" }]), "w", text)).toEqual({ state: "wait" });
    expect((await threadMessageGate(tx([{ id: "job1", status: "REJECTED" }]), "w", text)).state).toBe("cancel");
  });

  it("al publicarse el padre usa su texto final aprobado", async () => {
    const parentText = serializeCommentThreadMessage({ ...base, order: 1, mode: "comment", replyToOrder: null, replyToAuthor: null, replyToText: null, parentJobId: null, previousJobId: null, text: "¿Qué franquicia me recomendáis? (editado)" });
    const gate = await threadMessageGate(tx([{ id: "job1", status: "COMPLETED", text: parentText }]), "w", serializeCommentThreadMessage(base));
    expect(gate.state).toBe("ready");
    expect(gate.state === "ready" && gate.text && parseCommentThreadMessage(gate.text).replyToText).toBe("¿Qué franquicia me recomendáis? (editado)");
  });
});
