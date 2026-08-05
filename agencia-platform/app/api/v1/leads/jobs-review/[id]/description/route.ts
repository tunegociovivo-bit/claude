/**
 * Módulo Empleos — cargar el texto de la oferta BAJO DEMANDA.
 *
 *  POST → baja de la ficha de la oferta (LinkedIn) el texto de la descripción,
 *  lo guarda en el lead y lo devuelve. Se hace al desplegar la oferta en el panel
 *  (no en la búsqueda) para no gastar una llamada de Scrapfly por empresa de golpe.
 *  InfoJobs ya trae la descripción gratis en la búsqueda, así que no pasa por aquí.
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { prisma } from "@/lib/db/prisma";
import { fetchJobDescription } from "@/lib/leads/sources/jobs";
import { scrapflyKey } from "@/lib/leads/sources";

export const dynamic = "force-dynamic";

export const POST = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const row = await prisma.leadExecOutreach.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    select: { leadId: true }
  });
  if (!row) throw new ApiError(404, "not_found", "No se encontró la oferta.");

  const lead = await prisma.lead.findFirst({
    where: { id: row.leadId, workspaceId: api.workspaceId },
    select: { rawData: true }
  });
  const rd: any = lead?.rawData ?? {};
  // Ya la teníamos (InfoJobs, o cargada antes) → la devolvemos sin re-scrapear.
  if (typeof rd?.jobDescription === "string" && rd.jobDescription.trim()) {
    return NextResponse.json({ description: rd.jobDescription });
  }
  const jobUrl = typeof rd?.jobUrl === "string" ? rd.jobUrl : null;
  if (!jobUrl) throw new ApiError(400, "no_url", "Esta oferta no tiene enlace para extraer el texto.");

  const key = await scrapflyKey(api.workspaceId);
  if (!key) throw new ApiError(400, "no_scrapfly", "Falta la API key de Scrapfly (Ajustes de Leads).");

  const description = await fetchJobDescription(jobUrl, key);
  if (description) {
    await prisma.lead.update({
      where: { id: row.leadId },
      data: { rawData: { ...rd, jobDescription: description } }
    });
  }
  return NextResponse.json({ description: description ?? null });
});
