import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { generarBorrador } from "@/lib/subvenciones/borrador";
import { AGENCY_ID } from "@/lib/subvenciones/match";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const REQUIRED_PROFILE: Record<string, string> = {
  representativeName: "nombre del representante", representativeSurnames: "apellidos del representante", representativeId: "DNI/NIE",
  representativeRole: "cargo y poderes", representativeEmail: "email", representativePhone: "teléfono", companyTaxId: "NIF/CIF",
  legalName: "razón social", legalForm: "forma jurídica", address: "domicilio", postalCode: "código postal", city: "población",
  province: "provincia", country: "país", cnae: "CNAE"
};
const REQUIRED_FILES: Record<string, string> = {
  company_tax_card: "tarjeta NIF/CIF", representative_id: "DNI/NIE del representante", incorporation_deed: "escritura y estatutos",
  representation_powers: "poderes de representación", tax_certificate: "certificado de Hacienda", social_security_certificate: "certificado de Seguridad Social"
};

async function requireAdmin(workspaceId: string, userId?: string) {
  if (!userId) throw new ApiError(401, "unauthorized", "Autenticación requerida");
  const membership = await prisma.membership.findFirst({ where: { workspaceId, userId }, select: { role: true } });
  if (membership?.role !== "ADMIN") throw new ApiError(403, "forbidden", "Acceso restringido a administradores");
}

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  await requireAdmin(api.workspaceId, api.userId);
  const parsed = z.object({ taskId: z.string().min(1) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const task = await prisma.task.findFirst({ where: { id: parsed.data.taskId, workspaceId: api.workspaceId, deletedAt: null }, select: { id: true, clientId: true, description: true, aiState: true } });
  if (!task) throw new ApiError(404, "not_found", "Expediente no encontrado");
  const state: any = task.aiState ?? {}; const automation: any = state.subvencionAutomation ?? {}; const current: any = automation.workflow ?? {};
  const workspace = await prisma.workspace.findUnique({ where: { id: api.workspaceId }, select: { settings: true } });
  const profile: any = (workspace?.settings as any)?.subvenciones?.applicationVault ?? {};
  const vaultFiles = await prisma.file.findMany({ where: { workspaceId: api.workspaceId, targetType: "SUBVENCION_VAULT" }, select: { targetId: true } });
  const missingProfile = Object.entries(REQUIRED_PROFILE).filter(([key]) => !String(profile[key] ?? "").trim()).map(([, label]) => label);
  const presentCategories = new Set(vaultFiles.map((file) => file.targetId).filter(Boolean));
  const missingFiles = Object.entries(REQUIRED_FILES).filter(([key]) => !presentCategories.has(key)).map(([, label]) => label);
  let stage = "ELIGIBILITY"; let nextStep = ""; let blockers = ""; let workDone = "Validación automática completada.";

  if (missingProfile.length) {
    blockers = `Faltan datos maestros: ${missingProfile.join(", ")}.`;
    nextStep = "Completar los datos indicados en la Bóveda de solicitudes y volver a pulsar Continuar tramitación IA.";
  } else if (missingFiles.length) {
    stage = "DOCUMENTS"; blockers = `Faltan documentos maestros: ${missingFiles.join(", ")}.`;
    nextStep = "Adjuntar esos documentos en la Bóveda de solicitudes y volver a continuar.";
  } else {
    let description = task.description ?? "";
    if (!description.includes("DOSSIER INICIAL GENERADO POR IA") && automation.convocatoriaId) {
      const draft = await generarBorrador(api.workspaceId, task.clientId ?? AGENCY_ID, automation.convocatoriaId);
      description = `${description}\n\n---\n\nDOSSIER INICIAL GENERADO POR IA\n\n${draft}`;
      workDone = "Elegibilidad y documentación básica verificadas; dossier técnico generado por IA.";
    } else workDone = "Elegibilidad, documentación básica y dossier comprobados.";
    stage = "SIGNATURE";
    blockers = "Pendiente únicamente de revisión final, acceso a la sede y firma/autorización cuando el organismo la solicite.";
    nextStep = "Revisar el dossier, completar los campos específicos de la sede y solicitar la firma final.";
    await prisma.task.update({ where: { id: task.id }, data: { description } });
  }
  const workflow = { ...current, stage, nextStep, blockers, lastAutomaticRunAt: new Date().toISOString(), lastAutomaticResult: workDone, updatedBy: api.userId };
  const taskStatus = stage === "DOCUMENTS" ? "DOCUMENTACION" : stage === "SIGNATURE" ? "FIRMA" : "PREPARACION";
  await prisma.task.update({ where: { id: task.id }, data: { status: taskStatus, aiState: { ...state, subvencionAutomation: { ...automation, workflow } } } });
  return NextResponse.json({ ok: true, workflow, workDone, missingProfile, missingFiles });
});
