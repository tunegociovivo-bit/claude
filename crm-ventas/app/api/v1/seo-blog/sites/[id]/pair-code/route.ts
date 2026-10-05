import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { requireOwnSite } from "@/lib/seo-blog/access";
import { crmBaseUrl, encodePairCode, hashPairToken, newPairToken, PAIR_TTL_MS } from "@/lib/seo-blog/pair";

export const dynamic = "force-dynamic";

/** Genera (o renueva) el código de conexión de la web. Caduca a las 24 h y es de un solo uso. */
export const POST = withApi({ module: "seo", admin: true }, async (req, { params, api }) => {
  const site = await requireOwnSite(api, params.id);
  const token = newPairToken();
  await prisma.seoBlogSite.updateMany({
    where: { id: site.id, workspaceId: api.workspaceId },
    data: { pairTokenHash: hashPairToken(token), pairTokenAt: new Date() }
  });
  return NextResponse.json({ code: encodePairCode(crmBaseUrl(req), site.id, token), expiresAt: new Date(Date.now() + PAIR_TTL_MS).toISOString() });
});
