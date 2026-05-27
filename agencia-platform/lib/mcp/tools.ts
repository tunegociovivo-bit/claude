import { prisma } from "@/lib/db/prisma";
import type { ApiContext } from "@/lib/api/auth";

export type McpTool = {
  name: string;
  description: string;
  inputSchema: any;
  handler: (args: any, ctx: ApiContext) => Promise<any>;
};

export const mcpTools: McpTool[] = [
  {
    name: "list_clients",
    description: "Lista los clientes del workspace, opcionalmente filtrados por estado.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["ACTIVE", "PAUSED", "PROSPECT", "CHURNED"] },
        limit: { type: "integer", default: 50 }
      }
    },
    handler: async (args, ctx) => {
      return prisma.client.findMany({
        where: { workspaceId: ctx.workspaceId, deletedAt: null, status: args?.status },
        take: args?.limit ?? 50
      });
    }
  },
  {
    name: "create_client",
    description: "Crea un cliente nuevo.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        industry: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        notes: { type: "string" }
      }
    },
    handler: async (args, ctx) => {
      return prisma.client.create({ data: { ...args, workspaceId: ctx.workspaceId } });
    }
  },
  {
    name: "list_projects",
    description: "Lista los proyectos del workspace, opcionalmente filtrados por cliente.",
    inputSchema: {
      type: "object",
      properties: { clientId: { type: "string" } }
    },
    handler: async (args, ctx) => {
      return prisma.project.findMany({
        where: { workspaceId: ctx.workspaceId, archived: false, deletedAt: null, clientId: args?.clientId } as any
      });
    }
  },
  {
    name: "list_tasks",
    description: "Lista tareas (filtros: projectId, status).",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        status: { type: "string", enum: ["TODO", "IN_PROGRESS", "REVIEW", "DONE", "CANCELLED"] }
      }
    },
    handler: async (args, ctx) => {
      return prisma.task.findMany({
        where: {
          workspaceId: ctx.workspaceId,
          projectId: args?.projectId,
          status: args?.status
        },
        include: { project: true, client: true }
      });
    }
  },
  {
    name: "create_task",
    description: "Crea una tarea nueva en un proyecto.",
    inputSchema: {
      type: "object",
      required: ["projectId", "title"],
      properties: {
        projectId: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"] },
        dueDate: { type: "string", description: "ISO 8601" }
      }
    },
    handler: async (args, ctx) => {
      return prisma.task.create({
        data: {
          ...args,
          dueDate: args.dueDate ? new Date(args.dueDate) : null,
          workspaceId: ctx.workspaceId
        }
      });
    }
  },
  {
    name: "update_task_status",
    description: "Cambia el estado de una tarea.",
    inputSchema: {
      type: "object",
      required: ["taskId", "status"],
      properties: {
        taskId: { type: "string" },
        status: { type: "string", enum: ["TODO", "IN_PROGRESS", "REVIEW", "DONE", "CANCELLED"] }
      }
    },
    handler: async (args, ctx) => {
      return prisma.task.update({
        where: { id: args.taskId },
        data: {
          status: args.status,
          completedAt: args.status === "DONE" ? new Date() : null
        }
      });
    }
  },
  {
    name: "search_documents",
    description: "Busca documentos por título (ILIKE).",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: { query: { type: "string" }, limit: { type: "integer", default: 10 } }
    },
    handler: async (args, ctx) => {
      return prisma.document.findMany({
        where: {
          workspaceId: ctx.workspaceId,
          archived: false,
          title: { contains: args.query, mode: "insensitive" }
        },
        take: args.limit ?? 10
      });
    }
  },
  {
    name: "list_databases",
    description: "Lista las bases de datos tipo Notion del workspace.",
    inputSchema: { type: "object", properties: {} },
    handler: async (_args, ctx) => {
      return prisma.database.findMany({
        where: { workspaceId: ctx.workspaceId },
        include: { _count: { select: { records: true, properties: true } } }
      });
    }
  },
  {
    name: "list_database_records",
    description: "Lista los registros de una base de datos (con sus valores).",
    inputSchema: {
      type: "object",
      required: ["databaseId"],
      properties: { databaseId: { type: "string" } }
    },
    handler: async (args, ctx) => {
      const db = await prisma.database.findFirst({
        where: { id: args.databaseId, workspaceId: ctx.workspaceId }
      });
      if (!db) throw new Error("Database no encontrada");
      const recs = await prisma.databaseRecord.findMany({
        where: { databaseId: args.databaseId },
        include: { values: true }
      });
      return recs.map((r) => ({
        id: r.id,
        title: r.title,
        values: Object.fromEntries(r.values.map((v) => [v.propertyId, v.value]))
      }));
    }
  },
  {
    name: "create_database_record",
    description: "Crea un nuevo registro en una base de datos.",
    inputSchema: {
      type: "object",
      required: ["databaseId", "title"],
      properties: {
        databaseId: { type: "string" },
        title: { type: "string" },
        values: { type: "object", description: "{ propertyId: value }" }
      }
    },
    handler: async (args, ctx) => {
      const db = await prisma.database.findFirst({
        where: { id: args.databaseId, workspaceId: ctx.workspaceId }
      });
      if (!db) throw new Error("Database no encontrada");
      const rec = await prisma.databaseRecord.create({
        data: { databaseId: args.databaseId, title: args.title }
      });
      if (args.values) {
        for (const [propertyId, value] of Object.entries(args.values as any)) {
          await prisma.databaseValue.create({
            data: { recordId: rec.id, propertyId, value: value as any }
          });
        }
      }
      return rec;
    }
  },
  {
    name: "list_events",
    description: "Lista eventos del calendario en un rango de fechas.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "ISO 8601" },
        to: { type: "string", description: "ISO 8601" }
      }
    },
    handler: async (args, ctx) => {
      const where: any = { workspaceId: ctx.workspaceId };
      if (args?.from || args?.to) {
        where.startAt = {};
        if (args?.from) where.startAt.gte = new Date(args.from);
        if (args?.to) where.startAt.lte = new Date(args.to);
      }
      return prisma.calendarEvent.findMany({ where, orderBy: { startAt: "asc" } });
    }
  }
];
