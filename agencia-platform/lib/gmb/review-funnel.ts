/**
 * Enlace de reseñas + embudo de valoración (GMB Hub).
 *
 * 1) Analiza un negocio (nombre + ciudad, URL de Google Maps o Place ID) con Places API (New)
 *    y genera el enlace directo «Escribir reseña» de su ficha, igual que Whitespark:
 *      https://search.google.com/local/writereview?placeid=<PLACE_ID>
 * 2) Página pública con 5 estrellas (/opina/<slug>):
 *      4-5 → directo al enlace de reseña de Google.
 *      1-3 → primero un formulario de queja que llega al correo del dueño, PERO con el acceso
 *            a Google siempre visible. No se impide ni se oculta la reseña pública a nadie
 *            (la política de Google prohíbe el «review gating»).
 */
import { prisma } from "@/lib/db/prisma";
import { getGoogleApiKeyForWorkspace, placesTextSearch } from "@/lib/leads/google-places";
import { buildGmbReviewUrl, extractPlaceId } from "@/lib/reviews/gmb-link";

export type AnalyzedPlace = {
  placeId: string;
  name: string;
  address: string;
  category: string;
  rating: number | null;
  ratingCount: number;
  phone: string;
  website: string;
  mapsUrl: string;
  reviewUrl: string;
  businessStatus: string | null;
};

const DETAILS_MASK = [
  "id",
  "displayName",
  "formattedAddress",
  "primaryTypeDisplayName",
  "rating",
  "userRatingCount",
  "nationalPhoneNumber",
  "websiteUri",
  "googleMapsUri",
  "businessStatus"
].join(",");

function fromPlacesApi(p: any): AnalyzedPlace | null {
  const placeId = String(p?.id ?? p?.placeId ?? "");
  const reviewUrl = buildGmbReviewUrl(placeId);
  if (!placeId || !reviewUrl) return null;
  return {
    placeId,
    name: p?.displayName?.text ?? p?.name ?? "",
    address: p?.formattedAddress ?? "",
    category: p?.primaryTypeDisplayName?.text ?? p?.category ?? "",
    rating: typeof p?.rating === "number" ? p.rating : null,
    ratingCount: Number(p?.userRatingCount ?? 0) || 0,
    phone: p?.nationalPhoneNumber ?? p?.phone ?? "",
    website: p?.websiteUri ?? p?.website ?? "",
    mapsUrl: p?.googleMapsUri ?? p?.gmbUrl ?? `https://www.google.com/maps/place/?q=place_id:${placeId}`,
    reviewUrl,
    businessStatus: p?.businessStatus ?? null
  };
}

export async function placeById(workspaceId: string, placeId: string): Promise<AnalyzedPlace | null> {
  const key = await getGoogleApiKeyForWorkspace(workspaceId);
  const r = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=es`, {
    headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": DETAILS_MASK }
  });
  if (!r.ok) throw new Error(`Google Places ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return fromPlacesApi(await r.json());
}

/** Si pegan un enlace de Google Maps sin place_id (maps.app.goo.gl, /maps/place/Nombre/...), saca un texto buscable. */
async function queryFromMapsUrl(input: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  let finalUrl = url.toString();
  if (/goo\.gl|g\.page|share\.google/i.test(url.hostname)) {
    try {
      const r = await fetch(finalUrl, { redirect: "follow", signal: AbortSignal.timeout(8000) });
      finalUrl = r.url || finalUrl;
    } catch {
      /* sin red: seguimos con lo que hay */
    }
  }
  const m = decodeURIComponent(finalUrl).match(/\/maps\/place\/([^/@?]+)/);
  if (m) return m[1].replace(/\+/g, " ").trim();
  const q = new URL(finalUrl).searchParams.get("q");
  return q && !q.startsWith("place_id:") ? q : null;
}

/** Analiza un negocio y devuelve hasta 5 coincidencias con su enlace de reseña. */
export async function analyzeBusiness(workspaceId: string, input: string): Promise<AnalyzedPlace[]> {
  const raw = (input ?? "").trim();
  if (!raw) return [];
  const pid = extractPlaceId(raw);
  if (pid) {
    const one = await placeById(workspaceId, pid);
    return one ? [one] : [];
  }
  const query = /^https?:\/\//i.test(raw) ? (await queryFromMapsUrl(raw)) ?? raw : raw;
  const results = await placesTextSearch({ workspaceId, query, pageSize: 5, maxPages: 1 });
  return results
    .map((p) =>
      fromPlacesApi({
        id: p.placeId,
        name: p.name,
        formattedAddress: p.formattedAddress,
        category: p.category,
        rating: p.rating,
        userRatingCount: p.userRatingCount,
        phone: p.phone,
        website: p.website,
        gmbUrl: p.gmbUrl,
        businessStatus: p.businessStatus
      })
    )
    .filter((x): x is AnalyzedPlace => !!x)
    .slice(0, 5);
}

export function slugify(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "negocio"
  );
}

export async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  for (let i = 0; i < 20; i++) {
    const slug = i === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    const taken = await prisma.gmbReviewFunnel.findUnique({ where: { slug }, select: { id: true } });
    if (!taken) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export function funnelPublicUrl(origin: string, slug: string) {
  return `${origin.replace(/\/$/, "")}/opina/${slug}`;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function esc(s: string) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function complaintEmailHtml(f: { businessName: string }, fb: { stars: number; name: string; email: string; phone: string; message: string }) {
  const stars = "★".repeat(fb.stars) + "☆".repeat(5 - fb.stars);
  const row = (k: string, v: string) => (v ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b">${k}</td><td style="padding:4px 0">${esc(v)}</td></tr>` : "");
  return `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:560px;color:#0f172a">
  <h2 style="margin:0 0 4px;font-size:18px">Nueva opinión privada · ${esc(f.businessName)}</h2>
  <div style="font-size:22px;color:#f59e0b;margin:6px 0 14px">${stars} <span style="font-size:13px;color:#64748b">(${fb.stars}/5)</span></div>
  <div style="white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;font-size:14px;line-height:1.5">${esc(fb.message)}</div>
  <table style="margin-top:14px;font-size:13px">${row("Nombre", fb.name)}${row("Email", fb.email)}${row("Teléfono", fb.phone)}</table>
  <p style="font-size:12px;color:#94a3b8;margin-top:18px">Enviado desde la página de valoración del GMB Hub. Responde a este correo para contestar al cliente${fb.email ? "" : " (no dejó email)"}.</p>
</div>`;
}
