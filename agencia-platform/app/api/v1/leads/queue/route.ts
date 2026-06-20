import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { channelWarmupCap } from "@/lib/leads/channels";

const SENT_OK = ["sent", "delivered", "read"];

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const where: any = { workspaceId: api.workspaceId };
  if (status) where.status = status;
  const items = await prisma.leadMessage.findMany({
    where,
    orderBy: [{ status: "asc" }, { scheduledAt: "asc" }],
    take: 200
  });

  // Anotación de calentamiento: por cada mensaje EN COLA marcamos si su teléfono
  // está calentando y si ese mensaje entra en el cupo del día de ese teléfono
  // (se enviará por él) o lo supera (saldrá por otro número / se aplazará).
  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const leads: any = (ws?.settings as any)?.leads ?? {};
  const channels: any[] = (Array.isArray(leads.channels) ? leads.channels : []).filter(
    (c: any) => c && typeof c.name === "string" && c.name.trim()
  );
  const principalCap = Number(leads.dailyLimit) || 80;
  const capByName = new Map<string, { cap: number; warming: boolean }>();
  for (const c of channels) {
    const w = channelWarmupCap(c, leads);
    capByName.set(c.name, { cap: w.cap, warming: w.warming });
  }

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const sentToday = await prisma.leadMessage.groupBy({
    by: ["instanceName"],
    where: { workspaceId: api.workspaceId, status: { in: SENT_OK }, sentAt: { gte: dayStart } },
    _count: { _all: true }
  });
  const usedInit = new Map<string, number>();
  for (const r of sentToday) usedInit.set(r.instanceName ?? "__P__", r._count._all);

  const todayKey = new Date().toDateString();
  const running = new Map<string, number>();
  const queued = items
    .filter((m) => m.status === "queued")
    .slice()
    .sort((a, b) => new Date(a.scheduledAt ?? 0).getTime() - new Date(b.scheduledAt ?? 0).getTime());

  const annotById = new Map<string, { warming: boolean; willSend: boolean; channelCap: number }>();
  for (const m of queued) {
    const name = m.instanceName ?? null;
    const cap = !name ? principalCap : capByName.get(name)?.cap ?? 50;
    const warming = !name ? false : capByName.get(name)?.warming ?? false;
    const dayKey = m.scheduledAt ? new Date(m.scheduledAt).toDateString() : todayKey;
    const k = `${name ?? "__P__"}|${dayKey}`;
    let used = running.get(k);
    if (used === undefined) used = dayKey === todayKey ? usedInit.get(name ?? "__P__") ?? 0 : 0;
    annotById.set(m.id, { warming, willSend: used < cap, channelCap: cap });
    running.set(k, used + 1);
  }

  const out = items.map((m) => ({ ...m, ...(annotById.get(m.id) ?? {}) }));
  return NextResponse.json({ items: out });
});

const bulkDeleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500)
});

/** Borrado masivo de la cola. Excluye mensajes en estado "sending" para no
 *  abortar un envío en curso. */
export const DELETE = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = bulkDeleteSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const out = await prisma.leadMessage.deleteMany({
    where: {
      id: { in: parsed.data.ids },
      workspaceId: api.workspaceId,
      status: { not: "sending" }
    }
  });
  return NextResponse.json({ deleted: out.count });
});
