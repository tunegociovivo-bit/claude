/**
 * Notificación cuando alguien te menciona en una tarea, comentario o
 * documento. Crea aviso en el Hub y empuja canales externos best-effort.
 *
 * El diff de menciones es lo que importa: si el doc tenía X mencionado
 * antes y sigue ahí, no se vuelve a notificar. Solo los nuevos.
 */

import { prisma } from "@/lib/db/prisma";
import { sendPushToUser } from "@/lib/push/web-push";
import { extractMentionTokens, extractMentionUserIds, resolveMentions } from "@/lib/mentions";
import {
  focusOnMention,
  hasVisibleContent,
  richTextToEmailHtml,
  richTextToPlainText
} from "@/lib/notifications/rich-text";
import { buildMentionEmail } from "@/lib/notifications/mention-email";

type Source = {
  kind: "task" | "document" | "comment";
  id: string;
  title: string;
  workspaceId: string;
  link?: string;
  /**
   * Cuerpo rico donde está la mención (doc TipTap como objeto, JSON
   * stringified o texto plano legacy). Se renderiza para email/WhatsApp;
   * NUNCA se manda en crudo.
   *  - comment: el comentario completo.
   *  - task: la descripción.
   *  - document: el contenido del documento.
   */
  content?: unknown;
};

const EXCERPT_MAX_CHARS_EMAIL = 1200;
const EXCERPT_MAX_CHARS_WHATSAPP = 600;

export async function notifyNewMentions(opts: {
  source: Source;
  previousBody: any;
  nextBody: any;
  actorId: string | null | undefined;
}): Promise<void> {
  const workspaceUsers = await prisma.user.findMany({
    where: { memberships: { some: { workspaceId: opts.source.workspaceId } } },
    select: { id: true, email: true, name: true, phone: true }
  });
  const prevIds = new Set(resolveMentionIds(opts.previousBody, workspaceUsers));
  const nextIds = resolveMentionIds(opts.nextBody, workspaceUsers);
  const added = nextIds.filter((id) => !prevIds.has(id) && id !== opts.actorId);
  if (added.length === 0) return;

  const valid = workspaceUsers.filter((u) => added.includes(u.id));
  if (valid.length === 0) return;

  let actorName: string | null = null;
  if (opts.actorId) {
    const a = await prisma.user.findUnique({
      where: { id: opts.actorId },
      select: { name: true }
    });
    actorName = a?.name ?? null;
  }

  const where =
    opts.source.kind === "task"
      ? "la tarea"
      : opts.source.kind === "document"
        ? "el documento"
        : "un comentario de la tarea";
  const body = `${actorName ?? "Alguien"} te mencionó en ${where} "${opts.source.title}"`;
  const link = opts.source.link ?? (opts.source.kind === "task"
      ? `/tareas?task=${opts.source.id}`
      : opts.source.kind === "document"
        ? `/documentos/${opts.source.id}`
        : `/tareas?task=${opts.source.id}`);

  await prisma.notification.createMany({
    data: valid.map((u) => ({ userId: u.id, type: "mention", body, link }))
  });
  await Promise.all(
    valid.map((u) =>
      sendPushToUser(u.id, {
        title: "Te han mencionado",
        body,
        link,
        tag: `mention-${opts.source.kind}-${opts.source.id}`
      }).catch((e) => console.warn("[push] mention fallo:", e?.message ?? e))
    )
  );
  await Promise.all(
    valid.map((u) => notifyMentionOutsideHub({
      source: opts.source,
      user: u,
      actorName: actorName ?? "Alguien",
      body,
      link
    }))
  );
}

function resolveMentionIds<T extends { id: string; email: string; name: string | null }>(body: any, users: T[]): string[] {
  const direct = extractFromAny(body);
  const tokens = extractMentionTokens(textFromAny(body));
  const byToken = resolveMentions(tokens, users).map((u) => u.id);
  return Array.from(new Set([...direct, ...byToken]));
}

function extractFromAny(body: any): string[] {
  if (!body) return [];
  // Acepta tanto un string serializado como un objeto TipTap.
  if (typeof body === "string") return extractMentionUserIds(body);
  try {
    return extractMentionUserIds(JSON.stringify(body));
  } catch {
    return [];
  }
}

function textFromAny(body: any): string {
  if (!body) return "";
  if (typeof body === "string") return body;
  try {
    return JSON.stringify(body);
  } catch {
    return "";
  }
}

async function notifyMentionOutsideHub(opts: {
  source: Source;
  user: { id: string; email: string; phone: string | null; name: string | null };
  actorName: string;
  body: string;
  link: string;
}) {
  const { source, user } = opts;
  const baseUrl = (process.env.NEXTAUTH_URL ?? "https://hub.negociovivo.app").replace(/\/+$/, "");
  const url = `${baseUrl}${opts.link}`;

  // Fragmento a mostrar: el comentario entero, o en tareas/documentos
  // solo los bloques donde se menciona a este usuario.
  const raw = source.content;
  const excerptSource =
    raw == null || !hasVisibleContent(raw)
      ? null
      : source.kind === "comment"
        ? raw
        : focusOnMention(raw, user.id);

  const excerptHtml = excerptSource
    ? richTextToEmailHtml(excerptSource, { maxChars: EXCERPT_MAX_CHARS_EMAIL, highlightUserId: user.id })
    : { output: "", truncated: false };
  const excerptText = excerptSource
    ? richTextToPlainText(excerptSource, { maxChars: EXCERPT_MAX_CHARS_EMAIL })
    : { output: "", truncated: false };

  const labels =
    source.kind === "comment"
      ? { where: "un comentario", kind: "Tarea", cta: "Ver comentario" }
      : source.kind === "task"
        ? { where: "una tarea", kind: "Tarea", cta: "Abrir tarea" }
        : { where: "un documento", kind: "Documento", cta: "Abrir documento" };

  const email = buildMentionEmail({
    actorName: opts.actorName,
    whereLabel: labels.where,
    sourceTitle: source.title,
    sourceKindLabel: labels.kind,
    url,
    ctaLabel: labels.cta,
    excerptHtml: excerptHtml.output,
    excerptTruncated: excerptHtml.truncated,
    excerptText: excerptText.output
  });

  await import("@/lib/integrations/email")
    .then(({ sendEmail }) =>
      sendEmail({
        workspaceId: source.workspaceId,
        to: user.email,
        subject: email.subject,
        text: email.text,
        html: email.html
      })
    )
    .catch((e) => console.warn("[email] mention fallo:", e?.message ?? e));

  if (!user.phone) return;
  const waExcerpt = excerptSource
    ? richTextToPlainText(excerptSource, { maxChars: EXCERPT_MAX_CHARS_WHATSAPP, format: "whatsapp" }).output
    : "";
  await import("@/lib/leads/waha")
    .then(async ({ normalizePhone, sendText }) => {
      const phoneNormalized = normalizePhone(user.phone ?? "");
      if (!phoneNormalized) return;
      await sendText({
        workspaceId: source.workspaceId,
        phoneNormalized,
        text: `*Te han mencionado en el Hub*\n\n${opts.body}${waExcerpt ? `\n\n${waExcerpt}` : ""}\n\n${url}`
      });
    })
    .catch((e) => console.warn("[whatsapp] mention fallo:", e?.message ?? e));
}
