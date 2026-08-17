/**
 * Callback del OAuth de Google Business Profile. Verifica el state firmado, consume el
 * nonce (one-time, anti-replay), intercambia el code por tokens, guarda el refresh_token
 * CIFRADO en GmbGoogleConnection (tenant-scoped) y detecta si concede business.manage.
 *
 * Nunca expone tokens al cliente. Redirige a /gmb-hub con un estado legible por humanos.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { encryptSecret } from "@/lib/ai/crypto";
import { getServerSession } from "next-auth";
import { authOptions, getSessionWorkspaceId } from "@/lib/auth";
import { exchangeGbpCode, verifyGbpState, hasBusinessScope, emailFromIdToken } from "@/lib/gmb/gbp-oauth";
import { consumeNonce } from "@/lib/gmb/gbp-oauth-store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const base = process.env.NEXTAUTH_URL?.trim() || req.nextUrl.origin;
  const done = (value: string) => NextResponse.redirect(`${base}/gmb-hub?gbp=${value}`);
  const url = new URL(req.url);
  if (url.searchParams.get("error")) return done("denied");

  const code = url.searchParams.get("code");
  const state = verifyGbpState(url.searchParams.get("state") ?? "");
  if (!code || !state) return done("invalid");

  // La sesión del navegador debe coincidir con el state (defensa contra CSRF/estado ajeno).
  const session = await getServerSession(authOptions);
  const sessionUserId = (session?.user as any)?.id as string | undefined;
  const sessionWorkspaceId = await getSessionWorkspaceId();
  if (!sessionUserId || sessionUserId !== state.userId || sessionWorkspaceId !== state.workspaceId) return done("invalid_session");

  // Consume el nonce de forma atómica → un solo uso. Si ya se usó/caducó, rechazo.
  const ok = await consumeNonce({ nonce: state.nonce, workspaceId: state.workspaceId, userId: state.userId });
  if (!ok) return done("expired");

  try {
    const tokens = await exchangeGbpCode(code, req.nextUrl.origin);
    if (!tokens.refresh_token) return done("no_refresh");
    const business = hasBusinessScope(tokens.scope);
    const email = emailFromIdToken(tokens.id_token);
    await prisma.gmbGoogleConnection.upsert({
      where: { workspaceId: state.workspaceId },
      create: {
        workspaceId: state.workspaceId,
        refreshTokenEnc: encryptSecret(tokens.refresh_token),
        email,
        scope: tokens.scope ?? "",
        hasBusinessScope: business,
        createdById: state.userId,
        revokedAt: null,
        lastError: null,
      },
      update: {
        refreshTokenEnc: encryptSecret(tokens.refresh_token),
        email,
        scope: tokens.scope ?? "",
        hasBusinessScope: business,
        revokedAt: null,
        lastError: null,
      },
    });
    // Auditoría (best-effort): registra la conexión sin exponer tokens.
    await prisma.auditLog.create({
      data: {
        workspaceId: state.workspaceId,
        actorId: state.userId,
        action: "gmb.google.connected",
        targetType: "GmbGoogleConnection",
        meta: { email, hasBusinessScope: business },
      },
    }).catch(() => {});
    return done(business ? "connected" : "connected_no_scope");
  } catch (e) {
    console.error("[gbp oauth callback]", e);
    return done("failed");
  }
}
