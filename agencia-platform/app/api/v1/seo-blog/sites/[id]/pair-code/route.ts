import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireSeoBlogAccess } from "@/lib/seo-blog/access";
import { encodePairCode, hashPairToken, hubBaseUrl, newPairToken, PAIR_TTL_MS } from "@/lib/seo-blog/pair";

export const dynamic = "force-dynamic";

/** Genera (o renueva) el código de conexión de un cliente. Caduca a las 24 h y es de un solo uso. */
export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  await requireSeoBlogAccess(api);
  const site = await prisma.seoBlogSite.findFirst({ where: { id: params.id, workspaceId: api.workspaceId }, select: { id: true } });
  if (!site) throw new ApiError(404, "not_found", "No encontrado");
  const token = newPairToken();
  await prisma.seoBlogSite.updateMany({
    where: { id: site.id, workspaceId: api.workspaceId },
    data: { pairTokenHash: hashPairToken(token), pairTokenAt: new Date() }
  });
  return NextResponse.json({ code: encodePairCode(hubBaseUrl(req), site.id, token), expiresAt: new Date(Date.now() + PAIR_TTL_MS).toISOString() });
});
