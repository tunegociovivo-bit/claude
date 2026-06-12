/**
 * PATCH /api/v1/leads/inbox/conversation-meta   { phone, note?, priority? }
 *
 * Guarda los metadatos de una conversación del inbox multi-WhatsApp: nota
 * libre ("es el dueño de la pizzería X, quiere info en septiembre") y
 * prioridad (alta | media | baja | none) para ordenar a quién atender antes.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

const schema = z.object({
  phone: z.string().min(5).max(40),
  note: z.string().max(2000).nullable().optional(),
  displayName: z.string().max(80).nullable().optional(),
  priority: z.enum(["alta", "media", "baja", "none"]).optional()
});

export const PATCH = withApi({ scope: "*" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const { phone, note, displayName, priority } = parsed.data;

  const data: any = {};
  if (note !== undefined) data.note = note?.trim() ? note.trim() : null;
  if (displayName !== undefined) data.displayName = displayName?.trim() ? displayName.trim() : null;
  if (priority !== undefined) data.priority = priority;

  const meta = await prisma.leadConversationMeta.upsert({
    where: { workspaceId_phone: { workspaceId: api.workspaceId, phone } },
    create: { workspaceId: api.workspaceId, phone, ...data },
    update: data
  });
  return NextResponse.json({ ok: true, note: meta.note, displayName: meta.displayName, priority: meta.priority });
});
