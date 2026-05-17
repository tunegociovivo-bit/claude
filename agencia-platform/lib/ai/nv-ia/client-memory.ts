/**
 * Helpers de memoria persistente de Sonia — 3 capas:
 *   - CLIENT memory (Fase 8): por cliente, una fila por client.
 *   - WORKSPACE memory (Fase 17): global al workspace.
 *   - USER memory (Fase 17): por miembro del equipo.
 *
 * Las 3 capas comparten formato (markdown append-only con cap 50KB)
 * y la IA puede leerlas/editarlas con tools dedicadas. get_task_context
 * inyecta automáticamente las 3 al arrancar un run.
 */

import { prisma } from "@/lib/db/prisma";

const MAX_CONTENT_CHARS = 50_000;
const TRUNC_MARKER = "\n\n[...notas antiguas truncadas...]\n\n";

export type ClientMemoryNoteType =
  | "observation"
  | "preference"
  | "decision"
  | "rejected_draft"
  | "restriction";

const TYPE_LABEL: Record<ClientMemoryNoteType, string> = {
  observation: "Observación",
  preference: "Preferencia",
  decision: "Decisión",
  rejected_draft: "Borrador rechazado",
  restriction: "Restricción"
};

// ─────────────────────────────────────────────────────────────────
// Client memory (Fase 8)
// ─────────────────────────────────────────────────────────────────

export async function readClientMemory(
  workspaceId: string,
  clientId: string
): Promise<string> {
  const m = await prisma.aiClientMemory.findUnique({ where: { clientId } });
  if (!m || m.workspaceId !== workspaceId) return "";
  return m.content ?? "";
}

export async function appendClientMemoryNote(opts: {
  workspaceId: string;
  clientId: string;
  note: string;
  type?: ClientMemoryNoteType;
  by: string;
}): Promise<{ ok: true; size: number } | { ok: false; error: string }> {
  const clean = opts.note.trim();
  if (!clean) return { ok: false, error: "note vacío" };
  if (clean.length > 4000) return { ok: false, error: "note demasiado largo (>4000)" };
  const client = await prisma.client.findFirst({
    where: { id: opts.clientId, workspaceId: opts.workspaceId },
    select: { id: true }
  });
  if (!client) return { ok: false, error: "Cliente no encontrado en el workspace" };
  const next = appendNoteToContent(
    await readClientMemory(opts.workspaceId, opts.clientId),
    clean,
    opts.type ?? "observation",
    opts.by
  );
  await prisma.aiClientMemory.upsert({
    where: { clientId: opts.clientId },
    create: {
      workspaceId: opts.workspaceId,
      clientId: opts.clientId,
      content: next,
      updatedBy: opts.by
    },
    update: { content: next, updatedBy: opts.by }
  });
  return { ok: true, size: next.length };
}

export async function setClientMemory(opts: {
  workspaceId: string;
  clientId: string;
  content: string;
  by: string;
}): Promise<{ ok: true; size: number } | { ok: false; error: string }> {
  const client = await prisma.client.findFirst({
    where: { id: opts.clientId, workspaceId: opts.workspaceId },
    select: { id: true }
  });
  if (!client) return { ok: false, error: "Cliente no encontrado en el workspace" };
  const content = capContent(opts.content);
  await prisma.aiClientMemory.upsert({
    where: { clientId: opts.clientId },
    create: {
      workspaceId: opts.workspaceId,
      clientId: opts.clientId,
      content,
      updatedBy: opts.by
    },
    update: { content, updatedBy: opts.by }
  });
  return { ok: true, size: content.length };
}

// ─────────────────────────────────────────────────────────────────
// Workspace memory (Fase 17) — políticas/firma/horario global
// ─────────────────────────────────────────────────────────────────

export async function readWorkspaceMemory(workspaceId: string): Promise<string> {
  const m = await prisma.aiWorkspaceMemory.findUnique({ where: { workspaceId } });
  return m?.content ?? "";
}

export async function appendWorkspaceMemoryNote(opts: {
  workspaceId: string;
  note: string;
  type?: ClientMemoryNoteType;
  by: string;
}): Promise<{ ok: true; size: number } | { ok: false; error: string }> {
  const clean = opts.note.trim();
  if (!clean) return { ok: false, error: "note vacío" };
  if (clean.length > 4000) return { ok: false, error: "note demasiado largo (>4000)" };
  const next = appendNoteToContent(
    await readWorkspaceMemory(opts.workspaceId),
    clean,
    opts.type ?? "observation",
    opts.by
  );
  await prisma.aiWorkspaceMemory.upsert({
    where: { workspaceId: opts.workspaceId },
    create: { workspaceId: opts.workspaceId, content: next, updatedBy: opts.by },
    update: { content: next, updatedBy: opts.by }
  });
  return { ok: true, size: next.length };
}

export async function setWorkspaceMemory(opts: {
  workspaceId: string;
  content: string;
  by: string;
}): Promise<{ ok: true; size: number }> {
  const content = capContent(opts.content);
  await prisma.aiWorkspaceMemory.upsert({
    where: { workspaceId: opts.workspaceId },
    create: { workspaceId: opts.workspaceId, content, updatedBy: opts.by },
    update: { content, updatedBy: opts.by }
  });
  return { ok: true, size: content.length };
}

// ─────────────────────────────────────────────────────────────────
// User memory (Fase 17) — por miembro del equipo
// ─────────────────────────────────────────────────────────────────

export async function readUserMemory(workspaceId: string, userId: string): Promise<string> {
  const m = await prisma.aiUserMemory.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } }
  });
  return m?.content ?? "";
}

export async function appendUserMemoryNote(opts: {
  workspaceId: string;
  userId: string;
  note: string;
  type?: ClientMemoryNoteType;
  by: string;
}): Promise<{ ok: true; size: number } | { ok: false; error: string }> {
  const clean = opts.note.trim();
  if (!clean) return { ok: false, error: "note vacío" };
  if (clean.length > 4000) return { ok: false, error: "note demasiado largo (>4000)" };
  const m = await prisma.membership.findFirst({
    where: { workspaceId: opts.workspaceId, userId: opts.userId },
    select: { userId: true }
  });
  if (!m) return { ok: false, error: "user no pertenece al workspace" };
  const next = appendNoteToContent(
    await readUserMemory(opts.workspaceId, opts.userId),
    clean,
    opts.type ?? "observation",
    opts.by
  );
  await prisma.aiUserMemory.upsert({
    where: { workspaceId_userId: { workspaceId: opts.workspaceId, userId: opts.userId } },
    create: {
      workspaceId: opts.workspaceId,
      userId: opts.userId,
      content: next,
      updatedBy: opts.by
    },
    update: { content: next, updatedBy: opts.by }
  });
  return { ok: true, size: next.length };
}

export async function setUserMemory(opts: {
  workspaceId: string;
  userId: string;
  content: string;
  by: string;
}): Promise<{ ok: true; size: number } | { ok: false; error: string }> {
  const m = await prisma.membership.findFirst({
    where: { workspaceId: opts.workspaceId, userId: opts.userId },
    select: { userId: true }
  });
  if (!m) return { ok: false, error: "user no pertenece al workspace" };
  const content = capContent(opts.content);
  await prisma.aiUserMemory.upsert({
    where: { workspaceId_userId: { workspaceId: opts.workspaceId, userId: opts.userId } },
    create: {
      workspaceId: opts.workspaceId,
      userId: opts.userId,
      content,
      updatedBy: opts.by
    },
    update: { content, updatedBy: opts.by }
  });
  return { ok: true, size: content.length };
}

// ─────────────────────────────────────────────────────────────────
// Helpers internos
// ─────────────────────────────────────────────────────────────────

function appendNoteToContent(
  existing: string,
  note: string,
  type: ClientMemoryNoteType,
  by: string
): string {
  const date = new Date().toISOString().slice(0, 10);
  const line = `- **${date} · ${TYPE_LABEL[type]}** (por ${by}): ${note}`;
  let next = existing.trim() ? existing.trim() + "\n" + line : line;
  if (next.length > MAX_CONTENT_CHARS) {
    const target = MAX_CONTENT_CHARS - 2000;
    const excess = next.length - target;
    const idx = next.indexOf("\n", excess);
    next = TRUNC_MARKER + next.slice(idx >= 0 ? idx + 1 : excess);
  }
  return next;
}

function capContent(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length <= MAX_CONTENT_CHARS) return trimmed;
  return trimmed.slice(0, MAX_CONTENT_CHARS) + "\n\n[...truncado al cap de 50KB...]";
}
