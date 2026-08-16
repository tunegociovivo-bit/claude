/**
 * execute_safe — ejecución de acciones internas REVERSIBLES únicamente. NUNCA publica nada externo.
 *
 * El PLANIFICADOR (puro) decide qué efecto seguro corresponde a una acción; el EJECUTOR lo aplica de
 * forma IDEMPOTENTE y auditable. Los tres efectos seguros son:
 *   - content_draft : crear un GmbPost en estado "draft" (borrador, no publica),
 *   - nap_packets   : preparar paquetes de alta/corrección NAP y dejar las citaciones "prepared",
 *   - note          : registrar la acción interna (sin artefacto externo).
 * Cualquier acción EXTERNA se bloquea aquí: requiere aprobación y su publicación es otra vía.
 */
import { buildSubmissionPacket } from "./citations/engine";
import { directoryBySlug } from "./citations/directories";
import { getCanonicalNap } from "./server";

export type SafeEffectKind = "content_draft" | "nap_packets" | "note" | "blocked";
export type SafeEffectPlan = { kind: SafeEffectKind; reason?: string };

/** Decide el efecto seguro (puro). Las acciones externas nunca se ejecutan como efecto interno. */
export function planSafeEffect(action: { module: string; type: string; external: boolean }): SafeEffectPlan {
  if (action.external) return { kind: "blocked", reason: "acción externa: requiere aprobación y publicación por su propia vía" };
  const t = (action.type || "").toLowerCase();
  const m = (action.module || "").toLowerCase();
  if (m === "content" || /post|foto|photo|contenido|novedad/.test(t)) return { kind: "content_draft" };
  if (m === "citations" || /citation|nap|inconsist|alta|directorio|seed/.test(t)) return { kind: "nap_packets" };
  return { kind: "note" };
}

type PrismaLike = any;

/** Aplica el efecto seguro de forma idempotente. Devuelve el resultado para guardar en action.result. */
export async function applySafeEffect(
  prisma: PrismaLike,
  workspaceId: string,
  action: { id: string; clientId: string; module: string; type: string; title: string; external: boolean; evidence?: any; result?: any },
  actorId: string | null
): Promise<{ ok: boolean; result: any; error?: string }> {
  const plan = planSafeEffect(action);
  if (plan.kind === "blocked") return { ok: false, result: null, error: plan.reason };

  // Idempotencia: si ya se aplicó (result con artefacto), no repetir.
  if (action.result && action.result.kind === plan.kind && (action.result.postId || action.result.prepared != null || action.result.kind === "note")) {
    return { ok: true, result: action.result };
  }

  if (plan.kind === "content_draft") {
    const content = typeof action.evidence?.draft === "string" ? action.evidence.draft : `Borrador generado desde la acción «${action.title}». Edítalo antes de programar.`;
    const post = await prisma.gmbPost.create({ data: { workspaceId, clientId: action.clientId, title: action.title.slice(0, 120), content, status: "draft", createdById: actorId } });
    return { ok: true, result: { kind: "content_draft", postId: post.id, note: "Borrador de publicación creado (no publicado)." } };
  }

  if (plan.kind === "nap_packets") {
    const client = await prisma.gmbClient.findFirst({ where: { id: action.clientId, workspaceId } });
    if (!client) return { ok: false, result: null, error: "ficha no encontrada" };
    const canonical = await getCanonicalNap(prisma, workspaceId, client);
    // Citaciones que requieren alta/corrección.
    const cites = await prisma.gmbCitation.findMany({ where: { workspaceId, clientId: action.clientId, status: { in: ["not_found", "inconsistent", "pending"] } }, select: { id: true, directorySlug: true, status: true } });
    const packets: any[] = [];
    let prepared = 0;
    for (const c of cites) {
      const dir = directoryBySlug(c.directorySlug);
      if (dir) packets.push(buildSubmissionPacket(dir, canonical));
      // Transición idempotente a "prepared" (reversible; auditada por el llamante).
      const res = await prisma.gmbCitation.updateMany({ where: { id: c.id, workspaceId, status: { in: ["not_found", "inconsistent", "pending"] } }, data: { status: "prepared" } });
      if ((res.count ?? 0) > 0) {
        prepared++;
        await prisma.gmbCitationEvent.create({ data: { workspaceId, citationId: c.id, fromStatus: c.status, toStatus: "prepared", note: `Preparada por acción ${action.type}`, actorId } });
      }
    }
    return { ok: true, result: { kind: "nap_packets", prepared, packets: packets.slice(0, 20), note: `${prepared} citación(es) preparada(s); paquetes de alta/corrección generados.` } };
  }

  return { ok: true, result: { kind: "note", note: "Acción interna registrada." } };
}
