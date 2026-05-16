/**
 * GET /api/v1/me/google-calendar
 *
 * Estado de la conexión Google Calendar del user logueado. Devuelve
 * lo necesario para que la UI de /perfil sepa si está conectado, con
 * qué email y cuándo se sincronizó la última vez.
 *
 * PATCH /api/v1/me/google-calendar { pullEnabled?, pushEnabled? }
 *
 * Permite al user pausar push o pull sin desconectar la cuenta.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions, getSessionWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

async function authed(): Promise<{ userId: string; workspaceId: string } | null> {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  const workspaceId = await getSessionWorkspaceId();
  if (!userId || !workspaceId) return null;
  return { userId, workspaceId };
}

export async function GET() {
  const auth = await authed();
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const conn = await prisma.googleCalendarConnection.findUnique({
    where: { userId_workspaceId: auth }
  });
  return NextResponse.json({
    connected: !!conn,
    googleAccountEmail: conn?.googleAccountEmail ?? null,
    pullEnabled: conn?.pullEnabled ?? null,
    pushEnabled: conn?.pushEnabled ?? null,
    lastSyncedAt: conn?.lastSyncedAt ?? null,
    lastError: conn?.lastError ?? null,
    configured: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
  });
}

const patchSchema = z.object({
  pullEnabled: z.boolean().optional(),
  pushEnabled: z.boolean().optional()
});

export async function PATCH(req: Request) {
  const auth = await authed();
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_error" }, { status: 400 });
  }
  const updated = await prisma.googleCalendarConnection.updateMany({
    where: auth,
    data: parsed.data
  });
  if (updated.count === 0) {
    return NextResponse.json({ error: "not_connected" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
