import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireSeoBlogAccess } from "@/lib/seo-blog/access";
import { getSeoBlogSettings } from "@/lib/seo-blog/settings";
import { autofillFromSite } from "@/lib/seo-blog/autofill";
import { normalizeSiteUrl } from "@/lib/seo-blog/wp";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Analiza la web del cliente con IA y devuelve la ficha «Negocio y voz» propuesta (no la guarda: el usuario revisa y pulsa Guardar). */
export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  await requireSeoBlogAccess(api);
  const site = await prisma.seoBlogSite.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    include: { client: { select: { name: true, brandBrief: true, website: true } } }
  });
  if (!site) throw new ApiError(404, "not_found", "No encontrado");
  const b = (await req.json().catch(() => ({}))) ?? {};
  const url = normalizeSiteUrl(String(b.url || site.siteUrl || site.client.website || ""));
  if (!url) throw new ApiError(400, "validation_error", "Indica la URL de la web del cliente.");
  const settings = await getSeoBlogSettings(api.workspaceId);
  try {
    const data = await autofillFromSite(api.workspaceId, api.userId, settings, url, site.client.name, site.client.brandBrief);
    return NextResponse.json({ ok: true, ...data });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 200 });
  }
});
