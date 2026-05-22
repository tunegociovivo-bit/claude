/**
 * Inicia Facebook Login para obtener un token de usuario con acceso total.
 */
import { NextResponse } from "next/server";
import crypto from "crypto";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";
import { prisma } from "@/lib/db/prisma";
import { metaAppConfigured, buildMetaLoginUrl, metaLoginRedirectUri } from "@/lib/integrations/meta-login";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://hub.negociovivo.app").replace(/\/+$/, "");
  if (!metaAppConfigured()) {
    return NextResponse.redirect(
      `${base}/admin/meta-mcp?error=${encodeURIComponent(
        "Falta META_APP_ID/META_APP_SECRET en Railway. Configura una App de Facebook con redirect URI " +
          metaLoginRedirectUri()
      )}`
    );
  }
  // state firmado simple: guardamos en settings para validar en el callback.
  const state = crypto.randomBytes(16).toString("hex");
  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId }, select: { settings: true } });
  const settings: any = ws?.settings ?? {};
  settings.integrations = settings.integrations ?? {};
  settings.integrations.metaLogin = { state, at: Date.now() };
  await prisma.workspace.update({ where: { id: api.workspaceId }, data: { settings } });
  return NextResponse.redirect(buildMetaLoginUrl(state));
});
