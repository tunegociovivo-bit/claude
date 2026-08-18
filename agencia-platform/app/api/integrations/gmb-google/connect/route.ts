/**
 * Inicio del OAuth de Google Business Profile (estilo Make): el usuario pulsa
 * «Conectar con Google» → se firma un state one-time, se registra el nonce y se
 * redirige a Google con el scope mínimo (business.manage). Sin IDs ni claves a mano.
 *
 * Sesión requerida (getServerSession). Si faltan credenciales del servidor:
 *   - admin  → guía exacta en /admin/seguridad
 *   - normal → mensaje simple en /gmb-hub (sin secretos).
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getSessionWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { gbpAuthorizeUrl, gbpOAuthConfigurationIssue, newNonce, signGbpState } from "@/lib/gmb/gbp-oauth";
import { registerNonce } from "@/lib/gmb/gbp-oauth-store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const base = process.env.NEXTAUTH_URL?.trim() || req.nextUrl.origin;
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  const workspaceId = await getSessionWorkspaceId();
  if (!userId || !workspaceId) return NextResponse.redirect(`${base}/login`);

  const issue = gbpOAuthConfigurationIssue();
  if (issue) {
    // ¿El usuario es admin del workspace? Solo al admin le mostramos la guía de setup.
    const membership = await prisma.membership.findFirst({ where: { userId, workspaceId, role: "ADMIN" }, select: { id: true } });
    if (membership) return NextResponse.redirect(`${base}/admin/seguridad?gbp=setup_${issue}`);
    return NextResponse.redirect(`${base}/gmb-hub?gbp=no_config`);
  }

  try {
    const nonce = newNonce();
    await registerNonce({ nonce, workspaceId, userId });
    const state = signGbpState({ workspaceId, userId, nonce, ts: Date.now() });
    return NextResponse.redirect(gbpAuthorizeUrl(state, req.nextUrl.origin));
  } catch (error) {
    console.error("[gbp oauth connect]", error);
    return NextResponse.redirect(`${base}/gmb-hub?gbp=failed`);
  }
}
