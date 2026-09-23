import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireSeoBlogAccess } from "@/lib/seo-blog/access";
import { madridToUtc, todayMadrid } from "@/lib/seo-blog/util";

export const dynamic = "force-dynamic";

/**
 * Acciones masivas sobre propuestas:
 *  - discard | delete | generate
 *  - distribute: reparte en el calendario { start:"YYYY-MM-DD", weekdays:[1..7], perDay, time? }
 */
export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  await requireSeoBlogAccess(api);
  const b = (await req.json().catch(() => ({}))) ?? {};
  const ids: string[] = Array.isArray(b.ids) ? b.ids.map(String) : [];
  if (!ids.length) throw new ApiError(400, "validation_error", "Sin posts seleccionados");
  const ws = api.workspaceId;
  const action = String(b.action ?? "");
  if (action === "discard") {
    const r = await prisma.seoBlogPost.updateMany({ where: { id: { in: ids }, workspaceId: ws }, data: { status: "descartada", publishAt: null } });
    return NextResponse.json({ updated: r.count });
  }
  if (action === "delete") {
    const r = await prisma.seoBlogPost.deleteMany({ where: { id: { in: ids }, workspaceId: ws, status: { notIn: ["programada", "publicada"] } } });
    return NextResponse.json({ updated: r.count });
  }
  if (action === "generate") {
    const r = await prisma.seoBlogPost.updateMany({
      where: { id: { in: ids }, workspaceId: ws, status: { in: ["propuesta", "planificada", "error"] } },
      data: { status: "en_cola", step: "research", error: null, attempts: 0, fixPasses: 0 }
    });
    return NextResponse.json({ updated: r.count });
  }
  if (action === "distribute") {
    const days: number[] = (Array.isArray(b.weekdays) && b.weekdays.length ? b.weekdays : [2, 4]).map(Number);
    const perDay = Math.max(1, Math.min(5, Number(b.perDay) || 1));
    const start = /^\d{4}-\d{2}-\d{2}$/.test(String(b.start ?? "")) ? String(b.start) : todayMadrid();
    const slots: string[] = [];
    const d = new Date(`${start}T12:00:00Z`);
    for (let guard = 0; slots.length < ids.length && guard < 800; guard++) {
      const iso = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
      if (days.includes(iso)) for (let k = 0; k < perDay; k++) slots.push(d.toISOString().slice(0, 10));
      d.setUTCDate(d.getUTCDate() + 1);
    }
    const posts = await prisma.seoBlogPost.findMany({
      where: { id: { in: ids }, workspaceId: ws },
      select: { id: true, status: true, site: { select: { publishTime: true } } }
    });
    const order = new Map(ids.map((id, i) => [id, i]));
    posts.sort((a, c) => (order.get(a.id) ?? 0) - (order.get(c.id) ?? 0));
    let n = 0;
    for (let i = 0; i < posts.length && i < slots.length; i++) {
      const p = posts[i];
      if (["programada", "publicada"].includes(p.status)) continue;
      const when = madridToUtc(`${slots[i]} ${b.time || p.site.publishTime || "09:00"}`);
      await prisma.seoBlogPost.updateMany({
        where: { id: p.id, workspaceId: ws },
        data: { publishAt: when, ...(["propuesta", "descartada"].includes(p.status) ? { status: "planificada" } : {}) }
      });
      n++;
    }
    return NextResponse.json({ updated: n });
  }
  throw new ApiError(400, "validation_error", "Acción desconocida");
});
