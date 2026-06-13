/**
 * Collector de leads desde el BORME (Boletín Oficial del Registro Mercantil).
 * Cada día se publican las CONSTITUCIONES y NOMBRAMIENTOS de sociedades en
 * España. Mina de leads infrautilizada para captación.
 *
 * Formato real (API pública del BOE, sin clave):
 *   - Sumario: /datosabiertos/api/borme/sumario/<YYYYMMDD> → data.sumario.diario[]
 *     .seccion (código "A": Empresarios. Actos inscritos) .item[]: UN item por
 *     PROVINCIA (titulo = provincia, url_xml = XML de actos de esa provincia).
 *   - XML de provincia: <texto> con pares <p class="articulo">Nº - EMPRESA SL.</p>
 *     <p class="parrafo">acto (Constitución / Nombramientos / ...) con capital,
 *     objeto social y cargos</p>.
 *
 * Devuelve PlacesResult[] para encajar con el pipeline (AI relevance + upsert).
 */

import type { PlacesResult } from "../google-places";
import { detectSector } from "../ticket-score";

/** minúsculas + sin acentos, para comparar provincias y textos sin fallar por
 *  tildes ("Málaga" vs "MALAGA"). */
function normTxt(s: string): string {
  return String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

function isoFromYmd(ymd: string): string {
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

function arr<T = any>(x: any): T[] {
  if (Array.isArray(x)) return x;
  if (x == null) return [];
  return [x];
}

/** Items de PROVINCIA del sumario (sección A: Empresarios. Actos inscritos). */
function extractProvinceItems(json: any): Array<{ provincia: string; identificador: string; urlXml: string }> {
  const out: Array<{ provincia: string; identificador: string; urlXml: string }> = [];
  const sumario = json?.data?.sumario ?? json?.sumario ?? json;
  for (const diario of arr(sumario?.diario)) {
    for (const sec of arr(diario?.seccion)) {
      if (String(sec?.codigo ?? "").toUpperCase() !== "A") continue;
      for (const it of arr(sec?.item)) {
        const provincia = String(it?.titulo ?? "").trim();
        const id = String(it?.identificador ?? "");
        const urlXml =
          (typeof it?.url_xml === "string" && it.url_xml) ||
          (id ? `https://www.boe.es/diario_borme/xml.php?id=${id}` : "");
        if (!provincia || !urlXml) continue;
        out.push({ provincia, identificador: id, urlXml });
      }
    }
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

export type BormeCargo = { role: string; name: string };
export type BormeAct = { regNum: string | null; company: string; text: string };

/** Roles de cargo que publica el BORME (abreviaturas oficiales del registro). */
const CARGO_ROLES: Array<[RegExp, string]> = [
  [/Adm\.?\s*[ÚU]nico/i, "Administrador único"],
  [/Adm\.?\s*Solid/i, "Administrador solidario"],
  [/Adm\.?\s*Mancom/i, "Administrador mancomunado"],
  [/Cons\.?\s*Deleg/i, "Consejero delegado"],
  [/Consejero/i, "Consejero"],
  [/Presidente/i, "Presidente"],
  [/Vicepresidente/i, "Vicepresidente"],
  [/Secretario/i, "Secretario"],
  [/Apoderad/i, "Apoderado"],
  [/Director\s*General/i, "Director general"],
  [/Liquidador/i, "Liquidador"]
];

/** "GARCIA PEREZ JUAN" → "Garcia Perez Juan" (Title Case conservador). */
function titleCaseName(raw: string): string {
  const clean = raw.trim().replace(/\s+/g, " ").replace(/[.;]+$/, "");
  if (!clean) return "";
  return clean.toLowerCase().replace(/(^|\s|-)([\wáéíóúñç])/g, (_, s, c) => s + c.toUpperCase());
}

/** Extrae los cargos (rol + nombre) del texto de un acto de nombramientos. */
function parseCargos(texto: string): BormeCargo[] {
  const out: BormeCargo[] = [];
  const seg = texto.match(/Nombramientos\.?\s*(.+?)(?:Datos registrales|Objeto social|$)/i)?.[1] ?? texto;
  const re = /([A-Za-zÁÉÍÓÚÑ.\s]{3,30}?):\s*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ'\-\s]{4,60})(?=[.;]|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(seg))) {
    const role = CARGO_ROLES.find(([rx]) => rx.test(m![1].trim()))?.[1];
    if (!role) continue;
    const name = m[2].trim();
    if (out.some((c) => c.name.toUpperCase() === name && c.role === role)) continue;
    out.push({ role, name: titleCaseName(name) });
    if (out.length >= 6) break;
  }
  return out;
}

function parseCapital(texto: string): number | null {
  const m = texto.match(/Capital[^:]*:\s*([\d.]+(?:,\d+)?)\s*Euro/i);
  if (!m) return null;
  const v = parseInt(m[1].replace(/\./g, "").replace(/,\d+$/, ""), 10);
  return Number.isFinite(v) ? v : null;
}

function parseObjeto(texto: string): string | null {
  const m = texto.match(/Objeto social[^:]*:\s*(.+?)(?:Domicilio|Capital|Datos registrales|$)/i);
  return m ? m[1].trim().slice(0, 300) : null;
}

/** Descarga el XML de actos de una provincia y devuelve los pares empresa+acto. */
async function fetchProvinceActs(urlXml: string): Promise<BormeAct[]> {
  try {
    const resp = await fetch(urlXml, { headers: { Accept: "application/xml" }, signal: AbortSignal.timeout(12000) });
    if (!resp.ok) return [];
    const xml = await resp.text();
    const blocks = [...xml.matchAll(/<p[^>]*class="(articulo|parrafo)"[^>]*>([\s\S]*?)<\/p>/gi)];
    const acts: BormeAct[] = [];
    let cur: { regNum: string | null; company: string; parts: string[] } | null = null;
    const flush = () => {
      if (cur && cur.company) acts.push({ regNum: cur.regNum, company: cur.company, text: cur.parts.join(" ").trim() });
    };
    for (const b of blocks) {
      const kind = b[1].toLowerCase();
      const text = decodeEntities(b[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
      if (kind === "articulo") {
        flush();
        const m = text.match(/^(\d+)\s*-\s*(.+?)\.?$/);
        cur = m
          ? { regNum: m[1], company: m[2].trim(), parts: [] }
          : { regNum: null, company: text.replace(/\.$/, "").trim(), parts: [] };
      } else if (cur) {
        cur.parts.push(text);
      }
    }
    flush();
    return acts;
  } catch {
    return [];
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

/** Límite de XML de provincia a bajar por búsqueda (coste/latencia). */
const MAX_PROVINCE_FETCH = 60;
/** Tope de leads devueltos (controla el coste del clasificador IA posterior). */
const MAX_RESULTS = 500;

export async function collectBorme(opts: {
  daysBack?: number;
  provinceFilter?: string;
  /** Solo sociedades de un sector de alto valor (clínica dental, abogados…). */
  highValueOnly?: boolean;
  /** Capital social mínimo (€). */
  minCapital?: number;
  /** "cargos" → mina los NOMBRAMIENTOS para captar al directivo por su nombre. */
  mode?: "constituciones" | "cargos";
  /** Key de sector concreto (p.ej. "dental") para filtrar. */
  sectorFilter?: string;
}): Promise<PlacesResult[]> {
  const mode = opts.mode ?? "constituciones";
  // `daysBack` = nº de días PUBLICADOS a reunir. El BORME no publica findes ni
  // festivos, así que escaneamos hacia atrás hasta reunir esos días (sin esto,
  // una búsqueda en sábado miraba solo el sábado → 0 resultados).
  const wantDays = Math.max(1, Math.min(opts.daysBack ?? 1, 30));
  const maxScan = wantDays + 12;
  const today = new Date();
  const provFilter = opts.provinceFilter ? normTxt(opts.provinceFilter) : null;

  // 1) Reúne los items de provincia de los días publicados más recientes.
  type Prov = { provincia: string; identificador: string; urlXml: string; isoDate: string };
  const provItems: Prov[] = [];
  let fetched = 0;
  for (let d = 0; d < maxScan && fetched < wantDays; d++) {
    const date = new Date(today.getTime() - d * 86_400_000);
    if (date.getUTCDay() === 0 || date.getUTCDay() === 6) continue; // findes
    const ymd = ymdFromDate(date);
    let json: any;
    try {
      const resp = await fetch(`https://www.boe.es/datosabiertos/api/borme/sumario/${ymd}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(12000)
      });
      if (!resp.ok) {
        if (resp.status !== 404) console.warn(`[borme] sumario ${ymd}: HTTP ${resp.status}`);
        continue; // 404 = festivo: no cuenta como día publicado
      }
      json = await resp.json();
    } catch (e: any) {
      console.warn(`[borme] error red sumario ${ymd}:`, e?.message ?? e);
      continue;
    }
    fetched++;
    const isoDate = isoFromYmd(ymd);
    for (const it of extractProvinceItems(json)) {
      if (provFilter && !normTxt(it.provincia).includes(provFilter)) continue;
      provItems.push({ ...it, isoDate });
    }
  }

  // 2) Baja el XML de actos de cada provincia (acotado) en paralelo.
  const targets = provItems.slice(0, MAX_PROVINCE_FETCH);
  const actsByProvince = await mapPool(targets, 5, (p) => fetchProvinceActs(p.urlXml));

  // 3) Construye los leads a partir de los actos del tipo pedido.
  const out: PlacesResult[] = [];
  const seen = new Set<string>();
  const actRe = mode === "cargos" ? /Nombramientos/i : /Constituci[oó]n/i;

  for (let i = 0; i < targets.length && out.length < MAX_RESULTS; i++) {
    const prov = targets[i];
    for (const act of actsByProvince[i]) {
      if (!actRe.test(act.text)) continue;
      const cleanName = cleanCompanyName(act.company);
      if (!cleanName) continue;
      const objeto = parseObjeto(act.text);
      const capital = parseCapital(act.text);
      const cargos = mode === "cargos" ? parseCargos(act.text) : [];
      const sector = detectSector({ name: cleanName, category: objeto });

      if (opts.sectorFilter && sector?.key !== opts.sectorFilter) continue;
      if (opts.highValueOnly && !sector) continue;
      if (opts.minCapital != null && (capital == null || capital < opts.minCapital)) continue;
      if (mode === "cargos" && cargos.length === 0) continue;

      const placeId = `borme:${prov.identificador}:${act.regNum ?? normTxt(cleanName).replace(/\s+/g, "-").slice(0, 40)}`;
      if (seen.has(placeId)) continue;
      seen.add(placeId);

      const primary = cargos[0];
      out.push({
        placeId,
        name: cleanName,
        formattedAddress: null,
        province: prov.provincia,
        types: [mode === "cargos" ? "borme.nombramiento" : "borme.constitucion"],
        category: sector ? sector.label : mode === "cargos" ? "Empresa (cargo nombrado)" : "Sociedad recién constituida",
        latitude: null,
        longitude: null,
        rating: null,
        userRatingCount: 0,
        priceLevel: null,
        businessStatus: "OPERATIONAL",
        gmbUrl: `https://www.boe.es/diario_borme/xml.php?id=${prov.identificador}`,
        website: null,
        phone: null,
        internationalPhone: null,
        rawData: {
          source: "borme",
          boeDate: prov.isoDate,
          identificador: prov.identificador,
          sector: sector?.key ?? null,
          capital,
          objeto,
          directors: cargos,
          directorName: primary?.name ?? null,
          directorRole: primary?.role ?? null
        }
      });
      if (out.length >= MAX_RESULTS) break;
    }
  }

  return out;
}

/** Limpia el nombre BORME: quita punto final y normaliza mayúsculas
 *  conservando siglas. "TANTRA RIDDIM SL." → "Tantra Riddim SL". */
function cleanCompanyName(s: string): string {
  let n = s.trim().replace(/\.$/, "").trim();
  if (/^[A-ZÁÉÍÓÚÑÇ0-9\s\.\-&,'"]+$/.test(n)) {
    n = n.toLowerCase().replace(/(^|\s)([\wáéíóúñç])/g, (_, sp, c) => sp + c.toUpperCase());
    n = n.replace(/\b(Sl|Slu|Sa|Sau|Slp|Slne|Scp|Sc|Cb|Scs|Scm|Ute|Aie|Gie|Srl|Src)\b/g, (m) => m.toUpperCase());
  }
  return n;
}
