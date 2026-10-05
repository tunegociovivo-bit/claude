import "server-only";
import crypto from "crypto";
import type { WhatsappLine } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getWorkspaceSettings, saveWorkspaceSettings } from "@/lib/settings";
import { readSessionState } from "@/lib/waha-connection";
import type { LineSafetyState } from "@/lib/inbox/safety";

export type AiMode = "auto" | "suggest" | "off";
export const AI_MODES: AiMode[] = ["auto", "suggest", "off"];
export const MAX_LINES_PER_WORKSPACE = 20;

// La línea principal es la sesión que ya usaba el negocio (Ajustes → WhatsApp).
// Se crea sola la primera vez que se necesita: así los negocios existentes
// pasan a la bandeja unificada sin migración manual.
export async function ensurePrimaryLine(workspaceId: string): Promise<WhatsappLine | null> {
  const settings = await getWorkspaceSettings(workspaceId);
  const configuredSession = settings.whatsapp.wahaSession || "default";
  const existing = await prisma.whatsappLine.findFirst({ where: { workspaceId, isPrimary: true } });
  if (existing) {
    // Si la sesión principal cambió (p.ej. tras vincular por QR), la línea la sigue.
    if (existing.mode === "own" && existing.sessionName !== configuredSession) {
      const clash = await prisma.whatsappLine.findFirst({
        where: { workspaceId, sessionName: configuredSession, NOT: { id: existing.id } },
        select: { id: true },
      });
      if (!clash) {
        return prisma.whatsappLine.update({ where: { id: existing.id }, data: { sessionName: configuredSession } });
      }
    }
    return existing;
  }
  if (!settings.whatsapp.wahaUrl) return null;
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { createdAt: true } });
  try {
    return await prisma.whatsappLine.create({
      data: {
        workspaceId,
        sessionName: configuredSession,
        label: "Principal",
        isPrimary: true,
        mode: "own",
        aiMode: settings.whatsapp.autoReplyEnabled ? "auto" : "suggest",
        // Número ya en uso: no está "recién conectado".
        warmupSince: workspace?.createdAt ?? new Date(),
      },
    });
  } catch {
    // Carrera entre dos peticiones: la otra ya la creó.
    return prisma.whatsappLine.findFirst({ where: { workspaceId, isPrimary: true } });
  }
}

export async function listLines(workspaceId: string): Promise<WhatsappLine[]> {
  await ensurePrimaryLine(workspaceId);
  return prisma.whatsappLine.findMany({
    where: { workspaceId },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
}

// Línea a la que pertenece un evento de WAHA (por nombre de sesión).
export async function lineForSession(workspaceId: string, session?: string | null): Promise<WhatsappLine | null> {
  const primary = await ensurePrimaryLine(workspaceId);
  if (!session) return primary;
  if (primary?.sessionName === session) return primary;
  return prisma.whatsappLine.findFirst({ where: { workspaceId, sessionName: session } });
}

export function newLineSuffix(): string {
  return crypto.randomBytes(4).toString("hex").slice(0, 6);
}

export function toSafetyState(line: WhatsappLine, lastSendAt: Date | null): LineSafetyState {
  return {
    active: line.active,
    pausedUntil: line.pausedUntil,
    pauseReason: line.pauseReason,
    lastStatus: line.lastStatus,
    warmupSince: line.warmupSince,
    dailyLimit: line.dailyLimit,
    hourlyLimit: line.hourlyLimit,
    newChatsPerDay: line.newChatsPerDay,
    lastSendAt,
  };
}

// Estado en vivo de la sesión, cacheado 60 s en la propia línea.
export async function refreshLineStatus(line: WhatsappLine, maxAgeMs = 60_000): Promise<WhatsappLine> {
  if (line.lastStatusAt && Date.now() - line.lastStatusAt.getTime() < maxAgeMs) return line;
  let status: string;
  let phone: string | null = line.phone;
  try {
    const state = await readSessionState(line.workspaceId, line.sessionName);
    status = state.status;
    phone = state.phone ?? phone;
  } catch {
    status = "UNREACHABLE";
  }
  return prisma.whatsappLine.update({
    where: { id: line.id },
    data: { lastStatus: status, lastStatusAt: new Date(), phone },
  });
}

// El interruptor "Paula responde sola" de Ajustes refleja el modo de la línea principal.
export async function syncPrimaryAiMode(workspaceId: string, aiMode: AiMode) {
  await saveWorkspaceSettings(workspaceId, {
    whatsapp: { ...(await getWorkspaceSettings(workspaceId)).whatsapp, autoReplyEnabled: aiMode === "auto" },
  });
}

export async function setPrimaryLineAiModeFromSettings(workspaceId: string, autoReplyEnabled: boolean) {
  const primary = await ensurePrimaryLine(workspaceId);
  if (!primary || primary.aiMode === "off") return;
  const aiMode: AiMode = autoReplyEnabled ? "auto" : "suggest";
  if (primary.aiMode !== aiMode) {
    await prisma.whatsappLine.update({ where: { id: primary.id }, data: { aiMode } });
  }
}
