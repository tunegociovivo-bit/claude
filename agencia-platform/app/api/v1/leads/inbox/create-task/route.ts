/**
 * Crear una TAREA a partir de una conversación de WhatsApp del generador de leads.
 *
 * GET  ?phone=&leadId=  → datos para el modal: título sugerido por IA (a partir
 *                         de la conversación), proyecto y columna por defecto
 *                         (NEGOCIO VIVO GENERAL · REUNIONES Y LLAMADAS) y la
 *                         lista de proyectos con sus columnas para poder cambiar.
 * POST { phone, leadId?, projectId?, status?, title? } → crea la tarea. Se marca
 *       con customData.source="leads" (borde/chip verde en el kanban) y guarda
 *       el enlace de vuelta a la conversación.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { complete } from "@/lib/ai/anthropic";
import { readKanbanColumns, DEFAULT_COLUMNS } from "@/lib/kanban";

const DEFAULT_PROJECT_HINT = "NEGOCIO VIVO GENERAL";
const DEFAULT_COLUMN_HINT = "REUNIONES"; // "REUNIONES Y LLAMADAS"

type Col = { id: string; label: string };

/** Columnas de un proyecto: las suyas propias si las tiene, si no las del workspace. */
function projectColumns(project: { kanbanColumns?: any } | null, wsSettings: any): Col[] {
  const pc = project?.kanbanColumns;
  if (Array.isArray(pc) && pc.length) {
    return pc.map((c: any) => ({ id: String(c.id), label: String(c.label ?? c.id) }));
  }
  return readKanbanColumns(wsSettings).map((c) => ({ id: c.id, label: c.label }));
}

/** Columna por defecto: "REUNIONES Y LLAMADAS" si existe, si no la primera. */
function pickDefaultColumn(cols: Col[]): string {
  const m = cols.find((c) => c.label.toUpperCase().includes(DEFAULT_COLUMN_HINT));
  return (m ?? cols[0])?.id ?? "TODO";
}

async function resolveLeadName(workspaceId: string, phone: string, leadId?: string | null): Promise<string | null> {
  if (leadId) {
    const l = await prisma.lead.findFirst({ where: { id: leadId, workspaceId }, select: { name: true } });
    if (l?.name) return l.name;
  }
  const meta = await prisma.leadConversationMeta
    .findUnique({ where: { workspaceId_phone: { workspaceId, phone } }, select: { displayName: true } })
    .catch(() => null);
  return meta?.displayName ?? null;
}

/** Título de tarea generado por IA a partir de la conversación + teléfono. */
async function suggestTitle(workspaceId: string, phone: string, leadName: string | null): Promise<string> {
  const msgs = await prisma.leadInboxMessage.findMany({
    where: { workspaceId, phoneNormalized: phone },
    orderBy: { receivedAt: "asc" },
    take: 40,
    select: { direction: true, body: true }
  });
  const convo = msgs
    .map((m) => `${m.direction === "out" ? "Nosotros" : "Lead"}: ${m.body}`)
    .join("\n")
    .slice(0, 4000);

  let base = leadName ? `Seguimiento ${leadName}` : "Seguimiento lead WhatsApp";
  if (convo.trim()) {
    try {
      const out = await complete({
        workspaceId,
        system:
          "Eres un asistente que crea TÍTULOS de tarea muy cortos (máx 8 palabras) para un CRM de una agencia de marketing local. Devuelves SOLO el título, sin comillas ni punto final, en español. Resume la intención del lead o el próximo paso, p.ej. 'Llamar: interesado en web de fontanería' o 'Enviar propuesta posicionamiento Google'.",
        user: `Conversación de WhatsApp con un lead:\n---\n${convo}\n---\nDevuelve solo el título de la tarea.`,
        maxTokens: 40,
        feature: "leads-task-title"
      });
      const clean = out.replace(/^["'\s]+/, "").replace(/["'\s.]+$/, "").split("\n")[0].trim();
      if (clean) base = clean;
    } catch {
      /* usamos el título base */
    }
  }
  return `📞 ${base} · ${phone}`;
}

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const u = new URL(req.url);
  const phone = (u.searchParams.get("phone") ?? "").trim();
  if (!phone) throw new ApiError(400, "validation_error", "Falta 'phone'");
  const leadId = u.searchParams.get("leadId") || null;

  const [ws, projects] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: api.workspaceId }, select: { settings: true } }),
    prisma.project.findMany({
      where: { workspaceId: api.workspaceId, archived: false, deletedAt: null },
      select: { id: true, name: true, kanbanColumns: true },
      orderBy: { name: "asc" }
    })
  ]);

  const projOut = projects.map((p) => ({ id: p.id, name: p.name, columns: projectColumns(p, ws?.settings) }));
  const def = projects.find((p) => p.name.toUpperCase().includes(DEFAULT_PROJECT_HINT)) ?? projects[0] ?? null;
  const defCols = def ? projectColumns(def, ws?.settings) : DEFAULT_COLUMNS.map((c) => ({ id: c.id, label: c.label }));

  const leadName = await resolveLeadName(api.workspaceId, phone, leadId);
  const suggestedTitle = await suggestTitle(api.workspaceId, phone, leadName);

  return NextResponse.json({
    suggestedTitle,
    leadName,
    defaultProjectId: def?.id ?? null,
    defaultStatus: pickDefaultColumn(defCols),
    projects: projOut
  });
});

const postSchema = z.object({
  phone: z.string().min(1),
  leadId: z.string().optional(),
  projectId: z.string().optional(),
  status: z.string().optional(),
  title: z.string().max(300).optional()
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const { phone } = parsed.data;
  const leadId = parsed.data.leadId || null;

  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId }, select: { settings: true } });

  // Proyecto destino: el pedido, o NEGOCIO VIVO GENERAL, o el primero.
  let project = parsed.data.projectId
    ? await prisma.project.findFirst({
        where: { id: parsed.data.projectId, workspaceId: api.workspaceId, deletedAt: null },
        select: { id: true, kanbanColumns: true }
      })
    : null;
  if (!project) {
    const all = await prisma.project.findMany({
      where: { workspaceId: api.workspaceId, archived: false, deletedAt: null },
      select: { id: true, name: true, kanbanColumns: true },
      orderBy: { name: "asc" }
    });
    project = all.find((p) => p.name.toUpperCase().includes(DEFAULT_PROJECT_HINT)) ?? all[0] ?? null;
  }
  if (!project) throw new ApiError(400, "no_project", "No hay ningún proyecto donde crear la tarea.");

  const cols = projectColumns(project as any, ws?.settings);
  const status =
    parsed.data.status && cols.some((c) => c.id === parsed.data.status)
      ? parsed.data.status
      : pickDefaultColumn(cols);

  const leadName = await resolveLeadName(api.workspaceId, phone, leadId);
  const title = parsed.data.title?.trim() || (await suggestTitle(api.workspaceId, phone, leadName));

  const leadInboxUrl = `/admin/leads?tab=inbox&phone=${encodeURIComponent(phone)}`;

  const task = await prisma.task.create({
    data: {
      workspaceId: api.workspaceId,
      projectId: project.id,
      title,
      status,
      priority: "HIGH",
      customData: {
        source: "leads",
        leadPhone: phone,
        leadName: leadName ?? null,
        leadInboxUrl
      } as any
    },
    select: { id: true, title: true, projectId: true, status: true }
  });

  return NextResponse.json({ ok: true, task, taskUrl: `/tareas?task=${task.id}` });
});
