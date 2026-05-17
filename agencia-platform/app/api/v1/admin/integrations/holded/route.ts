/**
 * GET  /api/v1/admin/integrations/holded  → estado de la integración (sin exponer key)
 * PUT  /api/v1/admin/integrations/holded  → body: { apiKey: string }
 *
 * Guarda API key cifrada con AES-256-GCM. Sólo admin.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";
import { encryptSecret } from "@/lib/ai/crypto";
import { holdedTest } from "@/lib/integrations/holded";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const cfg = (ws?.settings as any)?.integrations?.holded ?? {};
  if (!cfg.apiKey) return NextResponse.json({ configured: false });
  // Test connection
  try {
    const test = await holdedTest(api.workspaceId);
    return NextResponse.json({ configured: true, test });
  } catch (e: any) {
    return NextResponse.json({
      configured: true,
      test: { ok: false, error: String(e?.message ?? e) }
    });
  }
});

const putSchema = z.object({ apiKey: z.string().min(10).max(500) });

export const PUT = withApi({ scope: "*" }, async (req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const settings: any = (ws?.settings as any) ?? {};
  settings.integrations = settings.integrations ?? {};
  settings.integrations.holded = { apiKey: encryptSecret(parsed.data.apiKey.trim()) };

  await prisma.workspace.update({
    where: { id: api.workspaceId },
    data: { settings }
  });
  return NextResponse.json({ ok: true });
});
