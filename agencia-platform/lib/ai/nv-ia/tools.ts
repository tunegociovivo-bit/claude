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
import { semanticSearch } from "@/lib/search/embeddings";
import { extractTextFromFile } from "./file-reader";
import { readDriveFileText } from "./drive-reader";
import { readClientMemory, appendClientMemoryNote } from "./client-memory";
import { transcribeAudioWithWhisper } from "@/lib/ai/openai";
import { signedDownloadUrl } from "@/lib/storage/r2";
import { completeVision } from "@/lib/ai/anthropic";
import { listDriveFiles } from "@/lib/integrations/google-drive";
import type { AiAgentConfig } from "./types";

export type ToolContext = {
  workspaceId: string;
  taskId: string;
  config: AiAgentConfig;
  /** Id del AiAgentRun que está ejecutando estas tools — para enlazar drafts. */
  runId: string;
  /** Contador de sub-agentes spawneados en este run (cap 5 para evitar costes desbocados). */
  subagentsSpawned?: { count: number };
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
    name: "search_knowledge",
    description:
      "Búsqueda SEMÁNTICA (no por palabras exactas) sobre todo el workspace — tareas, comentarios, proyectos, clientes y documentos. Devuelve los fragmentos más relevantes con su score. Úsalo para responder preguntas tipo '¿qué dijimos sobre X cliente?', '¿cómo resolvimos un problema parecido?', '¿qué decisiones tomamos sobre Y?'.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Pregunta o tema a buscar, en lenguaje natural."
        },
        topK: {
          type: "number",
          description: "Cuántos resultados quieres (default 5, máximo 15).",
          default: 5
        },
        entityTypes: {
          type: "array",
          description: "Filtra por tipos. Omitir para buscar en todo.",
          items: { type: "string", enum: ["TASK", "COMMENT", "PROJECT", "CLIENT", "DOCUMENT"] }
        }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    name: "draft_email",
    description:
      "Redacta un email PARA QUE LO APRUEBE UN HUMANO antes de enviarlo. NO se envía automáticamente — el email aparece en /admin/nv-ia/drafts y un admin pulsa 'Aprobar y enviar'. Úsalo para responder a un cliente, comunicar entregables, hacer seguimiento, etc. Sé claro, profesional y conciso.",
    input_schema: {
      type: "object",
      properties: {
        to: {
          type: "string",
          description: "Email del destinatario. UN SOLO email (para múltiples destinatarios, pide al humano que duplique el draft)."
        },
        subject: {
          type: "string",
          description: "Asunto. Conciso y descriptivo."
        },
        body: {
          type: "string",
          description: "Cuerpo del email en texto plano con saltos de línea para los párrafos. Sin HTML — el sistema lo convierte. Firma con 'Equipo Negocio Vivo'."
        }
      },
      required: ["to", "subject", "body"],
      additionalProperties: false
    }
  },
  {
    name: "draft_whatsapp",
    description:
      "Redacta un mensaje de WhatsApp PARA QUE LO APRUEBE UN HUMANO antes de enviarlo. NO se envía automáticamente. Úsalo para mensajes breves a clientes con su teléfono ya conocido. El mensaje aparece en /admin/nv-ia/drafts.",
    input_schema: {
      type: "object",
      properties: {
        phone: {
          type: "string",
          description: "Teléfono en formato internacional con prefijo (+34..., +1..., etc.). Si solo tienes el número español sin prefijo, ponlo igual — el sistema normaliza."
        },
        text: {
          type: "string",
          description: "Texto del mensaje. Breve (idealmente < 800 chars). Tono coloquial, sin emojis salvo que sea muy natural."
        }
      },
      required: ["phone", "text"],
      additionalProperties: false
    }
  },
  {
    name: "draft_editorial_post",
    description:
      "Redacta un post editorial (Instagram, blog, LinkedIn, etc.) PARA QUE LO APRUEBE UN HUMANO antes de programarlo o publicarlo. NO se publica automáticamente — al aprobar se crea como DRAFT en /editorial.",
    input_schema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Título interno del post (no se publica)."
        },
        content: {
          type: "string",
          description: "Cuerpo del post. Adáptalo al canal — para Instagram corto y con hashtags, para blog largo, para LinkedIn intermedio profesional."
        },
        networks: {
          type: "array",
          description: "Redes destino. Valores válidos: instagram, facebook, linkedin, twitter, blog, tiktok.",
          items: { type: "string" }
        },
        clientId: {
          type: "string",
          description: "ID del cliente al que pertenece el post (opcional)."
        }
      },
      required: ["title", "content", "networks"],
      additionalProperties: false
    }
  },
  {
    name: "list_task_files",
    description:
      "Lista los archivos adjuntos a la tarea actual (PDFs, docs, hojas de cálculo, imágenes...). Devuelve id, nombre, tipo MIME y tamaño. Úsalo ANTES de read_file_content para saber qué hay disponible.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "read_file_content",
    description:
      "Lee el contenido en texto plano de un archivo adjunto de la tarea. Soporta PDF, DOCX, XLSX, TXT, MD, CSV, JSON, HTML. NO soporta imágenes todavía. Pasa el id del archivo obtenido de list_task_files. Si el archivo es enorme se trunca a 200K chars con marca visible.",
    input_schema: {
      type: "object",
      properties: {
        fileId: { type: "string", description: "ID del archivo (de list_task_files)" }
      },
      required: ["fileId"],
      additionalProperties: false
    }
  },
  {
    name: "analyze_image",
    description:
      "Analiza una imagen adjunta a la tarea (PNG, JPEG, GIF, WebP) y devuelve una descripción textual + transcripción de cualquier texto visible. Úsalo para entender mockups, screenshots de errores, logos, infografías, fotos de productos, capturas de chats. Pasa el fileId de list_task_files y opcionalmente una pregunta concreta.",
    input_schema: {
      type: "object",
      properties: {
        fileId: { type: "string", description: "ID del archivo (de list_task_files). Debe ser una imagen." },
        question: {
          type: "string",
          description: "Pregunta concreta a responder sobre la imagen. Si la omites, la describo en general y extraigo el texto visible."
        }
      },
      required: ["fileId"],
      additionalProperties: false
    }
  },
  {
    name: "list_drive_files",
    description:
      "Lista archivos de la carpeta de Google Drive del workspace. Solo ves archivos dentro de la carpeta configurada — no puedes navegar por todo el Drive del cliente. Filtra opcionalmente por prefijo del nombre.",
    input_schema: {
      type: "object",
      properties: {
        namePrefix: {
          type: "string",
          description: "Filtro por nombre (case-insensitive, substring). Ej: 'brief' encuentra todos con 'brief' en el nombre."
        }
      },
      additionalProperties: false
    }
  },
  {
    name: "read_drive_file",
    description:
      "Lee el contenido en texto plano de un archivo de Google Drive (de los que aparecen en list_drive_files). Soporta Google Docs (→ texto), Google Sheets (→ CSV de la primera hoja), Google Slides (→ texto), PDF, DOCX, XLSX, TXT, MD, CSV, JSON. NO soporta imágenes (esas no están en Drive típicamente; si lo están, descárgalas a la tarea y usa analyze_image).",
    input_schema: {
      type: "object",
      properties: {
        fileId: { type: "string", description: "ID del archivo en Drive (de list_drive_files)." }
      },
      required: ["fileId"],
      additionalProperties: false
    }
  },
  {
    name: "get_calendar_events",
    description:
      "Lee eventos del calendario del workspace en un rango de fechas. Útil para saber disponibilidad antes de proponer una reunión o para responder '¿qué tengo el viernes?'. Devuelve título, hora, cliente asociado.",
    input_schema: {
      type: "object",
      properties: {
        fromIso: {
          type: "string",
          description: "Fecha inicio en ISO 8601 (ej '2026-05-20T00:00:00Z'). Si lo omites, usa hoy."
        },
        toIso: {
          type: "string",
          description: "Fecha fin en ISO 8601. Si lo omites, usa hoy+7d."
        },
        clientId: {
          type: "string",
          description: "Filtra por cliente (opcional)."
        }
      },
      additionalProperties: false
    }
  },
  {
    name: "draft_calendar_event",
    description:
      "Crea un BORRADOR de evento de calendario PARA QUE APRUEBE UN HUMANO antes de añadirlo. NO se crea automáticamente. Úsalo cuando alguien pide programar una reunión, recordar un hito, bloquear tiempo, etc. El evento aparece en /admin/nv-ia/drafts.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Título del evento (qué es)." },
        description: { type: "string", description: "Descripción/agenda (opcional)." },
        startIso: { type: "string", description: "Inicio en ISO 8601 con timezone." },
        endIso: { type: "string", description: "Fin en ISO 8601 con timezone (opcional para all-day)." },
        allDay: { type: "boolean", description: "true para evento de día completo." },
        type: {
          type: "string",
          description: "Tipo: MEETING, DEADLINE, REMINDER, OTHER",
          enum: ["MEETING", "DEADLINE", "REMINDER", "OTHER"]
        },
        clientId: { type: "string", description: "Cliente asociado (opcional)." }
      },
      required: ["title", "startIso"],
      additionalProperties: false
    }
  },
  {
    name: "get_client_memory",
    description:
      "Lee la memoria persistente que NV IA ha acumulado sobre un cliente: preferencias, decisiones, rechazos previos, restricciones. ÚSALO SI dudas del estilo a usar con un cliente o si te preguntas '¿cómo le hablamos a este cliente normalmente?'. Si la tarea actual tiene cliente, get_task_context YA te incluye esta memoria — solo llama aquí si quieres la de OTRO cliente o si necesitas refrescarla.",
    input_schema: {
      type: "object",
      properties: {
        clientId: {
          type: "string",
          description: "ID del cliente. Si lo omites, usa el cliente de la tarea actual."
        }
      },
      additionalProperties: false
    }
  },
  {
    name: "update_client_memory",
    description:
      "Añade una nota a la memoria persistente de un cliente. Úsalo cuando aprendas algo IMPORTANTE que aplique a TODOS los futuros trabajos con ese cliente: tono preferido, restricciones, decisiones de estrategia. NO lo uses para detalles operativos de una tarea concreta (eso ya queda en comentarios). Sé conciso — una frase clara. Tipos: observation, preference, decision, rejected_draft, restriction.",
    input_schema: {
      type: "object",
      properties: {
        note: { type: "string", description: "Texto de la nota (1 frase, max 4000 chars)." },
        type: {
          type: "string",
          enum: ["observation", "preference", "decision", "rejected_draft", "restriction"],
          description: "Categoría — ayuda a la IA del futuro a filtrar/encontrar la nota."
        },
        clientId: {
          type: "string",
          description: "ID del cliente. Si lo omites, usa el cliente de la tarea actual."
        }
      },
      required: ["note"],
      additionalProperties: false
    }
  },
  {
    name: "get_team_members",
    description:
      "Lista los miembros del workspace (id, nombre, email, rol). Útil ANTES de assign_task o create_subtask para saber a quién puedes asignar trabajo.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "assign_task",
    description:
      "Asigna la tarea actual a uno o varios miembros del workspace. REEMPLAZA los assignees existentes (no añade). Pasa lista vacía para desasignar a todos. El user NV IA NO debería incluirse aquí — ella ya está procesando la tarea.",
    input_schema: {
      type: "object",
      properties: {
        userIds: {
          type: "array",
          items: { type: "string" },
          description: "IDs de los users a asignar (de get_team_members). Pasa array vacío [] para desasignar a todos."
        }
      },
      required: ["userIds"],
      additionalProperties: false
    }
  },
  {
    name: "create_subtask",
    description:
      "Crea una SUBTAREA hija de la tarea actual. Útil para partir trabajos grandes en pasos asignables a personas distintas. La subtarea queda en el MISMO proyecto que la padre. Si pasas assigneeIds, se asignan al crear. Devuelve el id de la nueva tarea.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Título corto, accionable. Ej: 'Preparar borrador del informe Q4'." },
        description: { type: "string", description: "Detalle opcional de qué hay que hacer." },
        assigneeIds: {
          type: "array",
          items: { type: "string" },
          description: "Users a asignar a la subtarea (de get_team_members). Opcional."
        },
        priority: {
          type: "string",
          enum: ["LOW", "MEDIUM", "HIGH", "URGENT"],
          description: "Prioridad. Default MEDIUM."
        },
        dueDateIso: {
          type: "string",
          description: "Fecha límite en ISO 8601 (opcional). Ej: '2026-05-31'."
        }
      },
      required: ["title"],
      additionalProperties: false
    }
  },
  {
    name: "transcribe_audio",
    description:
      "Transcribe un archivo de AUDIO adjunto a la tarea usando Whisper. Soporta WebM, MP3, M4A, WAV, OGG (formatos típicos de notas de voz). Devuelve el texto transcrito. Pásalo el fileId de un audio que veas en list_task_files. Útil para notas de voz que mandan clientes o reuniones grabadas adjuntas.",
    input_schema: {
      type: "object",
      properties: {
        fileId: { type: "string", description: "ID del archivo audio (de list_task_files)." }
      },
      required: ["fileId"],
      additionalProperties: false
    }
  },
  {
    name: "draft_drive_file",
    description:
      "Crea un BORRADOR de archivo de Google Drive (Doc / Sheet / Slide) PARA QUE LO APRUEBE UN HUMANO antes de subir. Al aprobar se crea como nativo de Google Workspace en la carpeta de Drive del workspace. Úsalo para: preparar informes, hojas de seguimiento, presentaciones simples, propuestas largas que no encajan como email.",
    input_schema: {
      type: "object",
      properties: {
        fileName: {
          type: "string",
          description: "Nombre del archivo (sin extensión, Drive la añade). Ej: 'Propuesta campaña Navidad Acme'."
        },
        kind: {
          type: "string",
          enum: ["document", "spreadsheet", "presentation"],
          description: "Tipo Google Workspace. 'document' = Doc, 'spreadsheet' = Sheet (contenido como CSV), 'presentation' = Slides."
        },
        content: {
          type: "string",
          description: "Contenido. Para Doc: texto plano o HTML básico (saltos de párrafo, listas con guiones). Para Sheet: CSV con primera fila de cabeceras. Para Slides: texto plano (Google convierte párrafos en slides). Max 50K chars."
        }
      },
      required: ["fileName", "kind", "content"],
      additionalProperties: false
    }
  },
  {
    name: "spawn_subagent",
    description:
      "Delega una sub-tarea de investigación/análisis/redacción a un SUB-AGENTE especializado. Útil cuando la tarea es grande y tiene piezas independientes que puedes paralelizar mentalmente. El sub-agente trabaja sobre la MISMA tarea (mismo contexto) pero con una persona y tools restringidas. Devuelve un texto que puedes usar después. Tope: 5 sub-agentes por run. NO uses esto para todo — solo cuando hay una pieza claramente separable y compleja (ej: 'analizar el Excel de ventas Q4 y dame top 3 insights', 'redactar el primer borrador del email de 300 palabras').\n\nROLES:\n- researcher: busca y compila info del workspace (tareas, comentarios, Drive). Devuelve brief con hallazgos + referencias.\n- writer: redacta un texto concreto (email, post, propuesta). Devuelve el texto listo.\n- analyst: analiza datos de archivos/imágenes. Devuelve insights numerados con evidencia.\n- reviewer: revisa un borrador/decisión y propone mejoras/riesgos.\n\nLos sub-agentes son READ-ONLY — NO pueden comentar, asignar, ni crear drafts. Tú (el coordinator) usas su output para decidir qué hacer.",
    input_schema: {
      type: "object",
      properties: {
        role: {
          type: "string",
          enum: ["researcher", "writer", "analyst", "reviewer"],
          description: "Tipo de sub-agente."
        },
        instruction: {
          type: "string",
          description: "Instrucción CLARA y ACOTADA para el sub-agente (1-3 frases). Mejor pocos sub-agentes específicos que uno con instrucción vaga."
        }
      },
      required: ["role", "instruction"],
      additionalProperties: false
    }
  },
  {
    name: "mark_complete",
    description:
      "Marca la tarea como COMPLETADA, añade un comentario final con el resumen de lo que has hecho, y notifica al solicitante. Es la ÚNICA forma correcta de terminar el run con éxito. El resumen debe ser claro y conciso: qué se ha hecho, qué entregables hay (si aplica), MENCIONA explícitamente cuántos drafts quedan pendientes de aprobación si los hay. Después de llamar a esta tool, NO sigas trabajando — el run termina.",
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
    // Auto-inyección de memoria del cliente. Si el task tiene
    // clientId y existe memoria acumulada de runs anteriores, la
    // metemos aquí — ahorra a la IA hacer una tool call extra y
    // garantiza que SIEMPRE tiene el contexto histórico antes de
    // actuar (decisiones tomadas, preferencias, rechazos pasados).
    let clientMemory: string | null = null;
    if (task.clientId) {
      const mem = await readClientMemory(ctx.workspaceId, task.clientId);
      if (mem) clientMemory = mem;
    }
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
      })),
      clientMemory
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

  async search_knowledge(input, ctx) {
    const query = String(input?.query ?? "").trim();
    if (!query) return { error: "query vacío" };
    const topK = Math.min(Math.max(Number(input?.topK) || 5, 1), 15);
    const entityTypes = Array.isArray(input?.entityTypes) ? input.entityTypes : undefined;
    try {
      const results = await semanticSearch({
        workspaceId: ctx.workspaceId,
        query,
        topK,
        entityTypes
      });
      return {
        count: results.length,
        results: results.map((r) => ({
          type: r.entityType,
          id: r.entityId,
          score: Math.round(r.score * 100) / 100,
          text: r.text.slice(0, 600)
        }))
      };
    } catch (e: any) {
      return { error: `Búsqueda semántica falló: ${e?.message ?? e}` };
    }
  },

  async draft_email(input, ctx) {
    const to = String(input?.to ?? "").trim();
    const subject = String(input?.subject ?? "").trim();
    const body = String(input?.body ?? "").trim();
    if (!to || !subject || !body) return { error: "to/subject/body son obligatorios" };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return { error: "email destinatario inválido" };
    if (subject.length > 200) return { error: "subject demasiado largo (>200)" };
    if (body.length > 12000) return { error: "body demasiado largo (>12000)" };
    // body → html simple (párrafos por doble salto, <br> por simple)
    const html = body
      .split(/\n\n+/)
      .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
      .join("");
    const draft = await prisma.aiDraft.create({
      data: {
        workspaceId: ctx.workspaceId,
        aiAgentRunId: ctx.runId,
        taskId: ctx.taskId,
        kind: "EMAIL",
        title: `Email a ${to}: ${subject.slice(0, 80)}`,
        payload: { to, subject, html, text: body }
      }
    });
    return {
      ok: true,
      draftId: draft.id,
      message: "Borrador de email creado. Quedará pendiente hasta que un admin lo apruebe en /admin/nv-ia/drafts."
    };
  },

  async draft_whatsapp(input, ctx) {
    const { normalizePhone } = await import("@/lib/leads/waha");
    const phone = normalizePhone(String(input?.phone ?? ""));
    const text = String(input?.text ?? "").trim();
    if (!phone) return { error: "teléfono inválido o no normalizable" };
    if (!text) return { error: "text vacío" };
    if (text.length > 2000) return { error: "mensaje demasiado largo (>2000)" };
    const draft = await prisma.aiDraft.create({
      data: {
        workspaceId: ctx.workspaceId,
        aiAgentRunId: ctx.runId,
        taskId: ctx.taskId,
        kind: "WHATSAPP",
        title: `WhatsApp a +${phone}: ${text.slice(0, 60)}…`,
        payload: { phoneNormalized: phone, text }
      }
    });
    return {
      ok: true,
      draftId: draft.id,
      message: "Borrador de WhatsApp creado. Quedará pendiente hasta que un admin lo apruebe."
    };
  },

  async draft_editorial_post(input, ctx) {
    const title = String(input?.title ?? "").trim();
    const content = String(input?.content ?? "").trim();
    const networks = Array.isArray(input?.networks) ? input.networks.map(String) : [];
    if (!title || !content || networks.length === 0) {
      return { error: "title, content y networks (al menos 1) son obligatorios" };
    }
    if (content.length > 8000) return { error: "content demasiado largo" };
    const clientId = input?.clientId ? String(input.clientId) : null;
    if (clientId) {
      // Validamos que el cliente exista en el workspace
      const c = await prisma.client.findFirst({ where: { id: clientId, workspaceId: ctx.workspaceId } });
      if (!c) return { error: "clientId no encontrado en el workspace" };
    }
    const draft = await prisma.aiDraft.create({
      data: {
        workspaceId: ctx.workspaceId,
        aiAgentRunId: ctx.runId,
        taskId: ctx.taskId,
        kind: "EDITORIAL_POST",
        title: `Post (${networks.join(", ")}): ${title.slice(0, 60)}`,
        payload: { title, content, networks, clientId }
      }
    });
    return {
      ok: true,
      draftId: draft.id,
      message: "Borrador de post editorial creado. Quedará pendiente hasta que un admin lo apruebe."
    };
  },

  async list_task_files(_input, ctx) {
    const files = await prisma.file.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        targetType: "TASK",
        targetId: ctx.taskId
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, mimeType: true, sizeBytes: true, createdAt: true }
    });
    return {
      count: files.length,
      files: files.map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        sizeReadable: humanSize(f.sizeBytes)
      }))
    };
  },

  async read_file_content(input, ctx) {
    const fileId = String(input?.fileId ?? "").trim();
    if (!fileId) return { error: "fileId vacío" };
    const file = await prisma.file.findFirst({
      where: {
        id: fileId,
        workspaceId: ctx.workspaceId
      }
    });
    if (!file) return { error: "Archivo no encontrado en este workspace" };
    // Por defensa: solo dejamos leer archivos enlazados a la task o
    // al mismo cliente/proyecto. Para Fase 3 dejamos TASK y los que
    // no tienen targetType (sin owner) — no permitimos saltar a otra
    // task ajena al run.
    if (file.targetType && file.targetType !== "TASK") {
      return { error: "Solo puedes leer adjuntos de tipo TASK por ahora" };
    }
    if (file.targetType === "TASK" && file.targetId !== ctx.taskId) {
      return { error: "Ese archivo no pertenece a la tarea asignada a este run" };
    }
    const result = await extractTextFromFile({
      s3Key: file.s3Key,
      mimeType: file.mimeType,
      filename: file.name,
      sizeBytes: file.sizeBytes
    });
    if (!result.ok) return { error: result.error };
    return {
      ok: true,
      filename: file.name,
      mimeType: file.mimeType,
      bytes: result.bytes,
      truncated: result.truncated,
      pages: result.pages,
      sheets: result.sheets,
      text: result.text
    };
  },

  async get_calendar_events(input, ctx) {
    const from = input?.fromIso ? new Date(input.fromIso) : new Date();
    const to = input?.toIso
      ? new Date(input.toIso)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return { error: "fromIso/toIso inválidos" };
    }
    if (to.getTime() - from.getTime() > 90 * 24 * 60 * 60 * 1000) {
      return { error: "Rango máximo 90 días" };
    }
    const events = await prisma.calendarEvent.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        startAt: { gte: from, lte: to },
        ...(input?.clientId ? { clientId: String(input.clientId) } : {})
      },
      orderBy: { startAt: "asc" },
      take: 200,
      include: { client: { select: { id: true, name: true } } }
    });
    return {
      count: events.length,
      fromIso: from.toISOString(),
      toIso: to.toISOString(),
      events: events.map((e) => ({
        id: e.id,
        title: e.title,
        type: e.type,
        startIso: e.startAt.toISOString(),
        endIso: e.endAt?.toISOString() ?? null,
        allDay: e.allDay,
        client: e.client
      }))
    };
  },

  async draft_calendar_event(input, ctx) {
    const title = String(input?.title ?? "").trim();
    const startIso = String(input?.startIso ?? "").trim();
    if (!title || !startIso) return { error: "title y startIso son obligatorios" };
    const start = new Date(startIso);
    if (isNaN(start.getTime())) return { error: "startIso inválido" };
    let end: Date | null = null;
    if (input?.endIso) {
      end = new Date(String(input.endIso));
      if (isNaN(end.getTime())) return { error: "endIso inválido" };
      if (end <= start) return { error: "endIso debe ser posterior a startIso" };
    }
    const allDay = input?.allDay === true;
    const type = ["MEETING", "DEADLINE", "REMINDER", "OTHER"].includes(input?.type)
      ? input.type
      : "MEETING";
    const clientId = input?.clientId ? String(input.clientId) : null;
    if (clientId) {
      const c = await prisma.client.findFirst({
        where: { id: clientId, workspaceId: ctx.workspaceId }
      });
      if (!c) return { error: "clientId no encontrado en el workspace" };
    }
    const draft = await prisma.aiDraft.create({
      data: {
        workspaceId: ctx.workspaceId,
        aiAgentRunId: ctx.runId,
        taskId: ctx.taskId,
        kind: "CALENDAR_EVENT",
        title: `Evento: ${title.slice(0, 60)} (${start.toLocaleString("es-ES")})`,
        payload: {
          title,
          description: input?.description ?? null,
          startIso: start.toISOString(),
          endIso: end?.toISOString() ?? null,
          allDay,
          type,
          clientId
        }
      }
    });
    return {
      ok: true,
      draftId: draft.id,
      message: "Borrador de evento creado. Quedará pendiente hasta que un admin lo apruebe."
    };
  },

  async analyze_image(input, ctx) {
    const fileId = String(input?.fileId ?? "").trim();
    if (!fileId) return { error: "fileId vacío" };
    const file = await prisma.file.findFirst({
      where: { id: fileId, workspaceId: ctx.workspaceId }
    });
    if (!file) return { error: "Archivo no encontrado en este workspace" };
    if (file.targetType === "TASK" && file.targetId !== ctx.taskId) {
      return { error: "Ese archivo no pertenece a la tarea asignada" };
    }
    if (!file.mimeType?.startsWith("image/")) {
      return { error: `No es una imagen (${file.mimeType}). Para PDFs/docs usa read_file_content.` };
    }
    // Tope de tamaño: imágenes >10MB las rechazamos para no quemar
    // tokens. Claude vision limita a ~5MB por imagen igualmente.
    if (file.sizeBytes > 10 * 1024 * 1024) {
      return { error: `Imagen demasiado grande (${(file.sizeBytes / 1024 / 1024).toFixed(1)}MB > 10MB)` };
    }
    try {
      // signedDownloadUrl da un URL temporal (1h) que Claude puede
      // descargarse a sí mismo — no hace falta base64.
      const url = await signedDownloadUrl(file.s3Key);
      const question = String(input?.question ?? "").trim();
      const userText =
        question ||
        "Describe esta imagen en detalle. Si contiene texto, transcríbelo literalmente. Si es un mockup/diseño UI, identifica los elementos clave. Si es un logo o pieza gráfica, describe colores, tipografía y estilo. Si es un screenshot de error, extrae el mensaje. Sé conciso pero completo.";
      const text = await completeVision({
        workspaceId: ctx.workspaceId,
        system:
          "Eres un asistente que analiza imágenes con precisión técnica. Responde solo lo que se te pide, en castellano, sin frases hechas.",
        userText,
        imageUrls: [url],
        maxTokens: 2000,
        userId: ctx.config.userId,
        feature: "nv-ia-vision"
      });
      return {
        ok: true,
        fileId,
        filename: file.name,
        analysis: text
      };
    } catch (e: any) {
      return { error: `Análisis de imagen falló: ${e?.message ?? e}` };
    }
  },

  async list_drive_files(input, ctx) {
    try {
      const files = await listDriveFiles({
        workspaceId: ctx.workspaceId,
        namePrefix: input?.namePrefix ? String(input.namePrefix) : undefined
      });
      return {
        count: files.length,
        files: files.slice(0, 100).map((f) => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          sizeBytes: f.size ? Number(f.size) : null,
          modifiedTime: f.modifiedTime
        }))
      };
    } catch (e: any) {
      return { error: `Drive no disponible: ${e?.message ?? e}` };
    }
  },

  async read_drive_file(input, ctx) {
    const fileId = String(input?.fileId ?? "").trim();
    if (!fileId) return { error: "fileId vacío" };
    const result = await readDriveFileText({
      workspaceId: ctx.workspaceId,
      fileId
    });
    if (!result.ok) return { error: result.error };
    return {
      ok: true,
      name: result.name,
      mimeType: result.mimeType,
      bytes: result.bytes,
      truncated: result.truncated,
      text: result.text
    };
  },

  async get_client_memory(input, ctx) {
    let clientId = input?.clientId ? String(input.clientId) : null;
    if (!clientId) {
      const t = await prisma.task.findFirst({
        where: { id: ctx.taskId, workspaceId: ctx.workspaceId },
        select: { clientId: true }
      });
      clientId = t?.clientId ?? null;
    }
    if (!clientId) return { error: "La tarea no tiene cliente asignado y no pasaste clientId" };
    const mem = await readClientMemory(ctx.workspaceId, clientId);
    return {
      clientId,
      hasMemory: mem.length > 0,
      content: mem
    };
  },

  async update_client_memory(input, ctx) {
    let clientId = input?.clientId ? String(input.clientId) : null;
    if (!clientId) {
      const t = await prisma.task.findFirst({
        where: { id: ctx.taskId, workspaceId: ctx.workspaceId },
        select: { clientId: true }
      });
      clientId = t?.clientId ?? null;
    }
    if (!clientId) return { error: "La tarea no tiene cliente asignado y no pasaste clientId" };
    const note = String(input?.note ?? "").trim();
    if (!note) return { error: "note vacío" };
    const type = ["observation", "preference", "decision", "rejected_draft", "restriction"].includes(input?.type)
      ? input.type
      : "observation";
    const r = await appendClientMemoryNote({
      workspaceId: ctx.workspaceId,
      clientId,
      note,
      type,
      by: "nv-ia"
    });
    if (!r.ok) return { error: r.error };
    return { ok: true, clientId, size: r.size };
  },

  async get_team_members(_input, ctx) {
    const members = await prisma.membership.findMany({
      where: { workspaceId: ctx.workspaceId },
      include: {
        user: { select: { id: true, name: true, email: true, image: true } }
      }
    });
    return {
      count: members.length,
      members: members
        .filter((m) => m.userId !== ctx.config.userId) // excluir NV IA misma
        .map((m) => ({
          id: m.user.id,
          name: m.user.name,
          email: m.user.email,
          role: m.role
        }))
    };
  },

  async assign_task(input, ctx) {
    const userIds: string[] | null = Array.isArray(input?.userIds)
      ? (input.userIds as unknown[]).map(String)
      : null;
    if (!userIds) return { error: "userIds debe ser un array" };
    if (userIds.length > 20) return { error: "demasiados asignados (>20)" };
    // Validamos que todos pertenezcan al workspace
    if (userIds.length > 0) {
      const valid = await prisma.membership.findMany({
        where: { workspaceId: ctx.workspaceId, userId: { in: userIds } },
        select: { userId: true }
      });
      const validSet = new Set(valid.map((v) => v.userId));
      const invalid = userIds.filter((id: string) => !validSet.has(id));
      if (invalid.length > 0) {
        return { error: `Estos users no son del workspace: ${invalid.join(", ")}` };
      }
    }
    await prisma.$transaction([
      prisma.taskAssignee.deleteMany({ where: { taskId: ctx.taskId } }),
      ...(userIds.length > 0
        ? [
            prisma.taskAssignee.createMany({
              data: userIds.map((userId) => ({ taskId: ctx.taskId, userId }))
            })
          ]
        : [])
    ]);
    // Notificar a los nuevos asignados — la IA está delegando trabajo.
    if (userIds.length > 0) {
      await prisma.notification.createMany({
        data: userIds.map((uid: string) => ({
          userId: uid,
          type: "assignment",
          body: `NV IA te ha asignado una tarea`,
          link: `/tasks/${ctx.taskId}`
        }))
      }).catch(() => {});
    }
    return { ok: true, assignedCount: userIds.length };
  },

  async create_subtask(input, ctx) {
    const title = String(input?.title ?? "").trim();
    if (!title) return { error: "title vacío" };
    if (title.length > 500) return { error: "title demasiado largo (>500)" };
    const parent = await prisma.task.findFirst({
      where: { id: ctx.taskId, workspaceId: ctx.workspaceId },
      select: { projectId: true, clientId: true }
    });
    if (!parent) return { error: "Tarea padre no encontrada" };

    const assigneeIds: string[] = Array.isArray(input?.assigneeIds)
      ? (input.assigneeIds as unknown[]).map(String)
      : [];
    if (assigneeIds.length > 0) {
      const valid = await prisma.membership.findMany({
        where: { workspaceId: ctx.workspaceId, userId: { in: assigneeIds } },
        select: { userId: true }
      });
      const validSet = new Set(valid.map((v) => v.userId));
      const invalid = assigneeIds.filter((id: string) => !validSet.has(id));
      if (invalid.length > 0) {
        return { error: `Estos users no son del workspace: ${invalid.join(", ")}` };
      }
    }

    const priority = ["LOW", "MEDIUM", "HIGH", "URGENT"].includes(input?.priority)
      ? input.priority
      : "MEDIUM";
    let dueDate: Date | null = null;
    if (input?.dueDateIso) {
      const d = new Date(String(input.dueDateIso));
      if (!isNaN(d.getTime())) dueDate = d;
    }

    const subtask = await prisma.task.create({
      data: {
        workspaceId: ctx.workspaceId,
        projectId: parent.projectId,
        clientId: parent.clientId,
        parentId: ctx.taskId,
        title,
        description: input?.description ? String(input.description) : null,
        status: "TODO",
        priority: priority as any,
        dueDate
      }
    });
    if (assigneeIds.length > 0) {
      await prisma.taskAssignee.createMany({
        data: assigneeIds.map((userId: string) => ({ taskId: subtask.id, userId }))
      });
      await prisma.notification.createMany({
        data: assigneeIds.map((uid: string) => ({
          userId: uid,
          type: "assignment",
          body: `NV IA te ha asignado una subtarea: "${title.slice(0, 60)}"`,
          link: `/tasks/${subtask.id}`
        }))
      }).catch(() => {});
    }
    return {
      ok: true,
      subtaskId: subtask.id,
      assignedCount: assigneeIds.length
    };
  },

  async transcribe_audio(input, ctx) {
    const fileId = String(input?.fileId ?? "").trim();
    if (!fileId) return { error: "fileId vacío" };
    const file = await prisma.file.findFirst({
      where: { id: fileId, workspaceId: ctx.workspaceId }
    });
    if (!file) return { error: "Archivo no encontrado en este workspace" };
    if (file.targetType === "TASK" && file.targetId !== ctx.taskId) {
      return { error: "Ese archivo no pertenece a la tarea asignada" };
    }
    const mime = (file.mimeType ?? "").toLowerCase();
    const lower = file.name.toLowerCase();
    const isAudio =
      mime.startsWith("audio/") ||
      /\.(webm|mp3|m4a|wav|ogg|opus|flac)$/i.test(lower);
    if (!isAudio) return { error: `No es un archivo de audio (${mime || lower})` };
    if (file.sizeBytes > 25 * 1024 * 1024) {
      return { error: `Audio demasiado grande (${(file.sizeBytes / 1024 / 1024).toFixed(1)}MB > 25MB de Whisper)` };
    }
    try {
      const { downloadBuffer } = await import("@/lib/storage/r2");
      const buf = await downloadBuffer(file.s3Key);
      // Buffer → Uint8Array (ArrayBufferLike incompatible con BlobPart)
      const u8 = new Uint8Array(buf);
      const blob = new Blob([u8], { type: file.mimeType || "audio/webm" });
      const text = await transcribeAudioWithWhisper({
        workspaceId: ctx.workspaceId,
        audio: blob,
        filename: file.name,
        language: "es"
      });
      return {
        ok: true,
        fileId,
        filename: file.name,
        durationSeconds: null,
        transcript: text
      };
    } catch (e: any) {
      return { error: `Transcripción falló: ${e?.message ?? e}` };
    }
  },

  async draft_drive_file(input, ctx) {
    const fileName = String(input?.fileName ?? "").trim();
    const kind = String(input?.kind ?? "").trim();
    const content = String(input?.content ?? "").trim();
    if (!fileName) return { error: "fileName vacío" };
    if (!["document", "spreadsheet", "presentation"].includes(kind)) {
      return { error: "kind debe ser document | spreadsheet | presentation" };
    }
    if (!content) return { error: "content vacío" };
    if (content.length > 50_000) return { error: "content demasiado largo (>50K chars)" };
    const draft = await prisma.aiDraft.create({
      data: {
        workspaceId: ctx.workspaceId,
        aiAgentRunId: ctx.runId,
        taskId: ctx.taskId,
        kind: "DRIVE_FILE",
        title: `${kind === "document" ? "Doc" : kind === "spreadsheet" ? "Sheet" : "Slides"}: ${fileName.slice(0, 80)}`,
        payload: { fileName, kind, content }
      }
    });
    return {
      ok: true,
      draftId: draft.id,
      message: "Borrador de archivo de Drive creado. Al aprobar se subirá a la carpeta del workspace."
    };
  },

  async spawn_subagent(input, ctx) {
    const role = String(input?.role ?? "").trim();
    const instruction = String(input?.instruction ?? "").trim();
    if (!["researcher", "writer", "analyst", "reviewer"].includes(role)) {
      return { error: "role debe ser researcher | writer | analyst | reviewer" };
    }
    if (!instruction) return { error: "instruction vacía" };
    if (instruction.length > 4000) return { error: "instruction demasiado larga (>4000)" };
    // Cap 5 sub-agentes por run principal — el contador vive en
    // ctx.subagentsSpawned compartido entre todas las tool calls
    // del mismo run (el runner lo inicializa).
    if (!ctx.subagentsSpawned) ctx.subagentsSpawned = { count: 0 };
    if (ctx.subagentsSpawned.count >= 5) {
      return { error: "Cap de 5 sub-agentes por run alcanzado. Termina con lo que tienes." };
    }
    ctx.subagentsSpawned.count++;
    // Import dinámico para evitar circular (subagent → tools → ...).
    const { runSubagent } = await import("./subagent");
    const result = await runSubagent({
      workspaceId: ctx.workspaceId,
      taskId: ctx.taskId,
      config: ctx.config,
      parentRunId: ctx.runId,
      role: role as any,
      instruction
    });
    return {
      ok: result.ok,
      role,
      result: result.text,
      stepsUsed: result.stepsCount,
      toolsUsed: result.toolsUsed,
      tokensUsed: result.inputTokens + result.outputTokens,
      ...(result.error ? { error: result.error } : {})
    };
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

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
