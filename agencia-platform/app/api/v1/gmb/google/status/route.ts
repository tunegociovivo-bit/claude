/**
 * GET /api/v1/gmb/google/status — estado honesto de la conexión de Google del workspace.
 * Nunca expone tokens. Incluye si faltan credenciales del servidor (para que la UI muestre
 * la guía al ADMIN y un mensaje simple al usuario normal). Tenant-scoped.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { callerIsAdmin } from "@/lib/api/permissions";
import { gbpOAuthConfigurationIssue, gbpRedirectUri, hasBusinessScope } from "@/lib/gmb/gbp-oauth";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const issue = gbpOAuthConfigurationIssue();
  const isAdmin = await callerIsAdmin(api).catch(() => false);
  const conn = await prisma.gmbGoogleConnection.findUnique({ where: { workspaceId: api.workspaceId } });
  const linkedClients = await prisma.gmbClient.count({ where: { workspaceId: api.workspaceId, locationId: { not: "" } } });

  return NextResponse.json({
    ok: true,
    configured: issue === null,
    // Solo el ADMIN recibe el tipo de problema y el redirect a documentar; el usuario normal no.
    setup: issue ? { issue, isAdmin, redirectUri: isAdmin ? gbpRedirectUri(new URL(req.url).origin) : undefined } : null,
    connection: conn
      ? {
          connected: !conn.revokedAt,
          email: conn.email || null,
          hasBusinessScope: conn.hasBusinessScope || hasBusinessScope(conn.scope),
          revoked: !!conn.revokedAt,
          lastError: conn.lastError || null,
          updatedAt: conn.updatedAt,
        }
      : { connected: false },
    linkedClients,
  });
});
