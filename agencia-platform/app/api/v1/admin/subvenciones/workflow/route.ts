import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { isStorageEnabled, signedDownloadUrl } from "@/lib/storage/r2";

export const dynamic = "force-dynamic";

const stages = ["DETECTED", "ELIGIBILITY", "DOCUMENTS", "DRAFT", "SIGNATURE", "SUBMISSION", "SUBMITTED", "FOLLOWUP"] as const;
const updateSchema = z.object({
  taskId: z.string().min(1),
  stage: z.enum(stages),
  nextStep: z.string().max(1500),
  requiredDocuments: z.array(z.string().min(1).max(300)).max(40),
  blockers: z.string().max(1500)
});

async function requireAdmin(workspaceId: string, userId?: string) {
  if (!userId) throw new ApiError(401, "unauthorized", "Autenticación requerida");
  const membership = await prisma.membership.findFirst({ where: { workspaceId, userId }, select: { role: true } });
  if (membership?.role !== "ADMIN") throw new ApiError(403, "forbidden", "Acceso restringido a administradores");
}

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  await requireAdmin(api.workspaceId, api.userId);
  const taskId = new URL(req.url).searchParams.get("taskId")?.trim();
  if (!taskId) throw new ApiError(400, "validation_error", "Falta taskId");
  const task = await prisma.task.findFirst({ where: { id: taskId, workspaceId: api.workspaceId, deletedAt: null }, select: { id: true, status: true, description: true, aiState: true } });
  if (!task) throw new ApiError(404, "not_found", "Expediente no encontrado");
  const automation: any = (task.aiState as any)?.subvencionAutomation ?? {};
  const workflow = automation.workflow ?? {};
  const [files, vaultFiles] = await Promise.all([
    prisma.file.findMany({ where: { workspaceId: api.workspaceId, targetType: "SUBVENCION_APPLICATION", targetId: task.id }, orderBy: { createdAt: "desc" } }),
    prisma.file.findMany({ where: { workspaceId: api.workspaceId, targetType: "SUBVENCION_VAULT" }, orderBy: { createdAt: "desc" } })
  ]);
  const presentFile = async (file: (typeof files)[number]) => ({
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    category: file.targetId,
    createdAt: file.createdAt,
    url: isStorageEnabled() ? await signedDownloadUrl(file.s3Key) : null
  });
  return NextResponse.json({
    workflow: {
      stage: workflow.stage ?? (automation.status === "DOSSIER_READY" ? "DOCUMENTS" : "ELIGIBILITY"),
      nextStep: workflow.nextStep ?? automation.nextAction ?? "Validar los requisitos y recopilar la documentación pendiente.",
      requiredDocuments: Array.isArray(workflow.requiredDocuments) ? workflow.requiredDocuments : [],
      blockers: workflow.blockers ?? ""
    },
    files: await Promise.all(files.map(presentFile)),
    vaultFiles: await Promise.all(vaultFiles.map(presentFile)),
    generatedText: task.description ?? "",
    reviewChecklist: [
      { label: "Acreditación documental de experiencia comparable", ready: files.length > 0, detail: files.length ? `${files.length} documento(s) específico(s) adjunto(s)` : "Faltan contratos, certificados de buena ejecución, facturas o referencias verificables" },
      { label: "Memoria técnica y matriz de cumplimiento", ready: (task.description ?? "").includes("DOSSIER ESPECIFICO DE LICITACION V2"), detail: "Debe revisarse contra los pliegos antes de firmar" },
      { label: "Oferta económica desglosada", ready: (task.description ?? "").includes("DOSSIER ESPECIFICO DE LICITACION V2"), detail: "Los importes marcados [A COMPLETAR] requieren aprobación" }
    ]
  });
});

export const PATCH = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  await requireAdmin(api.workspaceId, api.userId);
  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const task = await prisma.task.findFirst({ where: { id: parsed.data.taskId, workspaceId: api.workspaceId, deletedAt: null }, select: { aiState: true } });
  if (!task) throw new ApiError(404, "not_found", "Expediente no encontrado");
  const state: any = task.aiState ?? {};
  const automation = state.subvencionAutomation ?? {};
  const workflow = { stage: parsed.data.stage, nextStep: parsed.data.nextStep.trim(), requiredDocuments: parsed.data.requiredDocuments.map((x) => x.trim()).filter(Boolean), blockers: parsed.data.blockers.trim(), updatedAt: new Date().toISOString(), updatedBy: api.userId };
  const taskStatus: Record<(typeof stages)[number], string> = {
    DETECTED: "PREPARACION", ELIGIBILITY: "PREPARACION", DOCUMENTS: "DOCUMENTACION", DRAFT: "PREPARACION",
    SIGNATURE: "FIRMA", SUBMISSION: "PREPARACION", SUBMITTED: "PRESENTADA", FOLLOWUP: "PRESENTADA"
  };
  await prisma.task.update({ where: { id: parsed.data.taskId }, data: { status: taskStatus[parsed.data.stage], aiState: { ...state, subvencionAutomation: { ...automation, workflow } } } });
  return NextResponse.json({ ok: true, workflow });
});
