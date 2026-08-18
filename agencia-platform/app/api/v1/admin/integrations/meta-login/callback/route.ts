/**
 * Callback de Facebook Login. Valida state, intercambia el code por un token
 * de usuario de larga duración y lo guarda como conexión Meta del workspace.
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";
import { prisma } from "@/lib/db/prisma";
import { handleMetaLoginCallback } from "@/lib/integrations/meta-login";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const url = new URL(req.url);
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://hub.negociovivo.app").replace(/\/+$/, "");

  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId }, select: { settings: true } });
  const saved = (ws?.settings as any)?.integrations?.metaLogin;
  const returnPath = saved?.returnPath === "/admin/meta-comments" ? "/admin/meta-comments" : "/admin/meta-mcp";
  const fail = (m: string) => NextResponse.redirect(`${base}${returnPath}?error=${encodeURIComponent(m.slice(0, 200))}`);
  const err = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (err) return fail(err);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return fail("Faltan code/state");
  if (!saved?.state || saved.state !== state) return fail("State inválido o expirado. Reinténtalo.");
  if (Date.now() - (saved.at ?? 0) > 15 * 60 * 1000) return fail("La conexión caducó. Reinténtala.");

  try {
    const r = await handleMetaLoginCallback({ workspaceId: api.workspaceId, userId: api.userId, code });
    return NextResponse.redirect(`${base}${returnPath}?connected=1&name=${encodeURIComponent(r.name ?? "")}`);
  } catch (e: any) {
    return fail(`No se pudo completar el login de Meta: ${String(e?.message ?? e)}`);
  }
});
