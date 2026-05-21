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

/** Saca el nombre del negocio de una URL de Google (search o Maps). */
function extractName(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  // Búsqueda de Google: ?q=Nombre+Del+Negocio
  const q = u.searchParams.get("q");
  if (q && q.trim()) return q.trim();
  // Google Maps: /maps/place/Nombre+Del+Negocio/@lat,lng,...
  const m = u.pathname.match(/\/maps\/place\/([^/@]+)/);
  if (m) {
    try {
      return decodeURIComponent(m[1].replace(/\+/g, " ")).trim();
    } catch {
      return m[1].replace(/\+/g, " ").trim();
    }
  }
  return null;
}

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const rawName = extractName(parsed.data.url);
  if (!rawName) {
    return NextResponse.json({
      ok: false,
      error:
        "No pude leer el nombre del negocio de esa URL. Pega el enlace de la ficha de Google (búsqueda o Google Maps)."
    });
  }

  const out = {
    ok: true,
    name: rawName,
    category: "",
    accountId: "",
    locationId: "",
    matched: false,
    note: undefined as string | undefined
  };

  // Emparejar con las ubicaciones GMB gestionadas del workspace para sacar
  // categoría + Account/Location ID (que no se pueden deducir de la URL).
  try {
    const { gmbListAccounts, gmbListLocations } = await import("@/lib/integrations/gmb");
    const accounts = await gmbListAccounts(api.workspaceId);
    const target = norm(rawName);
    let best: { score: number; accountId: string; loc: any } | null = null;

    for (const acc of accounts) {
      let locs: any[] = [];
      try {
        locs = await gmbListLocations({ workspaceId: api.workspaceId, accountId: acc.accountId });
      } catch {
        continue;
      }
      for (const loc of locs) {
        const t = norm(loc.title ?? "");
        if (!t) continue;
        let score = 0;
        if (t === target) score = 3;
        else if (t.includes(target) || target.includes(t)) score = 2;
        else {
          // Coincidencia parcial por palabras (al menos 2 en común).
          const tw = new Set(t.split(" "));
          const common = target.split(" ").filter((w) => w.length > 2 && tw.has(w)).length;
          if (common >= 2) score = 1;
        }
        if (score > 0 && (!best || score > best.score)) {
          best = { score, accountId: acc.accountId, loc };
        }
      }
      if (best?.score === 3) break;
    }

    if (best) {
      out.matched = true;
      out.name = best.loc.title || out.name;
      out.category = best.loc.primaryCategory || "";
      out.accountId = `accounts/${best.accountId}`;
      out.locationId = `accounts/${best.accountId}/locations/${best.loc.locationId}`;
    } else {
      out.note =
        "He rellenado el nombre, pero no encontré una ubicación que coincida en tu cuenta de Google Business Profile. Revisa el nombre o completa Account/Location ID a mano.";
    }
  } catch (e: any) {
    // GBP API no conectada o sin permisos: al menos devolvemos el nombre.
    out.note =
      "He rellenado el nombre. Para autocompletar categoría y los GMB IDs, conecta Google Business Profile en los ajustes de GMB Hub.";
  }

  return NextResponse.json(out);
});
