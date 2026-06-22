/**
 * Cruce IA entre un objetivo (un cliente O la propia agencia "Negocio Vivo") y
 * las convocatorias abiertas. Prefiltra por región/recencia y deja que la IA
 * puntúe el encaje y explique por qué califica y qué necesita.
 *
 * La agencia es un objetivo de PRIMERA CLASE: usa el id centinela AGENCY_ID, su
 * propio perfil (editable en ajustes) y un prompt que además de subvenciones
 * considera LICITACIONES y contratos públicos de servicios de marketing.
 */
import { prisma } from "@/lib/db/prisma";
import { completeJson, AIDisabledError } from "@/lib/ai/anthropic";
import { cnaeForCategory } from "./cnae";

// Id centinela para tratar a la agencia como un "objetivo" más (estados,
// borradores, avisos) sin tener que crear un Client falso.
export const AGENCY_ID = "__agency__";

// Perfil por defecto de Negocio Vivo si el admin no ha guardado uno propio.
const DEFAULT_AGENCY_PROFILE = `Nombre: Negocio Vivo — agencia de marketing digital
Tipo: empresa (CIF)
Sector: marketing, publicidad y comunicación. Servicios: diseño y desarrollo web (WordPress), gestión de redes sociales, SEO/SEM, publicidad en Meta y Google Ads, branding, contenidos audiovisuales y gestión de reseñas/reputación online.
Ubicación: Marbella, Málaga (Andalucía).
Tamaño: pequeña empresa / pyme.
Intereses en SUBVENCIONES: digitalización, innovación, transformación digital, contratación de personal, formación, internacionalización, eficiencia y proyectos de marketing/comunicación.
Intereses en LICITACIONES y contratos públicos: servicios de marketing, publicidad institucional, comunicación, diseño y mantenimiento web, gestión de redes sociales, campañas y SEO para ayuntamientos, diputaciones, Junta de Andalucía y otros organismos públicos.`;

// CCAA por provincia (mínimo para prefiltro regional; ampliable).
const CCAA: Record<string, string> = {
  malaga: "andalucia", sevilla: "andalucia", cordoba: "andalucia", granada: "andalucia",
  cadiz: "andalucia", jaen: "andalucia", almeria: "andalucia", huelva: "andalucia"
};

function norm(s: string | null | undefined): string {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

const SCHEMA = {
  type: "object",
  properties: {
    matches: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          fitScore: { type: "integer" },
          motivo: { type: "string" },
          requisitos: { type: "string" }
        },
        required: ["id", "fitScore", "motivo", "requisitos"]
      }
    }
  },
  required: ["matches"]
};

export type ClientMatch = {
  id: string;
  fitScore: number;
  motivo: string;
  requisitos: string;
  titulo: string;
  organo: string | null;
  importeTotal: number | null;
  fechaFin: Date | null;
  urlBases: string | null;
};

// LIMITACIÓN — caché del cruce por objetivo: no re-llama a la IA en cada clic.
const matchCache = new Map<string, { at: number; data: ClientMatch[] }>();
const MATCH_TTL = 12 * 60 * 60 * 1000;

/** Lee el perfil de la agencia (editable en settings.subvenciones) + su provincia. */
export async function getAgencyProfile(workspaceId: string): Promise<{ profile: string; province: string }> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  const sv = (ws?.settings as any)?.subvenciones ?? {};
  return {
    profile: (typeof sv.agencyProfile === "string" && sv.agencyProfile.trim()) || DEFAULT_AGENCY_PROFILE,
    province: norm(sv.agencyProvince) || "malaga"
  };
}

/** Núcleo del cruce: dada una descripción de perfil y su provincia, puntúa las
 *  convocatorias abiertas con IA. `mode` ajusta el prompt (cliente vs agencia). */
async function analizar(
  workspaceId: string,
  perfil: string,
  prov: string,
  cacheKey: string,
  mode: "cliente" | "agencia",
  opts?: { force?: boolean }
): Promise<ClientMatch[]> {
  if (!opts?.force) {
    const hit = matchCache.get(cacheKey);
    if (hit && Date.now() - hit.at < MATCH_TTL) return hit.data;
  }

  const now = new Date();
  const all = await prisma.subvencionConvocatoria.findMany({
    where: { abierta: true, OR: [{ fechaFin: null }, { fechaFin: { gte: now } }] },
    orderBy: { fechaFin: "asc" },
    take: 400
  });

  // Prefiltro regional: estatales + de su provincia/CCAA (o sin región).
  const ccaa = CCAA[prov] ?? "";
  const candidates = all
    .filter((c) => {
      const reg = norm(c.regiones);
      if (!reg) return true;
      if (reg.includes("espana") || reg.includes("estatal") || reg.includes("nacional")) return true;
      if (prov && reg.includes(prov)) return true;
      if (ccaa && reg.includes(ccaa)) return true;
      return false;
    })
    .slice(0, 40);

  if (candidates.length === 0) return [];

  const lista = candidates
    .map((c) => `[${c.id}] ${c.titulo}${c.finalidad ? ` | Finalidad: ${c.finalidad.slice(0, 160)}` : ""}${c.beneficiarios ? ` | Beneficiarios: ${c.beneficiarios.slice(0, 120)}` : ""}${c.regiones ? ` | Región: ${c.regiones.slice(0, 80)}` : ""}${c.fechaFin ? ` | Cierra: ${c.fechaFin.toISOString().slice(0, 10)}` : ""}`)
    .join("\n");

  const system = mode === "agencia"
    ? `Eres experto en subvenciones Y en licitaciones/contratos públicos para empresas en España. Te paso el perfil de una AGENCIA DE MARKETING y una lista de convocatorias abiertas (con su id). Considera DOS tipos de oportunidad para la agencia:
1) SUBVENCIONES/ayudas que la propia agencia puede solicitar (digitalización, innovación, contratación, formación, internacionalización…).
2) LICITACIONES y contratos públicos de servicios que la agencia podría GANAR (publicidad, comunicación, diseño/mantenimiento web, redes sociales, SEO, campañas) para ayuntamientos, diputaciones, Junta de Andalucía u otros organismos.
Devuelve SOLO las que le ENCAJAN de verdad, con:
- fitScore 0-100 (descarta lo que no aplique: no inventes encaje).
- motivo: 1 frase de por qué le encaja a la agencia.
- requisitos: 1 frase de qué necesitaría para solicitarla/presentarse.
Usa EXACTAMENTE los id que te paso. Ordena por fitScore desc. Máximo 12. Si ninguna encaja, devuelve lista vacía.`
    : `Eres experto en subvenciones para pymes y autónomos en España. Te paso el perfil de un negocio y una lista de convocatorias abiertas (con su id). Devuelve SOLO las que le ENCAJAN de verdad, con:
- fitScore 0-100 (descarta las que no apliquen: no inventes encaje).
- motivo: 1 frase de por qué califica.
- requisitos: 1 frase de qué necesitaría para solicitarla.
Usa EXACTAMENTE los id que te paso. Ordena por fitScore desc. Máximo 10. Si ninguna encaja, devuelve lista vacía.`;

  const etiqueta = mode === "agencia" ? "PERFIL DE LA AGENCIA" : "PERFIL DEL NEGOCIO";

  try {
    const out = await completeJson<{ matches: { id: string; fitScore: number; motivo: string; requisitos: string }[] }>({
      workspaceId,
      model: "claude-haiku-4-5-20251001",
      system,
      user: `${etiqueta}:\n${perfil}\n\nCONVOCATORIAS:\n${lista}`,
      schema: SCHEMA,
      maxTokens: 1700
    });
    const byId = new Map(candidates.map((c) => [c.id, c]));
    const result: ClientMatch[] = (out.matches ?? [])
      .filter((m) => byId.has(m.id) && m.fitScore >= 40)
      .sort((a, b) => b.fitScore - a.fitScore)
      .map((m) => {
        const c = byId.get(m.id)!;
        return {
          id: m.id, fitScore: m.fitScore, motivo: m.motivo, requisitos: m.requisitos,
          titulo: c.titulo, organo: c.organo, importeTotal: c.importeTotal, fechaFin: c.fechaFin, urlBases: c.urlBases
        };
      });
    matchCache.set(cacheKey, { at: Date.now(), data: result });
    return result;
  } catch (e) {
    if (e instanceof AIDisabledError) throw new Error("La IA (Anthropic) no está configurada en el workspace.");
    throw e;
  }
}

/** Cruce para la propia agencia (Negocio Vivo): subvenciones + licitaciones. */
export async function matchForAgency(workspaceId: string, opts?: { force?: boolean }): Promise<ClientMatch[]> {
  const { profile, province } = await getAgencyProfile(workspaceId);
  return analizar(workspaceId, profile, province, `${workspaceId}:${AGENCY_ID}`, "agencia", opts);
}

export async function matchForClient(workspaceId: string, clientId: string, opts?: { force?: boolean }): Promise<ClientMatch[]> {
  // La agencia se trata como un objetivo más mediante el id centinela.
  if (clientId === AGENCY_ID) return matchForAgency(workspaceId, opts);

  const client = await prisma.client.findFirst({
    where: { id: clientId, workspaceId },
    select: { id: true, name: true, industry: true, infoGeneral: true, city: true, province: true, taxId: true, kitDigital: true }
  });
  if (!client) throw new Error("Cliente no encontrado");

  const empresa = client.taxId ? /^[ABCDEFGHJNPQRSUVW]/i.test(client.taxId.trim()) : null;
  const perfil = [
    `Nombre: ${client.name}`,
    client.industry ? `Sector: ${client.industry}` : "",
    client.infoGeneral ? `Info: ${client.infoGeneral.slice(0, 500)}` : "",
    `Ubicación: ${[client.city, client.province].filter(Boolean).join(", ") || "—"}`,
    empresa === null ? "" : `Tipo: ${empresa ? "empresa (CIF)" : "autónomo/persona física"}`,
    `Kit Digital ya solicitado: ${client.kitDigital ? "sí" : "no"}`
  ].filter(Boolean).join("\n");

  return analizar(workspaceId, perfil, norm(client.province), `${workspaceId}:${clientId}`, "cliente", opts);
}

/** Cruce para un COMERCIO de Bubui (pyme/autónomo local). Construye el perfil
 *  a partir de su categoría/tipo/ubicación y reutiliza el mismo motor IA. */
export async function matchForBubuiBusiness(
  workspaceId: string,
  business: { id: string; name: string; category: string | null; businessType?: string | null; city?: string | null; province?: string | null },
  opts?: { force?: boolean }
): Promise<ClientMatch[]> {
  const perfil = [
    `Nombre: ${business.name}`,
    business.category ? `Sector/actividad: ${business.category}` : "",
    business.businessType ? `Tipo de negocio: ${business.businessType}` : "",
    (() => {
      const cnae = cnaeForCategory(business.category, business.businessType ?? null);
      return cnae ? `CNAE aproximado: ${cnae.code} (${cnae.label})` : "";
    })(),
    `Ubicación: ${[business.city, business.province].filter(Boolean).join(", ") || "—"}`,
    "Tipo: comercio local (pyme o autónomo)"
  ].filter(Boolean).join("\n");
  return analizar(workspaceId, perfil, norm(business.province), `${workspaceId}:bubui:${business.id}`, "cliente", opts);
}
