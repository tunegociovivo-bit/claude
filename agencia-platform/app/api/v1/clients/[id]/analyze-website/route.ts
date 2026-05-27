/**
 * POST /api/v1/clients/[id]/analyze-website
 * Body: { url?, save? }
 *
 * Llama a Claude para extraer summary, colores y fuentes de la web pública
 * del cliente. Si save=true, guarda colores en el cliente.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { analyzeClientWebsite } from "@/lib/editorial/analyze-client";
import { AIDisabledError } from "@/lib/ai/anthropic";
import { humanizeAiError } from "@/lib/ai/errors";

const schema = z.object({
  url: z.string().url().optional(),
  save: z.boolean().default(false)
});

export const POST = withApi({ scope: "clients:write" }, async (req, { params, api }) => {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const client = await prisma.client.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId, deletedAt: null }
  });
  if (!client) throw new ApiError(404, "not_found", "Cliente no encontrado");

  const url = parsed.data.url ?? client.website;
  if (!url) throw new ApiError(400, "no_url", "No hay URL del cliente. Rellénala primero o pásala en el body.");

  try {
    const out = await analyzeClientWebsite({ workspaceId: api.workspaceId, url });

    if (parsed.data.save) {
      await prisma.client.update({
        where: { id: client.id },
        data: {
          website: url,
          brandColorPrimary: out.brandColors.primary,
          brandColorAccent: out.brandColors.accent,
          brandColorText: out.brandColors.text
        }
      });
    }

    return NextResponse.json({ ...out, url, saved: parsed.data.save });
  } catch (e: any) {
    if (e instanceof AIDisabledError) throw new ApiError(503, "ai_disabled", e.message);
    console.error("[analyze-website] error:", e);
    const h = humanizeAiError(e);
    throw new ApiError(500, h.code, h.message);
  }
});
