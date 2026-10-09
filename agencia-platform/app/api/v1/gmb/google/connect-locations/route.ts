/**
 * POST /api/v1/gmb/google/connect-locations — crea/actualiza fichas (GmbClient) a partir de las
 * ubicaciones GBP seleccionadas. Idempotente y deduplicado por (workspaceId, locationId): si la
 * ficha ya existe, actualiza sus metadatos; si no, la crea. Tenant-scoped. Nunca inventa datos.
 *
 * Body: { accountId: string, source?: "hub:<id>"|"make:<id>", automate?: boolean,
 *         locations: Array<{ locationId, title, address?, phone?, website?, placeId?, primaryCategory? }> }
 * Cada ficha guarda la cuenta de Google con la que se vinculó (source) y la ruta completa
 * accounts/X/locations/Y. Con automate:true crea además su automatización de reseñas en Make.
 */
import { publicBaseUrl } from "@/lib/public-url";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { parseGbpSource } from "@/lib/integrations/gmb";
import { createReviewsScenario } from "@/lib/gmb/make-reviews-scenario";
import { syncClientReviews } from "@/lib/gmb/review-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type IncomingLocation = {
  locationId?: string;
  title?: string;
  address?: string | null;
  phone?: string | null;
  website?: string | null;
  websiteUri?: string | null;
  placeId?: string | null;
  primaryCategory?: string | null;
};

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => ({}));
  const accRaw = String(body?.accountId ?? "").trim().replace(/^accounts\//, "");
  const accountId = accRaw ? `accounts/${accRaw}` : "";
  const source = parseGbpSource(body?.source);
  const automate = body?.automate === true;
  const incoming: IncomingLocation[] = Array.isArray(body?.locations) ? body.locations : [];
  if (!accountId) throw new ApiError(400, "bad_request", "Falta accountId");

  // Sanea + deduplica por locationId dentro del propio payload.
  const byId = new Map<string, IncomingLocation>();
  for (const l of incoming) {
    const short = String(l?.locationId ?? "").trim().split("/").pop() ?? "";
    if (short) byId.set(`${accountId}/locations/${short}`, l);
  }
  const locationIds = [...byId.keys()];
  if (locationIds.length === 0) throw new ApiError(400, "bad_request", "Selecciona al menos una ubicación");

  // Fichas ya existentes (guardadas con la ruta completa o sólo con el id corto).
  const shorts = locationIds.map((x) => x.split("/").pop() as string);
  const existing = await prisma.gmbClient.findMany({
    where: { workspaceId: api.workspaceId, locationId: { in: [...locationIds, ...shorts] } },
    select: { id: true, locationId: true, scenarioId: true },
  });
  const existingByLoc = new Map(existing.map((e) => [`${accountId}/locations/${e.locationId.split("/").pop()}`, e]));

  let created = 0;
  let updated = 0;
  const toAutomate: { id: string; name: string }[] = [];
  const linked: string[] = [];
  for (const [locationId, l] of byId) {
    const data = {
      accountId,
      name: (l.title ?? "").trim() || "Ficha sin nombre",
      category: (l.primaryCategory ?? "").trim(),
      address: (l.address ?? "").trim(),
      phone: (l.phone ?? "").trim(),
      website: (l.website ?? l.websiteUri ?? "").trim(),
      placeId: (l.placeId ?? "").trim(),
      locationId,
      // Cuenta de Google con la que se vinculó (para leer reseñas, responder, publicar…).
      ...(source?.kind === "make" ? { connectionId: String(source.connId), googleConnectionId: "" } : {}),
      ...(source?.kind === "hub" && source.connectionId ? { googleConnectionId: source.connectionId } : {}),
    };
    const prev = existingByLoc.get(locationId);
    let id: string;
    if (prev) {
      // Actualiza metadatos SIN sobrescribir status/config del piloto ya elegidos.
      await prisma.gmbClient.updateMany({ where: { id: prev.id, workspaceId: api.workspaceId }, data });
      id = prev.id;
      updated++;
    } else {
      const row = await prisma.gmbClient.create({ data: { workspaceId: api.workspaceId, status: "active", ...data } });
      id = row.id;
      created++;
    }
    if (automate && !prev?.scenarioId) toAutomate.push({ id, name: data.name });
    linked.push(id);
  }
  // Importa ya el histórico de reseñas de cada ficha (el escenario de Make solo trae las nuevas).
  const synced = await Promise.allSettled(linked.map((cid) => syncClientReviews(api.workspaceId, cid, { maxPages: 4 })));
  const reviewsImported = synced.reduce((n, r) => n + (r.status === "fulfilled" ? r.value.imported : 0), 0);
  const reviewErrors = synced.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason?.message ?? r).slice(0, 200));
  const automation: { name: string; ok: boolean; scenarioId?: number; error?: string }[] = [];
  for (const c of toAutomate) {
    try {
      const sc = await createReviewsScenario(api.workspaceId, c.id, publicBaseUrl(req));
      automation.push({ name: c.name, ok: true, scenarioId: sc.id });
    } catch (e: any) {
      automation.push({ name: c.name, ok: false, error: String(e?.message ?? e).slice(0, 200) });
    }
  }

  await prisma.auditLog.create({
    data: {
      workspaceId: api.workspaceId,
      actorId: api.userId ?? null,
      action: "gmb.google.locations_linked",
      targetType: "GmbClient",
      meta: { accountId, created, updated, total: locationIds.length, source: body?.source ?? null },
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true, created, updated, total: locationIds.length, automation, reviewsImported, reviewErrors });
});
