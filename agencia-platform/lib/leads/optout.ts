/**
 * Bloqueo TOTAL de un lead ("no volver a contactar nunca").
 *
 * Un opt-out no es solo "no le mandes el siguiente mensaje": el usuario quiere
 * que ese negocio quede vetado de CUALQUIER acción en marcha y futura, haga la
 * búsqueda que haga. Eso implica cuatro cosas que antes se hacían a medias:
 *
 *   1. Opt-out permanente por TODOS sus teléfonos — el de la conversación (que
 *      puede ser un LID oculto de WhatsApp) Y los reales de su ficha (phone /
 *      internationalPhone). Así da igual por qué número reaparezca.
 *   2. Cancelar lo que esté EN MARCHA: mensajes en cola/enviándose, secuencias
 *      activas y secuencia a directivos.
 *   3. Marcar el LEAD como "excluded". search-manager preserva ese estado en
 *      re-búsquedas (unique por placeId), así que una búsqueda futura que
 *      re-encuentre el mismo negocio NO lo vuelve a poner "pending".
 *   4. Dejar rastro (reason) para que en la UI quede claro por qué no se le
 *      escribe.
 *
 * Idempotente: llamarlo dos veces no rompe nada.
 */

import { prisma } from "@/lib/db/prisma";
import { normalizePhone } from "./waha";

export type BlockLeadResult = {
  leadId: string | null;
  businessName: string | null;
  optoutPhones: string[];
  canceledMessages: number;
  stoppedSequences: number;
  stoppedExec: number;
  excludedLead: boolean;
};

export async function blockLeadCompletely(opts: {
  workspaceId: string;
  /** phoneNormalized de la conversación (puede ser un LID oculto). */
  phone?: string | null;
  leadId?: string | null;
  reason?: string | null;
  /** "ai_classification" | "manual" | ... */
  source?: string;
  countryCode?: string;
}): Promise<BlockLeadResult> {
  const { workspaceId } = opts;
  const source = opts.source ?? "manual";
  const reason = opts.reason ?? "Solicitó no ser contactado (opt-out)";
  const cc = opts.countryCode ?? "34";

  // 1. Resolver el lead (por id directo o por el teléfono de sus mensajes),
  //    para poder excluir el NEGOCIO y bloquear también su teléfono real.
  const leadSelect = { id: true, name: true, phone: true, internationalPhone: true, placeId: true } as const;
  let lead: { id: string; name: string | null; phone: string | null; internationalPhone: string | null; placeId: string } | null =
    null;
  if (opts.leadId) {
    lead = await prisma.lead.findFirst({ where: { id: opts.leadId, workspaceId }, select: leadSelect });
  }
  if (!lead && opts.phone) {
    const m = await prisma.leadMessage.findFirst({
      where: { workspaceId, phoneNormalized: opts.phone },
      orderBy: { createdAt: "desc" },
      select: { leadId: true }
    });
    if (m?.leadId) {
      lead = await prisma.lead.findFirst({ where: { id: m.leadId, workspaceId }, select: leadSelect });
    }
  }

  // 2. Reunir TODOS los teléfonos a vetar.
  const phones = new Set<string>();
  if (opts.phone) phones.add(opts.phone);
  for (const raw of [lead?.internationalPhone, lead?.phone]) {
    const n = normalizePhone(raw, cc);
    if (n) phones.add(n);
  }

  // 3. Opt-out permanente por cada teléfono (idempotente).
  for (const phone of phones) {
    await prisma.leadOptout
      .upsert({
        where: { workspaceId_phone: { workspaceId, phone } },
        create: { workspaceId, phone, leadId: lead?.id ?? opts.leadId ?? null, reason, source },
        update: { reason }
      })
      .catch(() => {});
  }

  // 4. Cancelar lo que esté EN MARCHA en la cola de envío (por cualquiera de sus
  //    teléfonos y por el leadId, por si algún mensaje tiene otro phoneNormalized).
  const or: any[] = [];
  if (phones.size) or.push({ phoneNormalized: { in: [...phones] } });
  if (lead) or.push({ leadId: lead.id });
  let canceledMessages = 0;
  if (or.length) {
    const res = await prisma.leadMessage.updateMany({
      where: { workspaceId, status: { in: ["queued", "sending"] }, OR: or },
      data: { status: "canceled", lastError: `Cancelado: ${reason}` }
    });
    canceledMessages = res.count;
  }

  // 5. Parar secuencias + exec-outreach y marcar el lead EXCLUIDO.
  let stoppedSequences = 0;
  let stoppedExec = 0;
  let excludedLead = false;
  if (lead) {
    const s = await prisma.leadSequenceAssignment.updateMany({
      where: { leadId: lead.id, status: "active" },
      data: { status: "stopped", stoppedReason: "opt_out", completedAt: new Date() }
    });
    stoppedSequences = s.count;
    const e = await prisma.leadExecOutreach
      .updateMany({ where: { leadId: lead.id, status: "active" }, data: { status: "stopped" } })
      .catch(() => ({ count: 0 }));
    stoppedExec = (e as any)?.count ?? 0;
    await prisma.lead.update({ where: { id: lead.id }, data: { contactStatus: "excluded" } }).catch(() => {});
    excludedLead = true;
  }

  // Apagamos el auto-seguimiento de la(s) conversación(es) de esos teléfonos
  // (además del veto por teléfono en optoutSet, esto lo deja explícito en la UI).
  if (phones.size) {
    await prisma.leadConversationMeta
      .updateMany({
        where: { workspaceId, phone: { in: [...phones] } },
        data: { autoFollowupOff: true }
      })
      .catch(() => {});
  }

  return {
    leadId: lead?.id ?? null,
    businessName: lead?.name ?? null,
    optoutPhones: [...phones],
    canceledMessages,
    stoppedSequences,
    stoppedExec,
    excludedLead
  };
}

/** ¿Este teléfono está vetado (opt-out) en el workspace? */
export async function isPhoneOptedOut(workspaceId: string, phone: string): Promise<boolean> {
  if (!phone) return false;
  const o = await prisma.leadOptout.findUnique({
    where: { workspaceId_phone: { workspaceId, phone } },
    select: { id: true }
  });
  return !!o;
}
