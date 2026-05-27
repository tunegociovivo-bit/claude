/**
 * Collector de leads desde el BORME (Boletín Oficial del Registro
 * Mercantil). Cada día se publican las CONSTITUCIONES de sociedades en
 * España — son negocios que en su día 1 no tienen ni web, ni GMB, ni nada.
 * Mina de leads infrautilizada para captación.
 *
 * Fuente: API pública del BOE (sin clave, gratis).
 *   https://www.boe.es/datosabiertos/api/borme/sumario/<YYYYMMDD>
 *
 * Devuelve PlacesResult[] para ser compatible con el resto del pipeline
 * (AI relevance + upsertLead + scoring) sin cambios.
 */

import type { PlacesResult } from "../google-places";

/** Mapea "REGISTRO MERCANTIL DE BARCELONA" → "Barcelona". */
function provinceFromRegistro(name: string): string {
  return String(name ?? "")
    .replace(/registro mercantil( central)? de\s+/i, "")
    .replace(/^\s+|\s+$/g, "")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function isoFromYmd(ymd: string): string {
  // YYYYMMDD → YYYY-MM-DD; si llega ya formateado, lo devuelve tal cual.
  if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  if (/^\d{8}$/.test(ymd)) return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
  return ymd;
}

function ymdFromDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/** Walker tolerante sobre el JSON del sumario BORME — el formato cambia
 *  entre días (puede venir como array o objeto). Devuelve los items
 *  cuya sección/epígrafe coincide con "Constituciones". */
function extractItems(json: any): Array<{ titulo: string; provincia: string; identificador: string; urlPdf?: string }> {
  const out: Array<{ titulo: string; provincia: string; identificador: string; urlPdf?: string }> = [];

  const sumario = json?.data?.sumario ?? json?.sumario ?? json;
  const diarios = arr(sumario?.diario);
  for (const diario of diarios) {
    const secciones = arr(diario?.seccion);
    for (const seccion of secciones) {
      // II = ANUNCIOS Y AVISOS LEGALES; A = empresarios.
      const departamentos = arr(seccion?.departamento);
      for (const dep of departamentos) {
        const provincia = provinceFromRegistro(dep?.nombre ?? dep?.codigo ?? "");
        const epigrafes = arr(dep?.epigrafe);
        for (const ep of epigrafes) {
          const nombre = String(ep?.nombre ?? "").toLowerCase();
          if (!nombre.includes("constituci")) continue;
          const items = arr(ep?.item);
          for (const it of items) {
            const titulo = String(it?.titulo ?? "").trim();
            if (!titulo) continue;
            out.push({
              titulo,
              provincia: provincia || "—",
              identificador: String(it?.identificador ?? `borme-${Math.random().toString(36).slice(2, 9)}`),
              urlPdf: it?.url_pdf ?? it?.urlPdf ?? undefined
            });
          }
        }
      }
    }
  }
  return out;
}

function arr<T = any>(x: any): T[] {
  if (Array.isArray(x)) return x;
  if (x == null) return [];
  return [x];
}

/**
 * Trae los items del BORME para un rango de días hacia atrás.
 *
 * @param daysBack Cuántos días hacia atrás incluir (1 = solo hoy).
 *                 Saltamos sábados/domingos: el BORME no se publica en finde.
 * @param provinceFilter Si se pasa, filtra a los items cuyo nombre de provincia
 *                       contenga este texto (case-insensitive).
 */
export async function collectBorme(opts: {
  daysBack?: number;
  provinceFilter?: string;
}): Promise<PlacesResult[]> {
  const daysBack = Math.max(1, Math.min(opts.daysBack ?? 1, 30));
  const out: PlacesResult[] = [];
  const today = new Date();

  for (let d = 0; d < daysBack; d++) {
    const date = new Date(today.getTime() - d * 86_400_000);
    // BORME no publica fines de semana (sábado=6, domingo=0).
    if (date.getUTCDay() === 0 || date.getUTCDay() === 6) continue;
    const ymd = ymdFromDate(date);
    const isoDate = isoFromYmd(ymd);

    let json: any;
    try {
      const resp = await fetch(`https://www.boe.es/datosabiertos/api/borme/sumario/${ymd}`, {
        headers: { Accept: "application/json" },
        // El BOE es rápido en general; 12s holgado.
        signal: AbortSignal.timeout(12000)
      });
      if (!resp.ok) {
        // 404 es normal en festivos: lo saltamos sin ruido.
        if (resp.status !== 404) {
          console.warn(`[borme] sumario ${ymd}: HTTP ${resp.status}`);
        }
        continue;
      }
      json = await resp.json();
    } catch (e: any) {
      console.warn(`[borme] error red sumario ${ymd}:`, e?.message ?? e);
      continue;
    }

    const items = extractItems(json);
    for (const it of items) {
      if (
        opts.provinceFilter &&
        !it.provincia.toLowerCase().includes(opts.provinceFilter.toLowerCase())
      ) {
        continue;
      }
      // PlaceId pseudo-único para que upsertLead deduplique entre días
      // y entre rebusquedas: "borme:<identificador>".
      out.push({
        placeId: `borme:${it.identificador}`,
        name: cleanCompanyName(it.titulo),
        formattedAddress: null,
        province: it.provincia,
        types: ["borme.constitucion"],
        category: "Sociedad recién constituida",
        latitude: null,
        longitude: null,
        rating: null,
        userRatingCount: 0,
        priceLevel: null,
        businessStatus: "OPERATIONAL",
        gmbUrl: it.urlPdf ?? null,
        website: null,
        phone: null,
        internationalPhone: null,
        rawData: { source: "borme", boeDate: isoDate, identificador: it.identificador, urlPdf: it.urlPdf ?? null }
      });
    }
  }

  // Dedup por placeId (puede aparecer la misma empresa en varios días si
  // hay rectificación posterior).
  const seen = new Set<string>();
  return out.filter((r) => {
    if (seen.has(r.placeId)) return false;
    seen.add(r.placeId);
    return true;
  });
}

/** Limpia el título BORME: quita puntos finales, normaliza mayúsculas
 *  conservando siglas. "TANTRA RIDDIM SL." → "Tantra Riddim SL". */
function cleanCompanyName(s: string): string {
  let n = s.trim().replace(/\.$/, "").trim();
  // Si está TODO en mayúsculas, paso a Title Case dejando siglas comunes.
  const SIGLAS = /\b(SL|SLU|SA|SAU|SLP|SLNE|SCP|SC|CB|SCS|SCM|UTE|AIE|GIE|SRL|SRC)\b/g;
  if (/^[A-ZÁÉÍÓÚÑÇ0-9\s\.\-&,'"]+$/.test(n)) {
    n = n
      .toLowerCase()
      .replace(/(^|\s)([\wáéíóúñç])/g, (_, sp, c) => sp + c.toUpperCase());
    n = n.replace(/\b(Sl|Slu|Sa|Sau|Slp|Slne|Scp|Sc|Cb|Scs|Scm|Ute|Aie|Gie|Srl|Src)\b/g, (m) => m.toUpperCase());
  }
  return n;
}
