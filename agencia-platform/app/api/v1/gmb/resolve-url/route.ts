/**
 * POST /api/v1/gmb/resolve-url  body: { url }
 *
 * Autorrelleno del formulario "Nueva ficha GMB" a partir de una URL de
 * Google (búsqueda con ?q=… o Google Maps /maps/place/…). Extrae el
 * nombre del negocio de la URL y, si el workspace tiene la API de Google
 * Business Profile conectada, lo empareja con una de las ubicaciones
 * gestionadas para devolver también categoría + GMB Account/Location ID.
 *
 * Respuesta: { ok, name, category, accountId, locationId, matched, note? }
 * Los campos que no se puedan resolver vuelven vacíos (se rellenan a mano).
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

const schema = z.object({ url: z.string().min(5) });

function norm(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Saca identificadores de una URL de Google (search, Maps o Business Profile). */
function parseGoogleUrl(raw: string): { name: string | null; fid: string | null } {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { name: null, fid: null };
  }
  // business.google.com/n/<acc>/profile?fid=<CID> → la ficha viene por fid
  // (= CID del negocio), sin nombre. También Maps a veces lleva ?cid=.
  const fid = u.searchParams.get("fid") || u.searchParams.get("cid") || null;

  // Búsqueda de Google: ?q=Nombre+Del+Negocio
  let name: string | null = null;
  const q = u.searchParams.get("q");
  if (q && q.trim()) name = q.trim();
  if (!name) {
    // Google Maps: /maps/place/Nombre+Del+Negocio/@lat,lng,...
    const m = u.pathname.match(/\/maps\/place\/([^/@]+)/);
    if (m) {
      try {
        name = decodeURIComponent(m[1].replace(/\+/g, " ")).trim();
      } catch {
        name = m[1].replace(/\+/g, " ").trim();
      }
    }
  }
  return { name, fid };
}

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const { name: rawName, fid } = parseGoogleUrl(parsed.data.url);
  if (!rawName && !fid) {
    return NextResponse.json({
      ok: false,
      error:
        "No pude leer datos de esa URL. Pega el enlace de la ficha de Google (búsqueda, Google Maps o Perfil de Empresa)."
    });
  }

  const out = {
    ok: true,
    name: rawName ?? "",
    category: "",
    accountId: "",
    locationId: "",
    matched: false,
    note: undefined as string | undefined
  };

  // Emparejar con las ubicaciones GMB gestionadas del workspace para sacar
  // categoría + Account/Location ID (que no se pueden deducir de la URL).
  // - Por fid/CID: lo más fiable (la URL de Perfil de Empresa lo lleva).
  // - Por nombre: si la URL trae el nombre del negocio.
  try {
    const { gmbListAccounts, gmbListLocations } = await import("@/lib/integrations/gmb");
    const accounts = await gmbListAccounts(api.workspaceId);
    const target = rawName ? norm(rawName) : "";
    let best: { score: number; accountId: string; loc: any } | null = null;

    for (const acc of accounts) {
      let locs: any[] = [];
      try {
        locs = await gmbListLocations({ workspaceId: api.workspaceId, accountId: acc.accountId });
      } catch {
        continue;
      }
      for (const loc of locs) {
        let score = 0;
        // Coincidencia exacta por fid/CID (en mapsUri ?cid=… o placeId).
        if (fid) {
          const maps = String(loc.mapsUri ?? "");
          if (maps.includes(fid) || String(loc.placeId ?? "") === fid || String(loc.locationId ?? "") === fid) {
            score = 5;
          }
        }
        if (score === 0 && target) {
          const t = norm(loc.title ?? "");
          if (t) {
            if (t === target) score = 3;
            else if (t.includes(target) || target.includes(t)) score = 2;
            else {
              const tw = new Set(t.split(" "));
              const common = target.split(" ").filter((w) => w.length > 2 && tw.has(w)).length;
              if (common >= 2) score = 1;
            }
          }
        }
        if (score > 0 && (!best || score > best.score)) {
          best = { score, accountId: acc.accountId, loc };
        }
      }
      if (best?.score === 5) break;
    }

    if (best) {
      out.matched = true;
      out.name = best.loc.title || out.name;
      out.category = best.loc.primaryCategory || "";
      out.accountId = `accounts/${best.accountId}`;
      out.locationId = `accounts/${best.accountId}/locations/${best.loc.locationId}`;
    } else {
      out.note = rawName
        ? "He rellenado el nombre, pero no encontré una ubicación que coincida en tu Google Business Profile. Revisa el nombre o completa Account/Location ID a mano."
        : "No encontré esa ficha entre las ubicaciones de tu Google Business Profile. Comprueba que la cuenta conectada gestiona ese negocio.";
    }
  } catch (e: any) {
    out.note =
      "Para autocompletar categoría y los GMB IDs necesito Google Business Profile conectado en los ajustes de GMB Hub." +
      (rawName ? " De momento he rellenado el nombre." : "");
  }

  return NextResponse.json(out);
});
