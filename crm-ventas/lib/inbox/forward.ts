import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { downloadBuffer } from "@/lib/storage/r2";
import { sendMedia, sendText, WahaSendError, type MediaSendKind } from "@/lib/waha";
import { ensurePrimaryLine, refreshLineStatus } from "@/lib/inbox/lines";
import { noteLineSendFailure } from "@/lib/inbox/outbound";
import { madridDayStart } from "@/lib/inbox/time";
import { getLeadsState } from "@/lib/leads/settings";
import { last9 } from "@/lib/phone";
import { extensionFor, MEDIA_LABEL, type StoredMedia } from "@/lib/inbox/media-core";

export const MAX_FORWARD_ITEMS = 20;
const FORWARD_LOCK_MS = 6 * 60_000; // > peor caso de 20 archivos con sus pausas

export class ForwardError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export type ForwardItemResult = { id: string; ok: boolean; error?: string; ambiguous?: boolean };
export type ForwardResult = {
  target: { id: string; label: string; phone: string };
  line: { id: string; label: string };
  sent: number;
  results: ForwardItemResult[];
  stoppedEarly: boolean;
};

// Resultado de reenvíos recientes (para devolver lo mismo si el móvil repite la
// petición). La protección real contra duplicados está en la BD (clave única).
const g = globalThis as typeof globalThis & { __forwardResults?: Map<string, { at: number; result: ForwardResult }> };
const recentResults: Map<string, { at: number; result: ForwardResult }> = (g.__forwardResults ??= new Map());
const RESULT_TTL_MS = 30 * 60_000;

function mediaSendKind(media: StoredMedia): MediaSendKind {
  switch (media.kind) {
    case "image":
    case "sticker":
      return "image";
    case "video":
      return "video";
    case "voice":
    case "audio":
      return "voice";
    default:
      return "file";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Reenvía mensajes de un chat (texto y archivos) a un destino de «ENVIAR A»,
// desde el MISMO número por el que se habla con el cliente. Cada envío queda
// registrado como salida del número (cuenta en sus límites diarios y por hora),
// se toma el bloqueo de envío del número y un fallo grave pausa el número igual
// que en la cola normal.
export async function forwardMessages(opts: {
  workspaceId: string;
  conversationId: string;
  messageIds: string[];
  targetId: string;
  userId: string;
  idempotencyKey?: string | null;
}): Promise<ForwardResult> {
  const now = Date.now();
  for (const [k, v] of recentResults) if (now - v.at > RESULT_TTL_MS) recentResults.delete(k);
  const batchKey = opts.idempotencyKey ? `fwd:${opts.workspaceId}:${opts.idempotencyKey}`.slice(0, 120) : null;
  if (batchKey) {
    const seen = recentResults.get(batchKey);
    if (seen) return seen.result;
    if (await prisma.outboundMessage.findUnique({ where: { idempotencyKey: batchKey }, select: { id: true } })) {
      throw new ForwardError("Este reenvío ya se hizo. Si falta algo, selecciónalo y vuelve a enviarlo.", 409);
    }
  }

  const leads = await getLeadsState(opts.workspaceId);
  if (!leads.enabled) throw new ForwardError("El reenvío no está activado en tu cuenta", 403);
  const target = leads.forwardTargets.find((t) => t.id === opts.targetId);
  if (!target) throw new ForwardError("Ese destino ya no existe: revísalo en Ajustes", 404);

  const ids = [...new Set(opts.messageIds)].slice(0, MAX_FORWARD_ITEMS);
  if (!ids.length) throw new ForwardError("Selecciona al menos un mensaje", 400);

  const conversation = await prisma.conversation.findFirst({ where: { id: opts.conversationId, workspaceId: opts.workspaceId } });
  if (!conversation) throw new ForwardError("Conversación no encontrada", 404);
  let line = conversation.lineId
    ? await prisma.whatsappLine.findFirst({ where: { id: conversation.lineId, workspaceId: opts.workspaceId } })
    : await ensurePrimaryLine(opts.workspaceId);
  if (!line) throw new ForwardError("El número de este chat ya no está conectado al CRM", 409);
  if (!line.active) throw new ForwardError(`El número ${line.label} está desactivado para enviar`, 409);
  if (line.pausedUntil && line.pausedUntil.getTime() > now) {
    throw new ForwardError(`El número ${line.label} está en pausa de seguridad`, 409);
  }
  line = await refreshLineStatus(line, 30_000);
  if (line.lastStatus !== "WORKING") {
    throw new ForwardError(`El WhatsApp de ${line.label} no está conectado ahora mismo`, 409);
  }
  if (line.phone && last9(line.phone) === last9(target.phone)) {
    throw new ForwardError(`Este chat ya va por el número de ${target.label}`, 400);
  }

  const messages = await prisma.message.findMany({
    where: { id: { in: ids }, workspaceId: opts.workspaceId, phone: conversation.phone },
    orderBy: { createdAt: "asc" },
    select: { id: true, body: true, meta: true },
  });
  if (!messages.length) throw new ForwardError("No se encontraron esos mensajes en este chat", 404);

  // Límites del número (los mismos que la cola anti-baneo).
  const [sentToday, sentLastHour] = await Promise.all([
    prisma.outboundMessage.count({ where: { lineId: line.id, status: "sent", sentAt: { gte: madridDayStart(new Date(now)) } } }),
    prisma.outboundMessage.count({ where: { lineId: line.id, status: "sent", sentAt: { gte: new Date(now - 3600_000) } } }),
  ]);
  if (sentToday + messages.length > line.dailyLimit) {
    throw new ForwardError(`El número ${line.label} llegaría a su límite diario (${line.dailyLimit} mensajes). Reenvía menos o mañana.`, 429);
  }
  if (sentLastHour + messages.length > line.hourlyLimit) {
    throw new ForwardError(`El número ${line.label} llegaría a su límite por hora (${line.hourlyLimit}). Espera unos minutos.`, 429);
  }

  // Un envío a la vez por número (compartido con la cola de salida).
  const lockValue = new Date(Date.now() + FORWARD_LOCK_MS);
  const lineId = line.id;
  let locked = 0;
  for (let i = 0; i < 6 && !locked; i++) {
    const t = new Date();
    locked = (
      await prisma.whatsappLine.updateMany({
        where: { id: lineId, OR: [{ sendLockUntil: null }, { sendLockUntil: { lt: t } }] },
        data: { sendLockUntil: lockValue },
      })
    ).count;
    if (!locked) await sleep(1500);
  }
  if (!locked) throw new ForwardError(`El número ${line.label} está enviando otro mensaje; vuelve a pulsar en unos segundos`, 409);
  const unlock = () =>
    prisma.whatsappLine.updateMany({ where: { id: lineId, sendLockUntil: lockValue }, data: { sendLockUntil: null } }).catch(() => undefined);

  const results: ForwardItemResult[] = [];
  let stoppedEarly = false;
  let anySent = false;
  let keyAssigned = false;
  try {
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      const media = (m.meta as any)?.media as StoredMedia | undefined;
      if (media?.kind && !media.key) {
        results.push({
          id: m.id,
          ok: false,
          error: media.pending ? "Este archivo aún se está descargando: espera unos segundos" : "Este archivo no llegó al CRM: reenvíalo desde el móvil",
        });
        continue; // hueco conocido: no rompe el orden del resto
      }
      // Registro previo («sending»): la clave única del lote evita que se envíe
      // dos veces aunque la petición llegue repetida o a otra instancia.
      let row;
      try {
        row = await prisma.outboundMessage.create({
          data: {
            workspaceId: opts.workspaceId,
            lineId,
            // No es una respuesta al cliente: no cuenta como mensaje en su chat.
            conversationId: `fwd:${conversation.id}`,
            phone: target.phone,
            chatId: `${target.phone}@c.us`,
            body: media?.kind ? `${MEDIA_LABEL[media.kind]} (reenvío)` : m.body.slice(0, 4000),
            origin: "forward",
            status: "sending",
            claimedAt: new Date(),
            userId: opts.userId,
            // La clave del lote va en la primera fila realmente creada.
            idempotencyKey: !keyAssigned && batchKey ? batchKey : null,
          },
        });
        keyAssigned = true;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new ForwardError("Este reenvío ya se está enviando", 409);
        }
        throw error;
      }
      try {
        if (media?.kind) {
          const data = await downloadBuffer(media.key!);
          await sendMedia({
            workspaceId: opts.workspaceId,
            session: line.sessionName,
            to: target.phone,
            kind: mediaSendKind(media),
            data,
            mimetype: media.mimetype,
            filename: media.filename ?? `${media.kind === "image" ? "foto" : media.kind}.${extensionFor(media.mimetype, media.kind)}`,
            caption: media.caption,
          });
        } else {
          await sendText({ workspaceId: opts.workspaceId, session: line.sessionName, to: target.phone, text: m.body });
        }
        anySent = true;
        await prisma.outboundMessage.update({ where: { id: row.id }, data: { status: "sent", sentAt: new Date() } });
        results.push({ id: m.id, ok: true });
        await recordForward(m.id, target, opts.userId).catch(() => undefined);
      } catch (error) {
        // Fallo antes de llamar a WhatsApp (archivo no legible): seguro que no salió.
        const ambiguous = error instanceof WahaSendError ? error.ambiguous : false;
        await prisma.outboundMessage
          .update({ where: { id: row.id }, data: { status: "failed", lastError: String((error as Error)?.message ?? error).slice(0, 500) } })
          .catch(() => undefined);
        if (error instanceof WahaSendError) await noteLineSendFailure(line, error).catch(() => undefined);
        results.push({
          id: m.id,
          ok: false,
          ambiguous,
          error: ambiguous
            ? "WhatsApp no confirmó el envío: puede haber llegado. Revisa el chat del destino antes de repetirlo."
            : `No se pudo enviar: ${(error as Error).message}`.slice(0, 300),
        });
        // Se para para no desordenar ni duplicar lo que queda.
        stoppedEarly = i < messages.length - 1;
        break;
      }
      if (i < messages.length - 1) await sleep(1500 + Math.round(Math.random() * 1500));
    }
  } finally {
    await unlock();
  }

  if (anySent) {
    await prisma.whatsappLine.update({ where: { id: lineId }, data: { lastSentAt: new Date(), consecutiveFailures: 0 } }).catch(() => undefined);
  }
  const result: ForwardResult = {
    target: { id: target.id, label: target.label, phone: target.phone },
    line: { id: lineId, label: line.label },
    sent: results.filter((r) => r.ok).length,
    results,
    stoppedEarly,
  };
  if (batchKey) recentResults.set(batchKey, { at: Date.now(), result });
  return result;
}

// Marca en el mensaje original a quién se ha reenviado (se ve en el chat).
async function recordForward(messageId: string, target: { id: string; label: string }, userId: string) {
  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ meta: unknown }>>`SELECT "meta" FROM "Message" WHERE "id" = ${messageId} FOR UPDATE`;
    const meta = { ...((rows[0]?.meta as Record<string, any>) ?? {}) };
    const forwards = Array.isArray(meta.forwards) ? meta.forwards.slice(-9) : [];
    forwards.push({ targetId: target.id, label: target.label, at: new Date().toISOString(), by: userId });
    meta.forwards = forwards;
    await tx.message.update({ where: { id: messageId }, data: { meta } });
  });
}
