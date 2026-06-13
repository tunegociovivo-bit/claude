/**
 * Collector de leads desde la BDNS (Base de Datos Nacional de Subvenciones).
 *
 * El SNPSAP publica TODAS las subvenciones concedidas en España (API pública,
 * gratis). Un negocio que acaba de cobrar una ayuda tiene PRESUPUESTO FRESCO y
 * mentalidad de invertir → momento perfecto para captarlo. Casi nadie explota
 * esta señal.
 *
 * Devuelve PlacesResult[] (sin teléfono; se enriquece luego con Google Places).
 */
import type { PlacesResult } from "../google-places";
import { detectSector } from "../ticket-score";

const BASES = [
  "https://www.infosubvenciones.es/bdnstrans/api",
  "https://www.pap.hacienda.gob.es/bdnstrans/api"
];

/** Letras de CIF de empresa (excluye DNI/NIE de personas físicas). */
const COMPANY_CIF = new Set(["A", "B", "C", "D", "E", "F", "G", "H", "J", "N", "P", "Q", "R", "S", "U", "V", "W"]);

function ddmmyyyy(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

function pick(it: any, keys: string[]): any {
  for (const k of keys) if (it?.[k] != null && it[k] !== "") return it[k];
  return null;
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|\s|[-.])([\wáéíóúñç])/g, (_, sp, c) => sp + c.toUpperCase())
    .replace(/\b(Sl|Slu|Sa|Sau|Slp|Scp|Sc|Cb)\b/g, (m) => m.toUpperCase());
}

export async function collectBdns(opts: {
  daysBack?: number;
  provinceFilter?: string;
  /** Importe mínimo concedido (€) para incluir el beneficiario. */
  minImporte?: number;
  /** Solo empresas (CIF), descarta personas físicas. Default true. */
  companiesOnly?: boolean;
}): Promise<PlacesResult[]> {
  const daysBack = Math.max(1, Math.min(opts.daysBack ?? 14, 90));
  const hasta = new Date();
  const desde = new Date(hasta.getTime() - daysBack * 86_400_000);
  const companiesOnly = opts.companiesOnly ?? true;

  // Intenta cada base hasta que una responda. La API es paginada.
  let items: any[] = [];
  let lastErr = "";
  for (const base of BASES) {
    try {
      const all: any[] = [];
      for (let page = 0; page < 3; page++) {
        const params = new URLSearchParams({
          vpd: "GE",
          page: String(page),
          "page-size": "100",
          order: "fechaConcesion",
          direccion: "desc",
          fechaDesde: ddmmyyyy(desde),
          fechaHasta: ddmmyyyy(hasta)
        });
        const resp = await fetch(`${base}/concesiones/busqueda?${params.toString()}`, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(20000)
        });
        if (!resp.ok) {
          lastErr = `BDNS ${resp.status}`;
          break;
        }
        const data: any = await resp.json().catch(() => null);
        const content: any[] = data?.content ?? data?.["concesiones"] ?? (Array.isArray(data) ? data : []);
        if (!content.length) break;
        all.push(...content);
        if (content.length < 100) break;
      }
      if (all.length) {
        items = all;
        break;
      }
    } catch (e: any) {
      lastErr = e?.message ?? String(e);
    }
  }
  if (items.length === 0) {
    throw new Error(`BDNS: sin resultados o API no accesible${lastErr ? ` (${lastErr})` : ""}.`);
  }

  const out: PlacesResult[] = [];
  const seen = new Set<string>();
  const kwProv = opts.provinceFilter?.trim().toLowerCase();

  for (const it of items) {
    const rawName = String(pick(it, ["beneficiario", "razonSocial", "denominacion", "nombreBeneficiario"]) ?? "").trim();
    if (!rawName) continue;
    const nif = String(pick(it, ["nifCif", "nif", "numeroIdentificacion", "idBeneficiario"]) ?? "").trim().toUpperCase();
    if (companiesOnly && nif && !COMPANY_CIF.has(nif[0])) continue; // descarta personas físicas
    const importe = Number(pick(it, ["importe", "ayudaEquivalente", "importeConcesion"]) ?? 0) || 0;
    if (opts.minImporte != null && importe < opts.minImporte) continue;

    const organo = String(pick(it, ["organo", "administracion", "nivel1", "nivel2"]) ?? "");
    const finalidad = String(pick(it, ["instrumento", "finalidad", "descripcion", "descripcionCooficial", "sector"]) ?? "");
    const provincia = String(pick(it, ["provincia", "ccaa", "region"]) ?? "");
    if (kwProv && provincia && !provincia.toLowerCase().includes(kwProv)) continue;

    const key = nif || rawName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const cleanName = /^[A-ZÁÉÍÓÚÑ0-9\s.\-&,'"]+$/.test(rawName) ? titleCase(rawName) : rawName;
    const sector = detectSector({ name: cleanName, category: finalidad });
    out.push({
      placeId: `bdns:${key}`,
      name: cleanName,
      formattedAddress: provincia || null,
      province: provincia || (opts.provinceFilter ?? null),
      types: ["bdns.subvencion"],
      category: sector ? sector.label : "Beneficiario de subvención",
      latitude: null,
      longitude: null,
      rating: null,
      userRatingCount: 0,
      priceLevel: null,
      businessStatus: "OPERATIONAL",
      gmbUrl: null,
      website: null,
      phone: null,
      internationalPhone: null,
      rawData: {
        source: "bdns",
        nif: nif || null,
        importe,
        organo,
        finalidad: finalidad.slice(0, 200),
        sector: sector?.key ?? null
      }
    });
  }

  // Mayor importe primero (más presupuesto).
  out.sort((a, b) => ((b.rawData as any).importe ?? 0) - ((a.rawData as any).importe ?? 0));
  return out;
}
