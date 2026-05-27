/**
 * POST /api/v1/editorial/multi-client
 * Body: { clientIds[], title, content, scheduledFor, format, networks,
 *         hashtags?, firstComment?, adaptCopy? (default true) }
 *
 * Crea la MISMA publicación en N clientes a la vez. Si adaptCopy=true,
 * llama a Claude para adaptar el copy al brief de cada cliente.
 *
 * Útil para "día de la madre", "Black Friday", etc. — un mensaje base que
 * se quiere replicar en todos los clientes con su tono propio.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { complete, AIDisabledError } from "@/lib/ai/anthropic";

const schema = z.object({
  clientIds: z.array(z.string().min(1)).min(1),
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  scheduledFor: z.string().datetime(),
  format: z.string().default("imagen"),
  networks: z.array(z.string()).default(["instagram"]),
  hashtags: z.string().optional(),
  firstComment: z.string().optional(),
  adaptCopy: z.boolean().default(true)
});

async function adaptCopyForClient(opts: {
  workspaceId: string;
  baseCopy: string;
  client: { name: string; brandBrief: string | null };
}): Promise<string> {
  if (!opts.client.brandBrief?.trim()) return opts.baseCopy;
  const system = `Eres copywriter senior. Te paso un copy base + el brief del cliente. Devuelve SOLO el copy reescrito en el tono y voz de ese cliente. Misma idea, longitud parecida, sin preámbulos.`;
  const user = `## Brief del cliente "${opts.client.name}"
${opts.client.brandBrief}

## Copy base
${opts.baseCopy}`;
  return await complete({
    workspaceId: opts.workspaceId,
    feature: "editorial_multi_client_adapt",
    system,
    user,
    maxTokens: 1000
  });
}

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const clients = await prisma.client.findMany({
    where: { id: { in: parsed.data.clientIds }, workspaceId: api.workspaceId, deletedAt: null },
    select: { id: true, name: true, brandBrief: true }
  });
  if (clients.length === 0) throw new ApiError(404, "no_clients", "Ningún cliente válido");

  const created: string[] = [];
  for (const c of clients) {
    let copy = parsed.data.content;
    if (parsed.data.adaptCopy) {
      try {
        copy = await adaptCopyForClient({
          workspaceId: api.workspaceId,
          baseCopy: parsed.data.content,
          client: c
        });
      } catch (e: any) {
        if (e instanceof AIDisabledError) {
          // Si no hay API key, seguimos sin adaptar
          copy = parsed.data.content;
        } else {
          throw e;
        }
      }
    }
    const p = await prisma.editorialPost.create({
      data: {
        workspaceId: api.workspaceId,
        clientId: c.id,
        title: parsed.data.title,
        content: copy,
        hashtags: parsed.data.hashtags ?? null,
        firstComment: parsed.data.firstComment ?? null,
        format: parsed.data.format,
        networks: JSON.stringify(parsed.data.networks),
        scheduledFor: new Date(parsed.data.scheduledFor),
        status: "DRAFT",
        mediaUrls: "[]"
      }
    });
    created.push(p.id);
  }

  return NextResponse.json({ created: created.length, ids: created, adapted: parsed.data.adaptCopy });
});
