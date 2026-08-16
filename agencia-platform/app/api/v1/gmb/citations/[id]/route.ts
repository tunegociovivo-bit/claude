/**
 * Detalle y transición de una CITACIÓN.
 *  GET   → citación + historial de eventos + paquete de alta (NAP canónico).
 *  PATCH → aplica un comando de workflow (detect, prepare, submit, publish, flag_inconsistent,
 *          flag_duplicate, retry, reset) o, si se envía `napObserved`, REVALIDA comparando con el
 *          NAP canónico. Registra evento de auditoría.
 * Tenant-scoped: la citación se resuelve por workspace (guard antes de escribir).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { getCanonicalNap } from "@/lib/gmb/server";
import { computeCitationTransition, classifyObservation, buildSubmissionPacket, type CitationStatus, type CitationCommand } from "@/lib/gmb/citations/engine";
import { directoryBySlug } from "@/lib/gmb/citations/directories";

export const dynamic = "force-dynamic";

async function loadCitation(workspaceId: string, id: string) {
  // Guard de tenant: solo citaciones del workspace.
  const citation = await prisma.gmbCitation.findFirst({ where: { id, workspaceId } });
  if (!citation) return null;
  return citation;
}

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const citation = await loadCitation(api.workspaceId, params.id);
  if (!citation) throw new ApiError(404, "not_found", "Citación no encontrada");
  const [events, client] = await Promise.all([
    prisma.gmbCitationEvent.findMany({ where: { workspaceId: api.workspaceId, citationId: citation.id }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.gmbClient.findFirst({ where: { id: citation.clientId, workspaceId: api.workspaceId } })
  ]);
  const dir = directoryBySlug(citation.directorySlug);
  const packet = dir && client ? buildSubmissionPacket(dir, await getCanonicalNap(prisma, api.workspaceId, client)) : null;
  return NextResponse.json({ ok: true, citation, events, packet });
});

const patchSchema = z.object({
  command: z.enum(["detect", "prepare", "submit", "publish", "flag_inconsistent", "flag_duplicate", "retry", "reset", "mark_error"]).optional(),
  url: z.string().max(500).optional(),
  note: z.string().max(500).optional(),
  napObserved: z.object({ name: z.string().optional(), address: z.string().optional(), phone: z.string().optional(), website: z.string().optional() }).optional()
});

export const PATCH = withApi({ scope: "*" }, async (req, { params, api }) => {
  const citation = await loadCitation(api.workspaceId, params.id);
  if (!citation) throw new ApiError(404, "not_found", "Citación no encontrada");
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const from = citation.status as CitationStatus;
  const data: any = {};
  let toStatus: CitationStatus = from;
  let note = parsed.data.note ?? null;

  // Revalidación por observación: compara NAP observado con el canónico.
  if (parsed.data.napObserved) {
    const client = await prisma.gmbClient.findFirst({ where: { id: citation.clientId, workspaceId: api.workspaceId } });
    const canonical = client ? await getCanonicalNap(prisma, api.workspaceId, client) : { name: "", address: "", phone: "", website: "" };
    const { status, diff } = classifyObservation(canonical, parsed.data.napObserved, from);
    toStatus = status;
    data.napObserved = parsed.data.napObserved;
    data.diffs = diff;
    data.lastCheckedAt = new Date();
    note = note ?? "Revalidación de NAP observado";
  } else if (parsed.data.command) {
    const t = computeCitationTransition(from, parsed.data.command as CitationCommand);
    if (!t.ok) throw new ApiError(409, "invalid_transition", t.error ?? "Transición inválida");
    toStatus = t.next!;
    if (parsed.data.command === "mark_error") data.lastError = note ?? "error";
  } else {
    throw new ApiError(400, "missing_command", "Indica un command o napObserved");
  }
  if (parsed.data.url !== undefined) data.url = parsed.data.url;
  data.status = toStatus;

  // Guard de tenant en la escritura (updateMany con workspaceId).
  await prisma.gmbCitation.updateMany({ where: { id: citation.id, workspaceId: api.workspaceId }, data });
  await prisma.gmbCitationEvent.create({ data: { workspaceId: api.workspaceId, citationId: citation.id, fromStatus: from, toStatus, note, actorId: api.userId ?? null } });

  return NextResponse.json({ ok: true, id: citation.id, status: toStatus });
});
