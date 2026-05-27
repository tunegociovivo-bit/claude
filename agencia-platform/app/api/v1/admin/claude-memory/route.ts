/**
 * Notas editables de "Memoria Claude" — guardadas en
 * Workspace.settings.claudeMemory como Json (sin migración de schema).
 *
 * GET  → lista las notas existentes (nota = { id, title, body,
 *         createdAt, updatedAt }).
 * PUT  → reemplaza el array completo. Body: { notes: Note[] }.
 *
 * Solo admin. La idea es que el equipo añada aquí cosas que vayan
 * aprendiendo del proyecto y queden persistidas para futuras
 * sesiones (los detalles "estables" viven en código:
 * lib/claude-memory/contents.ts, en git).
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";

export const dynamic = "force-dynamic";

const noteSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(200),
  body: z.string().max(10000).default(""),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
});

const putSchema = z.object({
  notes: z.array(noteSchema).max(200)
});

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const settings = (ws?.settings as any) ?? {};
  const notes = settings?.claudeMemory?.notes ?? [];
  return NextResponse.json({ notes });
});

export const PUT = withApi({ scope: "*" }, async (req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const settings: any = (ws?.settings as any) ?? {};
  settings.claudeMemory ??= {};
  settings.claudeMemory.notes = parsed.data.notes;

  await prisma.workspace.update({
    where: { id: api.workspaceId },
    data: { settings }
  });

  return NextResponse.json({ ok: true, notes: parsed.data.notes });
});
