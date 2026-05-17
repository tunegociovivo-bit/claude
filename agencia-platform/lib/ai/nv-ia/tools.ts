/**
 * Tools del agente NV IA — Fase 1.
 *
 * Filosofía de Fase 1: read-mostly. Solo 2 write tools (add_comment,
 * update_task_status) y un finalizer (mark_complete) — todas reversibles
 * y trazadas en el log del AiAgentRun. Nada de enviar emails, mover
 * dinero, ni tocar APIs externas todavía.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db/prisma";
import type { AiAgentConfig } from "./types";

export type ToolContext = {
  workspaceId: string;
  taskId: string;
  config: AiAgentConfig;
};

export type ToolExecutor = (input: any, ctx: ToolContext) => Promise<unknown>;

/**
 * Definiciones (schemas) que mandamos a Claude para que sepa qué tools
 * tiene. Cada tool tiene un executor correspondiente abajo.
 */
export const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: "get_task_context",
    description:
      "Obtiene la tarea asignada incluyendo título, descripción, proyecto, cliente, estado, fecha límite y todos los comentarios previos en orden cronológico. Llámalo SIEMPRE como primer paso para entender qué hay que hacer. No requiere argumentos: la tarea ya está en contexto.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "search_tasks",
    description:
      "Busca tareas relacionadas en el workspace por texto libre (busca en título y descripción). Útil para encontrar contexto histórico: '¿esta solicitud es parecida a otras que ya hemos hecho?'. Devuelve hasta 10 coincidencias con id, título, proyecto y estado.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Texto a buscar en títulos y descripciones."
        },
        limit: {
          type: "number",
          description: "Máximo de resultados (default 10, máximo 25).",
          default: 10
        }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    name: "add_comment",
    description:
      "Añade un comentario público a la tarea, firmado como 'NV IA'. Úsalo para: hacer preguntas al equipo si te falta información, dar updates de progreso, o documentar decisiones. NO uses esto para el resumen final — para eso usa mark_complete. Visible para todos los miembros con acceso a la tarea.",
    input_schema: {
      type: "object",
      properties: {
        body: {
          type: "string",
          description: "Texto del comentario. Markdown simple permitido (saltos de línea, listas con guiones). Sé conciso y profesional."
        }
      },
      required: ["body"],
      additionalProperties: false
    }
  },
  {
    name: "update_task_status",
    description:
      "Cambia el estado/columna de la tarea (TODO, IN_PROGRESS, BLOCKED, REVIEW, DONE, etc.). Úsalo para reflejar progreso. Para marcar 'hecho con éxito y entregable listo', usa mark_complete en su lugar — ese también notifica al solicitante.",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description: "Nuevo estado. Estados habituales: TODO, IN_PROGRESS, BLOCKED, REVIEW, DONE."
        }
      },
      required: ["status"],
      additionalProperties: false
    }
  },
  {
    name: "mark_complete",
    description:
      "Marca la tarea como COMPLETADA, añade un comentario final con el resumen de lo que has hecho, y notifica al solicitante. Es la ÚNICA forma correcta de terminar el run con éxito. El resumen debe ser claro y conciso: qué se ha hecho, qué entregables hay (si aplica), y cualquier dato relevante. Después de llamar a esta tool, NO sigas trabajando — el run termina.",
    input_schema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Resumen final para el solicitante. Markdown simple. 2-6 frases ideal."
        }
      },
      required: ["summary"],
      additionalProperties: false
    }
  }
];

/**
 * Ejecutores. Cada uno recibe input ya parseado (la API garantiza el
 * shape contra input_schema, pero validamos defensivamente).
 *
 * IMPORTANTE: ningún executor accede a recursos fuera del workspace
 * del run. Todos filtran por ctx.workspaceId.
 */
export const TOOL_EXECUTORS: Record<string, ToolExecutor> = {
  async get_task_context(_input, ctx) {
    const task = await prisma.task.findFirst({
      where: { id: ctx.taskId, workspaceId: ctx.workspaceId },
      include: {
        project: { select: { id: true, name: true, kanbanColumns: true } },
        client: { select: { id: true, name: true, industry: true } },
        assignees: { select: { user: { select: { id: true, name: true, email: true } } } }
      }
    });
    if (!task) return { error: "Task no encontrada" };
    const comments = await prisma.comment.findMany({
      where: { workspaceId: ctx.workspaceId, targetType: "TASK", targetId: ctx.taskId },
      orderBy: { createdAt: "asc" },
      include: { author: { select: { name: true, email: true } } },
      take: 50
    });
    return {
      task: {
        id: task.id,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        dueDate: task.dueDate,
        completedAt: task.completedAt,
        project: task.project,
        client: task.client,
        assignees: task.assignees.map((a: any) => a.user)
      },
      comments: comments.map((c) => ({
        id: c.id,
        author: c.author?.name ?? c.author?.email ?? "?",
        createdAt: c.createdAt,
        body: c.body
      }))
    };
  },

  async search_tasks(input, ctx) {
    const q = String(input?.query ?? "").trim();
    if (!q) return { error: "query vacío" };
    const limit = Math.min(Math.max(Number(input?.limit) || 10, 1), 25);
    const items = await prisma.task.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } }
        ]
      },
      take: limit,
      orderBy: { updatedAt: "desc" },
      include: { project: { select: { name: true } } }
    });
    return {
      count: items.length,
      results: items.map((t) => ({
        id: t.id,
        title: t.title,
        project: t.project?.name,
        status: t.status,
        priority: t.priority,
        updatedAt: t.updatedAt
      }))
    };
  },

  async add_comment(input, ctx) {
    const body = String(input?.body ?? "").trim();
    if (!body) return { error: "body vacío" };
    if (body.length > 8000) return { error: "body demasiado largo (>8000 chars)" };
    const c = await prisma.comment.create({
      data: {
        workspaceId: ctx.workspaceId,
        authorId: ctx.config.userId,
        targetType: "TASK",
        targetId: ctx.taskId,
        body,
        // TipTap doc minimal — un único párrafo. Si en Fase 2 queremos
        // permitir markdown completo, parsearemos a TipTap aquí.
        bodyJson: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: body }] }]
        }
      }
    });
    return { ok: true, commentId: c.id };
  },

  async update_task_status(input, ctx) {
    const status = String(input?.status ?? "").trim();
    if (!status) return { error: "status vacío" };
    const updated = await prisma.task.update({
      where: { id: ctx.taskId },
      data: {
        status,
        ...(status === "DONE" ? { completedAt: new Date() } : {})
      },
      select: { id: true, status: true, completedAt: true }
    });
    return { ok: true, task: updated };
  },

  async mark_complete(input, ctx) {
    const summary = String(input?.summary ?? "").trim();
    if (!summary) return { error: "summary vacío" };
    if (summary.length > 8000) return { error: "summary demasiado largo" };
    // 1. Comentario final firmado como NV IA
    const comment = await prisma.comment.create({
      data: {
        workspaceId: ctx.workspaceId,
        authorId: ctx.config.userId,
        targetType: "TASK",
        targetId: ctx.taskId,
        body: `✅ ${summary}`,
        bodyJson: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: `✅ ${summary}` }] }]
        }
      }
    });
    // 2. Status → DONE
    await prisma.task.update({
      where: { id: ctx.taskId },
      data: { status: "DONE", completedAt: new Date() }
    });
    return { ok: true, commentId: comment.id, completed: true };
  }
};
