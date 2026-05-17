/**
 * Helpers de memoria persistente de NV IA por cliente (Fase 8).
 *
 * - readClientMemory(workspaceId, clientId) → content actual (string vacío si no hay)
 * - appendClientMemoryNote(workspaceId, clientId, note, type, by) →
 *   añade una nota nueva al final con timestamp y prefijo de tipo.
 *
 * MAX_CONTENT_CHARS: 50_000. Si una append supera el cap, eliminamos
 * desde el inicio (las notas más antiguas) hasta tener hueco para la
 * nueva + margen, con una marca [...notas antiguas truncadas...].
 * En Fase 9 podríamos pedir a la IA que resuma cuando se acerque
 * al cap, en vez de truncar a saco.
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

export async function readClientMemory(
  workspaceId: string,
  clientId: string
): Promise<string> {
  const m = await prisma.aiClientMemory.findUnique({
    where: { clientId }
  });
  if (!m || m.workspaceId !== workspaceId) return "";
  return m.content ?? "";
}

export async function appendClientMemoryNote(opts: {
  workspaceId: string;
  clientId: string;
  note: string;
  type?: ClientMemoryNoteType;
  by: string; // "nv-ia" o userId
}): Promise<{ ok: true; size: number } | { ok: false; error: string }> {
  const clean = opts.note.trim();
  if (!clean) return { ok: false, error: "note vacío" };
  if (clean.length > 4000) return { ok: false, error: "note demasiado largo (>4000 chars)" };

  // Validamos que el cliente exista en el workspace antes de crear
  // memoria — si no, abrimos un AiClientMemory huérfano.
  const client = await prisma.client.findFirst({
    where: { id: opts.clientId, workspaceId: opts.workspaceId },
    select: { id: true }
  });
  if (!client) return { ok: false, error: "Cliente no encontrado en el workspace" };

  const date = new Date().toISOString().slice(0, 10);
  const type = opts.type ?? "observation";
  const line = `- **${date} · ${TYPE_LABEL[type]}** (por ${opts.by}): ${clean}`;

  const existing = await prisma.aiClientMemory.findUnique({
    where: { clientId: opts.clientId }
  });
  let nextContent: string;
  if (!existing) {
    nextContent = line;
  } else {
    nextContent = (existing.content ?? "").trim() + "\n" + line;
  }

  // Cap: si pasa el límite, recortamos por el principio dejando margen.
  if (nextContent.length > MAX_CONTENT_CHARS) {
    const target = MAX_CONTENT_CHARS - 2000; // 2KB de margen
    const excess = nextContent.length - target;
    const idx = nextContent.indexOf("\n", excess);
    nextContent = TRUNC_MARKER + nextContent.slice(idx >= 0 ? idx + 1 : excess);
  }

  await prisma.aiClientMemory.upsert({
    where: { clientId: opts.clientId },
    create: {
      workspaceId: opts.workspaceId,
      clientId: opts.clientId,
      content: nextContent,
      updatedBy: opts.by
    },
    update: {
      content: nextContent,
      updatedBy: opts.by
    }
  });

  return { ok: true, size: nextContent.length };
}

/**
 * Reemplaza completamente la memoria de un cliente (para edición
 * manual del admin desde UI). Aplica el mismo cap.
 */
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

  let content = opts.content.trim();
  if (content.length > MAX_CONTENT_CHARS) {
    content = content.slice(0, MAX_CONTENT_CHARS) + "\n\n[...truncado al cap de 50KB...]";
  }
  await prisma.aiClientMemory.upsert({
    where: { clientId: opts.clientId },
    create: {
      workspaceId: opts.workspaceId,
      clientId: opts.clientId,
      content,
      updatedBy: opts.by
    },
    update: {
      content,
      updatedBy: opts.by
    }
  });
  return { ok: true, size: content.length };
}
