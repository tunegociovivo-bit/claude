import { assertAiBudget } from "@/lib/content/ai-budget";
import { cleanupSeoPostFiles } from "@/lib/content/cleanup";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { ensureSeoSite } from "@/lib/seo-blog/access";
import { madridToUtc, todayMadrid } from "@/lib/seo-blog/util";
import { num, parseBody, z } from "@/lib/seo-blog/validate";

export const dynamic = "force-dynamic";

const Body = z.object({
  ids: z.array(z.string().max(64)).max(500),
  action: z.enum(["discard", "delete", "generate", "distribute"]),
  start: z.string().max(20).optional(),
  weekdays: z.array(num).max(7).optional(),
  perDay: num.optional(),
  time: z.string().max(10).optional()
});

/**
 * Acciones masivas sobre propuestas:
 *  - discard | delete | generate
 *  - distribute: reparte en el calendario { start:"YYYY-MM-DD", weekdays:[1..7], perDay, time? }
 */
export const POST = withApi({ module: "seo" }, async (req, { api }) => {
  const b = await parseBody(req, Body);
  const ids = [...new Set(b.ids)];
  if (!ids.length) throw new ApiError(400, "validation_error", "Sin posts seleccionados");
  const ws = api.workspaceId;
  const site = await ensureSeoSite(ws);
  const scope = { id: { in: ids }, workspaceId: ws, siteId: site.id };
  const action = b.action;
  if (action === "discard") {
    const r = await prisma.seoBlogPost.updateMany({ where: { ...scope, status: { notIn: ["programada", "publicada"] } }, data: { status: "descartada", publishAt: null } });
    return NextResponse.json({ updated: r.count });
  }
  if (action === "delete") {
    const where = { ...scope, status: { notIn: ["programada", "publicada"] } };
    const doomed = await prisma.seoBlogPost.findMany({ where, select: { id: true } });
    const r = await prisma.seoBlogPost.deleteMany({ where: { ...where, id: { in: doomed.map((p) => p.id) } } });
    for (const p of doomed) void cleanupSeoPostFiles(ws, p.id);
    return NextResponse.json({ updated: r.count });
  }
  if (action === "generate") {
    await assertAiBudget(ws);
    const r = await prisma.seoBlogPost.updateMany({
      where: { ...scope, status: { in: ["propuesta", "planificada", "error"] } },
      data: { status: "en_cola", step: "research", error: null, attempts: 0, fixPasses: 0 }
    });
    return NextResponse.json({ updated: r.count });
  }
  // distribute
  const days: number[] = (b.weekdays?.length ? b.weekdays : [2, 4]).map(Number).filter((d) => d >= 1 && d <= 7);
  if (!days.length) throw new ApiError(400, "validation_error", "Elige al menos un día de la semana");
  const perDay = Math.max(1, Math.min(5, Number(b.perDay) || 1));
  const start = /^\d{4}-\d{2}-\d{2}$/.test(String(b.start ?? "")) ? String(b.start) : todayMadrid();
  const time = b.time && /^([01]\d|2[0-3]):[0-5]\d$/.test(b.time) ? b.time : "";
  const slots: string[] = [];
  const d = new Date(`${start}T12:00:00Z`);
  if (isNaN(d.getTime())) throw new ApiError(400, "validation_error", "Fecha de inicio no válida");
  for (let guard = 0; slots.length < ids.length && guard < 800; guard++) {
    const iso = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
    if (days.includes(iso)) for (let k = 0; k < perDay; k++) slots.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  const posts = await prisma.seoBlogPost.findMany({
    where: scope,
    select: { id: true, status: true, site: { select: { publishTime: true } } }
  });
  const order = new Map(ids.map((id, i) => [id, i]));
  posts.sort((a, c) => (order.get(a.id) ?? 0) - (order.get(c.id) ?? 0));
  let n = 0;
  for (let i = 0; i < posts.length && i < slots.length; i++) {
    const p = posts[i];
    if (["programada", "publicada"].includes(p.status)) continue;
    const when = madridToUtc(`${slots[i]} ${time || p.site.publishTime || "09:00"}`);
    await prisma.seoBlogPost.updateMany({
      where: { id: p.id, workspaceId: ws },
      data: { publishAt: when, ...(["propuesta", "descartada"].includes(p.status) ? { status: "planificada" } : {}) }
    });
    n++;
  }
  return NextResponse.json({ updated: n });
});
