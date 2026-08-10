import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";
import { googleCalendarConfigured, googleCredentials } from "@/lib/google-calendar";
import { isSameOrigin, requireWorkspaceAdmin } from "@/lib/auth";
import { publicBaseUrl } from "@/lib/settings";

export async function GET() {
  try {
    const { workspaceId } = await requireWorkspaceAdmin();
    const connection = await prisma.googleCalendarConnection.findUnique({
      where: { workspaceId }, select: { googleEmail: true, connectedAt: true },
    });
    return NextResponse.json({
      configured: googleCalendarConfigured(),
      connected: Boolean(connection),
      googleEmail: connection?.googleEmail ?? null,
      connectedAt: connection?.connectedAt ?? null,
    });
  } catch { return NextResponse.json({ error: "No autorizado" }, { status: 403 }); }
}

export async function POST(request: NextRequest) {
  try {
    if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
    const { workspaceId, userId } = await requireWorkspaceAdmin();
    const credentials = googleCredentials();
    if (!googleCalendarConfigured(credentials)) return NextResponse.json({ error: "Google Calendar aún no está configurado por Negocio Vivo" }, { status: 503 });
    const redirectUri = `${publicBaseUrl()}/api/v1/settings/google-calendar/callback`;
    const state = encryptSecret(JSON.stringify({ workspaceId, userId, expiresAt: Date.now() + 10 * 60_000 }));
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: credentials.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      scope: "openid email https://www.googleapis.com/auth/calendar.events",
      state,
    }).toString();
    return NextResponse.json({ authUrl: url.toString() });
  } catch { return NextResponse.json({ error: "No autorizado" }, { status: 403 }); }
}

export async function DELETE(request: NextRequest) {
  try {
    if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
    const { workspaceId } = await requireWorkspaceAdmin();
    await prisma.googleCalendarConnection.deleteMany({ where: { workspaceId } });
    await prisma.appointment.updateMany({ where: { workspaceId }, data: { googleEventId: null } });
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "No autorizado" }, { status: 403 }); }
}
