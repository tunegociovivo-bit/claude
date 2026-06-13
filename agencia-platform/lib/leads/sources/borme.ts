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
import { detectSector } from "../ticket-score";

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
/**
 * Descarga el anuncio individual del BORME (XML legacy del BOE) y extrae
 * capital social y objeto social. El sumario solo trae el nombre; el detalle
 * permite filtrar por capital y afinar el sector con el objeto social.
 */
async function fetchBormeDetail(identificador: string): Promise<{ capital: number | null; objeto: string | null }> {
  try {
    const resp = await fetch(`https://www.boe.es/diario_borme/xml.php?id=${encodeURIComponent(identificador)}`, {
      headers: { Accept: "application/xml" },
      signal: AbortSignal.timeout(10000)
    });
    if (!resp.ok) return { capital: null, objeto: null };
    const xml = await resp.text();
    const texto = xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    // "Capital: 3.100,00 Euros" → 3100.  Formato español (miles ., decimales ,).
    let capital: number | null = null;
    const mCap = texto.match(/Capital[^:]*:\s*([\d.]+(?:,\d+)?)\s*Euro/i);
    if (mCap) {
      const num = mCap[1].replace(/\./g, "").replace(/,\d+$/, "");
      const v = parseInt(num, 10);
      if (Number.isFinite(v)) capital = v;
    }
    let objeto: string | null = null;
    const mObj = texto.match(/Objeto social[^:]*:\s*(.+?)(?:Domicilio|Capital|Datos registrales|$)/i);
    if (mObj) objeto = mObj[1].trim().slice(0, 300);
    return { capital, objeto };
  } catch {
    return { capital: null, objeto: null };
  }
}

/** Ejecuta `fn` sobre `items` con concurrencia limitada (pool). */
async function mapPool<T, R>(items: T[], concurrency: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}

export async function collectBorme(opts: {
  daysBack?: number;
  provinceFilter?: string;
  /** Si true, solo devuelve sociedades cuyo nombre/objeto delata un sector de
   *  alto valor (clínica dental, abogados, inmobiliaria, reformas…). Capta
   *  ticket alto desde el día 1, antes de que tengan proveedor de marketing. */
  highValueOnly?: boolean;
  /** Capital social mínimo (€) para incluir la sociedad. Requiere bajar el
   *  detalle de cada anuncio (más lento, acotado). */
  minCapital?: number;
}): Promise<PlacesResult[]> {
  const daysBack = Math.max(1, Math.min(opts.daysBack ?? 1, 30));
  const today = new Date();

  // 1) Recolecta los items crudos (constituciones) de todos los días pedidos.
  type Raw = { titulo: string; provincia: string; identificador: string; urlPdf?: string; isoDate: string };
  const raw: Raw[] = [];
  const seenId = new Set<string>();

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
        signal: AbortSignal.timeout(12000)
      });
      if (!resp.ok) {
        if (resp.status !== 404) console.warn(`[borme] sumario ${ymd}: HTTP ${resp.status}`);
        continue;
      }
      json = await resp.json();
    } catch (e: any) {
      console.warn(`[borme] error red sumario ${ymd}:`, e?.message ?? e);
      continue;
    }

    for (const it of extractItems(json)) {
      if (opts.provinceFilter && !it.provincia.toLowerCase().includes(opts.provinceFilter.toLowerCase())) continue;
      if (seenId.has(it.identificador)) continue;
      seenId.add(it.identificador);
      raw.push({ ...it, isoDate });
    }
  }

  // 2) ¿Hace falta el detalle del anuncio? Solo si se filtra por capital social
  //    (el sumario no lo trae). Acotado por coste/latencia.
  const needDetail = opts.minCapital != null;
  const detailCap = 150;
  const details = new Map<string, { capital: number | null; objeto: string | null }>();
  if (needDetail) {
    const targets = raw.slice(0, detailCap);
    const res = await mapPool(targets, 6, (it) => fetchBormeDetail(it.identificador));
    targets.forEach((it, idx) => details.set(it.identificador, res[idx]));
  }

  // 3) Construye los leads aplicando filtros (sector y/o capital).
  const out: PlacesResult[] = [];
  for (const it of raw) {
    const cleanName = cleanCompanyName(it.titulo);
    const det = details.get(it.identificador) ?? { capital: null, objeto: null };
    // El objeto social (cuando hay detalle) afina mucho la detección de sector.
    const sector = detectSector({ name: cleanName, category: det.objeto });

    if (opts.highValueOnly && !sector) continue;
    if (opts.minCapital != null) {
      // Si pedimos capital mínimo pero no pudimos verificarlo, descartamos.
      if (det.capital == null || det.capital < opts.minCapital) continue;
    }

    out.push({
      placeId: `borme:${it.identificador}`,
      name: cleanName,
      formattedAddress: null,
      province: it.provincia,
      types: ["borme.constitucion"],
      category: sector ? sector.label : "Sociedad recién constituida",
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
      rawData: {
        source: "borme",
        boeDate: it.isoDate,
        identificador: it.identificador,
        urlPdf: it.urlPdf ?? null,
        sector: sector?.key ?? null,
        capital: det.capital,
        objeto: det.objeto
      }
    });
  }

  return out;
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
