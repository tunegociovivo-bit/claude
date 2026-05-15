/**
 * POST /api/v1/editorial/generate-month
 *
 * Genera N publicaciones para un cliente y un mes con Claude, usando el brief
 * de marca, los colores y la guía de estilo cacheada (si existe).
 *
 * Migra "generar-mes-ai" del plugin NV Dashboard. Solo texto (las imágenes
 * llegan en fase F).
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { generateMonth } from "@/lib/editorial/generate-month";
import { AIDisabledError } from "@/lib/ai/anthropic";

const schema = z.object({
  clientId: z.string().min(1),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  count: z.number().int().min(1).max(40).default(14),
  networks: z.array(z.string()).min(1).default(["instagram"]),
  mix: z
    .object({
      imagen: z.number().min(0).max(100).optional(),
      reel: z.number().min(0).max(100).optional(),
      carrusel: z.number().min(0).max(100).optional(),
      story: z.number().min(0).max(100).optional(),
      video: z.number().min(0).max(100).optional()
    })
    .optional(),
  copyLength: z.number().int().min(0).max(100).default(50),
  perNetworkCopy: z.boolean().default(false),
  extraGuidance: z.string().optional(),
  status: z.enum(["DRAFT", "REVIEW"]).default("DRAFT")
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  try {
    const result = await generateMonth({
      workspaceId: api.workspaceId,
      userId: api.userId,
      ...parsed.data
    });
    return NextResponse.json(result);
  } catch (e: any) {
    if (e instanceof AIDisabledError) {
      throw new ApiError(503, "ai_disabled", e.message);
    }
    if (e?.message === "Cliente no encontrado") {
      throw new ApiError(404, "client_not_found", e.message);
    }
    console.error("[generate-month] error:", e);
    throw new ApiError(502, "ai_error", String(e?.message ?? e).slice(0, 300));
  }
});
