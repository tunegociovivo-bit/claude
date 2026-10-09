/**
 * GET /api/v1/gmb/clients/[id]/google-content?kind=photos|posts — fotos o publicaciones que la ficha
 * tiene AHORA en Google (API v4 media / localPosts, vía OAuth del Hub o la pasarela de Make).
 * Solo lectura; no se guarda nada. Tenant-scoped.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { gbpCall, gbpSourceForClient, gmbLocationPath } from "@/lib/integrations/gmb";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CAT: Record<string, string> = {
  COVER: "Portada",
  PROFILE: "Perfil",
  LOGO: "Logo",
  EXTERIOR: "Exterior",
  INTERIOR: "Interior",
  PRODUCT: "Producto",
  AT_WORK: "Trabajando",
  FOOD_AND_DRINK: "Comida y bebida",
  MENU: "Menú",
  COMMON_AREA: "Zonas comunes",
  ROOMS: "Habitaciones",
  TEAMS: "Equipo",
  ADDITIONAL: "Otras"
};

export const GET = withApi({ scope: "*" }, async (req, { params, api }) => {
  const client = await prisma.gmbClient.findFirst({ where: { id: (params as any).id, workspaceId: api.workspaceId } });
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const path = gmbLocationPath(client.accountId, client.locationId);
  if (!path) return NextResponse.json({ ok: false, message: "La ficha no está vinculada a Google." });
  const kind = new URL(req.url).searchParams.get("kind") === "posts" ? "posts" : "photos";
  const source = gbpSourceForClient(client);
  try {
    if (kind === "photos") {
      const items: any[] = [];
      let token = "";
      for (let i = 0; i < 4; i++) {
        const qs = new URLSearchParams({ pageSize: "100" });
        if (token) qs.set("pageToken", token);
        const d = await gbpCall(api.workspaceId, source, { api: "v4", path: `/v4/${path}/media?${qs}` });
        items.push(...(d?.mediaItems ?? []));
        token = d?.nextPageToken ?? "";
        if (!token) break;
      }
      const photos = items.map((m) => ({
        id: String(m.name ?? "").split("/").pop(),
        format: m.mediaFormat,
        url: m.googleUrl,
        thumb: m.thumbnailUrl || m.googleUrl,
        category: CAT[m.locationAssociation?.category] ?? m.locationAssociation?.category ?? "",
        createTime: m.createTime ?? null,
        views: m.insights?.viewCount ?? null,
        width: m.dimensions?.widthPixels ?? null,
        height: m.dimensions?.heightPixels ?? null
      }));
      photos.sort((a, b) => String(b.createTime).localeCompare(String(a.createTime)));
      return NextResponse.json({ ok: true, photos });
    }
    const raw: any[] = [];
    let token = "";
    for (let i = 0; i < 4; i++) {
      const qs = new URLSearchParams({ pageSize: "100" });
      if (token) qs.set("pageToken", token);
      const d = await gbpCall(api.workspaceId, source, { api: "v4", path: `/v4/${path}/localPosts?${qs}` });
      raw.push(...(d?.localPosts ?? []));
      token = d?.nextPageToken ?? "";
      if (!token) break;
    }
    const posts = raw.map((p) => ({
      id: String(p.name ?? "").split("/").pop(),
      summary: p.summary ?? p.event?.title ?? "",
      type: p.topicType ?? "STANDARD",
      state: p.state ?? "",
      createTime: p.createTime ?? null,
      updateTime: p.updateTime ?? null,
      url: p.searchUrl ?? null,
      image: p.media?.[0]?.googleUrl ?? null,
      cta: p.callToAction ? { type: p.callToAction.actionType, url: p.callToAction.url ?? null } : null,
      event: p.event ? { title: p.event.title, start: p.event.schedule?.startDate ?? null, end: p.event.schedule?.endDate ?? null } : null,
      offer: p.offer ? { code: p.offer.couponCode ?? null, terms: p.offer.termsConditions ?? null } : null
    }));
    posts.sort((a, b) => String(b.createTime).localeCompare(String(a.createTime)));
    return NextResponse.json({ ok: true, posts });
  } catch (e: any) {
    return NextResponse.json({ ok: false, message: String(e?.message ?? e).slice(0, 300) });
  }
});
