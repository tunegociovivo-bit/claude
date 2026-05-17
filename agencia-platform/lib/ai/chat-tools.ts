/**
 * Tools que el asistente AI puede llamar para operar sobre el workspace.
 * Reutilizan la lógica de los tools MCP pero con el formato Anthropic SDK.
 */

import { prisma } from "@/lib/db/prisma";

export type ChatTool = {
  name: string;
  description: string;
  input_schema: any;
  run: (args: any, ctx: { workspaceId: string; userId?: string }) => Promise<string>;
};

export const chatTools: ChatTool[] = [
  {
    name: "search_clients",
    description: "Busca clientes del workspace por nombre, industria o estado.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Búsqueda en nombre o industria (opcional)" },
        status: { type: "string", enum: ["ACTIVE", "PAUSED", "PROSPECT", "CHURNED"] }
      }
    },
    run: async (args, ctx) => {
      // MRR solo lo ve un admin. Para no-admin lo omitimos del select.
      let isAdmin = false;
      if (ctx.userId) {
        const m = await prisma.membership.findFirst({
          where: { userId: ctx.userId, workspaceId: ctx.workspaceId },
          select: { role: true }
        });
        isAdmin = m?.role === "ADMIN";
      }
      const items = await prisma.client.findMany({
        where: {
          workspaceId: ctx.workspaceId,
          deletedAt: null,
          status: args?.status,
          ...(args?.query
            ? {
                OR: [
                  { name: { contains: args.query, mode: "insensitive" } },
                  { industry: { contains: args.query, mode: "insensitive" } }
                ]
              }
            : {})
        },
        take: 25,
        select: {
          id: true,
          name: true,
          industry: true,
          status: true,
          email: true,
          ...(isAdmin ? { mrr: true } : {})
        }
      });
      return JSON.stringify(items);
    }
  },
  {
    name: "search_tasks",
    description: "Lista tareas filtrando por proyecto, estado, prioridad o cliente.",
    input_schema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        clientId: { type: "string" },
        status: { type: "string", enum: ["TODO", "IN_PROGRESS", "REVIEW", "DONE"] },
        priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"] }
      }
    },
    run: async (args, ctx) => {
      const items = await prisma.task.findMany({
        where: {
          workspaceId: ctx.workspaceId,
          projectId: args?.projectId,
          clientId: args?.clientId,
          status: args?.status,
          priority: args?.priority
        },
        take: 50,
        include: {
          project: { select: { name: true } },
          client: { select: { name: true } }
        },
        orderBy: [{ status: "asc" }, { dueDate: "asc" }]
      });
      return JSON.stringify(
        items.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          dueDate: t.dueDate?.toISOString().slice(0, 10) ?? null,
          project: t.project?.name,
          client: t.client?.name
        }))
      );
    }
  },
  {
    name: "create_task",
    description: "Crea una tarea nueva en un proyecto. Devuelve la tarea creada con su id.",
    input_schema: {
      type: "object",
      required: ["projectId", "title"],
      properties: {
        projectId: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"] },
        dueDate: { type: "string", description: "Fecha ISO 8601 YYYY-MM-DD" }
      }
    },
    run: async (args, ctx) => {
      const proj = await prisma.project.findFirst({
        where: { id: args.projectId, workspaceId: ctx.workspaceId }
      });
      if (!proj) return JSON.stringify({ error: "Proyecto no encontrado" });
      const task = await prisma.task.create({
        data: {
          workspaceId: ctx.workspaceId,
          projectId: args.projectId,
          clientId: proj.clientId,
          title: args.title,
          description: args.description ?? "",
          priority: args.priority ?? "MEDIUM",
          dueDate: args.dueDate ? new Date(args.dueDate) : null
        }
      });
      return JSON.stringify({ id: task.id, title: task.title });
    }
  },
  {
    name: "list_projects",
    description: "Lista los proyectos del workspace, opcionalmente filtrados por cliente.",
    input_schema: {
      type: "object",
      properties: { clientId: { type: "string" } }
    },
    run: async (args, ctx) => {
      const items = await prisma.project.findMany({
        where: {
          workspaceId: ctx.workspaceId,
          archived: false,
          deletedAt: null,
          clientId: args?.clientId
        } as any,
        select: {
          id: true,
          name: true,
          progress: true,
          client: { select: { name: true } }
        }
      });
      return JSON.stringify(items);
    }
  },
  {
    name: "search_documents",
    description: "Busca documentos del workspace por título.",
    input_schema: {
      type: "object",
      required: ["query"],
      properties: { query: { type: "string" } }
    },
    run: async (args, ctx) => {
      const items = await prisma.document.findMany({
        where: {
          workspaceId: ctx.workspaceId,
          archived: false,
          title: { contains: args.query, mode: "insensitive" }
        },
        take: 15,
        select: { id: true, title: true, category: true, updatedAt: true }
      });
      return JSON.stringify(items);
    }
  },
  {
    name: "upcoming_events",
    description: "Devuelve los próximos eventos del calendario.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "integer", description: "Ventana en días desde hoy", default: 14 }
      }
    },
    run: async (args, ctx) => {
      const from = new Date();
      const to = new Date();
      to.setDate(to.getDate() + (args?.days ?? 14));
      const events = await prisma.calendarEvent.findMany({
        where: {
          workspaceId: ctx.workspaceId,
          startAt: { gte: from, lte: to }
        },
        include: { client: { select: { name: true } } },
        orderBy: { startAt: "asc" }
      });
      return JSON.stringify(
        events.map((e) => ({
          id: e.id,
          title: e.title,
          when: e.startAt.toISOString(),
          type: e.type,
          client: e.client?.name
        }))
      );
    }
  }
];

export const toolDefs = chatTools.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.input_schema
}));

export async function runTool(
  name: string,
  input: any,
  ctx: { workspaceId: string; userId?: string }
): Promise<string> {
  const tool = chatTools.find((t) => t.name === name);
  if (!tool) return JSON.stringify({ error: `Tool desconocido: ${name}` });
  try {
    return await tool.run(input ?? {}, ctx);
  } catch (e: any) {
    return JSON.stringify({ error: e?.message ?? "Error ejecutando tool" });
  }
}
