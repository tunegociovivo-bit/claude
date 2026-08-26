import { prisma } from "@/lib/db/prisma";
const AGENCY_ID = "__agency__";

export type SubvencionHealth = {
  lastRunAt?: string;
  lastIngestAt?: string;
  lastMatchAt?: string;
  lastNotificationAt?: string;
  lastError?: string | null;
  ingested?: number;
  matches?: number;
  notifications?: number;
  trigger?: "cron" | "manual";
};

export async function updateSubvencionHealth(
  workspaceId: string,
  patch: Partial<SubvencionHealth>
): Promise<void> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
  if (!ws) return;
  const settings: any = ws.settings ?? {};
  const current = settings.subvenciones ?? {};
  settings.subvenciones = {
    ...current,
    health: { ...(current.health ?? {}), ...patch }
  };
  await prisma.workspace.update({ where: { id: workspaceId }, data: { settings } });
}

export async function saveSubvencionFeedback(input: {
  workspaceId: string;
  clientId: string;
  convocatoriaId: string;
  verdict: "interesa" | "no_encaja";
  reason?: string;
}): Promise<void> {
  const ws = await prisma.workspace.findUnique({ where: { id: input.workspaceId }, select: { settings: true } });
  if (!ws) return;
  const settings: any = ws.settings ?? {};
  const sv = settings.subvenciones ?? {};
  const feedback = Array.isArray(sv.feedback) ? sv.feedback : [];
  const key = `${input.clientId}:${input.convocatoriaId}`;
  const next = [
    { key, clientId: input.clientId, convocatoriaId: input.convocatoriaId, verdict: input.verdict, reason: input.reason?.trim().slice(0, 300) || "", at: new Date().toISOString() },
    ...feedback.filter((x: any) => x?.key !== key)
  ].slice(0, 1000);
  settings.subvenciones = { ...sv, feedback: next };
  await prisma.workspace.update({ where: { id: input.workspaceId }, data: { settings } });
}

export async function createSubvencionTask(input: {
  workspaceId: string;
  clientId: string;
  convocatoriaId: string;
  createdById?: string | null;
}): Promise<{ id: string; projectId: string; existing: boolean }> {
  const convocatoria = await prisma.subvencionConvocatoria.findUnique({ where: { id: input.convocatoriaId } });
  if (!convocatoria) throw new Error("Convocatoria no encontrada");
  const project = await prisma.project.findFirst({
    where: { workspaceId: input.workspaceId, deletedAt: null, archived: false, name: { contains: "Subvenciones", mode: "insensitive" } },
    orderBy: { createdAt: "asc" }
  });
  if (!project) throw new Error("Crea primero un proyecto cuyo nombre contenga “Subvenciones”");
  const taskTitle = `Subvención · ${convocatoria.titulo}`.slice(0, 240);
  const existing = await prisma.task.findFirst({
    where: { workspaceId: input.workspaceId, projectId: project.id, title: taskTitle, deletedAt: null },
    select: { id: true, projectId: true }
  });
  if (existing) return { ...existing, existing: true };
  const cols = Array.isArray(project.kanbanColumns) ? project.kanbanColumns as any[] : [];
  const status = String(cols.find((c) => !c?.isDone)?.id ?? "TODO");
  const dueDate = convocatoria.fechaFin ?? null;
  const description = [
    `Oportunidad detectada por el Cazador de Subvenciones.`,
    `Organismo: ${convocatoria.organo ?? "—"}`,
    `Beneficiarios: ${convocatoria.beneficiarios ?? "Por revisar"}`,
    `Finalidad: ${convocatoria.finalidad ?? "Por revisar"}`,
    convocatoria.urlBases ? `Bases: ${convocatoria.urlBases}` : "",
    "Checklist: validar elegibilidad · confirmar CNAE y ubicación · reunir documentación · preparar memoria y presupuesto · presentar · registrar justificante."
  ].filter(Boolean).join("\n\n");
  const task = await prisma.task.create({
    data: {
      workspaceId: input.workspaceId,
      projectId: project.id,
      clientId: input.clientId === AGENCY_ID ? null : input.clientId,
      title: taskTitle,
      description,
      status,
      priority: dueDate && dueDate.getTime() - Date.now() <= 10 * 86_400_000 ? "HIGH" : "MEDIUM",
      dueDate,
      flashTasks: [
        { id: "eligibility", text: "Validar elegibilidad", done: false },
        { id: "documents", text: "Reunir documentación", done: false },
        { id: "draft", text: "Preparar memoria y presupuesto", done: false },
        { id: "submit", text: "Presentar solicitud", done: false }
      ]
    }
  });
  await prisma.subvencionEstado.upsert({
    where: { workspaceId_clientId_convocatoriaId: { workspaceId: input.workspaceId, clientId: input.clientId, convocatoriaId: input.convocatoriaId } },
    create: { workspaceId: input.workspaceId, clientId: input.clientId, convocatoriaId: input.convocatoriaId, estado: "en_proceso" },
    update: { estado: "en_proceso" }
  });
  return { id: task.id, projectId: project.id, existing: false };
}

export function isLowValueBusinessOpportunity(c: {
  titulo: string;
  beneficiarios?: string | null;
  finalidad?: string | null;
}): boolean {
  const text = `${c.titulo} ${c.beneficiarios ?? ""} ${c.finalidad ?? ""}`.toLowerCase();
  const excluded = [
    /subvenci[oó]n nominativa/,
    /entidades? locales?/,
    /administraciones? p[uú]blicas?/,
    /universidades? p[uú]blicas?/,
    /familias con hijos/,
    /olimpiadas? educativas?/,
    /colegio oficial de/,
    /entidades? sin [aá]nimo de lucro/
  ];
  const businessSignal = /pyme|aut[oó]nom|empresa|comercio|emprend|sociedad|profesional/;
  return excluded.some((rx) => rx.test(text)) && !businessSignal.test(text);
}

export function hasDeliveryChannel(webhookUrl?: string | null, whatsappTo?: string | null): boolean {
  return Boolean(webhookUrl?.trim() || whatsappTo?.trim());
}
