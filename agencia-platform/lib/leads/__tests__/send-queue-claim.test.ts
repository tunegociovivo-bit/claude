/**
 * Regresión FASE 1 · Punto 4 — claim atómico e idempotente de la cola WhatsApp.
 *
 * Antes, sendMessageById hacía findFirst → check status → update en 3 pasos:
 * dos workers (scheduler in-app + cron de GitHub Actions) podían leer ambos
 * "queued" y ENVIAR DOS VECES el mismo mensaje. Ahora la transición
 * queued→sending es un único updateMany condicional; solo un worker gana
 * (count===1) y el resto se retira (count===0) SIN enviar.
 *
 * Prisma y los colaboradores de envío se mockean: probamos la lógica del claim,
 * no WAHA.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { prisma } = vi.hoisted(() => ({
  prisma: {
    leadMessage: {
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      count: vi.fn()
    }
  }
}));

vi.mock("@/lib/db/prisma", () => ({ prisma }));
// Los módulos hermanos solo se importan; en el camino count===0 no se ejecutan.
vi.mock("../template-engine", () => ({ renderTemplate: vi.fn() }));
vi.mock("../ai-vary", () => ({ aiRewriteMessage: vi.fn() }));
vi.mock("../waha", () => ({
  normalizePhone: vi.fn(),
  sendText: vi.fn(),
  sendImage: vi.fn(),
  sendVoice: vi.fn(),
  getWahaConfig: vi.fn(),
  getSession: vi.fn(),
  checkNumberExists: vi.fn()
}));
vi.mock("../voice-tts", () => ({ generateVoiceMp3: vi.fn() }));
vi.mock("../channels", () => ({
  pickEnqueueChannel: vi.fn(),
  reassignIfQuarantined: vi.fn(async () => null),
  getLeadChannels: vi.fn(async () => []),
  warmupReroute: vi.fn(async () => null)
}));
vi.mock("../competitors", () => ({ getCompetitorRanking: vi.fn(), rankingAutoCaption: vi.fn() }));
vi.mock("../ranking-card", () => ({ renderRankingPng: vi.fn() }));
vi.mock("../email-only", () => ({ EMAIL_ONLY_REASON: "email_only", isEmailOnlyLead: vi.fn(() => false) }));

import { sendMessageById } from "../send-queue";

// settings mínimos para saltar getSendSettings (que iría a la BD).
const SETTINGS: any = { sendEnabled: true, sendPaused: false, validateWaBeforeSend: false };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sendMessageById — claim atómico", () => {
  it("PERDEDOR de la carrera (count===0): se retira SIN enviar ni releer el mensaje", async () => {
    prisma.leadMessage.updateMany.mockResolvedValue({ count: 0 });

    const r = await sendMessageById("ws-1", "msg-1", { settings: SETTINGS });

    expect(r).toEqual({ processed: false, error: "already_claimed_or_not_queued" });
    // No debe intentar releer ni tocar el mensaje: otro worker lo tiene.
    expect(prisma.leadMessage.findFirst).not.toHaveBeenCalled();
  });

  it("la reclamación es una única sentencia condicional sobre status='queued'", async () => {
    prisma.leadMessage.updateMany.mockResolvedValue({ count: 0 });

    await sendMessageById("ws-1", "msg-1", { settings: SETTINGS });

    expect(prisma.leadMessage.updateMany).toHaveBeenCalledTimes(1);
    const arg = prisma.leadMessage.updateMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ workspaceId: "ws-1", id: "msg-1", status: "queued" });
    expect(arg.data.status).toBe("sending");
    // sendAttempts se incrementa de forma atómica en la propia sentencia.
    expect(arg.data.sendAttempts).toEqual({ increment: 1 });
  });

  it("GANADOR de la carrera (count===1): relee el mensaje ya reclamado", async () => {
    prisma.leadMessage.updateMany.mockResolvedValue({ count: 1 });
    // Tras ganar el claim, si el registro ya no aparece devolvemos not_found
    // (sin enviar): probamos que SÍ intenta releer cuando ganó el claim.
    prisma.leadMessage.findFirst.mockResolvedValue(null);

    const r = await sendMessageById("ws-1", "msg-1", { settings: SETTINGS });

    expect(prisma.leadMessage.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.leadMessage.findFirst).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ processed: false, error: "not_found" });
  });
});
