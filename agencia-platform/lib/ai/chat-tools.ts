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
    description:
      "Busca/lista tareas. Para buscar por TEXTO (un nombre, palabra o frase que aparezca en el título o la descripción de la tarea) usa `query` — ej. query:'clínica march' encuentra todas las tareas que mencionen eso, estén o no vinculadas a un cliente. También puedes filtrar por proyecto, estado, prioridad o cliente.\n\nIMPORTANTE: si el usuario pide 'tareas donde se nombre/mencione X', usa SIEMPRE `query:'X'` — NO asumas que X es un cliente. El texto puede estar solo en el título.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Texto a buscar en título Y descripción de las tareas (case-insensitive, acentos incluidos)."
        },
        projectId: { type: "string" },
        clientId: { type: "string" },
        status: { type: "string", enum: ["TODO", "IN_PROGRESS", "REVIEW", "DONE"] },
        priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"] }
      }
    },
    run: async (args, ctx) => {
      const where: any = {
        workspaceId: ctx.workspaceId,
        deletedAt: null
      };
      if (args?.projectId) where.projectId = args.projectId;
      if (args?.clientId) where.clientId = args.clientId;
      if (args?.status) where.status = args.status;
      if (args?.priority) where.priority = args.priority;
      const q = typeof args?.query === "string" ? args.query.trim() : "";
      if (q) {
        where.OR = [
          { title: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } }
        ];
      }
      const items = await prisma.task.findMany({
        where,
        take: 50,
        include: {
          project: { select: { name: true } },
          client: { select: { name: true } }
        },
        orderBy: [{ status: "asc" }, { dueDate: "asc" }]
      });
      return JSON.stringify({
        count: items.length,
        query: q || null,
        tasks: items.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          dueDate: t.dueDate?.toISOString().slice(0, 10) ?? null,
          project: t.project?.name,
          client: t.client?.name
        }))
      });
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
  },
  {
    name: "teach_sonia",
    description:
      "APRENDIZAJE DEL FEEDBACK. Cuando David te corrige o te da una preferencia que debes recordar para SIEMPRE ('para X usa tono formal', 'el copy máximo 2 frases', 'presupuesto por defecto 10€', 'no uses emojis con este cliente'…), llama a esta tool para guardarlo como lección permanente. En runs futuros similares lo aplicarás solo. Detecta estas frases: 'recuerda que…', 'para … siempre…', 'no hagas…', 'a partir de ahora…', 'prefiero que…'.",
    input_schema: {
      type: "object",
      properties: {
        lesson: {
          type: "string",
          description: "La preferencia/corrección en forma accionable. Ej: 'Para RS Advocats usa tono formal sin emojis'."
        },
        scope: {
          type: "string",
          description:
            "Cuándo aplica. Opciones: 'general' (siempre), 'task_type:meta_lead_campaign', 'task_type:report', 'tool:meta_ads', 'client:<clientId>'. Si dudas, usa 'general'."
        },
        clientName: {
          type: "string",
          description: "OPCIONAL. Si la preferencia es para un cliente concreto, su nombre — buscaré su id para acotar el scope."
        }
      },
      required: ["lesson"]
    },
    run: async (args, ctx) => {
      const { recordLesson } = await import("@/lib/ai/nv-ia/lessons");
      let scope = typeof args?.scope === "string" && args.scope.trim() ? args.scope.trim() : "general";
      // Si dieron clientName, resolver a client:<id>
      if (args?.clientName) {
        const c = await prisma.client.findFirst({
          where: {
            workspaceId: ctx.workspaceId,
            name: { contains: String(args.clientName), mode: "insensitive" }
          } as any,
          select: { id: true, name: true }
        });
        if (c) scope = `client:${c.id}`;
      }
      const lesson = String(args?.lesson ?? "").trim();
      if (lesson.length < 8) return JSON.stringify({ error: "lesson demasiado corta" });
      const r = await recordLesson({
        workspaceId: ctx.workspaceId,
        scope,
        lesson,
        source: "human"
      });
      return JSON.stringify({
        ok: true,
        scope,
        created: r.created,
        message: `Aprendido. Lo aplicaré en runs futuros (scope: ${scope}).`
      });
    }
  }
];

// ── BÚSQUEDA UNIVERSAL ───────────────────────────────────────────
// Una tool que rastrea TODO el workspace: tasks, comentarios,
// adjuntos, proyectos, clientes, documentos y eventos de calendario.
// Para responder "¿dónde se menciona X?" sobre cualquier cosa.
chatTools.push({
  name: "search_everything",
  description:
    "BÚSQUEDA UNIVERSAL en todo el workspace por una palabra/nombre/frase. Rastrea simultáneamente:\n" +
    "- Tareas (título + descripción)\n" +
    "- COMENTARIOS de tareas/proyectos/clientes/documentos (texto del comentario)\n" +
    "- Adjuntos / archivos (nombre del fichero)\n" +
    "- Proyectos (nombre + descripción)\n" +
    "- Clientes (nombre + brief de marca)\n" +
    "- Documentos (título)\n" +
    "- Eventos de calendario (título + descripción)\n\n" +
    "Úsala SIEMPRE que el usuario pregunte '¿dónde aparece/se menciona/se nombra X?' o quiera un rastreo completo. Devuelve resultados AGRUPADOS por tipo, con el contexto de cada coincidencia (ej. 'comentario de Ana en la tarea Y'). Si una coincidencia está en un comentario, resuelve a qué tarea/proyecto pertenece.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Texto a buscar (case-insensitive)." }
    },
    required: ["query"]
  },
  run: async (args, ctx) => {
    const q = String(args?.query ?? "").trim();
    if (q.length < 2) return JSON.stringify({ error: "query demasiado corta" });
    const ci = { contains: q, mode: "insensitive" as const };
    const ws = ctx.workspaceId;

    const [tasks, comments, files, projects, clients, documents, events] = await Promise.all([
      prisma.task.findMany({
        where: { workspaceId: ws, deletedAt: null, OR: [{ title: ci }, { description: ci }] },
        take: 30,
        select: { id: true, title: true, status: true, project: { select: { name: true } }, client: { select: { name: true } } }
      }),
      prisma.comment.findMany({
        where: { workspaceId: ws, body: ci },
        take: 30,
        orderBy: { createdAt: "desc" },
        select: { id: true, body: true, targetType: true, targetId: true, createdAt: true, author: { select: { name: true } } }
      }),
      prisma.file.findMany({
        where: { workspaceId: ws, name: ci },
        take: 20,
        select: { id: true, name: true, mimeType: true, targetType: true, targetId: true }
      }),
      prisma.project.findMany({
        where: { workspaceId: ws, deletedAt: null, OR: [{ name: ci }, { description: ci }] },
        take: 15,
        select: { id: true, name: true, description: true }
      }),
      prisma.client.findMany({
        where: { workspaceId: ws, OR: [{ name: ci }, { brandBrief: ci }] } as any,
        take: 15,
        select: { id: true, name: true }
      }),
      prisma.document.findMany({
        where: { workspaceId: ws, deletedAt: null, title: ci },
        take: 15,
        select: { id: true, title: true }
      }),
      prisma.calendarEvent.findMany({
        where: { workspaceId: ws, OR: [{ title: ci }, { description: ci }] },
        take: 15,
        orderBy: { startAt: "desc" },
        select: { id: true, title: true, startAt: true, client: { select: { name: true } } }
      })
    ]);

    // Resolver los targets de los comentarios (a qué task/proyecto/etc apuntan)
    const taskIds = comments.filter((c) => c.targetType === "TASK").map((c) => c.targetId);
    const taskTitles = taskIds.length
      ? await prisma.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, title: true } })
      : [];
    const taskTitleMap = new Map(taskTitles.map((t) => [t.id, t.title]));

    function snippet(text: string): string {
      const idx = text.toLowerCase().indexOf(q.toLowerCase());
      if (idx === -1) return text.slice(0, 120);
      const start = Math.max(0, idx - 40);
      return (start > 0 ? "…" : "") + text.slice(start, idx + q.length + 60) + "…";
    }

    const result = {
      query: q,
      totalMatches:
        tasks.length + comments.length + files.length + projects.length + clients.length + documents.length + events.length,
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        project: t.project?.name,
        client: t.client?.name
      })),
      comments: comments.map((c) => ({
        id: c.id,
        author: c.author?.name,
        on:
          c.targetType === "TASK"
            ? `tarea: ${taskTitleMap.get(c.targetId) ?? c.targetId}`
            : `${c.targetType.toLowerCase()}: ${c.targetId}`,
        targetType: c.targetType,
        targetId: c.targetId,
        snippet: snippet(c.body),
        date: c.createdAt.toISOString().slice(0, 10)
      })),
      files: files.map((f) => ({
        id: f.id,
        name: f.name,
        type: f.mimeType,
        attachedTo: f.targetType ? `${f.targetType}: ${f.targetId}` : null
      })),
      projects: projects.map((p) => ({ id: p.id, name: p.name })),
      clients: clients.map((c) => ({ id: c.id, name: c.name })),
      documents: documents.map((d) => ({ id: d.id, title: d.title })),
      calendarEvents: events.map((e) => ({
        id: e.id,
        title: e.title,
        when: e.startAt.toISOString().slice(0, 10),
        client: e.client?.name
      }))
    };
    return JSON.stringify(result);
  }
});

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
