import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireSeoBlogAccess } from "@/lib/seo-blog/access";
import { STEPS, STEP_LABELS, pollImages, regenImage, stepPost } from "@/lib/seo-blog/pipeline";
import { analyze } from "@/lib/seo-blog/seo";
import { getSeoBlogSettings } from "@/lib/seo-blog/settings";
import { getSiteCtx, seoLog } from "@/lib/seo-blog/service";
import { madridToUtc } from "@/lib/seo-blog/util";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Acciones sobre un post:
 *  schedule{publishAt} · unschedule · discard · restore · generate{from?} · retry
 *  approve{pushNow?} · back_to_review · regen_image{index,subject?} · poll_images · reaudit
 */
export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  await requireSeoBlogAccess(api);
  const ws = api.workspaceId;
  const p = await prisma.seoBlogPost.findFirst({ where: { id: params.id, workspaceId: ws }, include: { site: true } });
  if (!p) throw new ApiError(404, "not_found", "Post no encontrado");
  const b = (await req.json().catch(() => ({}))) ?? {};
  const set = (data: Record<string, any>) => prisma.seoBlogPost.updateMany({ where: { id: p.id, workspaceId: ws }, data });
  const generated = !!p.content;
  const who = api.userId ? (await prisma.user.findUnique({ where: { id: api.userId }, select: { name: true } }))?.name ?? "" : "API";

  switch (String(b.action ?? "")) {
    case "schedule": {
      const when = madridToUtc(String(b.publishAt ?? ""), p.site.publishTime || "09:00");
      if (!when) throw new ApiError(400, "validation_error", "Fecha no válida");
      if (p.status === "publicada") throw new ApiError(400, "published", "El post ya está publicado.");
      const data: Record<string, any> = { publishAt: when };
      if (["propuesta", "descartada"].includes(p.status)) data.status = "planificada";
      if (p.status === "programada") data.status = "aprobada"; // reenviar con la nueva fecha
      await set(data);
      await seoLog(ws, { siteId: p.siteId, postId: p.id }, `Fecha de publicación: ${String(b.publishAt)} (${who})`);
      break;
    }
    case "unschedule":
      if (["programada", "publicada"].includes(p.status)) throw new ApiError(400, "remote", "Ya está en la web del cliente; cámbialo allí o elimínalo.");
      await set({ publishAt: null, status: generated ? "revision" : "propuesta", step: "" });
      break;
    case "discard":
      if (["programada", "publicada"].includes(p.status)) throw new ApiError(400, "remote", "Ya está en la web del cliente.");
      await set({ status: "descartada", publishAt: null });
      break;
    case "restore":
      await set({ status: "propuesta" });
      break;
    case "generate": {
      const from = (STEPS as readonly string[]).includes(b.from) ? b.from : "research";
      await set({
        status: "en_cola", step: from, error: null, attempts: 0, lockedUntil: null,
        ...(["research", "brief"].includes(from) ? { fixPasses: 0 } : {})
      });
      await seoLog(ws, { siteId: p.siteId, postId: p.id }, `Generación solicitada desde: ${STEP_LABELS[from]} (${who})`);
      break;
    }
    case "retry":
      await set({ status: p.step === "push" ? "aprobada" : "generando", error: null, lockedUntil: null });
      break;
    case "approve": {
      if (!generated) throw new ApiError(400, "not_generated", "El post aún no está redactado.");
      if (!p.publishAt) throw new ApiError(400, "no_date", "Asigna una fecha de publicación antes de aprobar.");
      await set({ status: "aprobada", step: "" });
      await seoLog(ws, { siteId: p.siteId, postId: p.id }, `Aprobado por ${who}`);
      if (b.pushNow) return NextResponse.json(await stepPost(ws, p.id));
      break;
    }
    case "back_to_review":
      await set({ status: "revision" });
      break;
    case "regen_image": {
      const site = await getSiteCtx(ws, p.siteId);
      try {
        await regenImage(p, site!, await getSeoBlogSettings(ws), Number(b.index) || 0, b.subject ? String(b.subject) : undefined);
      } catch (e: any) {
        throw new ApiError(400, "image_failed", e?.message ?? String(e));
      }
      if (p.status === "programada") await set({ status: "revision" });
      break;
    }
    case "poll_images": {
      const site = await getSiteCtx(ws, p.siteId);
      const pending = await pollImages(p, site!, await getSeoBlogSettings(ws));
      return NextResponse.json({ pending });
    }
    case "reaudit": {
      const a = analyze(p, p.site);
      await set({ seoScore: a.score, seoReport: a as any });
      break;
    }
    default:
      throw new ApiError(400, "validation_error", "Acción desconocida");
  }
  const after = await prisma.seoBlogPost.findFirst({ where: { id: p.id, workspaceId: ws }, select: { status: true, step: true, publishAt: true } });
  return NextResponse.json({ ok: true, ...after });
});
