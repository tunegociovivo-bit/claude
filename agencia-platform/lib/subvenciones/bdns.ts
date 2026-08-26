/**
 * Acceso a la BDNS/SNPSAP para CONVOCATORIAS de subvenciones (las abiertas, a
 * las que un negocio puede SOLICITAR). API pública y gratuita. Defensivo con
 * los nombres de campos (la API varía) e idempotente al ingerir.
 */
import { prisma } from "@/lib/db/prisma";

// LIMITACIÓN — foco regional: solo se guardan convocatorias estatales o de la
// zona de trabajo (Andalucía y sus provincias) para que el catálogo sea
// relevante y manejable. Las de otras CCAA se descartan en la ingesta.
const FOCUS_REGIONS = [
  "espana", "estatal", "nacional", "general",
  "andalucia", "malaga", "sevilla", "cordoba", "granada", "cadiz", "jaen", "almeria", "huelva"
];
function nrm(s: string | null | undefined): string {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
function inFocus(regiones: string | null): boolean {
  const r = nrm(regiones);
  if (!r) return true; // sin región indicada → suele ser estatal: se mantiene
  return FOCUS_REGIONS.some((f) => r.includes(f));
}

const BASES = [
  "https://www.infosubvenciones.es/bdnstrans/api",
  "https://www.pap.hacienda.gob.es/bdnstrans/api"
];

function pick(it: any, keys: string[]): any {
  for (const k of keys) if (it?.[k] != null && it[k] !== "") return it[k];
  return null;
}

function parseDate(v: any): Date | null {
  if (!v) return null;
  const s = String(v).trim();
  let m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s); // dd/mm/yyyy
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); // yyyy-mm-dd
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function listText(v: any): string | null {
  if (!v) return null;
  if (Array.isArray(v)) {
    return v.map((x) => (typeof x === "string" ? x : x?.descripcion ?? x?.nombre ?? x?.descripcionCooficial ?? "")).filter(Boolean).join(" · ") || null;
  }
  if (typeof v === "object") return v.descripcion ?? v.nombre ?? null;
  return String(v);
}

function ddmmyyyy(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

export type RawConvocatoria = {
  id: string;
  titulo: string;
  organo: string | null;
  finalidad: string | null;
  beneficiarios: string | null;
  sectores: string | null;
  regiones: string | null;
  importeTotal: number | null;
  fechaInicio: Date | null;
  fechaFin: Date | null;
  urlBases: string | null;
  raw: any;
};

/** Clasifica ayudas de la red cameral obtenidas por la API pública de BDNS. */
export function isCamaraComercioConvocatoria(c: Pick<RawConvocatoria, "titulo" | "organo" | "finalidad">): boolean {
  const text = nrm(`${c.titulo} ${c.organo ?? ""} ${c.finalidad ?? ""}`);
  return /\bcamara(?:s)? (?:oficial(?:es)? )?(?:de |del )?(?:comercio|industria|navegacion)\b|\bcamara(?:s)? de comercio\b|\bcameral(?:es)?\b/.test(text);
}

/** Descarga convocatorias recientes y devuelve las ABIERTAS (plazo no vencido). */
export async function fetchOpenConvocatorias(opts?: { daysBack?: number; maxPages?: number }): Promise<RawConvocatoria[]> {
  const daysBack = Math.max(7, Math.min(opts?.daysBack ?? 120, 365));
  const maxPages = Math.max(1, Math.min(opts?.maxPages ?? 5, 15));
  const hasta = new Date();
  const desde = new Date(hasta.getTime() - daysBack * 86_400_000);

  let items: any[] = [];
  let lastErr = "";
  for (const base of BASES) {
    try {
      const all: any[] = [];
      for (let page = 0; page < maxPages; page++) {
        const params = new URLSearchParams({
          vpd: "GE",
          page: String(page),
          "page-size": "100",
          order: "fechaRecepcion",
          direccion: "desc",
          fechaDesde: ddmmyyyy(desde),
          fechaHasta: ddmmyyyy(hasta)
        });
        const resp = await fetch(`${base}/convocatorias/busqueda?${params.toString()}`, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(20000)
        });
        if (!resp.ok) { lastErr = `BDNS ${resp.status}`; break; }
        const data: any = await resp.json().catch(() => null);
        const content: any[] = data?.content ?? data?.convocatorias ?? (Array.isArray(data) ? data : []);
        if (!content.length) break;
        all.push(...content);
        if (content.length < 100) break;
      }
      if (all.length) { items = all; break; }
    } catch (e: any) {
      lastErr = e?.message ?? String(e);
    }
  }
  if (items.length === 0) throw new Error(`BDNS convocatorias: sin resultados o API no accesible${lastErr ? ` (${lastErr})` : ""}.`);

  const now = new Date();
  const out: RawConvocatoria[] = [];
  for (const it of items) {
    const id = String(pick(it, ["numeroConvocatoria", "codigoBDNS", "id", "idConvocatoria"]) ?? "").trim();
    if (!id) continue;
    const fechaFin = parseDate(pick(it, ["finSolicitud", "fechaFinSolicitud", "fechaFin", "plazoFin"]));
    // ABIERTAS: sin fecha fin (texto/varias) o con plazo aún no vencido.
    if (fechaFin && fechaFin.getTime() < now.getTime()) continue;
    out.push({
      id,
      titulo: String(pick(it, ["descripcion", "titulo", "descripcionCooficial"]) ?? "Convocatoria").slice(0, 500),
      organo: listText(pick(it, ["nivel1", "organo", "administracion", "departamento"])),
      finalidad: (pick(it, ["descripcionFinalidad", "finalidad", "instrumento"]) ? String(pick(it, ["descripcionFinalidad", "finalidad", "instrumento"])).slice(0, 1000) : null),
      beneficiarios: listText(pick(it, ["tiposBeneficiarios", "beneficiarios", "tipoBeneficiario"])),
      sectores: listText(pick(it, ["sectores", "sectoresProducto", "actividad"])),
      regiones: listText(pick(it, ["regiones", "ambitoGeografico", "ccaa", "provincia"])),
      importeTotal: Number(pick(it, ["importeTotal", "presupuestoTotal", "credito"]) ?? 0) || null,
      fechaInicio: parseDate(pick(it, ["inicioSolicitud", "fechaInicioSolicitud", "fechaRecepcion"])),
      fechaFin,
      urlBases: pick(it, ["urlBasesReguladoras", "sedeElectronica", "url"]) ?? null,
      raw: { source: "bdns", ...it }
    });
  }
  return out;
}

/** Ingiere/actualiza el catálogo de convocatorias abiertas. */
// Fuentes CURADAS: programas evergreen que casi siempre aplican (sin plazo
// fijo aquí; el match las pondera por cliente). Ampliable.
export const CURATED: RawConvocatoria[] = [
  {
    id: "curada:kit-digital",
    titulo: "Kit Digital — ayudas a la digitalización de pymes y autónomos",
    organo: "Red.es · Gobierno de España",
    finalidad: "Bono digital para web, comercio electrónico, redes sociales, gestión de clientes, ciberseguridad, facturación electrónica, etc.",
    beneficiarios: "Autónomos y pymes (hasta 249 empleados)",
    sectores: "Todos",
    regiones: "España",
    importeTotal: null,
    fechaInicio: null,
    fechaFin: null,
    urlBases: "https://www.acelerapyme.gob.es/kit-digital",
    raw: { source: "curada" }
  },
  {
    id: "curada:kit-consulting",
    titulo: "Kit Consulting — asesoramiento en transformación digital",
    organo: "Red.es · Gobierno de España",
    finalidad: "Ayuda para servicios de asesoramiento (IA, ciberseguridad, ventas digitales, análisis de datos).",
    beneficiarios: "Pymes de 10 a 249 empleados",
    sectores: "Todos",
    regiones: "España",
    importeTotal: null,
    fechaInicio: null,
    fechaFin: null,
    urlBases: "https://www.acelerapyme.gob.es/kit-consulting",
    raw: { source: "curada" }
  }
];

/** Upsert reutilizable de convocatorias (BDNS, curadas o externas vía Make). */
export async function upsertConvocatorias(list: RawConvocatoria[], fuente: string): Promise<number> {
  let n = 0;
  for (const c of list) {
    try {
      const data = {
        titulo: c.titulo, organo: c.organo, finalidad: c.finalidad,
        beneficiarios: c.beneficiarios, sectores: c.sectores, regiones: c.regiones,
        importeTotal: c.importeTotal, abierta: true, fuente, fechaInicio: c.fechaInicio,
        fechaFin: c.fechaFin, urlBases: c.urlBases, raw: c.raw ?? { source: fuente }
      };
      await prisma.subvencionConvocatoria.upsert({ where: { id: c.id }, create: { id: c.id, ...data }, update: data });
      n++;
    } catch {
      /* saltar una no debe romper la ingesta */
    }
  }
  return n;
}

/** Ingiere/actualiza el catálogo de convocatorias abiertas (BDNS + curadas). */
export async function ingestConvocatorias(opts?: { daysBack?: number; maxPages?: number }): Promise<{ fetched: number; upserted: number; fueraDeFoco: number; curadas: number; camaras: number }> {
  const list = await fetchOpenConvocatorias(opts);
  const enFoco = list.filter((c) => inFocus(c.regiones));
  const fueraDeFoco = list.length - enFoco.length;
  const camarasList = enFoco.filter(isCamaraComercioConvocatoria);
  const bdnsList = enFoco.filter((c) => !isCamaraComercioConvocatoria(c));
  const bdnsUpserted = await upsertConvocatorias(bdnsList, "bdns");
  const camarasUpserted = await upsertConvocatorias(camarasList, "camaras");
  // Reclasifica lo ya almacenado antes de habilitar esta cobertura.
  const migrated = await prisma.subvencionConvocatoria.updateMany({
    where: {
      fuente: "bdns",
      OR: [
        { titulo: { contains: "Cámara de Comercio", mode: "insensitive" } },
        { titulo: { contains: "Cámara Oficial", mode: "insensitive" } },
        { titulo: { contains: "cameral", mode: "insensitive" } },
        { organo: { contains: "Cámara de Comercio", mode: "insensitive" } },
        { organo: { contains: "Cámara Oficial", mode: "insensitive" } }
      ]
    },
    data: { fuente: "camaras" }
  });
  const upserted = bdnsUpserted + camarasUpserted;
  const curadas = await upsertConvocatorias(CURATED, "curada");
  // Marcar como cerradas las que ya vencieron (las curadas sin fecha no se tocan).
  await prisma.subvencionConvocatoria.updateMany({
    where: { abierta: true, fechaFin: { lt: new Date() } },
    data: { abierta: false }
  });
  return { fetched: list.length, upserted, fueraDeFoco, curadas, camaras: camarasUpserted + migrated.count };
}
