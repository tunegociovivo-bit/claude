import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isSameOrigin } from "@/lib/auth";
import { inboxError, requireInboxAdmin, requireInboxUser } from "@/lib/inbox/api";
import { listLines, MAX_LINES_PER_WORKSPACE, newLineSuffix } from "@/lib/inbox/lines";
import { lineAgeDays, lineRiskScore, warmupNewChatCap } from "@/lib/inbox/safety";
import { madridDayStart } from "@/lib/inbox/time";
import { ensureSessionStarted, extraSessionName } from "@/lib/waha-connection";
import { toSafetyState } from "@/lib/inbox/lines";

export const dynamic = "force-dynamic";

// GET → números del negocio con estado, uso de hoy y riesgo de baneo.
export async function GET() {
  try {
    const user = await requireInboxUser();
    const lines = await listLines(user.workspaceId);
    const now = new Date();
    const dayStart = madridDayStart(now);
    const since24h = new Date(now.getTime() - 24 * 3600_000);
    const since7d = new Date(now.getTime() - 7 * 86_400_000);
    const items = await Promise.all(
      lines.map(async (line) => {
        const [sentToday, sent24h, failed24h, coldToday, queued, optOuts7d] = await Promise.all([
          prisma.outboundMessage.count({ where: { lineId: line.id, status: "sent", sentAt: { gte: dayStart } } }),
          prisma.outboundMessage.count({ where: { lineId: line.id, status: "sent", sentAt: { gte: since24h } } }),
          prisma.outboundMessage.count({ where: { lineId: line.id, status: "failed", createdAt: { gte: since24h } } }),
          prisma.outboundMessage.count({
            where: { lineId: line.id, status: "sent", cold: true, sentAt: { gte: dayStart } },
          }),
          prisma.outboundMessage.count({ where: { lineId: line.id, status: "queued" } }),
          prisma.conversation.count({ where: { lineId: line.id, optedOut: true, optedOutAt: { gte: since7d } } }),
        ]);
        const safety = toSafetyState(line, line.lastSentAt);
        const risk = lineRiskScore({ line: safety, now, sentToday, sent24h, failed24h, optOuts7d, coldToday });
        const age = lineAgeDays(safety, now);
        return {
          id: line.id,
          label: line.label,
          sessionName: user.isOperator ? line.sessionName : undefined,
          mode: line.mode,
          isPrimary: line.isPrimary,
          phone: line.phone,
          active: line.active,
          aiMode: line.aiMode,
          instructions: line.instructions ?? "",
          dailyLimit: line.dailyLimit,
          hourlyLimit: line.hourlyLimit,
          newChatsPerDay: line.newChatsPerDay,
          newChatsCapToday: warmupNewChatCap(line.newChatsPerDay, age),
          warmupDays: Math.floor(age),
          lastStatus: line.lastStatus,
          pausedUntil: line.pausedUntil && line.pausedUntil > now ? line.pausedUntil : null,
          pauseReason: line.pausedUntil && line.pausedUntil > now ? line.pauseReason : null,
          usage: { sentToday, sent24h, failed24h, coldToday, queued, optOuts7d },
          risk,
        };
      })
    );
    return Response.json({
      lines: items,
      canManage: user.isAdmin,
      isOperator: user.isOperator,
      maxLines: MAX_LINES_PER_WORKSPACE,
    });
  } catch (error) {
    return inboxError(error);
  }
}

const createSchema = z.object({ label: z.string().trim().min(1).max(60) });

// POST → añadir un número nuevo del negocio (sesión propia + QR).
export async function POST(req: NextRequest) {
  try {
    if (!isSameOrigin(req)) return Response.json({ error: "Origen no permitido" }, { status: 403 });
    const user = await requireInboxAdmin();
    const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return Response.json({ error: "Indica un nombre para el número" }, { status: 400 });
    const lines = await listLines(user.workspaceId);
    if (lines.length >= MAX_LINES_PER_WORKSPACE) {
      return Response.json({ error: `Máximo ${MAX_LINES_PER_WORKSPACE} números por negocio` }, { status: 409 });
    }
    const line = await prisma.whatsappLine.create({
      data: {
        workspaceId: user.workspaceId,
        sessionName: extraSessionName(user.workspaceId, newLineSuffix()),
        label: parsed.data.label,
        mode: "own",
        aiMode: "suggest",
        newChatsPerDay: 0,
        lastStatus: "NO_SESSION",
      },
    });
    let connection = null;
    let connectError: string | null = null;
    try {
      connection = await ensureSessionStarted(user.workspaceId, line.sessionName);
      await prisma.whatsappLine.update({
        where: { id: line.id },
        data: { lastStatus: connection.status, lastStatusAt: new Date(), phone: connection.phone },
      });
    } catch (error) {
      connectError = (error as Error)?.message ?? "No se pudo arrancar la sesión";
    }
    return Response.json({ line: { id: line.id }, connection, connectError }, { status: 201 });
  } catch (error) {
    return inboxError(error);
  }
}
