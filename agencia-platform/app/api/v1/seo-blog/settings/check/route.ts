import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { requireSeoBlogAccess } from "@/lib/seo-blog/access";
import { getSeoBlogSettings } from "@/lib/seo-blog/settings";
import { checkFreepikKey } from "@/lib/seo-blog/freepik";

export const dynamic = "force-dynamic";

/** Comprueba las claves externas sin gastar créditos (Freepik/Magnific). */
export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  await requireSeoBlogAccess(api);
  const s = await getSeoBlogSettings(api.workspaceId);
  const freepik = await checkFreepikKey(api.workspaceId, s);
  return NextResponse.json({ freepik });
});
