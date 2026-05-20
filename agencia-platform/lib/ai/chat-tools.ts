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

/**
 * Tarjeta interactiva que el chat renderiza bajo la respuesta de Sonia.
 * Se construye en el servidor a partir de los resultados REALES de las
 * tools de búsqueda (no del texto del modelo), así los enlaces son
 * fiables y abren el elemento directamente.
 */
export type HubCard = {
  type: "task" | "client" | "project" | "document" | "event";
  title: string;
  url: string;
  subtitle?: string;
  badges?: { label: string; tone?: "default" | "red" | "amber" | "green" | "indigo" }[];
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
        take: 500,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          status: true,
          completedAt: true,
          dueDate: true,
          priority: true,
          projectId: true,
          project: { select: { id: true, name: true, kanbanColumns: true } },
          client: { select: { name: true } }
        }
      }),
      prisma.comment.findMany({
        where: { workspaceId: ws, body: ci },
        take: 200,
        orderBy: { createdAt: "desc" },
        select: { id: true, body: true, targetType: true, targetId: true, createdAt: true, author: { select: { name: true } } }
      }),
      prisma.file.findMany({
        where: { workspaceId: ws, name: ci },
        take: 100,
        select: { id: true, name: true, mimeType: true, targetType: true, targetId: true }
      }),
      prisma.project.findMany({
        where: { workspaceId: ws, deletedAt: null, OR: [{ name: ci }, { description: ci }] },
        take: 100,
        select: { id: true, name: true, description: true }
      }),
      prisma.client.findMany({
        where: { workspaceId: ws, OR: [{ name: ci }, { brandBrief: ci }] } as any,
        take: 100,
        select: { id: true, name: true }
      }),
      prisma.document.findMany({
        where: { workspaceId: ws, deletedAt: null, title: ci },
        take: 100,
        select: { id: true, title: true }
      }),
      prisma.calendarEvent.findMany({
        where: { workspaceId: ws, OR: [{ title: ci }, { description: ci }] },
        take: 100,
        orderBy: { startAt: "desc" },
        select: { id: true, title: true, startAt: true, client: { select: { name: true } } }
      })
    ]);

    // Resolver los targets de los comentarios (a qué task/proyecto/etc apuntan)
    const taskIds = comments.filter((c) => c.targetType === "TASK").map((c) => c.targetId);
    const taskTitles = taskIds.length
      ? await prisma.task.findMany({
          where: { id: { in: taskIds } },
          select: { id: true, title: true, projectId: true }
        })
      : [];
    const taskTitleMap = new Map(taskTitles.map((t) => [t.id, t.title]));
    const taskProjectMap = new Map(taskTitles.map((t) => [t.id, t.projectId]));

    function snippet(text: string): string {
      const idx = text.toLowerCase().indexOf(q.toLowerCase());
      if (idx === -1) return text.slice(0, 120);
      const start = Math.max(0, idx - 40);
      return (start > 0 ? "…" : "") + text.slice(start, idx + q.length + 60) + "…";
    }

    // Resolver el LABEL de la columna de cada task a partir de las
    // kanbanColumns de su proyecto (o defaults del workspace).
    const DEFAULT_COLS: Record<string, string> = {
      TODO: "Por hacer",
      IN_PROGRESS: "En curso",
      REVIEW: "Revisión",
      DONE: "Hecha"
    };
    function columnLabel(t: (typeof tasks)[number]): string {
      const cols = (t.project as any)?.kanbanColumns;
      if (Array.isArray(cols)) {
        const match = cols.find((c: any) => c.id === t.status);
        if (match?.label) return match.label;
      }
      return DEFAULT_COLS[t.status] ?? t.status;
    }

    const result = {
      query: q,
      totalMatches:
        tasks.length + comments.length + files.length + projects.length + clients.length + documents.length + events.length,
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        project: t.project?.name ?? "—",
        projectId: t.projectId,
        column: columnLabel(t),
        done: !!t.completedAt,
        priority: t.priority,
        dueDate: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null,
        client: t.client?.name ?? null,
        // Deep-link que abre la tarea EN su proyecto (para que el filtro
        // la incluya y el modal la encuentre siempre).
        url: `/tareas?project=${t.projectId}&task=${t.id}`
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
        date: c.createdAt.toISOString().slice(0, 10),
        url:
          c.targetType === "TASK"
            ? `/tareas?project=${taskProjectMap.get(c.targetId) ?? "all"}&task=${c.targetId}`
            : null
      })),
      files: files.map((f) => ({
        id: f.id,
        name: f.name,
        type: f.mimeType,
        attachedTo: f.targetType ? `${f.targetType}: ${f.targetId}` : null,
        url: f.targetType === "TASK" && f.targetId ? `/tareas?task=${f.targetId}` : null
      })),
      projects: projects.map((p) => ({ id: p.id, name: p.name, url: `/tareas?project=${p.id}` })),
      clients: clients.map((c) => ({ id: c.id, name: c.name, url: `/clientes?cliente=${c.id}` })),
      documents: documents.map((d) => ({ id: d.id, title: d.title, url: `/documentos/${d.id}` })),
      calendarEvents: events.map((e) => ({
        id: e.id,
        title: e.title,
        when: e.startAt.toISOString().slice(0, 10),
        client: e.client?.name,
        url: `/calendario`
      }))
    };
    return JSON.stringify(result);
  }
});

// ── CORREO (IMAP/SMTP) ───────────────────────────────────────────
// Solo funcionan para el USUARIO dueño de la cuenta (ctx.userId). Si
// el usuario no tiene cuenta conectada, devuelven un aviso — así otro
// usuario del workspace no puede usar el correo ajeno.
chatTools.push({
  name: "email_search",
  description:
    "Busca correos en la bandeja del USUARIO (su cuenta conectada, ej. info@negociovivo.com). Úsalo cuando te pregunte por sus emails. `query` admite: texto libre (busca en asunto+cuerpo), 'from:alguien@x.com', 'unseen' (no leídos), 'since:YYYY-MM-DD'. Devuelve los más recientes con uid, remitente, asunto, fecha. Para leer el cuerpo completo usa email_read con el uid.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Criterio de búsqueda. Vacío = últimos de la bandeja." },
      max: { type: "integer", description: "Máx resultados (default 10, tope 25)." }
    }
  },
  run: async (args, ctx) => {
    if (!ctx.userId) return JSON.stringify({ error: "Necesitas sesión de usuario para acceder al correo." });
    try {
      const { searchEmails } = await import("@/lib/integrations/email-account");
      const emails = await searchEmails({
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
        query: args?.query ? String(args.query) : undefined,
        max: typeof args?.max === "number" ? args.max : undefined
      });
      return JSON.stringify({ count: emails.length, emails });
    } catch (e: any) {
      return JSON.stringify({ error: String(e?.message ?? e) });
    }
  }
});

chatTools.push({
  name: "email_read",
  description:
    "Lee el cuerpo completo de un correo del USUARIO por su uid (obtenido de email_search). Devuelve remitente, asunto, fecha y el texto del correo.",
  input_schema: {
    type: "object",
    properties: { uid: { type: "integer", description: "uid del correo (de email_search)." } },
    required: ["uid"]
  },
  run: async (args, ctx) => {
    if (!ctx.userId) return JSON.stringify({ error: "Necesitas sesión de usuario." });
    try {
      const { readEmail } = await import("@/lib/integrations/email-account");
      const email = await readEmail({
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
        uid: Number(args?.uid)
      });
      return JSON.stringify(email);
    } catch (e: any) {
      return JSON.stringify({ error: String(e?.message ?? e) });
    }
  }
});

chatTools.push({
  name: "email_send",
  description:
    "ENVÍA un correo desde la cuenta del USUARIO (ej. info@negociovivo.com). Úsalo SOLO cuando el usuario te pida explícitamente enviar/responder un email. CONFIRMA siempre el destinatario + asunto + cuerpo en tu respuesta antes de dar por enviado. No inventes destinatarios.",
  input_schema: {
    type: "object",
    properties: {
      to: { type: "string", description: "Destinatario(s), separados por coma." },
      subject: { type: "string" },
      body: { type: "string", description: "Cuerpo del correo en texto plano." },
      cc: { type: "string", description: "Copia (opcional)." }
    },
    required: ["to", "subject", "body"]
  },
  run: async (args, ctx) => {
    if (!ctx.userId) return JSON.stringify({ error: "Necesitas sesión de usuario para enviar correo." });
    try {
      const { sendEmailFromAccount } = await import("@/lib/integrations/email-account");
      const r = await sendEmailFromAccount({
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
        to: String(args?.to ?? ""),
        subject: String(args?.subject ?? ""),
        body: String(args?.body ?? ""),
        cc: args?.cc ? String(args.cc) : undefined
      });
      return JSON.stringify({ ok: true, messageId: r.messageId, message: "Correo enviado." });
    } catch (e: any) {
      return JSON.stringify({ error: String(e?.message ?? e) });
    }
  }
});

// ---- Meta Ads (Facebook/Instagram) ----
// Usan el token guardado en la conexión Meta del workspace (el que no
// caduca de /campanas-meta). Sonia las usa para consultar y operar sobre
// las campañas. Las de escritura SOLO cuando el usuario lo pide explícito.

chatTools.push({
  name: "meta_list_ad_accounts",
  description:
    "Lista las CUENTAS PUBLICITARIAS de Meta (Ad Accounts) a las que tiene acceso el token conectado del workspace. Úsalo cuando pregunten '¿a qué cuentas de Meta puedes acceder?' o para verificar que la conexión funciona. Solo necesita el token (no el Ad Account ID).",
  input_schema: { type: "object", properties: {} },
  run: async (_args, ctx) => {
    try {
      const { metaAdsListAdAccounts } = await import("@/lib/integrations/meta-ads");
      const accounts = await metaAdsListAdAccounts(ctx.workspaceId);
      if (!accounts || accounts.length === 0) {
        return JSON.stringify({ connected: true, accounts: [], note: "El token no tiene cuentas publicitarias." });
      }
      return JSON.stringify({ connected: true, accounts });
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      const notConnected = /MetaConnection no configurada|token inválido/i.test(msg);
      return JSON.stringify({
        connected: false,
        error: msg,
        hint: notConnected ? "No hay token de Meta conectado. Conéctalo en /campanas-meta." : undefined
      });
    }
  }
});

// Resuelve el parámetro adAccount (nombre o act_id) a un adhoc para las
// funciones de meta-ads. Lanza si no encuentra la cuenta.
async function metaAdhocFor(workspaceId: string, adAccount?: string): Promise<Record<string, string> | undefined> {
  if (!adAccount || !adAccount.trim()) return undefined;
  const { metaAdsResolveAccount } = await import("@/lib/integrations/meta-ads");
  const acc = await metaAdsResolveAccount(workspaceId, adAccount.trim());
  if (!acc) throw new Error(`No encontré ninguna cuenta publicitaria de Meta que coincida con "${adAccount}".`);
  return { META_ADS_AD_ACCOUNT_ID: acc.id };
}

chatTools.push({
  name: "meta_list_campaigns",
  description:
    "Lista las campañas de Meta Ads de UNA cuenta publicitaria. El token tiene varias cuentas, así que indica `adAccount` (nombre o act_id, p.ej. 'NEGOCIO VIVO'). Si quieres TODAS las cuentas a la vez usa meta_list_all_campaigns.",
  input_schema: {
    type: "object",
    properties: {
      adAccount: { type: "string", description: "Cuenta publicitaria por nombre o act_id." },
      status: { type: "string", enum: ["ACTIVE", "PAUSED", "ALL"], description: "Filtrar por estado (default ALL)." },
      limit: { type: "integer", description: "Máx. campañas (default 50)." }
    }
  },
  run: async (args, ctx) => {
    try {
      const { metaAdsListCampaigns } = await import("@/lib/integrations/meta-ads");
      const adhoc = await metaAdhocFor(ctx.workspaceId, args?.adAccount);
      const items = await metaAdsListCampaigns({
        workspaceId: ctx.workspaceId,
        status: args?.status && args.status !== "ALL" ? args.status : undefined,
        limit: Math.min(Number(args?.limit) || 50, 100),
        adhoc
      });
      return JSON.stringify(items);
    } catch (e: any) {
      return JSON.stringify({ error: String(e?.message ?? e) });
    }
  }
});

chatTools.push({
  name: "meta_list_all_campaigns",
  description:
    "Lista las campañas de Meta Ads de TODAS las cuentas publicitarias del token, agrupadas por cuenta. Úsalo cuando pidan 'todas las campañas'. Por defecto solo ACTIVAS para no saturar; pasa status para cambiarlo. Puede tardar (una llamada por cuenta).",
  input_schema: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["ACTIVE", "PAUSED", "ALL"],
        description: "Estado a listar (default ACTIVE)."
      }
    }
  },
  run: async (args, ctx) => {
    try {
      const { metaAdsListAllCampaigns } = await import("@/lib/integrations/meta-ads");
      const status = args?.status === "ALL" ? undefined : args?.status ?? "ACTIVE";
      const grouped = await metaAdsListAllCampaigns({ workspaceId: ctx.workspaceId, status });
      // Resumen compacto: solo cuentas con campañas + conteo, para no
      // devolver un JSON gigante al modelo.
      const withCampaigns = grouped.filter((g) => (g.campaigns?.length ?? 0) > 0);
      return JSON.stringify({
        totalAccounts: grouped.length,
        accountsWithCampaigns: withCampaigns.length,
        results: grouped
      });
    } catch (e: any) {
      return JSON.stringify({ error: String(e?.message ?? e) });
    }
  }
});

chatTools.push({
  name: "meta_campaign_insights",
  description:
    "Métricas de rendimiento de una campaña de Meta Ads (impresiones, clics, gasto, CTR, CPC, alcance, conversiones) en un rango. Necesita el campaignId (de meta_list_campaigns).",
  input_schema: {
    type: "object",
    properties: {
      campaignId: { type: "string" },
      datePreset: {
        type: "string",
        description: "Rango: today, yesterday, last_7d, last_14d, last_30d, this_month, last_month, maximum.",
        enum: ["today", "yesterday", "last_7d", "last_14d", "last_30d", "this_month", "last_month", "maximum"]
      }
    },
    required: ["campaignId"]
  },
  run: async (args, ctx) => {
    try {
      const { metaAdsGetCampaignInsights } = await import("@/lib/integrations/meta-ads");
      const data = await metaAdsGetCampaignInsights({
        workspaceId: ctx.workspaceId,
        campaignId: String(args?.campaignId ?? ""),
        datePreset: args?.datePreset ?? "last_30d"
      });
      return JSON.stringify(data);
    } catch (e: any) {
      return JSON.stringify({ error: String(e?.message ?? e) });
    }
  }
});

chatTools.push({
  name: "meta_top_performers",
  description:
    "Devuelve las mejores campañas de Meta Ads de UNA cuenta por una métrica (gasto, impresiones, CTR, alcance) en un rango. Indica `adAccount` (nombre o act_id). Útil para '¿qué campaña va mejor en [cuenta]?'.",
  input_schema: {
    type: "object",
    properties: {
      adAccount: { type: "string", description: "Cuenta publicitaria por nombre o act_id." },
      metric: { type: "string", enum: ["spend", "impressions", "ctr", "reach"], description: "Default spend." },
      datePreset: { type: "string", enum: ["last_7d", "last_14d", "last_30d", "this_month", "last_month", "maximum"] },
      limit: { type: "integer", description: "Top N (default 5)." }
    }
  },
  run: async (args, ctx) => {
    try {
      const { metaAdsTopPerformers } = await import("@/lib/integrations/meta-ads");
      const adhoc = await metaAdhocFor(ctx.workspaceId, args?.adAccount);
      const items = await metaAdsTopPerformers({
        workspaceId: ctx.workspaceId,
        metric: args?.metric ?? "spend",
        datePreset: args?.datePreset ?? "last_30d",
        limit: Math.min(Number(args?.limit) || 5, 25),
        adhoc
      });
      return JSON.stringify(items);
    } catch (e: any) {
      return JSON.stringify({ error: String(e?.message ?? e) });
    }
  }
});

chatTools.push({
  name: "meta_download_leads",
  description:
    "Descarga los leads (formularios Lead Ads) de una campaña/anuncio de Meta. Devuelve count + array de leads. Útil para '¿cuántos leads ha traído X?' o exportarlos.",
  input_schema: {
    type: "object",
    properties: {
      campaignId: { type: "string", description: "Campaña (opcional si das adId/formId)." },
      adId: { type: "string" },
      formId: { type: "string" },
      since: { type: "string", description: "YYYY-MM-DD (opcional)." },
      until: { type: "string", description: "YYYY-MM-DD (opcional)." }
    }
  },
  run: async (args, ctx) => {
    try {
      const { metaAdsDownloadLeads } = await import("@/lib/integrations/meta-ads");
      const data = await metaAdsDownloadLeads({
        workspaceId: ctx.workspaceId,
        campaignId: args?.campaignId ? String(args.campaignId) : undefined,
        adId: args?.adId ? String(args.adId) : undefined,
        formId: args?.formId ? String(args.formId) : undefined,
        since: args?.since ? String(args.since) : undefined,
        until: args?.until ? String(args.until) : undefined
      });
      return JSON.stringify(data);
    } catch (e: any) {
      return JSON.stringify({ error: String(e?.message ?? e) });
    }
  }
});

chatTools.push({
  name: "meta_update_campaign",
  description:
    "MODIFICA una campaña de Meta Ads: pausar/activar (status) o cambiar el presupuesto diario. Úsalo SOLO cuando el usuario lo pida explícitamente. CONFIRMA en tu respuesta qué campaña y qué cambio harás (gasta dinero real del cliente). Cambiar presupuesto en euros/día.",
  input_schema: {
    type: "object",
    properties: {
      campaignId: { type: "string" },
      status: { type: "string", enum: ["ACTIVE", "PAUSED"], description: "Pausar o activar la campaña." },
      dailyBudgetEur: { type: "number", description: "Nuevo presupuesto diario en euros." }
    },
    required: ["campaignId"]
  },
  run: async (args, ctx) => {
    try {
      const { metaAdsUpdateCampaign } = await import("@/lib/integrations/meta-ads");
      const r = await metaAdsUpdateCampaign({
        workspaceId: ctx.workspaceId,
        campaignId: String(args?.campaignId ?? ""),
        status: args?.status,
        dailyBudgetEur: typeof args?.dailyBudgetEur === "number" ? args.dailyBudgetEur : undefined
      });
      return JSON.stringify({ ok: r.success, message: "Campaña actualizada en Meta." });
    } catch (e: any) {
      return JSON.stringify({ error: String(e?.message ?? e) });
    }
  }
});

// ---- GMB Hub (fichas de Google My Business) ----
// Las reseñas entran vía Make; Sonia las lee/responde sobre los datos del hub.
// Responder publica en Google a través del webhook de Make (si está configurado).

async function gmbResolveClient(workspaceId: string, ref: string): Promise<{ id: string; name: string } | null> {
  const r = ref.trim();
  if (!r) return null;
  // por id exacto
  const byId = await prisma.gmbClient.findFirst({
    where: { id: r, workspaceId },
    select: { id: true, name: true }
  });
  if (byId) return byId;
  // por nombre (contiene)
  return prisma.gmbClient.findFirst({
    where: { workspaceId, name: { contains: r, mode: "insensitive" } },
    select: { id: true, name: true }
  });
}

chatTools.push({
  name: "gmb_list_clients",
  description:
    "Lista las fichas de Google My Business del workspace (GMB Hub) con su rating medio, nº de reseñas y cuántas están sin responder. Úsalo para '¿qué fichas de GMB tengo?' o '¿qué reseñas tengo sin responder?'.",
  input_schema: { type: "object", properties: {} },
  run: async (_args, ctx) => {
    const clients = await prisma.gmbClient.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, category: true, rating: true, reviewCount: true, status: true }
    });
    const ids = clients.map((c) => c.id);
    const unreplied = ids.length
      ? await prisma.gmbReview.groupBy({
          by: ["clientId"],
          where: { clientId: { in: ids }, OR: [{ reviewReply: null }, { reviewReply: "" }] },
          _count: { _all: true }
        })
      : [];
    const um = new Map(unreplied.map((u) => [u.clientId, u._count._all]));
    return JSON.stringify({
      count: clients.length,
      clients: clients.map((c) => ({ ...c, unreplied: um.get(c.id) ?? 0 }))
    });
  }
});

chatTools.push({
  name: "gmb_list_reviews",
  description:
    "Lista reseñas de una ficha de GMB (por nombre o id). Opcional: solo las que están sin responder. Devuelve autor, estrellas, comentario, fecha y la respuesta si la tiene.",
  input_schema: {
    type: "object",
    properties: {
      client: { type: "string", description: "Nombre o id de la ficha." },
      unrepliedOnly: { type: "boolean", description: "Solo reseñas sin responder." },
      limit: { type: "integer", description: "Máx (default 20)." }
    },
    required: ["client"]
  },
  run: async (args, ctx) => {
    const client = await gmbResolveClient(ctx.workspaceId, String(args?.client ?? ""));
    if (!client) return JSON.stringify({ error: "Ficha de GMB no encontrada" });
    const reviews = await prisma.gmbReview.findMany({
      where: {
        clientId: client.id,
        ...(args?.unrepliedOnly ? { OR: [{ reviewReply: null }, { reviewReply: "" }] } : {})
      },
      orderBy: { reviewTime: "desc" },
      take: Math.min(Number(args?.limit) || 20, 50),
      select: { reviewId: true, authorName: true, rating: true, comment: true, reviewReply: true, reviewTime: true }
    });
    return JSON.stringify({ client, count: reviews.length, reviews });
  }
});

chatTools.push({
  name: "gmb_suggest_reply",
  description:
    "Genera (sin publicar) una respuesta con IA para una reseña concreta de GMB, con el tono de la ficha. Devuelve el texto propuesto para que lo revises antes de publicarlo con gmb_reply_review.",
  input_schema: {
    type: "object",
    properties: {
      client: { type: "string", description: "Nombre o id de la ficha." },
      reviewId: { type: "string", description: "reviewId de la reseña (de gmb_list_reviews)." }
    },
    required: ["client", "reviewId"]
  },
  run: async (args, ctx) => {
    try {
      const client = await gmbResolveClient(ctx.workspaceId, String(args?.client ?? ""));
      if (!client) return JSON.stringify({ error: "Ficha de GMB no encontrada" });
      const full = await prisma.gmbClient.findUnique({
        where: { id: client.id },
        select: { name: true, tone: true, customTone: true }
      });
      const review = await prisma.gmbReview.findFirst({
        where: { clientId: client.id, reviewId: String(args?.reviewId ?? "") },
        select: { rating: true, comment: true }
      });
      if (!review) return JSON.stringify({ error: "Reseña no encontrada" });
      const { generateReviewReply } = await import("@/lib/integrations/gmb-hub");
      const tone = full?.tone === "custom" && full.customTone ? full.customTone : full?.tone ?? "profesional";
      const reply = await generateReviewReply({
        workspaceId: ctx.workspaceId,
        businessName: full?.name ?? client.name,
        tone,
        rating: review.rating || 5,
        comment: review.comment ?? ""
      });
      return JSON.stringify({ reply });
    } catch (e: any) {
      return JSON.stringify({ error: String(e?.message ?? e) });
    }
  }
});

chatTools.push({
  name: "gmb_reply_review",
  description:
    "PUBLICA una respuesta a una reseña de GMB: la guarda y la envía a Google vía el webhook de Make. Úsalo SOLO cuando el usuario lo pida explícitamente y tras CONFIRMAR el texto. Para reseñas negativas, redacta con tacto.",
  input_schema: {
    type: "object",
    properties: {
      client: { type: "string", description: "Nombre o id de la ficha." },
      reviewId: { type: "string", description: "reviewId de la reseña." },
      reply: { type: "string", description: "Texto de la respuesta a publicar." }
    },
    required: ["client", "reviewId", "reply"]
  },
  run: async (args, ctx) => {
    try {
      const client = await gmbResolveClient(ctx.workspaceId, String(args?.client ?? ""));
      if (!client) return JSON.stringify({ error: "Ficha de GMB no encontrada" });
      const full = await prisma.gmbClient.findUnique({
        where: { id: client.id },
        select: { accountId: true, locationId: true }
      });
      const review = await prisma.gmbReview.findFirst({
        where: { clientId: client.id, reviewId: String(args?.reviewId ?? "") },
        select: { id: true }
      });
      if (!review) return JSON.stringify({ error: "Reseña no encontrada" });
      const reply = String(args?.reply ?? "").trim();
      if (!reply) return JSON.stringify({ error: "Falta el texto de la respuesta" });
      await prisma.gmbReview.update({ where: { id: review.id }, data: { reviewReply: reply, updateTime: new Date() } });
      const { publishReplyViaMake, logGmbActivity } = await import("@/lib/integrations/gmb-hub");
      const pub = await publishReplyViaMake({
        workspaceId: ctx.workspaceId,
        accountId: full?.accountId ?? "",
        locationId: full?.locationId ?? "",
        reviewId: String(args?.reviewId ?? ""),
        reply
      });
      await logGmbActivity({
        workspaceId: ctx.workspaceId,
        clientId: client.id,
        actionType: "review_replied",
        description: `Respuesta publicada por Sonia${pub.sentToGoogle ? " (en Google)" : " (guardada; webhook de Make no configurado)"}`
      });
      return JSON.stringify({
        ok: true,
        sentToGoogle: pub.sentToGoogle,
        note: pub.sentToGoogle
          ? "Respuesta publicada en Google."
          : "Guardada. Para publicarla en Google configura el webhook de Make en ajustes de GMB."
      });
    } catch (e: any) {
      return JSON.stringify({ error: String(e?.message ?? e) });
    }
  }
});

chatTools.push({
  name: "gmb_seo_audit",
  description:
    "Auditoría SEO local de una ficha de GMB (por nombre o id): puntuación 0-100 + qué falta + recomendaciones. Útil para '¿cómo está el SEO de [ficha]?' o priorizar mejoras.",
  input_schema: {
    type: "object",
    properties: { client: { type: "string", description: "Nombre o id de la ficha." } },
    required: ["client"]
  },
  run: async (args, ctx) => {
    const client = await gmbResolveClient(ctx.workspaceId, String(args?.client ?? ""));
    if (!client) return JSON.stringify({ error: "Ficha de GMB no encontrada" });
    const full = await prisma.gmbClient.findUnique({ where: { id: client.id } });
    if (!full) return JSON.stringify({ error: "Ficha no encontrada" });
    const { computeSeoAudit } = await import("@/lib/integrations/gmb-hub");
    return JSON.stringify({ client: client.name, audit: computeSeoAudit(full) });
  }
});

chatTools.push({
  name: "gmb_grid_rank",
  description:
    "Mide el ranking local de una ficha de GMB para un keyword por zonas (rejilla en el mapa): devuelve la posición media, cuántas zonas están en top 3 y en cuántas aparece. Útil para '¿cómo rankea [ficha] para [keyword]?'. Operación algo lenta (consulta el mapa por zonas).",
  input_schema: {
    type: "object",
    properties: {
      client: { type: "string", description: "Nombre o id de la ficha." },
      keyword: { type: "string", description: "Búsqueda a medir, ej. 'cerrajero Málaga'." },
      size: { type: "integer", description: "Celdas por lado 3-7 (default 5)." }
    },
    required: ["client", "keyword"]
  },
  run: async (args, ctx) => {
    try {
      const client = await gmbResolveClient(ctx.workspaceId, String(args?.client ?? ""));
      if (!client) return JSON.stringify({ error: "Ficha de GMB no encontrada" });
      const c = await prisma.gmbClient.findUnique({ where: { id: client.id } });
      if (!c) return JSON.stringify({ error: "Ficha no encontrada" });
      const { gridRank, resolveCoords } = await import("@/lib/integrations/google-maps");
      let lat = c.latitude;
      let lng = c.longitude;
      let placeId = c.placeId || undefined;
      if (lat == null || lng == null) {
        const coords = await resolveCoords({
          workspaceId: ctx.workspaceId,
          placeId,
          query: [c.name, c.address].filter(Boolean).join(" ")
        });
        if (!coords) return JSON.stringify({ error: "No pude localizar el negocio en el mapa." });
        lat = coords.lat;
        lng = coords.lng;
        placeId = coords.placeId ?? placeId;
        await prisma.gmbClient.update({
          where: { id: c.id },
          data: { latitude: lat, longitude: lng, placeId: placeId ?? c.placeId }
        });
      }
      const res = await gridRank({
        workspaceId: ctx.workspaceId,
        lat: lat!,
        lng: lng!,
        keyword: String(args.keyword),
        businessName: c.name,
        placeId,
        size: Number(args?.size) || 5
      });
      await prisma.gmbPosition.create({
        data: {
          workspaceId: ctx.workspaceId,
          clientId: c.id,
          keyword: String(args.keyword),
          avgPosition: res.avgPosition,
          top3Count: res.top3Count,
          foundCount: res.foundCount,
          cellCount: res.cellCount,
          gridData: res.cells as any
        }
      });
      return JSON.stringify({
        client: client.name,
        keyword: args.keyword,
        avgPosition: res.avgPosition,
        top3Count: res.top3Count,
        foundCount: res.foundCount,
        cellCount: res.cellCount
      });
    } catch (e: any) {
      return JSON.stringify({ error: String(e?.message ?? e) });
    }
  }
});

chatTools.push({
  name: "gmb_buscador",
  description:
    "Busca negocios en Google Maps por zona(s) + keyword (Buscador GMB), para captar clientes. Devuelve la lista de negocios encontrados (nombre, dirección, rating, reseñas). La detección de 'reclamable' (sin dueño) es lenta y se hace desde la UI, no aquí.",
  input_schema: {
    type: "object",
    properties: {
      locations: { type: "array", items: { type: "string" }, description: "Localizaciones, ej. ['Torremolinos','Mijas']." },
      keyword: { type: "string", description: "Tipo de negocio, ej. 'clínica dental'." },
      radiusKm: { type: "number", description: "Radio en km (default 3)." }
    },
    required: ["locations"]
  },
  run: async (args, ctx) => {
    try {
      const locs = (Array.isArray(args?.locations) ? args.locations : []).map((s: any) => String(s)).filter(Boolean);
      if (locs.length === 0) return JSON.stringify({ error: "Indica al menos una localización." });
      const { placesNearby, resolveCoords } = await import("@/lib/integrations/google-maps");
      const byPlace = new Map<string, any>();
      for (const loc of locs.slice(0, 10)) {
        const coords = await resolveCoords({ workspaceId: ctx.workspaceId, query: loc });
        if (!coords) continue;
        const places = await placesNearby({
          workspaceId: ctx.workspaceId,
          lat: coords.lat,
          lng: coords.lng,
          radius: (Number(args?.radiusKm) || 3) * 1000,
          keyword: args?.keyword ? String(args.keyword) : undefined,
          maxPages: 1
        });
        for (const p of places) if (p.placeId && !byPlace.has(p.placeId)) byPlace.set(p.placeId, p);
      }
      const results = Array.from(byPlace.values());
      return JSON.stringify({
        count: results.length,
        results: results.slice(0, 30).map((r) => ({ name: r.name, address: r.address, rating: r.rating, reviewCount: r.reviewCount }))
      });
    } catch (e: any) {
      return JSON.stringify({ error: String(e?.message ?? e) });
    }
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

/**
 * Normaliza el resultado JSON de una tool de búsqueda en tarjetas
 * interactivas (HubCard[]). Devuelve [] si la tool no es "listable" o el
 * resultado no parsea. Se acumula a lo largo del loop agéntico y se
 * devuelve junto a la respuesta de texto.
 */
export function extractCardsFromTool(name: string, raw: string): HubCard[] {
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!data || data.error) return [];

  const prioBadge = (p?: string): HubCard["badges"] => {
    if (p === "URGENT") return [{ label: "Urgente", tone: "red" }];
    if (p === "HIGH") return [{ label: "Alta", tone: "amber" }];
    return [];
  };
  const taskCard = (t: any): HubCard => {
    const isDone = t.done ?? t.status === "DONE";
    const badges: NonNullable<HubCard["badges"]> = [];
    if (isDone) badges.push({ label: "Hecha", tone: "green" });
    badges.push(...(prioBadge(t.priority) ?? []));
    if (t.dueDate) badges.push({ label: String(t.dueDate), tone: "default" });
    const subParts = [t.project, t.column].filter(Boolean);
    if (t.client && t.client !== t.project) subParts.push(t.client);
    return {
      type: "task",
      title: String(t.title ?? "(sin título)"),
      url: t.url ?? (t.projectId ? `/tareas?project=${t.projectId}&task=${t.id}` : `/tareas?task=${t.id}`),
      subtitle: subParts.join(" · ") || undefined,
      badges: badges.length ? badges : undefined
    };
  };
  const clientCard = (c: any): HubCard => ({
    type: "client",
    title: String(c.name ?? "(cliente)"),
    url: c.url ?? `/clientes?cliente=${c.id}`,
    subtitle: c.industry || undefined,
    badges: c.status
      ? [{ label: String(c.status).toLowerCase(), tone: c.status === "ACTIVE" ? "green" : "default" }]
      : undefined
  });
  const projectCard = (p: any): HubCard => ({
    type: "project",
    title: String(p.name ?? "(proyecto)"),
    url: p.url ?? `/tareas?project=${p.id}`,
    subtitle: p.client?.name || undefined
  });
  const docCard = (d: any): HubCard => ({
    type: "document",
    title: String(d.title ?? "(documento)"),
    url: d.url ?? `/documentos/${d.id}`,
    subtitle: d.category || undefined
  });
  const eventCard = (e: any): HubCard => ({
    type: "event",
    title: String(e.title ?? "(evento)"),
    url: e.url ?? "/calendario",
    subtitle: [typeof e.when === "string" ? e.when.slice(0, 10) : null, e.client].filter(Boolean).join(" · ") || undefined
  });

  const out: HubCard[] = [];
  if (name === "search_everything") {
    (data.tasks ?? []).slice(0, 6).forEach((t: any) => out.push(taskCard(t)));
    (data.clients ?? []).slice(0, 4).forEach((c: any) => out.push(clientCard(c)));
    (data.projects ?? []).slice(0, 4).forEach((p: any) => out.push(projectCard(p)));
    (data.documents ?? []).slice(0, 4).forEach((d: any) => out.push(docCard(d)));
    (data.calendarEvents ?? []).slice(0, 3).forEach((e: any) => out.push(eventCard(e)));
  } else if (name === "search_tasks") {
    (data.tasks ?? []).slice(0, 10).forEach((t: any) => out.push(taskCard(t)));
  } else if (name === "search_clients") {
    (Array.isArray(data) ? data : []).slice(0, 10).forEach((c: any) => out.push(clientCard(c)));
  } else if (name === "list_projects") {
    (Array.isArray(data) ? data : []).slice(0, 12).forEach((p: any) => out.push(projectCard(p)));
  } else if (name === "search_documents") {
    (Array.isArray(data) ? data : []).slice(0, 10).forEach((d: any) => out.push(docCard(d)));
  } else if (name === "upcoming_events") {
    (Array.isArray(data) ? data : []).slice(0, 8).forEach((e: any) => out.push(eventCard(e)));
  }
  return out;
}
