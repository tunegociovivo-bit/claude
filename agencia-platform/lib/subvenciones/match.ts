/**
 * Cruce IA entre un cliente y las convocatorias de subvenciones abiertas.
 * Prefiltra por región/recencia y deja que la IA puntúe el encaje y explique
 * por qué califica y qué necesita.
 */
import { prisma } from "@/lib/db/prisma";
import { completeJson, AIDisabledError } from "@/lib/ai/anthropic";

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

export async function matchForClient(workspaceId: string, clientId: string, userId?: string | null): Promise<ClientMatch[]> {
  const client = await prisma.client.findFirst({
    where: { id: clientId, workspaceId },
    select: { id: true, name: true, industry: true, infoGeneral: true, city: true, province: true, taxId: true, kitDigital: true }
  });
  if (!client) throw new Error("Cliente no encontrado");

  const now = new Date();
  const all = await prisma.subvencionConvocatoria.findMany({
    where: { abierta: true, OR: [{ fechaFin: null }, { fechaFin: { gte: now } }] },
    orderBy: { fechaFin: "asc" },
    take: 400
  });

  // Prefiltro regional: estatales + de su provincia/CCAA (o sin región).
  const prov = norm(client.province);
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

  const empresa = client.taxId ? /^[ABCDEFGHJNPQRSUVW]/i.test(client.taxId.trim()) : null;
  const perfil = [
    `Nombre: ${client.name}`,
    client.industry ? `Sector: ${client.industry}` : "",
    client.infoGeneral ? `Info: ${client.infoGeneral.slice(0, 500)}` : "",
    `Ubicación: ${[client.city, client.province].filter(Boolean).join(", ") || "—"}`,
    empresa === null ? "" : `Tipo: ${empresa ? "empresa (CIF)" : "autónomo/persona física"}`,
    `Kit Digital ya solicitado: ${client.kitDigital ? "sí" : "no"}`
  ].filter(Boolean).join("\n");

  const lista = candidates
    .map((c) => `[${c.id}] ${c.titulo}${c.finalidad ? ` | Finalidad: ${c.finalidad.slice(0, 160)}` : ""}${c.beneficiarios ? ` | Beneficiarios: ${c.beneficiarios.slice(0, 120)}` : ""}${c.regiones ? ` | Región: ${c.regiones.slice(0, 80)}` : ""}${c.fechaFin ? ` | Cierra: ${c.fechaFin.toISOString().slice(0, 10)}` : ""}`)
    .join("\n");

  try {
    void userId;
    const out = await completeJson<{ matches: { id: string; fitScore: number; motivo: string; requisitos: string }[] }>({
      workspaceId,
      model: "claude-haiku-4-5-20251001",
      system: `Eres experto en subvenciones para pymes y autónomos en España. Te paso el perfil de un negocio y una lista de convocatorias abiertas (con su id). Devuelve SOLO las que le ENCAJAN de verdad, con:
- fitScore 0-100 (descarta las que no apliquen: no inventes encaje).
- motivo: 1 frase de por qué califica.
- requisitos: 1 frase de qué necesitaría para solicitarla.
Usa EXACTAMENTE los id que te paso. Ordena por fitScore desc. Máximo 10. Si ninguna encaja, devuelve lista vacía.`,
      user: `PERFIL DEL NEGOCIO:\n${perfil}\n\nCONVOCATORIAS:\n${lista}`,
      schema: SCHEMA,
      maxTokens: 1500
    });
    const byId = new Map(candidates.map((c) => [c.id, c]));
    return (out.matches ?? [])
      .filter((m) => byId.has(m.id) && m.fitScore >= 40)
      .sort((a, b) => b.fitScore - a.fitScore)
      .map((m) => {
        const c = byId.get(m.id)!;
        return {
          id: m.id, fitScore: m.fitScore, motivo: m.motivo, requisitos: m.requisitos,
          titulo: c.titulo, organo: c.organo, importeTotal: c.importeTotal, fechaFin: c.fechaFin, urlBases: c.urlBases
        };
      });
  } catch (e) {
    if (e instanceof AIDisabledError) throw new Error("La IA (Anthropic) no está configurada en el workspace.");
    throw e;
  }
}
