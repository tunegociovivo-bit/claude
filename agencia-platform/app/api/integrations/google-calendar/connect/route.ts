/**
 * GET /api/integrations/google-calendar/connect
 *
 * Inicia el OAuth flow para conectar el Google Calendar del usuario
 * logueado. Redirige a Google con scope `calendar` + access_type=offline
 * + prompt=consent para asegurar refresh_token.
 *
 * `state` contiene el userId + workspaceId firmados de forma simple
 * (hmac con NEXTAUTH_SECRET) para que en el callback validemos que
 * el browser no nos engaña con un userId ajeno.
 */

import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { getServerSession } from "next-auth";
import { authOptions, getSessionWorkspaceId } from "@/lib/auth";
import { googleAuthorizeUrl } from "@/lib/integrations/google-calendar/oauth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  const workspaceId = await getSessionWorkspaceId();
  if (!userId || !workspaceId) {
    return NextResponse.redirect(new URL("/login", process.env.NEXTAUTH_URL ?? "http://localhost:3000"));
  }
  const state = signState({ userId, workspaceId, ts: Date.now() });
  return NextResponse.redirect(googleAuthorizeUrl(state));
}

function signState(payload: { userId: string; workspaceId: string; ts: number }): string {
  const secret = process.env.NEXTAUTH_SECRET ?? "dev";
  const json = JSON.stringify(payload);
  const b64 = Buffer.from(json).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}
