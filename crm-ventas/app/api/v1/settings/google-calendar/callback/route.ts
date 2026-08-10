import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { googleCredentials, syncFutureAppointments } from "@/lib/google-calendar";
import { requireWorkspaceAdmin } from "@/lib/auth";
import { publicBaseUrl } from "@/lib/settings";

function redirect(status: string) {
  return NextResponse.redirect(`${publicBaseUrl()}/ajustes?googleCalendar=${status}`);
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  if (!code || !state) return redirect("error");
  try {
    const { workspaceId, userId } = await requireWorkspaceAdmin();
    const decoded = JSON.parse(decryptSecret(state));
    if (decoded.workspaceId !== workspaceId || decoded.userId !== userId || decoded.expiresAt < Date.now()) return redirect("error");
    const credentials = googleCredentials();
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        redirect_uri: `${publicBaseUrl()}/api/v1/settings/google-calendar/callback`,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenResponse.ok) return redirect("error");
    const tokens = await tokenResponse.json();
    if (!tokens.refresh_token || !tokens.access_token) return redirect("error");
    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = profileResponse.ok ? await profileResponse.json() : {};
    await prisma.googleCalendarConnection.upsert({
      where: { workspaceId },
      update: {
        googleEmail: profile.email ?? null,
        refreshTokenEnc: encryptSecret(tokens.refresh_token),
        accessTokenEnc: encryptSecret(tokens.access_token),
        expiresAt: new Date(Date.now() + Number(tokens.expires_in ?? 3600) * 1000),
      },
      create: {
        workspaceId,
        googleEmail: profile.email ?? null,
        refreshTokenEnc: encryptSecret(tokens.refresh_token),
        accessTokenEnc: encryptSecret(tokens.access_token),
        expiresAt: new Date(Date.now() + Number(tokens.expires_in ?? 3600) * 1000),
      },
    });
    await syncFutureAppointments(workspaceId).catch((error) => console.error("[google-calendar] sync inicial:", error));
    return redirect("connected");
  } catch (error) {
    console.error("[google-calendar] callback:", error);
    return redirect("error");
  }
}
