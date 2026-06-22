/**
 * Genera con IA un borrador de solicitud para una convocatoria y un cliente:
 * memoria/justificación, por qué encaja, presupuesto orientativo, checklist de
 * documentación y pasos. Texto listo para revisar y adaptar.
 */
import { prisma } from "@/lib/db/prisma";
import { complete, AIDisabledError } from "@/lib/ai/anthropic";
import { AGENCY_ID, getAgencyProfile } from "@/lib/subvenciones/match";
import { cnaeForCategory } from "@/lib/subvenciones/cnae";

export async function generarBorrador(workspaceId: string, clientId: string, convocatoriaId: string): Promise<string> {
  const convo = await prisma.subvencionConvocatoria.findUnique({ where: { id: convocatoriaId } });
  if (!convo) throw new Error("Convocatoria no encontrada");

  let perfil: string;
  if (clientId === AGENCY_ID) {
    // Borrador para la propia agencia (Negocio Vivo): subvención o licitación.
    perfil = (await getAgencyProfile(workspaceId)).profile;
  } else {
    const client = await prisma.client.findFirst({
      where: { id: clientId, workspaceId },
      select: { name: true, legalName: true, taxId: true, industry: true, infoGeneral: true, city: true, province: true }
    });
    if (!client) throw new Error("Cliente no encontrado");
    perfil = [
      `Nombre: ${client.name}`,
      client.legalName ? `Razón social: ${client.legalName}` : "",
      client.taxId ? `NIF/CIF: ${client.taxId}` : "",
      client.industry ? `Sector: ${client.industry}` : "",
      client.infoGeneral ? `Descripción: ${client.infoGeneral.slice(0, 800)}` : "",
      `Ubicación: ${[client.city, client.province].filter(Boolean).join(", ") || "—"}`
    ].filter(Boolean).join("\n");
  }

  return await redactar(workspaceId, perfil, convo);
}

/** Borrador para un COMERCIO de Bubui (pyme/autónomo local). */
export async function generarBorradorBubui(workspaceId: string, businessId: string, convocatoriaId: string): Promise<string> {
  const convo = await prisma.subvencionConvocatoria.findUnique({ where: { id: convocatoriaId } });
  if (!convo) throw new Error("Convocatoria no encontrada");
  const b = await prisma.bubuiBusiness.findUnique({
    where: { id: businessId },
    select: { name: true, category: true, businessType: true, city: true, province: true, description: true }
  });
  if (!b) throw new Error("Comercio no encontrado");
  const cnae = cnaeForCategory(b.category, b.businessType ?? null);
  const perfil = [
    `Nombre: ${b.name}`,
    b.category ? `Sector/actividad: ${b.category}` : "",
    cnae ? `CNAE aproximado: ${cnae.code} (${cnae.label})` : "",
    b.description ? `Descripción: ${b.description.slice(0, 800)}` : "",
    `Ubicación: ${[b.city, b.province].filter(Boolean).join(", ") || "—"}`,
    "Tipo: comercio local (pyme o autónomo)"
  ].filter(Boolean).join("\n");
  return await redactar(workspaceId, perfil, convo);
}

async function redactar(workspaceId: string, perfil: string, convo: any): Promise<string> {
  const conv = [
    `Título: ${convo.titulo}`,
    convo.organo ? `Organismo: ${convo.organo}` : "",
    convo.finalidad ? `Finalidad: ${convo.finalidad}` : "",
    convo.beneficiarios ? `Beneficiarios: ${convo.beneficiarios}` : "",
    convo.importeTotal ? `Presupuesto: ${convo.importeTotal} €` : "",
    convo.fechaFin ? `Cierre: ${convo.fechaFin.toISOString().slice(0, 10)}` : ""
  ].filter(Boolean).join("\n");

  try {
    return await complete({
      workspaceId,
      model: "claude-haiku-4-5-20251001",
      maxTokens: 1800,
      feature: "subvencion_borrador",
      system: `Eres consultor experto en subvenciones para pymes/autónomos en España. Redacta un BORRADOR de solicitud en español de España, claro y profesional, con estas secciones (usa encabezados):
1) Resumen del solicitante.
2) Encaje con la convocatoria (por qué cumple los requisitos).
3) Memoria/justificación del proyecto (2-3 párrafos, concreta y creíble).
4) Presupuesto orientativo (conceptos y rangos; deja claro que es estimado).
5) Documentación necesaria (checklist).
6) Próximos pasos y plazos.
Reglas: no inventes datos fiscales ni cifras exactas que no te den (usa rangos/placeholders [a completar]). Sé útil y específico al sector del solicitante. Devuelve solo el borrador.`,
      user: `SOLICITANTE:\n${perfil}\n\nCONVOCATORIA:\n${conv}`
    });
  } catch (e) {
    if (e instanceof AIDisabledError) throw new Error("La IA (Anthropic) no está configurada en el workspace.");
    throw e;
  }
}
