import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";
import { encryptSecret } from "@/lib/ai/crypto";
import { elevenlabsTest } from "@/lib/integrations/elevenlabs";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const cfg = (ws?.settings as any)?.integrations?.elevenlabs ?? {};
  if (!cfg.apiKey) return NextResponse.json({ configured: false });
  try {
    const test = await elevenlabsTest(api.workspaceId);
    return NextResponse.json({ configured: true, voiceId: cfg.voiceId, modelId: cfg.modelId, test });
  } catch (e: any) {
    return NextResponse.json({ configured: true, test: { ok: false, error: String(e?.message ?? e) } });
  }
});

const putSchema = z.object({
  apiKey: z.string().min(10).max(500),
  voiceId: z.string().optional(),
  modelId: z.string().optional()
});

export const PUT = withApi({ scope: "*" }, async (req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const settings: any = (ws?.settings as any) ?? {};
  settings.integrations = settings.integrations ?? {};
  settings.integrations.elevenlabs = {
    apiKey: encryptSecret(parsed.data.apiKey.trim()),
    ...(parsed.data.voiceId ? { voiceId: parsed.data.voiceId } : {}),
    ...(parsed.data.modelId ? { modelId: parsed.data.modelId } : {})
  };
  await prisma.workspace.update({ where: { id: api.workspaceId }, data: { settings } });
  return NextResponse.json({ ok: true });
});
