/**
 * POST /api/v1/leads/queue/enqueue-bulk
 * Body: { leadIds, templateId?, kind?, mix? }
 *
 * Encola mensajes de WhatsApp para varios leads (campaña). Soporta:
 *  - kind único: "text" | "ranking" (imagen+pie) | "text_then_image" |
 *    "voice" (nota de voz) | "voice_image" (imagen + voz) | "alternate".
 *  - mix: reparto por porcentajes entre formatos (anti-baneo + flexibilidad),
 *    p. ej. [{kind:"voice_image",percent:25},{kind:"ranking",percent:35},...].
 *
 * IMPORTANTE: el bucle es SECUENCIAL a propósito. enqueueMessage encadena cada
 * mensaje tras el último programado para ESPACIARLOS (anti-baneo).
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { enqueueMessage } from "@/lib/leads/send-queue";
import { EMAIL_ONLY_REASON, isEmailOnlyLead } from "@/lib/leads/email-only";

const FORMAT = z.enum(["text", "ranking", "text_then_image", "voice", "voice_image"]);

const schema = z.object({
  leadIds: z.array(z.string().min(1)).min(1).max(2000),
  templateId: z.string().min(1).nullable().optional(),
  kind: z.enum(["text", "ranking", "text_then_image", "voice", "voice_image", "alternate"]).optional(),
  // Reparto por porcentajes (si viene, manda sobre `kind`).
  mix: z.array(z.object({ kind: FORMAT, percent: z.number().min(0).max(100) })).optional(),
  // Si true, borra los mensajes EN COLA (no enviados) de estos leads antes de
  // reencolar, para poder cambiar el formato de leads ya encolados.
  replaceQueued: z.boolean().optional()
});

type Format = z.infer<typeof FORMAT>;

// Formatos que necesitan texto de plantilla (texto a enviar o guion de voz).
const NEEDS_TEXT: Record<Format, boolean> = {
  text: true,
  ranking: false, // el pie es opcional (auto)
  text_then_image: true,
  voice: true,
  voice_image: true
};

/** Asigna un formato a cada lead repartiendo según porcentajes, intercalado
 *  (greedy por mayor déficit) para que los formatos queden mezclados en el
 *  tiempo (mejor anti-baneo) y cuadren los conteos. */
function buildAssignment(n: number, mix: { kind: Format; percent: number }[]): Format[] {
  const total = mix.reduce((s, m) => s + m.percent, 0) || 1;
  const targets = mix.map((m) => ({ kind: m.kind, target: (m.percent / total) * n, assigned: 0 }));
  const out: Format[] = [];
  for (let i = 0; i < n; i++) {
    let best = targets[0];
    for (const t of targets) {
      if (t.target - t.assigned > best.target - best.assigned) best = t;
    }
    out.push(best.kind);
    best.assigned++;
  }
  return out;
}

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const singleKind = parsed.data.kind ?? "text";
  const mix = parsed.data.mix?.filter((m) => m.percent > 0) ?? null;

  // ¿Algún formato implicado necesita texto de plantilla?
  const usedFormats: Format[] = mix
    ? mix.map((m) => m.kind)
    : singleKind === "alternate"
      ? ["ranking", "text_then_image"]
      : [singleKind as Format];
  const needsTemplate = usedFormats.some((f) => NEEDS_TEXT[f]);

  // Resolver plantilla: la elegida → la default → cualquiera (si hace falta texto).
  let tpl = parsed.data.templateId
    ? await prisma.leadTemplate.findFirst({ where: { id: parsed.data.templateId, workspaceId: api.workspaceId } })
    : null;
  if (!tpl && needsTemplate) {
    tpl = await prisma.leadTemplate.findFirst({ where: { workspaceId: api.workspaceId, isDefault: true } });
  }
  if (!tpl && needsTemplate) {
    tpl = await prisma.leadTemplate.findFirst({ where: { workspaceId: api.workspaceId } });
  }
  if (!tpl && needsTemplate) {
    throw new ApiError(400, "no_template", "No hay ninguna plantilla. Crea una en la pestaña Plantillas.");
  }

  // Orden por urgencia/score (los más calientes primero).
  const allLeads = await prisma.lead.findMany({
    where: { id: { in: parsed.data.leadIds }, workspaceId: api.workspaceId },
    select: { id: true, score: true, urgency: true, placeId: true, rawData: true, search: { select: { source: true } } }
  });
  // Orígenes solo-email (Franquicias): fuera ANTES de encolar, con aviso claro.
  // enqueueMessage también los rechaza (cierre central); esto evita meterlos en
  // el bucle y da un conteo legible en la respuesta.
  const emailOnly = allLeads.filter((l) => isEmailOnlyLead(l));
  const leadsForOrder = allLeads.filter((l) => !isEmailOnlyLead(l));
  const emailOnlySkipped = emailOnly.map((l) => ({ leadId: l.id, reason: EMAIL_ONLY_REASON }));
  const URGENCY_RANK: Record<string, number> = { critica: 0, alta: 1, media: 2, baja: 3, descartar: 4 };
  const orderedIds = leadsForOrder
    .slice()
    .sort((a, b) => {
      const ua = URGENCY_RANK[a.urgency ?? ""] ?? 5;
      const ub = URGENCY_RANK[b.urgency ?? ""] ?? 5;
      if (ua !== ub) return ua - ub;
      return (b.score ?? 0) - (a.score ?? 0);
    })
    .map((l) => l.id);
  const known = new Set(orderedIds);
  const emailOnlyIds = new Set(emailOnly.map((l) => l.id));
  for (const id of parsed.data.leadIds) if (!known.has(id) && !emailOnlyIds.has(id)) orderedIds.push(id);

  // Reemplazar: borra lo pendiente (status "queued") de estos leads para poder
  // reencolar con otro formato. No toca "sending"/"sent".
  let replacedQueued = 0;
  if (parsed.data.replaceQueued && orderedIds.length > 0) {
    const del = await prisma.leadMessage.deleteMany({
      where: { workspaceId: api.workspaceId, leadId: { in: orderedIds }, status: "queued" }
    });
    replacedQueued = del.count;
  }

  // Formato por lead: del mix, del alternate, o el kind único.
  const assignment: Format[] = mix
    ? buildAssignment(orderedIds.length, mix)
    : orderedIds.map((_, i) =>
        singleKind === "alternate" ? (i % 2 === 0 ? "ranking" : "text_then_image") : (singleKind as Format)
      );

  const tplBody = tpl?.body ?? "";
  const tplId = tpl?.id ?? null;
  async function enqueueForLead(leadId: string, fmt: Format) {
    if (fmt === "text" || fmt === "ranking" || fmt === "voice") {
      await enqueueMessage({ workspaceId: api.workspaceId, leadId, body: tplBody, templateId: tplId, kind: fmt });
    } else if (fmt === "text_then_image") {
      await enqueueMessage({ workspaceId: api.workspaceId, leadId, body: tplBody, templateId: tplId, kind: "text" });
      await enqueueMessage({ workspaceId: api.workspaceId, leadId, body: "", templateId: null, kind: "ranking", skipDuplicateCheck: true });
    } else if (fmt === "voice_image") {
      // Imagen (sin pie) + nota de voz con el guion de la plantilla.
      await enqueueMessage({ workspaceId: api.workspaceId, leadId, body: "", templateId: null, kind: "ranking" });
      await enqueueMessage({ workspaceId: api.workspaceId, leadId, body: tplBody, templateId: tplId, kind: "voice", skipDuplicateCheck: true });
    }
  }

  // Encolar. El render por lead (consulta a Places + plantilla + variación IA)
  // es costoso; con muchos leads, hacerlo dentro de la request agota el timeout
  // del gateway (502). Por eso, a partir de cierto volumen, lo procesamos EN
  // SEGUNDO PLANO (el servidor de Node es persistente) y respondemos al instante.
  async function runEnqueue(): Promise<{ ok: number; skipped: { leadId: string; reason: string }[] }> {
    let ok = 0;
    const skipped: { leadId: string; reason: string }[] = [];
    for (let i = 0; i < orderedIds.length; i++) {
      try {
        await enqueueForLead(orderedIds[i], assignment[i]);
        ok++;
      } catch (e: any) {
        skipped.push({ leadId: orderedIds[i], reason: e?.message ?? "error" });
      }
    }
    return { ok, skipped };
  }

  const BACKGROUND_THRESHOLD = 20;
  if (orderedIds.length > BACKGROUND_THRESHOLD) {
    // Sin await: sigue ejecutándose tras responder. Los mensajes van
    // apareciendo en la cola conforme se procesan (se ven al refrescar).
    runEnqueue()
      .then((r) => console.log(`[enqueue-bulk] async OK=${r.ok} skipped=${r.skipped.length} de ${orderedIds.length}`))
      .catch((e) => console.warn("[enqueue-bulk] async error:", (e as Error)?.message ?? e));
    return NextResponse.json({
      async: true,
      total: parsed.data.leadIds.length,
      queued: orderedIds.length,
      templateName: tpl?.name ?? null,
      replacedQueued,
      emailOnlySkipped: emailOnlySkipped.length
    });
  }

  const { ok, skipped } = await runEnqueue();
  return NextResponse.json({
    ok,
    skipped: [...emailOnlySkipped, ...skipped],
    total: parsed.data.leadIds.length,
    templateName: tpl?.name ?? null,
    replacedQueued,
    emailOnlySkipped: emailOnlySkipped.length
  });
});
