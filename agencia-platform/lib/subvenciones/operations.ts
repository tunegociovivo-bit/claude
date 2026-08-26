import { prisma } from "@/lib/db/prisma";
import { generarBorrador } from "./borrador";
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
  const marker = `[subvencion:${input.convocatoriaId}]`;
  let project = await prisma.project.findFirst({ where: { workspaceId: input.workspaceId, deletedAt: null, description: { contains: marker } } });
  if (!project) project = await prisma.project.create({
    data: {
      workspaceId: input.workspaceId,
      clientId: input.clientId === AGENCY_ID ? null : input.clientId,
      name: `Solicitud · ${convocatoria.titulo}`.slice(0, 180),
      description: `${marker}\nExpediente autónomo generado por el Cazador de Subvenciones.`,
      emoji: "📑", color: "bg-indigo-500",
      kanbanColumns: [
        { id: "PREPARACION", label: "Preparación IA", color: "bg-blue-500", order: 0 },
        { id: "DOCUMENTACION", label: "Documentación", color: "bg-amber-500", order: 1 },
        { id: "FIRMA", label: "Firma / autorización", color: "bg-violet-500", order: 2 },
        { id: "PRESENTADA", label: "Presentada", color: "bg-emerald-500", order: 3 },
        { id: "RESUELTA", label: "Resuelta", color: "bg-slate-500", order: 4, isDone: true }
      ]
    }
  });
  const taskTitle = `Subvención · ${convocatoria.titulo}`.slice(0, 240);
  const existing = await prisma.task.findFirst({
    where: { workspaceId: input.workspaceId, title: taskTitle, deletedAt: null },
    select: { id: true, projectId: true, description: true, aiState: true }
  });
  const dueDate = convocatoria.fechaFin ?? null;
  const description = [
    `Oportunidad detectada por el Cazador de Subvenciones.`,
    `Organismo: ${convocatoria.organo ?? "—"}`,
    `Beneficiarios: ${convocatoria.beneficiarios ?? "Por revisar"}`,
    `Finalidad: ${convocatoria.finalidad ?? "Por revisar"}`,
    convocatoria.urlBases ? `Bases: ${convocatoria.urlBases}` : "",
    "Checklist: validar elegibilidad · confirmar CNAE y ubicación · reunir documentación · preparar memoria y presupuesto · presentar · registrar justificante."
  ].filter(Boolean).join("\n\n");
  const task = existing ?? await prisma.task.create({
    data: {
      workspaceId: input.workspaceId,
      projectId: project.id,
      clientId: input.clientId === AGENCY_ID ? null : input.clientId,
      title: taskTitle,
      description,
      status: "PREPARACION",
      priority: dueDate && dueDate.getTime() - Date.now() <= 10 * 86_400_000 ? "HIGH" : "MEDIUM",
      dueDate,
      flashTasks: [
        { id: "eligibility", text: "Validar elegibilidad", done: false },
        { id: "documents", text: "Reunir documentación", done: false },
        { id: "draft", text: "Preparar memoria y presupuesto", done: false },
        { id: "submit", text: "Presentar solicitud", done: false }
      ],
      aiState: { subvencionAutomation: { convocatoriaId: input.convocatoriaId, status: "PREPARING", autonomous: true, nextAction: "VERIFY_ELIGIBILITY", requiresHuman: [] } }
    },
    select: { id: true, projectId: true, description: true, aiState: true }
  });
  if (task.projectId !== project.id) {
    await prisma.taskProject.upsert({ where: { taskId_projectId: { taskId: task.id, projectId: task.projectId } }, create: { taskId: task.id, projectId: task.projectId }, update: {} });
    await prisma.task.update({ where: { id: task.id }, data: { projectId: project.id, status: "PREPARACION" } });
  }

  const phases = [
    ["Validar elegibilidad y requisitos", "PREPARACION"],
    ["Recopilar documentación administrativa", "DOCUMENTACION"],
    ["Preparar memoria técnica y presupuesto", "PREPARACION"],
    ["Completar formularios de la sede electrónica", "PREPARACION"],
    ["Solicitar únicamente firma o documentación imprescindible", "FIRMA"],
    ["Presentar y guardar justificante de registro", "PRESENTADA"],
    ["Controlar subsanaciones y resolución", "PRESENTADA"]
  ] as const;
  for (const [title, phase] of phases) {
    const found = await prisma.task.findFirst({ where: { workspaceId: input.workspaceId, parentId: task.id, title, deletedAt: null }, select: { id: true } });
    if (!found) await prisma.task.create({ data: { workspaceId: input.workspaceId, projectId: project.id, clientId: input.clientId === AGENCY_ID ? null : input.clientId, parentId: task.id, title, status: phase, priority: "MEDIUM", dueDate } });
  }

  const state: any = task.aiState ?? {};
  if (!state?.subvencionAutomation?.draftGeneratedAt) {
    try {
      const draft = await generarBorrador(input.workspaceId, input.clientId, input.convocatoriaId);
      const nextState = { ...state, subvencionAutomation: { ...(state.subvencionAutomation ?? {}), convocatoriaId: input.convocatoriaId, status: "DOSSIER_READY", autonomous: true, nextAction: "COLLECT_DOCUMENTS", requiresHuman: [], draftGeneratedAt: new Date().toISOString() } };
      await prisma.task.update({ where: { id: task.id }, data: { description: `${description}\n\n---\n\nDOSSIER INICIAL GENERADO POR IA\n\n${draft}`, aiState: nextState } });
    } catch (error) {
      await prisma.task.update({ where: { id: task.id }, data: { aiState: { ...state, subvencionAutomation: { ...(state.subvencionAutomation ?? {}), status: "PREPARING", autonomous: true, nextAction: "GENERATE_DOSSIER", lastError: error instanceof Error ? error.message.slice(0, 300) : "No se pudo generar el dossier" } } } }).catch(() => {});
    }
  }
  await prisma.subvencionEstado.upsert({
    where: { workspaceId_clientId_convocatoriaId: { workspaceId: input.workspaceId, clientId: input.clientId, convocatoriaId: input.convocatoriaId } },
    create: { workspaceId: input.workspaceId, clientId: input.clientId, convocatoriaId: input.convocatoriaId, estado: "en_proceso" },
    update: { estado: "en_proceso" }
  });
  return { id: task.id, projectId: project.id, existing: Boolean(existing) };
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
