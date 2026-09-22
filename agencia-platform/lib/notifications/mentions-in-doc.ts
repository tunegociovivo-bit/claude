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

type Source = {
  kind: "task" | "document" | "comment";
  id: string;
  title: string;
  workspaceId: string;
  link?: string;
  text?: string | null;
};

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
        : "un comentario";
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
      workspaceId: opts.source.workspaceId,
      user: u,
      title: "Te han mencionado en el Hub",
      body,
      link,
      excerpt: opts.source.text
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
  workspaceId: string;
  user: { id: string; email: string; phone: string | null; name: string | null };
  title: string;
  body: string;
  link: string;
  excerpt?: string | null;
}) {
  const baseUrl = process.env.NEXTAUTH_URL ?? "https://hub.negociovivo.app";
  const url = `${baseUrl}${opts.link}`;
  const excerpt = opts.excerpt ? `\n\nTexto:\n${opts.excerpt.slice(0, 800)}` : "";
  await import("@/lib/integrations/email")
    .then(({ sendEmail }) =>
      sendEmail({
        workspaceId: opts.workspaceId,
        to: opts.user.email,
        subject: opts.title,
        text: `${opts.body}${excerpt}\n\nAbrir en el Hub: ${url}`,
        html: `<p>${escapeHtml(opts.body)}</p>${opts.excerpt ? `<p><strong>Texto:</strong></p><div style="white-space:pre-wrap">${escapeHtml(opts.excerpt.slice(0, 800))}</div>` : ""}<p><a href="${escapeHtml(url)}">Abrir en el Hub</a></p>`
      })
    )
    .catch((e) => console.warn("[email] mention fallo:", e?.message ?? e));

  if (!opts.user.phone) return;
  await import("@/lib/leads/waha")
    .then(async ({ normalizePhone, sendText }) => {
      const phoneNormalized = normalizePhone(opts.user.phone ?? "");
      if (!phoneNormalized) return;
      await sendText({
        workspaceId: opts.workspaceId,
        phoneNormalized,
        text: `*${opts.title}*\n\n${opts.body}${opts.excerpt ? `\n\n${opts.excerpt.slice(0, 600)}` : ""}\n\n${url}`
      });
    })
    .catch((e) => console.warn("[whatsapp] mention fallo:", e?.message ?? e));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
