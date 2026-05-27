import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { encryptSecret, maskSecret, decryptSecret } from "@/lib/ai/crypto";

const patchSchema = z.object({
  anthropicApiKey: z.string().nullable().optional(),
  openaiApiKey: z.string().nullable().optional()
});

export const GET = withApi({ scope: "admin" }, async (_req, { api }) => {
  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const settings = (ws?.settings as any) ?? {};
  const encA = settings?.ai?.anthropicApiKey as string | undefined;
  const encO = settings?.ai?.openaiApiKey as string | undefined;
  const decA = encA ? decryptSecret(encA) : null;
  const decO = encO ? decryptSecret(encO) : null;
  return NextResponse.json({
    hasKey: !!decA,
    keyMasked: decA ? maskSecret(decA) : null,
    envKey: !!process.env.ANTHROPIC_API_KEY,
    openai: {
      hasKey: !!decO,
      keyMasked: decO ? maskSecret(decO) : null,
      envKey: !!process.env.OPENAI_API_KEY
    }
  });
});

export const PATCH = withApi({ scope: "admin" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const settings = ((ws?.settings as any) ?? {}) as any;
  settings.ai ??= {};

  if (parsed.data.anthropicApiKey === null) {
    delete settings.ai.anthropicApiKey;
  } else if (parsed.data.anthropicApiKey) {
    const k = parsed.data.anthropicApiKey.trim();
    if (!k.startsWith("sk-ant-")) {
      throw new ApiError(400, "validation_error", "El token de Anthropic debe empezar por sk-ant-");
    }
    settings.ai.anthropicApiKey = encryptSecret(k);
  }

  if (parsed.data.openaiApiKey === null) {
    delete settings.ai.openaiApiKey;
  } else if (parsed.data.openaiApiKey) {
    const k = parsed.data.openaiApiKey.trim();
    if (!k.startsWith("sk-")) {
      throw new ApiError(400, "validation_error", "El token de OpenAI debe empezar por sk-");
    }
    settings.ai.openaiApiKey = encryptSecret(k);
  }

  await prisma.workspace.update({
    where: { id: api.workspaceId },
    data: { settings }
  });
  return NextResponse.json({ ok: true });
});
