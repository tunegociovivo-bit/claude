/**
 * POST /api/v1/editorial/posts/[id]/ai-action
 * Body: { action, customInstruction?, apply? }
 *
 * Si apply=true, también persiste el resultado en el post (content/hashtags)
 * y crea una EditorialRevision.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { runAiAction, AI_ACTIONS, type AiAction } from "@/lib/editorial/ai-actions";
import { AIDisabledError } from "@/lib/ai/anthropic";
import { humanizeAiError } from "@/lib/ai/errors";

const ACTION_KEYS = Object.keys(AI_ACTIONS) as [AiAction, ...AiAction[]];

const schema = z.object({
  action: z.enum(ACTION_KEYS),
  customInstruction: z.string().optional(),
  apply: z.boolean().default(false)
});

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  try {
    const out = await runAiAction({
      workspaceId: api.workspaceId,
      userId: api.userId,
      postId: params.id,
      action: parsed.data.action,
      customInstruction: parsed.data.customInstruction
    });

    if (parsed.data.apply) {
      const updateData: any = {};
      if (parsed.data.action === "hashtags") {
        updateData.hashtags = out.result;
      } else if (parsed.data.action !== "variants") {
        updateData.content = out.result;
      }
      // variants no se aplica automáticamente (el usuario elige cuál)

      if (Object.keys(updateData).length > 0) {
        await prisma.$transaction([
          prisma.editorialPost.update({
            where: { id: params.id },
            data: updateData
          }),
          prisma.editorialRevision.create({
            data: {
              postId: params.id,
              authorId: api.userId ?? null,
              body: updateData.content ?? updateData.hashtags ?? null,
              changeSummary: `IA: ${AI_ACTIONS[parsed.data.action].label}`
            }
          })
        ]);
      }
    }

    return NextResponse.json({
      action: parsed.data.action,
      result: out.result,
      variants: out.variants,
      applied: parsed.data.apply
    });
  } catch (e: any) {
    if (e instanceof AIDisabledError) throw new ApiError(503, "ai_disabled", e.message);
    if (e?.message === "Publicación no encontrada") throw new ApiError(404, "not_found", e.message);
    console.error("[ai-action] error:", e);
    const h = humanizeAiError(e);
    throw new ApiError(500, h.code, h.message);
  }
});
