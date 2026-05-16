/**
 * DELETE /api/integrations/google-calendar/disconnect
 *
 * Borra la GoogleCalendarConnection del usuario logueado (revoca el
 * refresh_token contra Google si es posible para que la app
 * desaparezca también del listado de Google Account). Los eventos
 * que ya estaban sincronizados se mantienen como "huérfanos" — no
 * los borramos del Hub.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getSessionWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/ai/crypto";
import { revokeRefreshToken } from "@/lib/integrations/google-calendar/oauth";

export const dynamic = "force-dynamic";

export async function DELETE() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  const workspaceId = await getSessionWorkspaceId();
  if (!userId || !workspaceId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const conn = await prisma.googleCalendarConnection.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } }
  });
  if (!conn) return NextResponse.json({ ok: true, alreadyDisconnected: true });

  const refreshToken = decryptSecret(conn.refreshTokenEnc);
  if (refreshToken) await revokeRefreshToken(refreshToken);

  await prisma.googleCalendarConnection.delete({ where: { id: conn.id } });
  return NextResponse.json({ ok: true });
}
