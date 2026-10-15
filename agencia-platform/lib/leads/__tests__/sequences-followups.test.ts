import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  assignments: [] as any[],
  messages: new Map<string, any>(),
  inbox: [] as any[],
  updates: [] as any[],
  enqueued: [] as any[]
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    leadSequenceAssignment: {
      findMany: vi.fn(async () => db.assignments),
      updateMany: vi.fn(async () => ({ count: 1 })),
      update: vi.fn(async ({ where, data }: any) => {
        db.updates.push({ id: where.id, ...data });
        return {};
      })
    },
    leadMessage: {
      findUnique: vi.fn(async ({ where }: any) => db.messages.get(where.id) ?? null),
      findFirst: vi.fn(async ({ where }: any) => {
        if (where.status) return [...db.messages.values()].find((m) => m.leadId === where.leadId && ["queued", "sending"].includes(m.status) && m.id !== where.id?.not) ?? null;
        return null;
      })
    },
    leadInboxMessage: { findMany: vi.fn(async () => db.inbox) }
  }
}));

vi.mock("../send-queue", () => ({
  SENT_STATUSES: ["sent", "delivered", "read"],
  enqueueMessage: vi.fn(async (opts: any) => {
    db.enqueued.push(opts);
    return { messageId: `msg-${db.enqueued.length}`, scheduledAt: new Date() };
  })
}));

import { decideNextSequenceAction, processSequencesTick, stepDelayMs, uniqueSequenceSteps } from "../sequences";

const DAY = 86_400_000;
const now = new Date("2026-10-15T10:00:00Z");
const steps = [
  { order: 0, delayHours: 0, delayDays: 0, templateBody: "Hola {{nombre_negocio}}", kind: "text", stopIfResponded: true },
  { order: 1, delayHours: 24, delayDays: 1, templateBody: "Te dejé un mensaje el otro día", kind: "text", stopIfResponded: true },
  { order: 2, delayHours: 24, delayDays: 1, templateBody: "No te molesto más", kind: "text", stopIfResponded: true }
];

describe("decisión del siguiente paso", () => {
  const base = { now, currentStep: 0, stepCount: 3, nextStepDelayMs: DAY, hasOtherPendingMessage: false };

  it("espera mientras el mensaje anterior sigue en cola (el fallo que dejaba solo el primer mensaje)", () => {
    const d = decideNextSequenceAction({ ...base, lastMessage: { status: "queued", sentAt: null, scheduledAt: new Date(now.getTime() + 3 * 3600_000), lastError: null } });
    expect(d.kind).toBe("wait");
    if (d.kind === "wait") expect(d.until.getTime()).toBe(now.getTime() + 3 * 3600_000 + 2 * 60_000);
  });

  it("cuenta el retraso desde el ENVÍO del paso anterior", () => {
    const sentAt = new Date(now.getTime() - 6 * 3600_000);
    const d = decideNextSequenceAction({ ...base, lastMessage: { status: "delivered", sentAt, scheduledAt: null, lastError: null } });
    expect(d).toEqual({ kind: "wait", until: new Date(sentAt.getTime() + DAY), reason: expect.any(String) });
    expect(decideNextSequenceAction({ ...base, lastMessage: { status: "read", sentAt: new Date(now.getTime() - 2 * DAY), scheduledAt: null, lastError: null } })).toEqual({ kind: "enqueue", stepIndex: 1 });
  });

  it("pausa con el motivo si el paso anterior no salió", () => {
    const d = decideNextSequenceAction({ ...base, lastMessage: { status: "failed", sentAt: null, scheduledAt: null, lastError: "Bloqueado por seguridad sectorial" } });
    expect(d).toEqual({ kind: "pause", reason: expect.stringContaining("Bloqueado por seguridad sectorial") });
  });

  it("completa tras el último paso y espera si hay otro mensaje del lead en cola", () => {
    expect(decideNextSequenceAction({ ...base, currentStep: 2, lastMessage: { status: "sent", sentAt: new Date(now.getTime() - DAY), scheduledAt: null, lastError: null } })).toEqual({ kind: "complete" });
    expect(decideNextSequenceAction({ ...base, currentStep: -1, lastMessage: null, hasOtherPendingMessage: true }).kind).toBe("wait");
    expect(decideNextSequenceAction({ ...base, currentStep: 0, lastMessage: null })).toEqual({ kind: "enqueue", stepIndex: 1 });
  });

  it("quita pasos duplicados de importaciones antiguas y lee el retraso en horas o días", () => {
    const dup = [steps[1], steps[0], { ...steps[0] }, steps[2], { ...steps[1] }];
    expect(uniqueSequenceSteps(dup).map((step) => step.templateBody)).toEqual(steps.map((step) => step.templateBody));
    expect(stepDelayMs({ delayHours: 72, delayDays: 1 })).toBe(3 * DAY);
    expect(stepDelayMs({ delayHours: 0, delayDays: 2 })).toBe(2 * DAY);
    expect(stepDelayMs({ delayHours: null, delayDays: null })).toBe(0);
  });
});

describe("procesador de secuencias", () => {
  beforeEach(() => {
    db.assignments = [];
    db.messages = new Map();
    db.inbox = [];
    db.updates = [];
    db.enqueued = [];
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  const assignment = (over: Partial<any> = {}) => ({
    id: "asg1",
    leadId: "lead1",
    sequenceId: "seq1",
    status: "active",
    currentStep: 0,
    startedAt: new Date(now.getTime() - 3 * DAY),
    nextRunAt: new Date(now.getTime() - 60_000),
    lastMessageId: "m0",
    sequence: { steps: [steps[0], { ...steps[0] }, steps[1], steps[2]] },
    lead: { id: "lead1", contactStatus: "contacted", phone: "600111222", internationalPhone: null },
    ...over
  });

  it("no intenta encolar el paso 2 mientras el 1 está en cola: sigue activa", async () => {
    db.assignments = [assignment()];
    db.messages.set("m0", { id: "m0", leadId: "lead1", status: "queued", sentAt: null, scheduledAt: new Date(now.getTime() + 3600_000), lastError: null });
    const result = await processSequencesTick({ workspaceId: "ws" });
    expect(db.enqueued).toHaveLength(0);
    expect(result).toMatchObject({ waiting: 1, paused: 0, stopped: 0 });
    expect(db.updates.at(-1)).toMatchObject({ id: "asg1", nextRunAt: expect.any(Date) });
    expect(db.updates.some((u) => u.status === "paused")).toBe(false);
  });

  it("enviado el paso 1 y pasado su retraso, encola el paso 2 con clave idempotente", async () => {
    db.assignments = [assignment()];
    db.messages.set("m0", { id: "m0", leadId: "lead1", status: "delivered", sentAt: new Date(now.getTime() - 2 * DAY), scheduledAt: null, lastError: null });
    const result = await processSequencesTick({ workspaceId: "ws" });
    expect(result.advanced).toBe(1);
    expect(db.enqueued[0]).toMatchObject({ leadId: "lead1", body: "Te dejé un mensaje el otro día", idempotencyKey: `seq:asg1:${now.getTime() - 3 * DAY}:1` });
    expect(db.updates.at(-1)).toMatchObject({ currentStep: 1, lastMessageId: "msg-1" });
  });

  it("reactivación (sin mensaje previo en la tanda) envía ya el paso elegido", async () => {
    db.assignments = [assignment({ currentStep: 0, lastMessageId: null, startedAt: now })];
    const result = await processSequencesTick({ workspaceId: "ws" });
    expect(result.advanced).toBe(1);
    expect(db.enqueued[0].body).toBe("Te dejé un mensaje el otro día");
  });

  it("un saludo automático de WhatsApp Business no detiene la secuencia", async () => {
    db.assignments = [assignment()];
    db.inbox = [{ body: "Gracias por comunicarte con Clínica Sol. ¿En qué podemos ayudarte?" }];
    db.messages.set("m0", { id: "m0", leadId: "lead1", status: "sent", sentAt: new Date(now.getTime() - 2 * DAY), scheduledAt: null, lastError: null });
    const result = await processSequencesTick({ workspaceId: "ws" });
    expect(result).toMatchObject({ stopped: 0, advanced: 1 });
  });

  it("se detiene si el lead respondió de verdad desde que empezó", async () => {
    db.assignments = [assignment()];
    db.inbox = [{ body: "Sí, me interesa, llámame mañana" }];
    db.messages.set("m0", { id: "m0", leadId: "lead1", status: "sent", sentAt: new Date(now.getTime() - 2 * DAY), scheduledAt: null, lastError: null });
    const result = await processSequencesTick({ workspaceId: "ws" });
    expect(result.stopped).toBe(1);
    expect(db.enqueued).toHaveLength(0);
    expect(db.updates.at(-1)).toMatchObject({ status: "stopped", stoppedReason: "respuesta_recibida" });
  });
});
