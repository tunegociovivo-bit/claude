/**
 * Tools del agente Sonia — Fase 1.
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
import {
  readClientMemory,
  appendClientMemoryNote,
  readWorkspaceMemory,
  appendWorkspaceMemoryNote,
  readUserMemory,
  appendUserMemoryNote
} from "./client-memory";
import { transcribeAudioWithWhisper, getOpenAiKeyForWorkspace } from "@/lib/ai/openai";
import { uploadBuffer, buildS3Key } from "@/lib/storage/r2";
import { getWorkflowDefinition } from "./workflows";
import {
  holdedListInvoices,
  holdedListContacts,
  holdedListQuotes,
  holdedGetInvoice,
  holdedInvoiceStatusLabel
} from "@/lib/integrations/holded";
import {
  stripeListCustomers,
  stripeListInvoices,
  stripeListSubscriptions
} from "@/lib/integrations/stripe-light";
import { elevenlabsSynthesize } from "@/lib/integrations/elevenlabs";
import { metricoolListBrands, metricoolGetStats } from "@/lib/integrations/metricool";
import {
  metaAdsListAdAccounts,
  metaAdsListCampaigns,
  metaAdsGetCampaignInsights,
  metaAdsTopPerformers
} from "@/lib/integrations/meta-ads";
import {
  gadsListCampaigns,
  gadsCampaignMetrics,
  gadsCreateCampaignBudget,
  gadsCreateCampaign,
  gadsUpdateCampaignStatus,
  gadsUpdateBudget,
  gadsCreateAdGroup,
  gadsCreateKeywords,
  gadsCreateResponsiveSearchAd
} from "@/lib/integrations/google-ads";
import { ga4GetReport } from "@/lib/integrations/ga4";
import { searchConsoleQuery } from "@/lib/integrations/search-console";
import { generateMonthlyClientReport } from "@/lib/reports/monthly-client-report";
import { generateWeeklySocialSummary } from "@/lib/reports/weekly-social-summary";
import {
  gmbListAccounts,
  gmbListLocations,
  gmbListReviews,
  gmbReplyReview,
  gmbDeleteReviewReply,
  gmbCreatePost,
  gmbGetInsights
} from "@/lib/integrations/gmb";
import { signedDownloadUrl } from "@/lib/storage/r2";
import { completeVision } from "@/lib/ai/anthropic";
import { listDriveFiles } from "@/lib/integrations/google-drive";
import { uploadAttachmentForTask } from "@/lib/files/sonia-upload";
import { markdownToHtmlBody, wrapAsReportHtml } from "@/lib/files/markdown-html";
import type { AiAgentConfig } from "./types";

export type ToolContext = {
  workspaceId: string;
  taskId: string;
  config: AiAgentConfig;
  /** Id del AiAgentRun que está ejecutando estas tools — para enlazar drafts. */
  runId: string;
  /** Contador de sub-agentes spawneados en este run (cap 5 para evitar costes desbocados). */
  subagentsSpawned?: { count: number };
  /** Contador de http_request en este run (cap 50 para evitar abuso). */
  httpRequests?: { count: number };
  /**
   * Credenciales temporales inyectadas en la tarea (descripción o
   * comentarios) para este run. Las tools de integración (meta-ads,
   * google-ads, holded, stripe, waha, resend, elevenlabs) las
   * priorizan sobre las del workspace cifrado.
   *
   * Caso de uso: el user pega un token Meta temporal cuando la
   * integración oficial caducó, sin tener que reconectar.
   *
   * Claves canónicas: META_ADS_TOKEN, META_ADS_AD_ACCOUNT_ID, etc.
   * Ver lib/ai/nv-ia/adhoc-credentials.ts.
   */
  adhocCredentials?: Record<string, string>;
};

export type ToolExecutor = (input: any, ctx: ToolContext) => Promise<unknown>;

/**
 * Normaliza un Ad Account ID de Meta. Acepta "act_123", "123", o incluso
 * una URL del Ads Manager con "?act=123". Devuelve "act_<digits>" o null.
 */
function normalizeAdAccountId(input?: unknown): string | null {
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (!s) return null;
  const m = s.match(/act[=_](\d{6,20})/i) ?? s.match(/(\d{6,20})/);
  return m ? `act_${m[1]}` : null;
}

/**
 * Devuelve las credenciales adhoc del run con META_ADS_AD_ACCOUNT_ID
 * sobrescrito por el adAccountId que pase la tool (si lo pasa). Permite
 * a Sonia analizar la cuenta de CUALQUIER cliente (p.ej. ESAEM en su
 * cuenta propia act_1581277508683081) sin depender del default del
 * workspace ni de que el user pegue la URL en la descripción.
 */
function adhocWithAdAccount(
  adhoc: Record<string, string> | undefined,
  adAccountId?: unknown
): Record<string, string> | undefined {
  const norm = normalizeAdAccountId(adAccountId);
  if (!norm) return adhoc;
  return { ...(adhoc ?? {}), META_ADS_AD_ACCOUNT_ID: norm };
}

/**
 * Definiciones (schemas) que mandamos a Claude para que sepa qué tools
 * tiene. Cada tool tiene un executor correspondiente abajo.
 */
export const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  // ────────────────────────────────────────────────────────────────
  // Server-side tools de Anthropic (Fase 14+16)
  // Estas las ejecuta Anthropic, no nosotros. Solo las declaramos.
  // El modelo las usa autónomamente y los resultados aparecen en
  // el response como bloques server_tool_use / *_tool_result.
  // ────────────────────────────────────────────────────────────────
  // @ts-expect-error — Anthropic SDK type es Tool con input_schema, pero
  // los server tools solo necesitan {type, name}. SDK lo acepta en runtime.
  { type: "web_search_20260209", name: "web_search" },
  // code_execution DESACTIVADO temporalmente. El server tool requiere
  // threading de container_id entre turnos (la respuesta incluye un
  // container_id que hay que devolver en la siguiente messages.create),
  // y nuestro loop no lo implementa todavía. Sin eso, en cuanto el
  // modelo invoca code_execution Anthropic devuelve:
  //   400 invalid_request_error: "container_id is required when there
  //   are pending tool uses generated by code execution with tools."
  // y el run revienta entero. Sonia tiene http_request +
  // create_xlsx_workbook + análisis vía Haiku que cubren el 99% de
  // casos reales (cálculos, gráficas, regex). Re-activar cuando
  // implementemos container threading correcto en runner.ts.
  // { type: "code_execution_20260120", name: "code_execution" },
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
      "Añade un comentario público a la tarea, firmado como 'Sonia'. Úsalo para: hacer preguntas al equipo si te falta información, dar updates de progreso, o documentar decisiones. NO uses esto para el resumen final — para eso usa mark_complete. Visible para todos los miembros con acceso a la tarea.",
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
      "Lee la memoria persistente que Sonia ha acumulado sobre un cliente: preferencias, decisiones, rechazos previos, restricciones. ÚSALO SI dudas del estilo a usar con un cliente o si te preguntas '¿cómo le hablamos a este cliente normalmente?'. Si la tarea actual tiene cliente, get_task_context YA te incluye esta memoria — solo llama aquí si quieres la de OTRO cliente o si necesitas refrescarla.",
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
    name: "get_workspace_memory",
    description:
      "Lee la memoria GLOBAL del workspace — políticas, firma estándar, horario, dirección, criterios generales que aplican a TODA la comunicación. get_task_context ya te la inyecta automáticamente; solo llama aquí si necesitas refrescarla.",
    input_schema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "update_workspace_memory",
    description:
      "Añade una nota a la memoria global del workspace. Úsalo cuando descubras algo que aplica a TODO el workspace (no solo a un cliente). Ej: 'firmar siempre como Equipo Negocio Vivo', 'horario lun-vie 9-18', 'fuera de horario solo respondemos urgencias'. NO uses esto para detalles de un cliente concreto — para eso update_client_memory.",
    input_schema: {
      type: "object",
      properties: {
        note: { type: "string", description: "1 frase clara. Max 4000 chars." },
        type: {
          type: "string",
          enum: ["observation", "preference", "decision", "rejected_draft", "restriction"]
        }
      },
      required: ["note"],
      additionalProperties: false
    }
  },
  {
    name: "get_user_memory",
    description:
      "Lee la memoria de un MIEMBRO del equipo — sus áreas, especialidades, horarios, preferencias de delegación. Útil ANTES de assign_task o create_subtask para no asignar a alguien que p.ej. está de vacaciones o no maneja ese tema. get_task_context ya inyecta la memoria del REQUESTER, así que solo llama aquí si quieres la de OTRO miembro.",
    input_schema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "ID del miembro (de get_team_members)." }
      },
      required: ["userId"],
      additionalProperties: false
    }
  },
  {
    name: "update_user_memory",
    description:
      "Añade una nota sobre un miembro del equipo. Útil cuando aprendes algo sobre sus áreas/preferencias que mejora futuras asignaciones. Ej: 'María lleva Cliente Acme', 'Juan no responde después de las 18h', 'Lucía solo hace contenido visual'.",
    input_schema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "ID del miembro." },
        note: { type: "string", description: "1 frase clara. Max 4000 chars." },
        type: {
          type: "string",
          enum: ["observation", "preference", "decision", "rejected_draft", "restriction"]
        }
      },
      required: ["userId", "note"],
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
      "Asigna la tarea actual a uno o varios miembros del workspace. REEMPLAZA los assignees existentes (no añade). Pasa lista vacía para desasignar a todos. El user Sonia NO debería incluirse aquí — ella ya está procesando la tarea.",
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
    name: "draft_gmb_post",
    description:
      "Redacta un post para Google Business Profile (Google My Business) PARA APROBACIÓN HUMANA. Como la integración con GMB aún no está disponible, el draft se guarda como CUSTOM y el admin lo copia/pega manualmente en GMB tras aprobar. Útil para: ofertas, eventos, novedades del negocio. Tipos GMB: 'standard' (post normal), 'event' (con fechas), 'offer' (con descuento).",
    input_schema: {
      type: "object",
      properties: {
        clientId: { type: "string", description: "Cliente al que aplica (opcional)." },
        type: {
          type: "string",
          enum: ["standard", "event", "offer"],
          description: "Tipo de post de GMB."
        },
        title: { type: "string", description: "Titular del post. Max 100 chars." },
        body: { type: "string", description: "Cuerpo del post. Recomendado 150-300 chars (GMB recorta visualmente más allá)." },
        callToAction: {
          type: "string",
          description: "CTA opcional. Valores típicos GMB: BOOK, ORDER, SHOP, LEARN_MORE, SIGN_UP, CALL."
        },
        ctaUrl: { type: "string", description: "URL del CTA si aplica." },
        eventStart: { type: "string", description: "Para type=event: fecha/hora inicio ISO." },
        eventEnd: { type: "string", description: "Para type=event: fecha/hora fin ISO." }
      },
      required: ["type", "body"],
      additionalProperties: false
    }
  },
  {
    name: "get_pricing_rules",
    description:
      "Lista los servicios con sus precios y rangos de negociación admitidos. Sonia puede ofrecer descuentos hasta minAmountEur (más allá requiere escalación). Devuelve también los tradeoffs configurados (compromisos que justifican rebaja). LLAMA ESTO ANTES de proponer cualquier deal — son las únicas reglas que tienes permitidas.",
    input_schema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "create_deal",
    description:
      "Abre un Deal en estado PROSPECT cuando detectas que un lead/cliente está en proceso de compra. Asocia opcionalmente leadId o clientId. items[] = lo que se ofrece inicialmente (puedes ajustar luego con propose_deal o counter_offer). El Deal se ve en /admin/nv-ia/deals.",
    input_schema: {
      type: "object",
      properties: {
        leadId: { type: "string", description: "ID del Lead si existe en BD." },
        clientId: { type: "string", description: "ID del Client si es upsell." },
        contactName: { type: "string" },
        contactEmail: { type: "string" },
        contactPhone: { type: "string" },
        items: {
          type: "array",
          description: "Líneas iniciales del deal.",
          items: {
            type: "object",
            properties: {
              serviceId: { type: "string", description: "ID de PricingService." },
              name: { type: "string" },
              units: { type: "number" },
              amountEur: { type: "number", description: "Precio EUR por unidad (debe ser >= minAmountEur)." },
              unit: { type: "string", enum: ["one_time", "monthly", "hourly"] }
            },
            required: ["name", "units", "amountEur"]
          }
        },
        notes: { type: "string" }
      },
      required: ["items"],
      additionalProperties: false
    }
  },
  {
    name: "propose_deal_to_lead",
    description:
      "Genera draft de comunicación al lead con la propuesta inicial. Prepara email (o WhatsApp si solo tienes phone) con la propuesta detallada — pasa por aprobación humana antes de salir, igual que cualquier draft_email/draft_whatsapp. Marca el deal como PROPOSED.",
    input_schema: {
      type: "object",
      properties: {
        dealId: { type: "string" },
        channel: { type: "string", enum: ["email", "whatsapp"], description: "Canal a usar para la propuesta." },
        coverMessage: {
          type: "string",
          description: "Mensaje envoltorio sobre la propuesta — la lista de items la genero yo formateada."
        }
      },
      required: ["dealId", "channel"],
      additionalProperties: false
    }
  },
  {
    name: "counter_offer",
    description:
      "Ajusta los términos del deal en respuesta a una contraoferta del cliente. Sonia puede: bajar precio dentro del rango (>= minAmountEur), añadir condiciones/tradeoffs ('te lo dejo en X si te comprometes a 12 meses'), cambiar el alcance. Cualquier cambio fuera del rango permitido = ESCALATED, no se aplica. Loguea la negociación. Marca el deal como NEGOTIATING. Devuelve sugerencia de mensaje pero NO envía — usa draft_email/draft_whatsapp después.",
    input_schema: {
      type: "object",
      properties: {
        dealId: { type: "string" },
        newItems: {
          type: "array",
          items: {
            type: "object",
            properties: {
              serviceId: { type: "string" },
              name: { type: "string" },
              units: { type: "number" },
              amountEur: { type: "number" },
              unit: { type: "string", enum: ["one_time", "monthly", "hourly"] },
              terms: { type: "string", description: "Condiciones especiales aplicadas (ej: 'compromiso 12m')." }
            }
          }
        },
        justification: {
          type: "string",
          description: "Por qué este nuevo precio/condición — para el audit log."
        }
      },
      required: ["dealId", "newItems", "justification"],
      additionalProperties: false
    }
  },
  {
    name: "close_deal",
    description:
      "Cierra un deal como ganado o perdido. Si WON: opcionalmente crea factura/presupuesto en Holded con los items finales (draft_holded_invoice/draft_holded_quote separados — esta tool solo marca el estado). Si LOST: razon del perdido se guarda. Actualiza el Lead asociado si lo hay.",
    input_schema: {
      type: "object",
      properties: {
        dealId: { type: "string" },
        outcome: { type: "string", enum: ["won", "lost", "escalated"] },
        reason: { type: "string", description: "Si LOST/ESCALATED, por qué." }
      },
      required: ["dealId", "outcome"],
      additionalProperties: false
    }
  },
  {
    name: "meta_ads_list_ad_accounts",
    description:
      "Lista cuentas publicitarias de Meta (Facebook/Instagram Ads) accesibles con la conexión Meta del workspace. Útil para encontrar el adAccountId si todavía no está configurado.",
    input_schema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "meta_ads_resolve_ad_account_by_name",
    description:
      "Resuelve el Ad Account ID de un cliente a partir de un fragmento de su NOMBRE (ej: 'ESAEM' → act_1581277508683081). Busca entre todas las cuentas accesibles con el token y devuelve la mejor coincidencia + alternativas. ÚSALO cuando tengas que analizar/gestionar las campañas de un cliente que tiene su PROPIA cuenta publicitaria (separada de la cuenta de la agencia), sin tener que pedirle al user la URL del Ads Manager. Luego pasa el adAccountId resuelto a meta_ads_list_campaigns / top_performers / etc.",
    input_schema: {
      type: "object",
      properties: {
        nameFragment: { type: "string", description: "Parte del nombre del cliente/cuenta a buscar (ej: 'ESAEM', 'Esaem Nueva')." }
      },
      required: ["nameFragment"],
      additionalProperties: false
    }
  },
  {
    name: "meta_ads_list_campaigns",
    description:
      "Lista las campañas de Meta Ads. Filtra por status (ACTIVE, PAUSED, ARCHIVED). Devuelve id, name, objetivo, budget. Por defecto usa la cuenta del workspace; pasa adAccountId para analizar la cuenta de OTRO cliente (la suya propia).",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["ACTIVE", "PAUSED", "ARCHIVED"] },
        limit: { type: "number" },
        adAccountId: { type: "string", description: "Opcional. Ad Account a consultar (act_XXX, el id numérico, o una URL del Ads Manager con ?act=). Override del default del workspace." }
      },
      additionalProperties: false
    }
  },
  {
    name: "meta_ads_get_campaign_insights",
    description:
      "Performance de una campaña Meta en un rango: impressions, clicks, spend, CTR, CPC, CPM, reach, frequency, actions. datePreset='last_7d|last_30d|last_90d' o pasa since/until ISO YYYY-MM-DD.",
    input_schema: {
      type: "object",
      properties: {
        campaignId: { type: "string" },
        datePreset: { type: "string" },
        since: { type: "string" },
        until: { type: "string" },
        adAccountId: { type: "string", description: "Opcional. Override del Ad Account (act_XXX, id numérico o URL con ?act=)." }
      },
      required: ["campaignId"],
      additionalProperties: false
    }
  },
  {
    name: "meta_ads_top_performers",
    description:
      "Top campañas Meta por una métrica (spend, impressions, ctr, reach) en un rango. Útil para informes y análisis cross-campaña sin tener que pedir cada insights por separado. Pasa adAccountId para analizar la cuenta de otro cliente.",
    input_schema: {
      type: "object",
      properties: {
        metric: { type: "string", enum: ["spend", "impressions", "ctr", "reach"] },
        datePreset: { type: "string" },
        limit: { type: "number" },
        adAccountId: { type: "string", description: "Opcional. Override del Ad Account (act_XXX, id numérico o URL con ?act=)." }
      },
      additionalProperties: false
    }
  },
  {
    name: "meta_ads_download_leads",
    description:
      "Descarga los LEADS (personas que rellenaron formularios de Lead Ads) de una o varias campañas/adsets/ads/forms de Meta. Devuelve nombres, emails, teléfonos y cualquier campo del formulario. Filtra por rango de fechas. SI pasas `attachAs:'csv'` o `'xlsx'`, automáticamente adjunta el archivo a la task — esto es lo que el user normalmente quiere (\"genérame un Excel bonito con los leads\"). Si pasas `attachAs:'json'` o lo omites, devuelve los datos en el response y tú decides qué hacer.",
    input_schema: {
      type: "object",
      properties: {
        campaignId: { type: "string", description: "ID de la campaña (numérico). Bajan todos los leads de sus ads hijos." },
        adsetId: { type: "string", description: "ID del adset (numérico). Bajan los leads de sus ads hijos." },
        adId: { type: "string", description: "ID de un ad concreto (numérico)." },
        formId: { type: "string", description: "ID del lead form (numérico). Solo si conoces el form directamente." },
        since: { type: "string", description: "Fecha desde, formato YYYY-MM-DD. Inclusiva." },
        until: { type: "string", description: "Fecha hasta, formato YYYY-MM-DD. Inclusiva." },
        attachAs: {
          type: "string",
          enum: ["csv", "xlsx", "json"],
          description: "csv → adjunta .csv a la task. xlsx → adjunta .xlsx con cabeceras estiladas. json → devuelve los datos en el response sin adjuntar."
        },
        filename: { type: "string", description: "Nombre del archivo (sin extensión). Default: 'leads-meta-<source>-<fecha>'" },
        adAccountId: { type: "string", description: "Opcional. Override del Ad Account (act_XXX, id numérico o URL con ?act=) para clientes con cuenta propia." }
      },
      additionalProperties: false
    }
  },
  // ──────────────────────────────────────────────────────────────
  // META ADS — WRITE (creación/gestión de campañas Lead Ads)
  // Todas crean en PAUSED por defecto. Macro create_lead_campaign
  // es la que Sonia usará más a menudo en el día a día (un solo
  // call que monta campaign + adset + form + imagen + creative + ad).
  // ──────────────────────────────────────────────────────────────
  {
    name: "meta_ads_list_pages",
    description: "Lista las páginas de Facebook que el usuario del token puede usar para Lead Ads. Necesario antes de crear lead forms — cada form va asociado a una page. Devuelve [{id, name, category}].",
    input_schema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "meta_ads_list_lead_forms",
    description: "Lista los lead forms existentes en una page. Útil para reutilizar un form en lugar de crear uno nuevo, o para enseñarle al user qué formularios tiene activos.",
    input_schema: {
      type: "object",
      properties: {
        pageId: { type: "string", description: "ID numérico de la page (de meta_ads_list_pages)." },
        adAccountId: { type: "string", description: "Opcional. Override del Ad Account (act_XXX, id numérico o URL con ?act=)." }
      },
      required: ["pageId"],
      additionalProperties: false
    }
  },
  {
    name: "meta_ads_list_adsets",
    description:
      "Lista los adsets de una campaña. Necesario para descender campaign → adsets → ads cuando solo conoces el campaignId. Devuelve [{id, name, status, daily_budget, optimization_goal, destination_type, promoted_object, targeting}].",
    input_schema: {
      type: "object",
      properties: {
        campaignId: { type: "string", description: "ID de la campaña." },
        limit: { type: "number", description: "Default 50, max 200." },
        adAccountId: { type: "string", description: "Opcional. Override del Ad Account (act_XXX, id numérico o URL con ?act=)." }
      },
      required: ["campaignId"],
      additionalProperties: false
    }
  },
  {
    name: "meta_ads_list_ads",
    description:
      "Lista los ads (anuncios) dentro de una campaign o un adset. Imprescindible para hacer SWAP del creative de un ad existente: necesitas el adId.\n\n" +
      "Workflow típico 'regenerar imagen del anuncio sin re-crear nada':\n" +
      "1. meta_ads_list_ads({ campaignId }) → encuentra el adId del ad activo\n" +
      "2. generate_meta_ad_creative + meta_ads_upload_image → tienes image_hash nuevo\n" +
      "3. meta_ads_create_ad_creative con ese image_hash → tienes creativeId nuevo\n" +
      "4. meta_ads_update_ad({ adId, creativeId }) → swap, listo\n\n" +
      "Devuelve [{id, name, status, adset_id, campaign_id, creative}].",
    input_schema: {
      type: "object",
      properties: {
        campaignId: { type: "string", description: "ID de la campaña. Pasa este O adsetId." },
        adsetId: { type: "string", description: "ID del adset. Pasa este O campaignId." },
        limit: { type: "number", description: "Default 200." },
        adAccountId: { type: "string", description: "Opcional. Override del Ad Account (act_XXX, id numérico o URL con ?act=)." }
      },
      additionalProperties: false
    }
  },
  {
    name: "meta_ads_targeting_search",
    description: "Busca intereses, ubicaciones, etc. para construir el targeting de un adset. Type 'adinterest' (default) busca intereses; 'adgeolocation' busca regiones/ciudades; 'adlocale' idiomas. Devuelve [{id, name, type, audience_size}].",
    input_schema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Texto a buscar (ej: 'travel', 'fitness', 'Barcelona')." },
        type: { type: "string", enum: ["adinterest", "adgeolocation", "adlocale"], description: "Tipo de búsqueda." },
        limit: { type: "number" }
      },
      required: ["q"],
      additionalProperties: false
    }
  },
  {
    name: "meta_ads_create_custom_audience",
    description:
      "Crea una Custom Audience de ENGAGEMENT para REMARKETING real (Meta deprecó targeting.connections, así que el remarketing necesita esto). Fuentes: 'page' (interacción con la Página FB, pasa pageId), 'instagram' (perfil IG, pasa el ig business id), 'lead_form' (quien abrió el formulario, pasa leadFormId), 'video' (reproducciones, pasa videoId). Devuelve audienceId → úsalo en el targeting del adset de remarketing: targeting.custom_audiences=[{id}]. Para un remarketing potente, crea page + instagram y úsalas juntas.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        source: { type: "string", enum: ["page", "instagram", "lead_form", "video"] },
        sourceId: { type: "string", description: "pageId | ig business id | leadFormId | videoId según source." },
        retentionDays: { type: "number", description: "Ventana de retención en días (1-365, default 365)." }
      },
      required: ["name", "source", "sourceId"],
      additionalProperties: false
    }
  },
  {
    name: "meta_ads_create_lead_campaign",
    description: "MACRO TOOL — orquesta el flujo entero de crear una Lead Ads campaign en UNA SOLA LLAMADA: campaign + adset + lead form + subida de imagen + creative + ad. Todo queda en PAUSED para que el humano revise en Ads Manager antes de activar. Es la tool que usarás más a menudo cuando el user pida 'crea una campaña de leads en Meta para...'. \n\nFlujo completo:\n  1. Crea campaign (OUTCOME_LEADS, PAUSED)\n  2. Crea adset (LEAD_GENERATION, daily budget, targeting por países + edad)\n  3. Crea lead form con las questions custom\n  4. Sube la imagen del adjunto local (imageFileId, lo obtienes de list_task_files)\n  5. Crea creative con la imagen + link al form\n  6. Crea ad linked al adset + creative\n\nDevuelve todos los IDs creados + adsManagerUrl para que el user revise. Si algún paso falla, los anteriores quedan creados en PAUSED y se devuelve { ok: false, step: 'paso_donde_falló', error: 'mensaje' }.",
    input_schema: {
      type: "object",
      properties: {
        campaignName: { type: "string", description: "Nombre de la campaña (ej: 'RS Advocats - Lead Ads Despidos')." },
        pageId: { type: "string", description: "ID de la page (de meta_ads_list_pages)." },
        dailyBudgetEur: { type: "number", description: "Presupuesto diario en euros (ej: 15)." },
        countries: { type: "array", items: { type: "string" }, description: "Códigos ISO 2 letras: ['ES'], ['ES','PT','FR'], etc." },
        ageMin: { type: "number" },
        ageMax: { type: "number" },
        formName: { type: "string", description: "Nombre del lead form (visible al user en Page Setting)." },
        formQuestions: {
          type: "array",
          description: "Preguntas del formulario. Tipos estándar: FULL_NAME, EMAIL, PHONE_NUMBER, CITY, STATE, ZIP_CODE, COUNTRY, COMPANY_NAME, JOB_TITLE. Para preguntas custom: type='CUSTOM' + label + options (si es selección múltiple).",
          items: {
            type: "object",
            properties: {
              type: { type: "string", description: "Tipo del campo. 'EMAIL', 'PHONE_NUMBER', 'FULL_NAME', 'CUSTOM', etc." },
              key: { type: "string", description: "Identificador interno (snake_case)." },
              label: { type: "string", description: "Texto visible para el user (CUSTOM)." },
              options: {
                type: "array",
                description: "Opciones para selección múltiple (CUSTOM con tipo MULTIPLE_CHOICE).",
                items: {
                  type: "object",
                  properties: {
                    key: { type: "string" },
                    value: { type: "string" }
                  },
                  required: ["key", "value"],
                  additionalProperties: false
                }
              }
            },
            required: ["type"],
            additionalProperties: false
          }
        },
        privacyPolicyUrl: { type: "string", description: "URL a la política de privacidad del cliente (OBLIGATORIO por la GDPR)." },
        imageFileId: { type: "string", description: "ID del File local (adjunto a la task) con la creatividad. Usa list_task_files para encontrarlo." },
        adName: { type: "string", description: "Nombre del ad concreto." },
        primaryText: { type: "string", description: "Texto principal del anuncio (encima de la imagen). 1-2 frases con hook." },
        headline: { type: "string", description: "Headline corto (40 chars max, debajo de la imagen)." },
        description: { type: "string", description: "Descripción opcional." },
        callToAction: { type: "string", description: "CTA: LEARN_MORE, SIGN_UP, GET_QUOTE, CONTACT_US, GET_OFFER, BOOK_NOW. Default SIGN_UP para Lead Ads.", enum: ["LEARN_MORE", "SIGN_UP", "GET_QUOTE", "CONTACT_US", "GET_OFFER", "BOOK_NOW", "DOWNLOAD", "APPLY_NOW"] },
        followUpActionUrl: { type: "string", description: "URL opcional donde mandar al user tras enviar el form (gracias-page)." }
      },
      required: ["campaignName", "pageId", "dailyBudgetEur", "countries", "formName", "formQuestions", "privacyPolicyUrl", "imageFileId", "adName", "primaryText"],
      additionalProperties: false
    }
  },
  {
    name: "meta_ads_create_campaign",
    description: "Crea SOLO una campaign en PAUSED. Útil cuando quieres montar la campaign manualmente paso a paso (en vez de usar la macro). Objetivos comunes: OUTCOME_LEADS, OUTCOME_TRAFFIC, OUTCOME_SALES, OUTCOME_AWARENESS, OUTCOME_ENGAGEMENT, OUTCOME_APP_PROMOTION.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        objective: { type: "string", description: "Objetivo de la campaign." },
        dailyBudgetEur: { type: "number" },
        lifetimeBudgetEur: { type: "number", description: "Alternativo a dailyBudgetEur." },
        status: { type: "string", enum: ["PAUSED", "ACTIVE"] },
        forceCreate: { type: "boolean", description: "Crea una campaña nueva aunque esta task ya tenga una registrada (salta el dedupe). Útil si la anterior se borró o quieres un A/B." }
      },
      required: ["name", "objective"],
      additionalProperties: false
    }
  },
  {
    name: "meta_ads_create_adset",
    description:
      "Crea un adset dentro de una campaign existente. Targeting mínimo: { geo_locations: { countries: ['ES'] } }. Para Lead Ads, optimizationGoal='LEAD_GENERATION' + destinationType='ON_AD'.\n\n" +
      "CRÍTICO para Lead Ads: SIEMPRE pasar promotedObject={pageId:'<id de la page>'} — Meta lo exige y sin él la API devuelve 400. La page es la que recibe los leads.\n\n" +
      "Si la campaña está en CBO (budget en campaign), NO pases dailyBudgetEur aquí — el adset hereda el budget. Si pasas budget en adset cuando campaign también lo tiene, Meta devuelve subcode 1885737.",
    input_schema: {
      type: "object",
      properties: {
        campaignId: { type: "string" },
        name: { type: "string" },
        dailyBudgetEur: { type: "number", description: "OMITIR si la campaña usa CBO." },
        targeting: {
          type: "object",
          additionalProperties: true,
          description:
            "Objeto targeting de Meta. Mínimo: { geo_locations: { countries: ['ES'] } }. Para targeting profesional pasa también: age_min, age_max, interests: [{id, name}], behaviors: [{id, name}], publisher_platforms: ['facebook','instagram'], facebook_positions: ['feed','story','reels','marketplace'], instagram_positions: ['stream','story','reels','explore']. NUNCA incluyas 'audience_network' (calidad de lead inferior)."
        },
        optimizationGoal: {
          type: "string",
          description: "Default LEAD_GENERATION para Lead Ads. Otros: LINK_CLICKS, CONVERSIONS, REACH."
        },
        billingEvent: { type: "string", description: "Default IMPRESSIONS." },
        destinationType: {
          type: "string",
          description: "Para Lead Ads on-ad: 'ON_AD' (default). Otros: 'WEBSITE', 'APP'."
        },
        startTime: { type: "string", description: "ISO 8601." },
        endTime: { type: "string", description: "ISO 8601 opcional." },
        status: { type: "string", enum: ["PAUSED", "ACTIVE"] },
        promotedObject: {
          type: "object",
          description:
            "REQUERIDO para Lead Ads on-ad: { pageId } indica la Page que recibe leads. Para conversión web: { pixelId, customEventType }. Para app install: { applicationId }.",
          properties: {
            pageId: { type: "string" },
            applicationId: { type: "string" },
            customEventType: { type: "string" },
            customEventStr: { type: "string" },
            productSetId: { type: "string" },
            pixelId: { type: "string" }
          },
          additionalProperties: false
        },
        bidStrategy: {
          type: "string",
          enum: [
            "LOWEST_COST_WITHOUT_CAP",
            "LOWEST_COST_WITH_BID_CAP",
            "COST_CAP",
            "LOWEST_COST_WITH_MIN_ROAS"
          ],
          description: "Default LOWEST_COST_WITHOUT_CAP (no requiere bid_amount)."
        },
        bidAmountCents: {
          type: "number",
          description: "Solo si bidStrategy != LOWEST_COST_WITHOUT_CAP."
        },
        forceCreate: {
          type: "boolean",
          description:
            "Crea OTRO adset aunque esta task ya tenga uno registrado (salta el dedupe). ÚSALO cuando necesitas un SEGUNDO adset en la misma campaña (p.ej. el adset de REMARKETING además del de frío)."
        }
      },
      required: ["campaignId", "name", "targeting"],
      additionalProperties: false
    }
  },
  {
    name: "meta_ads_create_lead_form",
    description: "Crea un lead form en una page de Facebook. Necesario antes de poder lanzar un Lead Ad.",
    input_schema: {
      type: "object",
      properties: {
        pageId: { type: "string" },
        name: { type: "string" },
        questions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string" },
              key: { type: "string" },
              label: { type: "string" },
              options: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    key: { type: "string" },
                    value: { type: "string" }
                  },
                  required: ["key", "value"],
                  additionalProperties: false
                }
              }
            },
            required: ["type"],
            additionalProperties: false
          }
        },
        privacyPolicyUrl: { type: "string" },
        privacyPolicyLinkText: { type: "string" },
        followUpActionUrl: { type: "string" },
        locale: { type: "string" }
      },
      required: ["pageId", "name", "questions", "privacyPolicyUrl"],
      additionalProperties: false
    }
  },
  {
    name: "meta_ads_upload_image",
    description: "Sube una imagen a la ad account (la creatividad de un anuncio) y devuelve el image_hash para crear el creative. Acepta el fileId de un adjunto/archivo del formulario (el de los DATOS DEL FORMULARIO, formato 'nombre [fileId: XXX]') o una url directa. El servidor descarga la imagen de R2 por ti — NO necesitas internet ni descargarla tú. USA ESTO para las imágenes que el usuario subió, en vez de generar una nueva.",
    input_schema: {
      type: "object",
      properties: {
        fileId: { type: "string", description: "ID del File (de list_task_files o del campo de archivos del formulario)." },
        url: { type: "string", description: "Alternativa: URL de la imagen (p.ej. la del formulario). El servidor la descarga y la sube a Meta." }
      },
      additionalProperties: false
    }
  },
  {
    name: "meta_ads_upload_video",
    description:
      "Sube un VÍDEO a la ad account y devuelve el videoId (espera a que Meta lo procese). Acepta fileId (del campo de archivos del formulario, formato 'nombre [fileId: XXX]') o url. Úsalo para los vídeos que subió el usuario. Luego crea el anuncio con meta_ads_create_video_creative (necesita además una miniatura: sube una imagen con meta_ads_upload_image y pasa su image_hash).",
    input_schema: {
      type: "object",
      properties: {
        fileId: { type: "string", description: "ID del File del vídeo." },
        url: { type: "string", description: "Alternativa: URL del vídeo." }
      },
      additionalProperties: false
    }
  },
  {
    name: "meta_ads_create_carousel_creative",
    description:
      "Crea un creative de CARRUSEL para Lead Ads (2-10 tarjetas). Pasa los image_hashes (de meta_ads_upload_image, uno por imagen subida). Devuelve creativeId para meta_ads_create_ad. Úsalo cuando el usuario subió varias imágenes o un carrusel.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        pageId: { type: "string" },
        leadFormId: { type: "string" },
        imageHashes: { type: "array", items: { type: "string" }, description: "2-10 image_hash (de meta_ads_upload_image)." },
        primaryText: { type: "string", description: "Texto principal del anuncio." },
        cards: {
          type: "array",
          description: "Opcional: título/descr por tarjeta, en el mismo orden que imageHashes.",
          items: {
            type: "object",
            properties: { name: { type: "string" }, description: { type: "string" } },
            additionalProperties: false
          }
        },
        callToAction: { type: "string", description: "Default SIGN_UP. Otros: LEARN_MORE, GET_QUOTE, CONTACT_US…" },
        link: { type: "string", description: "URL https válida (privacidad/home del cliente)." }
      },
      required: ["name", "pageId", "leadFormId", "imageHashes", "primaryText"],
      additionalProperties: false
    }
  },
  {
    name: "meta_ads_create_video_creative",
    description:
      "Crea un creative de VÍDEO para Lead Ads. Requiere videoId (de meta_ads_upload_video) y thumbnailImageHash (sube una miniatura con meta_ads_upload_image). Devuelve creativeId para meta_ads_create_ad.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        pageId: { type: "string" },
        leadFormId: { type: "string" },
        videoId: { type: "string", description: "De meta_ads_upload_video." },
        thumbnailImageHash: { type: "string", description: "image_hash de la miniatura (de meta_ads_upload_image)." },
        primaryText: { type: "string" },
        headline: { type: "string" },
        description: { type: "string" },
        callToAction: { type: "string", description: "Default SIGN_UP." },
        link: { type: "string", description: "URL https válida." }
      },
      required: ["name", "pageId", "leadFormId", "videoId", "thumbnailImageHash", "primaryText"],
      additionalProperties: false
    }
  },
  {
    name: "meta_ads_create_ad_creative",
    description: "Crea un ad creative (la creatividad del anuncio) para Lead Ads: page + lead form + imagen + textos. Si no pasas `link`, se usa la URL de la página oficial del cliente como link válido (evita el error 2446433).",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        pageId: { type: "string" },
        leadFormId: { type: "string" },
        imageHash: { type: "string", description: "Del meta_ads_upload_image." },
        primaryText: { type: "string" },
        headline: { type: "string" },
        description: { type: "string" },
        callToAction: { type: "string", enum: ["LEARN_MORE", "SIGN_UP", "GET_QUOTE", "CONTACT_US", "GET_OFFER", "BOOK_NOW", "DOWNLOAD", "APPLY_NOW"] },
        link: { type: "string", description: "URL HTTPS (privacidad, home del cliente, etc.) que Meta exige aunque sea Lead Ads on-ad. Opcional — si no se pasa, se usa la URL de la página." }
      },
      required: ["name", "pageId", "leadFormId", "imageHash", "primaryText"],
      additionalProperties: false
    }
  },
  {
    name: "meta_ads_create_ad",
    description: "Crea un ad concreto (el último paso): adset + creative ya existentes. Status PAUSED por defecto.",
    input_schema: {
      type: "object",
      properties: {
        adsetId: { type: "string" },
        name: { type: "string" },
        creativeId: { type: "string" },
        status: { type: "string", enum: ["PAUSED", "ACTIVE"] }
      },
      required: ["adsetId", "name", "creativeId"],
      additionalProperties: false
    }
  },
  {
    name: "meta_ads_update_campaign",
    description:
      "Modifica una campaign existente. Casos de uso:\n" +
      "- pausar / reanudar (status: PAUSED | ACTIVE)\n" +
      "- cambiar nombre o presupuesto\n" +
      "- **LIMPIAR DUPLICADAS**: si tras varios intentos fallidos quedan N campañas duplicadas en la cuenta del cliente, NO digas 'no tengo tool de delete' — usa esta tool con status: 'DELETED' para cada duplicada. Meta no las borra físicamente (quedan archivadas en su histórico) pero desaparecen del Ads Manager. Es seguro y reversible.\n\n" +
      "Estados disponibles: ACTIVE | PAUSED | DELETED (soft-delete, recomendado para duplicadas) | ARCHIVED (mover al histórico sin borrar).",
    input_schema: {
      type: "object",
      properties: {
        campaignId: { type: "string" },
        name: { type: "string" },
        status: { type: "string", enum: ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"] },
        dailyBudgetEur: { type: "number" },
        lifetimeBudgetEur: { type: "number" }
      },
      required: ["campaignId"],
      additionalProperties: false
    }
  },
  {
    name: "meta_ads_launch_ab_test",
    description:
      "Lanza un experimento A/B con 2-5 creatividades distintas en la MISMA campaña. Crea un adset por variante (cada uno con su creative+ad) y los pone ACTIVE simultáneamente. A las 48h (configurable) un cron evalúa cuál tuvo mejor performance.\n\n" +
      "Caso de uso típico: David crea Lead Ads y pide 'prueba 3 hooks distintos'. En lugar de comprometerse con UNA creatividad, lanzas 3 con diferentes headlines/imágenes y dejas que el mercado decida.\n\n" +
      "FLOW antes de llamar esta tool:\n" +
      "  1. meta_ads_create_campaign (CBO recomendado para que el budget se reparta solo entre variantes ganadoras)\n" +
      "  2. Para cada variante: generate_meta_ad_creative + meta_ads_upload_image\n" +
      "  3. meta_ads_launch_ab_test con todas las variantes (cada una con su imageHash)\n\n" +
      "Devuelve { campaignId, variants: [{label, adsetId, creativeId, adId}], evalAt }.",
    input_schema: {
      type: "object",
      properties: {
        campaignId: { type: "string" },
        targeting: { type: "object", additionalProperties: true },
        pageId: { type: "string" },
        leadFormId: { type: "string" },
        optimizationGoal: { type: "string", description: "Default LEAD_GENERATION" },
        dailyBudgetEurPerVariant: {
          type: "number",
          description: "Solo si la campaña NO es CBO. Si la campaña tiene CBO, déjalo vacío y se reparte automáticamente."
        },
        variants: {
          type: "array",
          minItems: 2,
          maxItems: 5,
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              imageHash: { type: "string" },
              primaryText: { type: "string" },
              headline: { type: "string" },
              description: { type: "string" },
              callToAction: { type: "string" }
            },
            required: ["label", "imageHash", "primaryText"],
            additionalProperties: false
          }
        },
        evaluationHours: { type: "number", description: "Default 48." },
        evaluationStrategy: { type: "string", enum: ["cpl", "ctr", "cpc"], description: "Default cpl." }
      },
      required: ["campaignId", "targeting", "pageId", "leadFormId", "variants"],
      additionalProperties: false
    }
  },
  {
    name: "meta_ads_bulk_update_campaigns",
    description:
      "BATCH update de N campañas en paralelo (1 step en vez de N). Útil para:\n" +
      "- Limpiar 5 campañas duplicadas: { campaignIds: ['id1','id2','id3','id4','id5'], status: 'DELETED' }\n" +
      "- Pausar todas las de un cliente al final del mes\n" +
      "- Subir el presupuesto a varias a la vez tras buenos resultados\n\n" +
      "Devuelve [{campaignId, ok, error?}]. NO aborta si una falla — las demás se procesan. Mucho más eficiente que llamar meta_ads_update_campaign en serie.",
    input_schema: {
      type: "object",
      properties: {
        campaignIds: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 50
        },
        status: { type: "string", enum: ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"] },
        dailyBudgetEur: { type: "number" }
      },
      required: ["campaignIds"],
      additionalProperties: false
    }
  },
  {
    name: "meta_ads_update_adset",
    description: "Modifica un adset: status, nombre, presupuesto diario, targeting.",
    input_schema: {
      type: "object",
      properties: {
        adsetId: { type: "string" },
        name: { type: "string" },
        status: { type: "string", enum: ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"] },
        dailyBudgetEur: { type: "number" },
        targeting: { type: "object", additionalProperties: true }
      },
      required: ["adsetId"],
      additionalProperties: false
    }
  },
  {
    name: "meta_ads_update_ad",
    description:
      "Modifica un ad existente. Casos:\n" +
      "- status (PAUSED, ACTIVE, DELETED, ARCHIVED)\n" +
      "- name\n" +
      "- **creativeId**: SWAP de la creatividad del ad. Workflow para 'regenerar la imagen del anuncio' SIN re-crear toda la campaña:\n" +
      "  1. generate_meta_ad_creative (con QC automático) → tienes nueva imagen como adjunto del task\n" +
      "  2. meta_ads_upload_image con esa imagen → te da image_hash\n" +
      "  3. meta_ads_create_ad_creative con el image_hash + leadFormId + pageId + link → te da creative_id\n" +
      "  4. meta_ads_update_ad({ adId, creativeId }) ← SWAP — el ad ahora usa la imagen nueva, todo lo demás (form, targeting, budget) se mantiene\n" +
      "  5. (opcional) meta_ads_get_ad_preview para confirmar visualmente",
    input_schema: {
      type: "object",
      properties: {
        adId: { type: "string" },
        name: { type: "string" },
        status: { type: "string", enum: ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"] },
        creativeId: {
          type: "string",
          description: "id del nuevo creative (de meta_ads_create_ad_creative). Sustituye al actual."
        }
      },
      required: ["adId"],
      additionalProperties: false
    }
  },
  {
    name: "meta_ads_get_ad_preview",
    description: "Preview HTML de un ad — útil para mostrarle al user cómo se verá el anuncio antes de activarlo. Format default 'DESKTOP_FEED_STANDARD'. Otros: MOBILE_FEED_STANDARD, INSTAGRAM_STANDARD, INSTAGRAM_STORY.",
    input_schema: {
      type: "object",
      properties: {
        adId: { type: "string" },
        format: { type: "string" }
      },
      required: ["adId"],
      additionalProperties: false
    }
  },
  {
    name: "http_request",
    description:
      "Hace una llamada HTTP a CUALQUIER URL pública. Te permite total autonomía cuando no existe una tool específica para la API que necesitas. ÚSALA con cabeza:\n- Para APIs externas con auth (incluye Authorization header).\n- Para webhooks, IFTTT, Zapier, etc.\n- Para descargar contenido público (un PDF, un JSON, un HTML).\n\nNO la uses como sustituta cuando ya existe tool específica (meta_ads_*, google_ads_*, holded_*, etc) — esas son más fiables y validan tipos.\n\nLímites: timeout 30s, body request <2MB, body response <5MB (se trunca si es mayor). NO permite host=localhost ni IPs privadas (anti-SSRF). Tope 50 llamadas por run.\n\nResponse: { status, statusText, headers, body }. El body viene como texto (si no es UTF-8 válido, devuelve base64).",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL completa con protocolo (https:// recomendado)." },
        method: {
          type: "string",
          enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"],
          description: "Método HTTP. Default: GET."
        },
        headers: {
          type: "object",
          description: "Cabeceras como { 'Authorization': 'Bearer ...', 'Content-Type': 'application/json' }. Pasa el token como te lo dieron (sin re-encodear).",
          additionalProperties: { type: "string" }
        },
        body: { type: "string", description: "Cuerpo del request como string. Si es JSON, hazlo JSON.stringify tú antes." },
        timeoutMs: { type: "number", description: "Timeout en ms (1000-30000). Default 15000." }
      },
      required: ["url"],
      additionalProperties: false
    }
  },
  {
    name: "web_scrape_dynamic",
    description:
      "Scraping de sites con JavaScript pesado (SPAs, Instagram, Shopify, Notion públicas, etc) que http_request NO puede resolver. Renderiza la página en Chrome headless gestionado (Browserless.io) y devuelve el HTML final + opcionalmente screenshot PNG subido a R2.\n\nUsa cuando http_request te devuelve HTML casi vacío (signo claro de SPA). El coste es ~$0.005 por llamada — no abuses.\n\nCap: timeout max 60s, response HTML max 5MB (se trunca con marcador <!-- TRUNCATED -->).",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL pública con https://" },
        waitForSelector: {
          type: "string",
          description:
            "CSS selector que esperar antes de capturar HTML. Más fiable que esperar 'load' para SPAs. Ej: 'main article', '.product-card', '#feed'."
        },
        waitMs: {
          type: "number",
          description: "Tiempo extra después de load (0-10000ms). Default 1500."
        },
        screenshot: {
          type: "boolean",
          description: "Si true, captura PNG y sube a R2. Devuelve screenshotUrl firmada."
        },
        timeoutMs: { type: "number", description: "Timeout total (5000-60000). Default 30000." }
      },
      required: ["url"],
      additionalProperties: false
    }
  },
  {
    name: "analyze_image_deep",
    description:
      "Análisis profundo de UNA imagen con vision IA + schema estructurado. Devuelve JSON con: paleta hex exacta (3-8 colores), color dominante, objetos identificados con confianza, materiales visibles, dimensiones estimadas si hay referencias de escala, vibe/mood, sugerencias accionables, encaje con brandBrief, **textsFound (OCR — TODOS los textos visibles transcritos literalmente)** y **composition (layout: regla de tercios, centrado, full-bleed…)**.\n\nÚSALO para:\n- Anuncios publicitarios de referencia que pega el cliente → con textsFound extraes claim+CTA+USPs y los puedes replicar en generate_meta_ad_creative.\n- Fichas de producto (Reva muebles → dimensiones + materiales; Champiso setas → tipo + cocción).\n- Validar que una imagen encaja con la marca antes de publicar.\n- Extraer paleta exacta del catálogo del cliente para alimentar generate_brand_image.\n\nCoste ~\\$0.02 por análisis (vision Sonnet). Para análisis superficial usa view_attachment o get_task_context que ya leen imágenes adjuntas.",
    input_schema: {
      type: "object",
      properties: {
        imageUrl: {
          type: "string",
          description:
            "URL pública de la imagen. Firmada de R2 vale, o cualquier URL HTTPS accesible."
        },
        clientId: {
          type: "string",
          description: "Cliente. Si se pasa, enriquece análisis con brandBrief + industry."
        }
      },
      required: ["imageUrl"],
      additionalProperties: false
    }
  },
  {
    name: "create_xlsx_workbook",
    description:
      "Genera un EXCEL PROFESIONAL para entregar a cliente: cabeceras blancas sobre azul corporativo, filas alternadas (zebra), freeze pane, auto-filtros, anchuras automáticas, hoja Resumen con título grande. Trabajo digno de consultoría.\n\nCombina datos de dos fuentes (puedes usar ambas o solo una):\n  - fromAttachments: archivos .xlsx/.csv YA adjuntos a la task → cada uno se importa como hoja.\n  - sheets: hojas inline con rows como array de objetos (más natural que arrays de arrays). Auto-detecta columnas de los keys.\n\nPara cada hoja inline puedes pasar:\n  - title: título grande (font 16, color marca) que aparece encima de la tabla.\n  - subtitle: línea pequeña debajo del título.\n  - columnLabels: { 'snake_case_key': 'Label Bonito' } — renombra columnas en la cabecera. Si no se da, snake_case se convierte a 'Title Case' automáticamente y las siglas conocidas (ID, URL, GMB, IA, SEO, ROAS, CTR, CPC) quedan en mayúsculas.\n  - columnOrder: orden explícito de columnas.\n  - columnWidths: { key: number } anchura en chars (override del auto).\n\nUSO TÍPICO tras meta_ads_download_leads:\n  1. Download_leads 3 veces (por país) con attachAs='xlsx' o 'json' (en json los datos vuelven en el response y los puedes pasar a 'sheets' aquí).\n  2. create_xlsx_workbook({\n       filename: 'leads-MM-Travel-finde-15-17may',\n       theme: 'corporate',\n       sheets: [{\n         name: 'Resumen',\n         title: 'Leads Facebook Ads — M&M Travel',\n         subtitle: 'Periodo: viernes 15 – domingo 17 may 2026',\n         rows: [\n           { Campana: 'Colombia', Pais: '🇨🇴 Colombia', 'Total leads': 64, 'CPL est.': '0,57€' },\n           { Campana: 'Perú', Pais: '🇵🇪 Perú', 'Total leads': 28, 'CPL est.': '1,30€' },\n         ]\n       }],\n       fromAttachments: ['leads-colombia', 'leads-peru', 'leads-ecuador']\n     })\n  3. Se adjunta UN excel con 4 hojas (Resumen primero por defecto).\n\nThemes disponibles: 'corporate' (azul oscuro #1F4E79, default), 'minimal' (gris claro), 'dark' (slate). Puedes overridear el color principal con primaryColor: '#FF5722' por ejemplo.",
    input_schema: {
      type: "object",
      properties: {
        filename: { type: "string", description: "Nombre del archivo SIN extensión. Se añade .xlsx automáticamente." },
        theme: {
          type: "string",
          enum: ["corporate", "minimal", "dark"],
          description: "Tema visual. Default 'corporate' (azul oscuro)."
        },
        primaryColor: {
          type: "string",
          description: "Override del color principal del tema. Hex tipo '#1F4E79' o '#FF5722'. Cambia color de header bg y título."
        },
        fromAttachments: {
          type: "array",
          items: { type: "string" },
          description: "Nombres exactos (o prefijos únicos) de archivos ya adjuntos a la task que quieres incluir como hojas. Acepta .xlsx, .csv. Cada archivo → una hoja."
        },
        sheets: {
          type: "array",
          description: "Hojas con datos inline. Cada una se renderiza con estilos del theme.",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Nombre de la hoja (≤31 chars, sin /:*?[])." },
              title: { type: "string", description: "Título grande que aparece encima de la tabla (opcional)." },
              subtitle: { type: "string", description: "Subtítulo pequeño debajo del título (opcional)." },
              rows: {
                type: "array",
                description: "Filas como objetos. Los KEYs son nombres internos de columna; los labels visibles vienen de columnLabels o se pretty-formatean.",
                items: { type: "object", additionalProperties: true }
              },
              columnOrder: {
                type: "array",
                items: { type: "string" },
                description: "Orden explícito de las columnas. Si no, se infiere del primer row."
              },
              columnLabels: {
                type: "object",
                description: "Mapping snake_case → 'Label Bonito'. Override del pretty-format automático.",
                additionalProperties: { type: "string" }
              },
              columnWidths: {
                type: "object",
                description: "Mapping key → anchura en chars. Override del auto-width.",
                additionalProperties: { type: "number" }
              }
            },
            required: ["name", "rows"],
            additionalProperties: false
          }
        },
        summarySheetFirst: {
          type: "boolean",
          description: "Si es true (default), las sheets inline van ANTES de fromAttachments. Útil para que el Resumen sea la primera hoja al abrir."
        },
        description: {
          type: "string",
          description: "Texto opcional para el comentario que Sonia añade al adjuntar el archivo."
        },
        meta: {
          type: "object",
          description: "Propiedades del archivo (visible en File > Properties).",
          properties: {
            title: { type: "string" },
            subject: { type: "string" },
            company: { type: "string" }
          },
          additionalProperties: false
        }
      },
      required: ["filename"],
      additionalProperties: false
    }
  },
  {
    name: "google_ads_list_campaigns",
    description:
      "Campañas Google Ads del customerId configurado. Filtra por status (ENABLED, PAUSED, REMOVED). Devuelve id, name, type, budget en EUR, fechas.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["ENABLED", "PAUSED", "REMOVED"] },
        limit: { type: "number" }
      },
      additionalProperties: false
    }
  },
  {
    name: "google_ads_get_metrics",
    description:
      "Métricas de campañas Google Ads en un rango: impressions, clicks, cost en EUR, CTR, CPC, conversions, value de conversiones. Si pasas campaignId filtra a una sola; si lo omites, devuelve todas. datePreset='LAST_7_DAYS|LAST_30_DAYS|LAST_90_DAYS' o pasa since/until.",
    input_schema: {
      type: "object",
      properties: {
        campaignId: { type: "string" },
        datePreset: { type: "string" },
        since: { type: "string" },
        until: { type: "string" }
      },
      additionalProperties: false
    }
  },
  {
    name: "google_ads_create_budget",
    description:
      "Crea un Campaign Budget en Google Ads (prerequisito de crear campaña). Devuelve resourceName + budgetId. amountEurDaily es el presupuesto diario en euros. Se crea como non-shared.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nombre del budget (no visible al user final)." },
        amountEurDaily: { type: "number", description: "Presupuesto diario en EUR." },
        deliveryMethod: { type: "string", enum: ["STANDARD", "ACCELERATED"] }
      },
      required: ["name", "amountEurDaily"],
      additionalProperties: false
    }
  },
  {
    name: "google_ads_create_campaign",
    description:
      "Crea una campaña Google Ads. SIEMPRE en PAUSED por defecto (el humano valida antes de gastar). Necesita budgetResourceName previo (de google_ads_create_budget). channelType default 'SEARCH'.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        budgetResourceName: {
          type: "string",
          description: "Devuelto por google_ads_create_budget — formato customers/X/campaignBudgets/Y."
        },
        channelType: { type: "string", enum: ["SEARCH", "DISPLAY", "PERFORMANCE_MAX"] },
        status: { type: "string", enum: ["ENABLED", "PAUSED"] },
        startDate: { type: "string", description: "YYYY-MM-DD" },
        endDate: { type: "string", description: "YYYY-MM-DD" }
      },
      required: ["name", "budgetResourceName"],
      additionalProperties: false
    }
  },
  {
    name: "google_ads_update_campaign_status",
    description:
      "Cambia el status de una campaña Google Ads. Útil para pausar (PAUSED) campañas que rinden mal, o ENABLED tras validación del humano. REMOVED = borrado lógico.",
    input_schema: {
      type: "object",
      properties: {
        campaignId: { type: "string" },
        status: { type: "string", enum: ["ENABLED", "PAUSED", "REMOVED"] }
      },
      required: ["campaignId", "status"],
      additionalProperties: false
    }
  },
  {
    name: "google_ads_update_budget",
    description:
      "Modifica el presupuesto diario de un Campaign Budget existente. amountEurDaily en EUR.",
    input_schema: {
      type: "object",
      properties: {
        budgetId: { type: "string" },
        amountEurDaily: { type: "number" }
      },
      required: ["budgetId", "amountEurDaily"],
      additionalProperties: false
    }
  },
  {
    name: "google_ads_create_adgroup",
    description:
      "Crea un Ad Group dentro de una campaña Google Ads. cpcBidEur es el CPC máximo (€). status default PAUSED. type fijo SEARCH_STANDARD.",
    input_schema: {
      type: "object",
      properties: {
        campaignId: { type: "string" },
        name: { type: "string" },
        cpcBidEur: { type: "number" },
        status: { type: "string", enum: ["ENABLED", "PAUSED"] }
      },
      required: ["campaignId", "name"],
      additionalProperties: false
    }
  },
  {
    name: "google_ads_create_keywords",
    description:
      "Añade keywords a un Ad Group. Acepta hasta ~100 keywords por llamada. matchType: PHRASE (default), EXACT, BROAD.",
    input_schema: {
      type: "object",
      properties: {
        adGroupId: { type: "string" },
        keywords: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string" },
              matchType: { type: "string", enum: ["EXACT", "PHRASE", "BROAD"] }
            },
            required: ["text"],
            additionalProperties: false
          }
        }
      },
      required: ["adGroupId", "keywords"],
      additionalProperties: false
    }
  },
  {
    name: "google_ads_create_responsive_search_ad",
    description:
      "Crea un Responsive Search Ad en un Ad Group. headlines (3-15, max 30 chars c/u), descriptions (2-4, max 90 chars c/u). Se crea PAUSED. finalUrl es la landing.",
    input_schema: {
      type: "object",
      properties: {
        adGroupId: { type: "string" },
        finalUrl: { type: "string" },
        headlines: { type: "array", items: { type: "string" } },
        descriptions: { type: "array", items: { type: "string" } },
        path1: { type: "string", description: "Path opcional del display URL (≤15 chars)." },
        path2: { type: "string", description: "Path opcional del display URL (≤15 chars)." }
      },
      required: ["adGroupId", "finalUrl", "headlines", "descriptions"],
      additionalProperties: false
    }
  },
  {
    name: "ga4_get_report",
    description:
      "Reporte GA4 (Google Analytics 4). Devuelve métricas + dimensiones del propertyId configurado (Client.settings.ga4PropertyId o Workspace.settings.integrations.ga4.defaultPropertyId; puedes también pasar propertyId explícito). Métricas comunes: sessions, totalUsers, conversions, engagementRate, bounceRate, screenPageViews, eventCount. Dimensiones comunes: sessionSourceMedium, pagePath, country, deviceCategory, date. datePreset: 'last_7_days'|'last_30_days'|'last_90_days'.",
    input_schema: {
      type: "object",
      properties: {
        propertyId: { type: "string" },
        clientId: { type: "string", description: "Para autoresolver propertyId desde Client.settings.ga4PropertyId." },
        datePreset: { type: "string" },
        since: { type: "string", description: "YYYY-MM-DD" },
        until: { type: "string", description: "YYYY-MM-DD" },
        metrics: { type: "array", items: { type: "string" } },
        dimensions: { type: "array", items: { type: "string" } },
        limit: { type: "number" }
      },
      additionalProperties: false
    }
  },
  {
    name: "search_console_query",
    description:
      "Datos de Search Console (SEO orgánico). dimensions: ['query'|'page'|'country'|'device'|'date']. siteUrl es la propiedad como está en SC (ej. 'sc-domain:negociovivo.app' o 'https://negociovivo.app/'). Auto-resuelve desde Client.settings.gscSiteUrl si no se pasa. Devuelve clicks, impressions, ctr, position.",
    input_schema: {
      type: "object",
      properties: {
        siteUrl: { type: "string" },
        clientId: { type: "string" },
        since: { type: "string" },
        until: { type: "string" },
        datePreset: { type: "string", enum: ["last_7_days", "last_30_days", "last_90_days"] },
        dimensions: {
          type: "array",
          items: { type: "string", enum: ["query", "page", "country", "device", "date"] }
        },
        rowLimit: { type: "number" }
      },
      additionalProperties: false
    }
  },
  {
    name: "generate_monthly_client_report",
    description:
      "MACRO. Genera un informe XLSX completo combinando GA4 + Search Console + Meta Ads + Google Ads. El XLSX se adjunta automáticamente a la task actual y se publica un comentario con el resumen ejecutivo en markdown. Si alguna fuente falla, sigue con el resto (best-effort). Ideal para informes mensuales de cliente — una sola llamada y entrega todo.",
    input_schema: {
      type: "object",
      properties: {
        clientId: { type: "string", description: "Para resolver propertyId GA4 + siteUrl GSC del cliente." },
        clientName: { type: "string", description: "Solo para títulos y nombre del archivo." },
        datePreset: {
          type: "string",
          enum: ["last_7_days", "last_30_days", "last_90_days"],
          description: "Default last_30_days."
        },
        since: { type: "string" },
        until: { type: "string" },
        include: {
          type: "array",
          items: { type: "string", enum: ["ga4", "searchConsole", "metaAds", "googleAds"] }
        },
        primaryColor: { type: "string", description: "Hex color para el header del XLSX." }
      },
      additionalProperties: false
    }
  },
  {
    name: "gmb_list_accounts",
    description:
      "Lista las cuentas de Google Business Profile (Google My Business) accesibles. Cada agencia/admin suele tener UNA cuenta con varias ubicaciones dentro. Devuelve accountId, name, type, role. Necesario el primer uso para descubrir el accountId — luego lo guardas en Client.settings.gmb.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "gmb_list_locations",
    description:
      "Lista las ubicaciones (fichas de negocio) dentro de una cuenta GMB. Devuelve locationId, title, dirección, teléfono, web, categoría primaria. Usa esto para mapear cada Client del Hub a su locationId de GMB.",
    input_schema: {
      type: "object",
      properties: {
        accountId: { type: "string", description: "Devuelto por gmb_list_accounts." }
      },
      required: ["accountId"],
      additionalProperties: false
    }
  },
  {
    name: "gmb_list_reviews",
    description:
      "Lista reseñas de una ubicación GMB. Pasa clientId para auto-resolver accountId/locationId desde Client.settings.gmb, o pásalos explícitos. Devuelve: reviewName, reviewer, rating (1-5), comment, createTime, reply existente. orderBy: 'updateTime desc' (más recientes) por defecto. Limit pageSize.",
    input_schema: {
      type: "object",
      properties: {
        clientId: { type: "string" },
        accountId: { type: "string" },
        locationId: { type: "string" },
        pageSize: { type: "number", description: "Default 25, max 50." },
        orderBy: { type: "string", description: "'updateTime desc' | 'starRating' | 'starRating desc'" }
      },
      additionalProperties: false
    }
  },
  {
    name: "gmb_reply_to_review",
    description:
      "Responde (o actualiza la respuesta) a una reseña de GMB. CRÍTICO para gestión de reputación. Tono recomendado: agradecer reseñas positivas con empatía + invitar a volver; en negativas, NUNCA atacar al cliente — reconocer, ofrecer solución, mover offline. Max ~4000 chars. Si pasas reviewName completo lo usa; si no, construye desde accountId+locationId+reviewId. NO publiques nada sin haber consultado el brandBrief y tono del cliente — pídelo en read_client_memory si dudas.",
    input_schema: {
      type: "object",
      properties: {
        reviewName: {
          type: "string",
          description: "Formato completo 'accounts/X/locations/Y/reviews/Z'. Recomendado pasarlo directo de gmb_list_reviews."
        },
        accountId: { type: "string" },
        locationId: { type: "string" },
        clientId: { type: "string" },
        reviewId: { type: "string" },
        comment: { type: "string", description: "La respuesta. Max ~4000 chars. Texto plano, sin markdown." }
      },
      required: ["comment"],
      additionalProperties: false
    }
  },
  {
    name: "gmb_delete_review_reply",
    description:
      "Borra la respuesta a una reseña de GMB. Útil si publicaste algo equivocado y quieres rehacerlo (después puedes volver a llamar gmb_reply_to_review).",
    input_schema: {
      type: "object",
      properties: {
        reviewName: { type: "string" },
        accountId: { type: "string" },
        locationId: { type: "string" },
        clientId: { type: "string" },
        reviewId: { type: "string" }
      },
      additionalProperties: false
    }
  },
  {
    name: "gmb_create_post",
    description:
      "Publica un post en Google Business Profile. Tipos: STANDARD (post normal), EVENT (con fechas), OFFER (con cupón). CTAs típicas: BOOK, ORDER, SHOP, LEARN_MORE, SIGN_UP, CALL. summary visible ~300 chars (corta visualmente más allá). mediaUrl debe ser una URL pública accesible por Google (imagen del Drive/R2 firmada vale). Resultado: post visible en la ficha del negocio + en Maps. NO requiere aprobación del usuario al ser una publicación — pídela TÚ si el cliente es nuevo o si dudas del copy.",
    input_schema: {
      type: "object",
      properties: {
        clientId: { type: "string" },
        accountId: { type: "string" },
        locationId: { type: "string" },
        summary: { type: "string", description: "Cuerpo del post." },
        topicType: { type: "string", enum: ["STANDARD", "EVENT", "OFFER"] },
        callToAction: {
          type: "object",
          properties: {
            actionType: {
              type: "string",
              enum: ["BOOK", "ORDER", "SHOP", "LEARN_MORE", "SIGN_UP", "CALL"]
            },
            url: { type: "string" }
          },
          required: ["actionType"],
          additionalProperties: false
        },
        mediaUrl: { type: "string", description: "URL pública de la imagen." },
        eventTitle: { type: "string" },
        eventStartIso: { type: "string" },
        eventEndIso: { type: "string" },
        offerCouponCode: { type: "string" },
        offerRedeemUrl: { type: "string" },
        offerTerms: { type: "string" },
        languageCode: { type: "string", description: "'es' default." }
      },
      required: ["summary"],
      additionalProperties: false
    }
  },
  {
    name: "gmb_get_insights",
    description:
      "Métricas de rendimiento de una ficha GMB: impresiones en mapas/búsqueda (desktop y móvil), peticiones de direcciones, clics a llamar, clics a la web. Devuelve totales por métrica + serie diaria. Útil para informes mensuales locales (Reva, Champiso, etc.). Rango default últimos 30 días.",
    input_schema: {
      type: "object",
      properties: {
        clientId: { type: "string" },
        accountId: { type: "string" },
        locationId: { type: "string" },
        since: { type: "string", description: "YYYY-MM-DD" },
        until: { type: "string", description: "YYYY-MM-DD" },
        metrics: {
          type: "array",
          items: { type: "string" },
          description:
            "Subset opcional de métricas. Default: impresiones mapas+búsqueda (desktop+mobile), direction_requests, call_clicks, website_clicks."
        }
      },
      additionalProperties: false
    }
  },
  {
    name: "weekly_social_summary",
    description:
      "MACRO. Genera un resumen semanal de redes sociales para un cliente, combinando Metricool (instagram/facebook/tiktok/etc) + GMB insights + Meta Ads de los últimos 7 días. Devuelve el mensaje markdown listo para mandar al cliente. Modos de entrega: 'comment' (solo lo deja en la task), 'whatsapp' (manda al teléfono del cliente vía WAHA), 'email' (manda al email del cliente), 'all'. Best-effort: si una fuente falla, sigue con las demás y omite las que cayeron del resumen. Usa request_user_approval ANTES si el cliente es nuevo o si los datos parecen raros — un mensaje semanal incorrecto daña la relación.",
    input_schema: {
      type: "object",
      properties: {
        clientId: { type: "string" },
        networks: {
          type: "array",
          items: {
            type: "string",
            enum: ["instagram", "facebook", "tiktok", "linkedin", "twitter", "gmb"]
          },
          description: "Default: ['instagram','facebook','gmb']"
        },
        skipMetaAds: {
          type: "boolean",
          description: "true si el cliente no tiene campañas activas (evita la sección Meta Ads)."
        },
        delivery: {
          type: "string",
          enum: ["comment", "whatsapp", "email", "all"],
          description: "Default 'comment'."
        },
        emailSubject: {
          type: "string",
          description: "Solo aplica si delivery incluye email. Default 'Resumen semanal — {cliente}'."
        }
      },
      required: ["clientId"],
      additionalProperties: false
    }
  },
  {
    name: "auto_tag_task",
    description:
      "Analiza el contexto de la task actual y le aplica etiquetas inteligentes: 'urgente' (deadline <24h o lenguaje del user), 'requiere-cliente-final' (acción visible al cliente que necesita aprobación), 'creativo-pendiente' (falta diseño/imagen/copy), 'dato-faltante' (necesita info no disponible). Devuelve las tags aplicadas. SOLO usa cuando la task está sin tags y tiene contenido relevante — no spamees.",
    input_schema: {
      type: "object",
      properties: {
        tags: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "urgente",
              "requiere-cliente-final",
              "creativo-pendiente",
              "dato-faltante",
              "reseña-negativa",
              "campaña-activa",
              "informe-mensual",
              "seguimiento"
            ]
          },
          description: "Etiquetas a aplicar. Mínimo 1, máximo 3."
        }
      },
      required: ["tags"],
      additionalProperties: false
    }
  },
  {
    name: "gmb_unreplied_reviews_briefing",
    description:
      "Devuelve las reseñas SIN responder de un cliente, ya agrupadas por sentimiento (positivas 4-5★ / neutrales 3★ / negativas 1-2★) Y enriquecidas con el contexto del cliente (brandBrief, styleGuide cacheado, brand colors, contacto). Pensado para que Sonia procese las reseñas pendientes con un solo turno de contexto en lugar de hacer N llamadas. Después usas gmb_reply_to_review para responder cada una. RECUERDA: las negativas pídelas con request_user_approval antes de publicar.",
    input_schema: {
      type: "object",
      properties: {
        clientId: { type: "string" },
        accountId: { type: "string" },
        locationId: { type: "string" },
        maxReviews: {
          type: "number",
          description: "Tope de reseñas a procesar en una pasada. Default 15."
        }
      },
      additionalProperties: false
    }
  },
  {
    name: "generate_voice_audio",
    description:
      "Genera un audio MP3 con la voz de la marca (ElevenLabs) a partir de un texto. Útil para responder a notas de voz por WhatsApp con otra nota de voz natural, en lugar de texto. El audio se adjunta a la task actual; tú puedes usar su fileId en draft_whatsapp_voice (próxima fase) o el admin lo descarga y reenvía. Max 4000 chars del texto. Tono coloquial recomendado (estás 'hablando', no escribiendo).",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Lo que quieres que diga la voz." }
      },
      required: ["text"],
      additionalProperties: false
    }
  },
  {
    name: "metricool_list_brands",
    description:
      "Lista las marcas/cuentas configuradas en Metricool del workspace. Útil para encontrar el blogId antes de pedir estadísticas.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "metricool_get_stats",
    description:
      "Obtiene métricas de redes sociales desde Metricool (Instagram, Facebook, TikTok, LinkedIn, Twitter, GMB). Útil para informes de cliente, análisis de qué contenido funcionó, comparar períodos. Filtros: network, from, to. Si no pasas blogId usa el default del workspace.",
    input_schema: {
      type: "object",
      properties: {
        blogId: { type: "string", description: "ID de la marca en Metricool (de metricool_list_brands)." },
        network: {
          type: "string",
          enum: ["instagram", "facebook", "twitter", "linkedin", "tiktok", "gmb"]
        },
        from: { type: "string", description: "Fecha inicio (YYYY-MM-DD)." },
        to: { type: "string", description: "Fecha fin (YYYY-MM-DD)." }
      },
      additionalProperties: false
    }
  },
  {
    name: "make_list_teams",
    description:
      "Lista los equipos (teams) de tu organización Make. Necesario la primera vez para descubrir el teamId — luego se guarda como default y no hace falta volver a llamar. Devuelve [{id, name, organizationId}].",
    input_schema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "make_list_scenarios",
    description:
      "Lista los escenarios de Make en un team. Pagina TODOS los escenarios (hasta 2000) y aplica filtro por substring case-insensitive sobre name+description. Múltiples términos separados por espacios funcionan como AND (todos deben matchear). Acentos normalizados.\n\nEjemplos:\n- query: 'RS Advocats' → matchea nombres con 'RS' y 'Advocats'\n- query: 'rsadvocat renta' → matchea cualquier escenario que mencione ambos\n- query: 'advocat' → matchea 'rsadvocat', 'rs advocat', 'Advocát'…\n\nDevuelve [{id, name, isActive, folderId, description, teamId, scheduling}].",
    input_schema: {
      type: "object",
      properties: {
        teamId: { type: "number", description: "Opcional si hay default configurado." },
        query: { type: "string", description: "Substring(s) a filtrar. Múltiples palabras = AND. Acentos ignorados." },
        pageSize: { type: "number", description: "Límite del resultado tras filtrar. Default sin tope." }
      },
      additionalProperties: false
    }
  },
  {
    name: "make_get_blueprint",
    description:
      "Devuelve el BLUEPRINT JSON completo de un escenario (todos sus módulos y configuración). Lo necesitas antes de duplicar/modificar: lees el blueprint del origen, lo modificas (cambias formId del módulo Facebook Lead Ads, destinos del módulo Email, etc), y lo usas para crear el nuevo escenario con make_create_scenario. El blueprint puede ser grande (10-50KB) — sé eficiente leyendo.",
    input_schema: {
      type: "object",
      properties: {
        scenarioId: { type: "number" }
      },
      required: ["scenarioId"],
      additionalProperties: false
    }
  },
  {
    name: "make_create_scenario",
    description:
      "Crea un escenario Make nuevo a partir de un blueprint. Workflow típico de duplicación:\n1. make_list_scenarios({query: 'RS Advocats'}) → encuentras el origen\n2. make_get_blueprint({scenarioId: <origen>}) → recuperas el JSON completo\n3. Modificas el JSON cambiando los parámetros relevantes (formId del trigger Facebook Lead Ads, recipients de los módulos email, etc.) — el blueprint es JSON estructurado, los módulos vienen en blueprint.flow[]\n4. make_create_scenario({blueprint: <modificado>, name: '<cliente> - Lead Ads <fecha>'})\n5. make_activate_scenario({scenarioId: <nuevo>}) para que arranque\n\nIMPORTANTE: el escenario nuevo USA LAS MISMAS CONEXIONES (Facebook, Gmail, etc.) que el origen — heredadas vía blueprint. Si una conexión del origen no es válida, el nuevo también fallará. Sonia NO necesita re-autorizar conexiones.",
    input_schema: {
      type: "object",
      properties: {
        blueprint: { type: "object", description: "JSON completo del blueprint (modificado o no)." },
        name: { type: "string", description: "Nombre visible del nuevo escenario." },
        teamId: { type: "number", description: "Opcional si hay default." },
        folderId: { type: "number", description: "Carpeta destino opcional." },
        scheduling: {
          type: "object",
          description: "Default { type: 'immediately' } (corre al haber datos en el trigger)."
        }
      },
      required: ["blueprint"],
      additionalProperties: false
    }
  },
  {
    name: "make_activate_scenario",
    description:
      "Activa un escenario (lo pone en estado ACTIVO para que ejecute cuando haya datos). Inverso: make_deactivate_scenario.",
    input_schema: {
      type: "object",
      properties: { scenarioId: { type: "number" } },
      required: ["scenarioId"],
      additionalProperties: false
    }
  },
  {
    name: "make_deactivate_scenario",
    description:
      "Pausa un escenario. Útil si quieres detener un automatismo sin borrarlo.",
    input_schema: {
      type: "object",
      properties: { scenarioId: { type: "number" } },
      required: ["scenarioId"],
      additionalProperties: false
    }
  },
  {
    name: "make_raw_api",
    description:
      "ACCESO RAW a Make API v2 — usa esto cuando ninguna tool específica de Make te valga.\n\n" +
      "Casos típicos:\n" +
      "- **Crear webhook Facebook Lead Ads bindeado al form nuevo** (necesario para que un escenario clonado funcione end-to-end sin que el humano abra Make):\n" +
      "  1. GET /hooks?teamId=X → lista hooks existentes, encuentra uno con typeName='facebook-lead-ads' (te da el shape de connection/page/form)\n" +
      "  2. POST /hooks?teamId=X body: { name, typeName: 'facebook-lead-ads', __IMTCONN__: <connectionIdDelHookOriginal>, page: <pageId>, form: <formId> }\n" +
      "  3. GET /scenarios/<scenarioId>/blueprint → busca en el blueprint el __IMTHOOK__ del módulo Lead Ads\n" +
      "  4. Actualiza el blueprint sustituyendo el hook viejo por el nuevo, y haz POST /scenarios body: { teamId, blueprint, scheduling }\n" +
      "- Listar connections: GET /connections?teamId=X\n" +
      "- Obtener templates: GET /templates?teamId=X\n" +
      "- Cualquier endpoint nuevo que aparezca en la doc de Make.\n\n" +
      "El path es relativo a `/api/v2`. Devuelve { status, ok, data, responseText }. Si status>=400, lee `responseText` para entender el error. NO lanza excepción — siempre devuelve el response.\n\n" +
      "REGLAS:\n" +
      "1. Antes de POST/PATCH/DELETE: haz GET primero para entender el shape actual.\n" +
      "2. NO uses esta tool si existe una específica (make_list_scenarios, etc.) — usa la específica.\n" +
      "3. Para body, pasa un objeto JSON, NO un string.",
    input_schema: {
      type: "object",
      properties: {
        method: {
          type: "string",
          enum: ["GET", "POST", "PATCH", "PUT", "DELETE"]
        },
        path: {
          type: "string",
          description: "Path relativo a /api/v2 (ej '/hooks', '/scenarios/123/blueprint', '/connections')."
        },
        body: {
          type: "object",
          description: "OPCIONAL. Body JSON para POST/PATCH/PUT. Ignorado en GET/DELETE.",
          additionalProperties: true
        },
        query: {
          type: "object",
          description: "OPCIONAL. Query string params. Ej: { teamId: 123, typeName: 'facebook-lead-ads' }",
          additionalProperties: true
        }
      },
      required: ["method", "path"],
      additionalProperties: false
    }
  },
  {
    name: "holded_list_invoices",
    description:
      "Lista facturas del workspace en Holded. Filtros opcionales: status (0=pendiente, 1=pagada, 2=vencida, 3=cancelada, 4=borrador), limit. Útil para cashflow, recordatorios de pago, análisis de morosidad.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "number", description: "Filtro de status (0-4)." },
        limit: { type: "number", description: "Máximo a devolver (default 50, máx 100)." }
      },
      additionalProperties: false
    }
  },
  {
    name: "holded_list_contacts",
    description:
      "Lista contactos/clientes en Holded. Útil para encontrar el contactId de un cliente antes de crear factura/presupuesto, o para validar que un cliente está dado de alta en contabilidad.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Filtro por nombre/email/CIF." },
        limit: { type: "number", description: "Máximo (default 50)." }
      },
      additionalProperties: false
    }
  },
  {
    name: "holded_list_quotes",
    description:
      "Lista presupuestos (estimates) en Holded. Útil para seguimiento de propuestas comerciales no convertidas.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number" }
      },
      additionalProperties: false
    }
  },
  {
    name: "draft_holded_invoice",
    description:
      "Redacta un BORRADOR de factura en Holded para aprobación humana. Al aprobar, se crea como pendiente en Holded. Usa holded_list_contacts antes para obtener contactId del cliente. Para items: nombre, unidades, precio sin IVA, % IVA. Ej: { items: [{name:'Diseño web', units:1, subtotal:1500, tax:21}] }.",
    input_schema: {
      type: "object",
      properties: {
        contactId: { type: "string", description: "ID del contacto en Holded (de holded_list_contacts)." },
        contactName: { type: "string", description: "Si no tienes contactId, nombre del cliente (Holded lo creará)." },
        desc: { type: "string", description: "Descripción/concepto de la factura." },
        items: {
          type: "array",
          description: "Líneas de la factura.",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              units: { type: "number" },
              subtotal: { type: "number", description: "Precio unitario SIN IVA." },
              tax: { type: "number", description: "% IVA (21, 10, 4, 0)." }
            },
            required: ["name", "units", "subtotal"]
          }
        },
        notes: { type: "string", description: "Notas internas/cliente." }
      },
      required: ["items"],
      additionalProperties: false
    }
  },
  {
    name: "draft_holded_quote",
    description:
      "Como draft_holded_invoice pero crea PRESUPUESTO (estimate). Mismo shape de items. Útil para enviar al cliente antes de facturar.",
    input_schema: {
      type: "object",
      properties: {
        contactId: { type: "string" },
        contactName: { type: "string" },
        desc: { type: "string" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              units: { type: "number" },
              subtotal: { type: "number" },
              tax: { type: "number" }
            },
            required: ["name", "units", "subtotal"]
          }
        },
        notes: { type: "string" }
      },
      required: ["items"],
      additionalProperties: false
    }
  },
  {
    name: "stripe_list_customers",
    description:
      "Lista clientes en Stripe. Para validar suscripciones activas, encontrar customerId, etc.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" }
      },
      additionalProperties: false
    }
  },
  {
    name: "stripe_list_invoices",
    description:
      "Lista facturas Stripe. Filtros: customer (id), status (draft/open/paid/uncollectible/void), sinceDays. Útil para revisar suscripciones impagadas.",
    input_schema: {
      type: "object",
      properties: {
        customer: { type: "string" },
        status: { type: "string", enum: ["draft", "open", "paid", "uncollectible", "void"] },
        sinceDays: { type: "number" },
        limit: { type: "number" }
      },
      additionalProperties: false
    }
  },
  {
    name: "draft_stripe_payment_link",
    description:
      "Crea un BORRADOR de payment link de Stripe (URL única para cobrar). Tras aprobación se crea en Stripe y devuelve la URL para enviar al cliente. amount en CÉNTIMOS de euro (€10 = 1000).",
    input_schema: {
      type: "object",
      properties: {
        productName: { type: "string" },
        amount: { type: "number", description: "Importe en céntimos. €100 → 10000." },
        currency: { type: "string", description: "ISO 4217 minúsculas. Default 'eur'." }
      },
      required: ["productName", "amount"],
      additionalProperties: false
    }
  },
  {
    name: "start_client_workflow",
    description:
      "Arranca un workflow automático sobre un cliente — secuencia de pasos programados por días que Sonia ejecuta automáticamente. Tipos soportados: 'onboarding_7d' (cliente nuevo, 5 pasos en 7 días), 'onboarding_30d' (5 pasos en 30 días), 'renewal_30d' (4 pasos antes de renovación), 'churn_recovery_14d' (4 pasos para recuperar cliente en riesgo). Cada paso es una task nueva que Sonia procesa.",
    input_schema: {
      type: "object",
      properties: {
        clientId: { type: "string", description: "ID del cliente. Si lo omites, usa el de la tarea actual." },
        workflowType: {
          type: "string",
          enum: ["onboarding_7d", "onboarding_30d", "renewal_30d", "churn_recovery_14d"]
        }
      },
      required: ["workflowType"],
      additionalProperties: false
    }
  },
  {
    name: "generate_image",
    description:
      "Genera una imagen con IA (gpt-image-1 de OpenAI). Devuelve la imagen como adjunto de la tarea actual + URL. Útil para: visuales de posts editoriales, mockups, ilustraciones de propuestas, imágenes de relleno para Drive docs. Pasa prompt descriptivo en castellano o inglés. Tamaños: 'square' (1024x1024), 'portrait' (1024x1536), 'landscape' (1536x1024).",
    input_schema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Descripción detallada de la imagen. Max 4000 chars." },
        size: {
          type: "string",
          enum: ["square", "portrait", "landscape"],
          description: "Aspecto de la imagen. Default square."
        },
        purpose: {
          type: "string",
          description: "Para qué se usa (post, propuesta, mockup, etc) — solo para el filename."
        }
      },
      required: ["prompt"],
      additionalProperties: false
    }
  },
  {
    name: "query_knowledge_graph",
    description:
      "Búsqueda CRUZADA en el workspace que liga entidades. Útil para responder preguntas tipo 'muéstrame todas las decisiones de pricing con clientes del sector salud en 2025 y agrupa por las que funcionaron'. Hace varias búsquedas semánticas + agrupa por cliente/sector + filtra por fechas. Más caro que search_knowledge — usar solo para análisis cruzados.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Pregunta o tema en lenguaje natural." },
        clientFilter: {
          type: "string",
          description: "Nombre parcial de cliente para filtrar (opcional)."
        },
        industryFilter: {
          type: "string",
          description: "Sector/industria para filtrar (opcional)."
        },
        sinceDays: {
          type: "number",
          description: "Solo entidades de los últimos N días. Default 365."
        }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    name: "propose_new_tool",
    description:
      "Propone una NUEVA tool que no tienes hoy y que crees que necesitas para automatizar un patrón recurrente que has visto. El admin revisa tu propuesta y, si le parece útil, su equipo de desarrollo la implementa y la añade a tus capacidades. ÚSALO SOLO cuando detectas un patrón claro que se repite (no para cada idea — sé selectiva). Describe: qué hace, qué argumentos toma, qué APIs/recursos necesita, y POR QUÉ la pides (qué runs se beneficiarían). La tool NO se ejecuta automáticamente — queda en /admin/nv-ia/proposed-tools.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Nombre en snake_case (ej: 'send_invoice_reminder')."
        },
        description: {
          type: "string",
          description: "Para qué sirve, qué problema resuelve. 2-4 frases."
        },
        inputSchema: {
          type: "object",
          description: "JSON Schema de los argumentos esperados (similar a las tools actuales)."
        },
        executorPseudoCode: {
          type: "string",
          description: "Pseudocódigo o TypeScript describiendo qué debería hacer la tool (qué consulta a BD, qué API externa, qué transformación). Es para el dev humano que la implemente."
        },
        rationale: {
          type: "string",
          description: "Por qué la pides. Cita ejemplos concretos (runs/tareas donde te habría ayudado). 2-4 frases."
        }
      },
      required: ["name", "description", "inputSchema", "executorPseudoCode", "rationale"],
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
    name: "notify_user",
    description:
      "Manda una notificación PUSH directa a un miembro del workspace. Útil para alertarle de algo urgente que has dejado en una tarea (sin esperar a que vea el comentario). Pasa el userId de get_team_members. body corto (1-2 frases). link opcional al sitio relevante. NO abuses — usa solo para cosas que requieren acción rápida.",
    input_schema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "ID del user a notificar (de get_team_members)." },
        body: { type: "string", description: "Mensaje breve. Max 280 chars." },
        link: { type: "string", description: "URL relativa opcional (ej: '/tasks/abc123')." }
      },
      required: ["userId", "body"],
      additionalProperties: false
    }
  },
  {
    name: "tag_task",
    description:
      "Aplica una o varias etiquetas a la tarea actual. Si una etiqueta no existe en el workspace, la creas con un color por defecto. Útil para clasificar tareas (urgente, cliente-X, redes, web, fiscal...). REEMPLAZA las etiquetas existentes — pasa todas las que quieras dejar.",
    input_schema: {
      type: "object",
      properties: {
        tagNames: {
          type: "array",
          items: { type: "string" },
          description: "Nombres de tags. Si alguno no existe se crea. Max 10 tags."
        }
      },
      required: ["tagNames"],
      additionalProperties: false
    }
  },
  {
    name: "set_task_due_date",
    description:
      "Programa o cambia la fecha límite de la tarea actual. Pasa null para quitar el deadline. Usar cuando una tarea sin deadline lo necesita o un deadline cambia.",
    input_schema: {
      type: "object",
      properties: {
        dueDateIso: {
          type: "string",
          description: "Fecha en ISO 8601 (ej: '2026-06-15' o '2026-06-15T17:00:00Z'). Pasa 'null' como string para quitar."
        }
      },
      required: ["dueDateIso"],
      additionalProperties: false
    }
  },
  {
    name: "set_task_priority",
    description:
      "Cambia la prioridad de la tarea actual. Valores: LOW, MEDIUM, HIGH, URGENT. Úsalo cuando detectes que una tarea debería escalarse (ej: cliente VIP, deadline duro acercándose).",
    input_schema: {
      type: "object",
      properties: {
        priority: {
          type: "string",
          enum: ["LOW", "MEDIUM", "HIGH", "URGENT"]
        }
      },
      required: ["priority"],
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
  },
  // ────────────────────────────────────────────────────────────────
  // Adjuntar archivos a la tarea (entregables, informes, PDFs)
  // ────────────────────────────────────────────────────────────────
  {
    name: "attach_file_to_task",
    description:
      "Adjunta un archivo CUALQUIERA (PDF, DOCX, HTML, MD, TXT, CSV, JSON, imagen, etc.) directamente a la tarea actual. El archivo aparece en la lista de adjuntos del task como si lo hubiera subido el user, firmado por Sonia. Pasa el contenido en `contentText` (UTF-8 para texto plano) O en `contentBase64` (para binarios). Usa esta tool en vez de Google Doc cuando el user quiera el archivo COMO ADJUNTO de la tarea — más cómodo que ir a Drive.",
    input_schema: {
      type: "object",
      properties: {
        filename: {
          type: "string",
          description:
            "Nombre del archivo con extensión (ej: 'informe-meta-novaextranjeria-mayo.html', 'datos.csv', 'logo.png')."
        },
        mimeType: {
          type: "string",
          description:
            "Mime type del archivo. Ej: text/html, application/pdf, text/markdown, text/csv, application/json, image/png."
        },
        contentText: {
          type: "string",
          description:
            "Contenido en texto plano UTF-8 (para HTML, MD, TXT, CSV, JSON, etc.). Mutuamente excluyente con contentBase64."
        },
        contentBase64: {
          type: "string",
          description:
            "Contenido binario en base64 (para PDF, DOCX, imágenes). Mutuamente excluyente con contentText."
        },
        description: {
          type: "string",
          description:
            "Descripción opcional para el comentario que añade Sonia al adjuntar ('Aquí tienes el informe que pediste, abierto en navegador → Ctrl+P para PDF'). Si no la pasas, el comentario es escueto."
        }
      },
      required: ["filename", "mimeType"],
      additionalProperties: false
    }
  },
  {
    name: "attach_report_to_task",
    description:
      "ATAJO PROFESIONAL para entregar un INFORME. Pasas título + cuerpo en MARKDOWN; Sonia lo convierte a HTML estilizado (con headers, tablas, listas), lo envuelve en un documento A4 con cabecera/pie, y lo adjunta a la task como `.html`. El user puede abrirlo en navegador y hacer Ctrl+P → 'Guardar como PDF' para tenerlo en PDF. Más rápido y consistente que generar HTML manualmente. ÚSALA SIEMPRE para informes, propuestas y entregables formales.",
    input_schema: {
      type: "object",
      properties: {
        filename: {
          type: "string",
          description:
            "Nombre del archivo .html (ej: 'informe-meta-mayo-2026.html'). Termina en .html."
        },
        title: {
          type: "string",
          description: "Título del informe que aparece en la cabecera del documento."
        },
        subtitle: {
          type: "string",
          description:
            "Subtítulo opcional para la cabecera (ej: 'Cliente: Novaextranjería · Periodo: 30 días')."
        },
        markdown: {
          type: "string",
          description:
            "Cuerpo del informe en Markdown. Soporta # headers, listas, tablas pipe |col|col|, **bold**, *italic*, `code`, [links](url), ---. NO necesitas escribir HTML — Sonia lo genera por ti."
        },
        footer: {
          type: "string",
          description: "Pie de página opcional del documento."
        }
      },
      required: ["filename", "title", "markdown"],
      additionalProperties: false
    }
  },
  // ────────────────────────────────────────────────────────────────
  // Escalación a Claude Code (self-improvement)
  // ────────────────────────────────────────────────────────────────
  {
    name: "validate_credentials",
    description:
      "PRE-FLIGHT check de tokens/credenciales. Úsala AL INICIO del run si la task requiere integraciones externas (Meta Ads, Make, Holded, Stripe, GMB, etc.). Cada integración se valida con una llamada barata a su endpoint /me-equivalente. Devuelve { valid: [...], invalid: [...] } con detalle del fallo.\n\n" +
      "Si alguna sale invalid, ABORT EARLY: comenta al user qué token falta/caducó ANTES de empezar a hacer trabajo. Evita el escenario típico de hoy: gastas 14 pasos creando recursos, paso 15 falla por token expirado, todo el trabajo previo queda colgando.",
    input_schema: {
      type: "object",
      properties: {
        integrations: {
          type: "array",
          items: { type: "string" },
          description:
            "Lista de integraciones a validar. Opciones: 'meta_ads', 'make', 'openai', 'anthropic', 'holded', 'stripe', 'elevenlabs', 'gmb'. Si pasas array vacío, valida solo las que tienen credenciales configuradas en el workspace."
        }
      },
      additionalProperties: false
    }
  },
  {
    name: "escalate_to_claude",
    description:
      "Cuando te topas con una LIMITACIÓN TÉCNICA (falta tool para algo, API caduca/inalcanzable, formato no soportable, falta config en el workspace, comportamiento ambiguo en una integración) y NO PUEDES completar la tarea como el user quiere, llama a esta tool EN VEZ DE cerrar con mark_complete diciendo 'no puedo'. Esto: (1) marca el run como REQUIRES_HUMAN, (2) abre un issue en GitHub con el contexto entero y `@claude` mention, y (3) Claude Code analiza, hace fix de código, y re-dispara la task automáticamente. El user no tiene que hacer NADA — la limitación se convierte en mejora permanente del sistema. NO ABUSES: solo úsala para limitaciones REALES del sistema, no para tareas que requieren juicio humano (esas usan mark_complete con un summary claro pidiendo guidance).",
    input_schema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description:
            "Qué te impide completar la tarea, en 1-3 frases concretas. Ej: 'No tengo tool para adjuntar PDFs directos al task; solo puedo subir Google Docs a Drive.'"
        },
        blockingType: {
          type: "string",
          enum: ["missing_tool", "api_error", "missing_config", "ambiguous_request", "format_unsupported", "other"],
          description: "Categoría del bloqueo. Ayuda a Claude a saber dónde mirar en el código."
        },
        suggestedFix: {
          type: "string",
          description:
            "OPCIONAL pero MUY útil: tu propuesta de qué tool nueva / qué fix de código resolvería esto en el futuro. Ej: 'Añadir tool attach_pdf_to_task que use puppeteer para render HTML→PDF y suba a R2.'"
        },
        whatICompletedAnyway: {
          type: "string",
          description:
            "OPCIONAL: qué SÍ pudiste hacer pese a la limitación. Ej: 'He preparado el informe completo como Google Doc en Drive con el draft pending de aprobación'. Aparece en el comentario al user."
        }
      },
      required: ["reason", "blockingType"],
      additionalProperties: false
    }
  },
  {
    name: "request_user_approval",
    description:
      "Pide aprobación humana explícita ANTES de ejecutar una acción arriesgada (mandar email a cliente, publicar en WP, activar campaña, hacer transacción Stripe, etc.). Esto pausa el run y notifica al admin con la pregunta concreta. El admin contesta 'ok'/'no' como comentario en la task; cuando contesta, la task se relanza y tú lees la respuesta en los comentarios. USO TÍPICO: 'voy a mandar este email a cliente, ¿OK?' antes de send_email a un dominio externo; 'voy a activar la campaña con presupuesto 50€/día, ¿OK?' antes de un meta_ads_update_status. NO la uses para preguntas de aclaración menores — para esas usa mark_complete con una pregunta.",
    input_schema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description:
            "Pregunta concreta y accionable al admin. Ej: '¿Activo la campaña 6750... con presupuesto 50€/día? El creativo se ve bien pero el targeting es amplio.'"
        },
        actionSummary: {
          type: "string",
          description:
            "Resumen 1 línea de la acción que ejecutarás si aprueba. Para audit log."
        },
        riskLevel: {
          type: "string",
          enum: ["low", "medium", "high"],
          description:
            "low = email interno; medium = email externo a cliente; high = dinero, publicación pública, cambios irreversibles."
        }
      },
      required: ["question", "actionSummary", "riskLevel"],
      additionalProperties: false
    }
  },
  {
    name: "schedule_followup",
    description:
      "Crea una task futura para ti misma. Útil cuando una acción tiene que esperar (un lead que tiene que contestarte en 3 días, un cliente que pediste info hace tiempo, un seguimiento post-campaña). En la fecha programada, Sonia recibirá la task como cualquier otra y la procesará. NO sustituye al recordatorio del calendario — esto crea una task accionable en el Hub.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string", description: "Contexto que necesitarás tú misma en el futuro — sé generosa." },
        whenIso: {
          type: "string",
          description: "Fecha+hora ISO en la que reanudar. Ej: '2026-05-25T09:00:00Z'."
        },
        clientId: { type: "string", description: "Cliente al que aplica, opcional." }
      },
      required: ["title", "whenIso"],
      additionalProperties: false
    }
  },
  {
    name: "delegate_to_human",
    description:
      "Crea una task asignada a un user específico del equipo (no a Sonia). Útil cuando detectas que algo necesita juicio humano (revisar diseño, hablar por teléfono con cliente, decidir entre 2 ofertas). Distinto de escalate_to_claude: aquí no hay fallo de Sonia, simplemente una sub-tarea humana legítima. Distinto de request_user_approval: aquí desbloqueas y sigues con TU task; el humano hace lo suyo en paralelo.",
    input_schema: {
      type: "object",
      properties: {
        userIdOrEmail: {
          type: "string",
          description:
            "ID o email del user al que asignar. Si no estás segura del ID, pasa el email — buscamos por ambos."
        },
        title: { type: "string" },
        description: { type: "string" },
        dueDate: { type: "string", description: "ISO, opcional. Default 3 días desde ahora." },
        priority: { type: "string", enum: ["LOW", "NORMAL", "HIGH", "URGENT"] }
      },
      required: ["userIdOrEmail", "title"],
      additionalProperties: false
    }
  },
  // ──────────────────────────────────────────────────────────────
  // COMUNICACIONES: send (no draft) — para casos donde no necesitas
  // que el humano apruebe el draft antes (notificaciones rutinarias,
  // confirmaciones a leads, follow-ups con copy ya validado).
  //
  // CAVEAT: para mensajes COMERCIALES nuevos a un cliente o lead,
  // SIEMPRE prefiere draft_email / draft_whatsapp (que pasan por
  // aprobación humana). send_* es para casos rutinarios.
  // ──────────────────────────────────────────────────────────────
  {
    name: "send_email",
    description:
      "Envía un email REAL (no draft) inmediatamente vía Resend. Úsala SOLO para:\n- Notificaciones rutinarias al cliente (informe mensual, confirmación de descarga, alerta de KPI).\n- Follow-ups automáticos con copy ya validado.\n- Mensajes internos al equipo.\n\nNO la uses para: primer contacto comercial a un lead (eso es draft_email + aprobación), copy nuevo a un cliente importante.\n\nSi el copy es importante o nuevo, mejor draft_email — pasa por aprobación humana.",
    input_schema: {
      type: "object",
      properties: {
        to: {
          oneOf: [
            { type: "string" },
            { type: "array", items: { type: "string" } }
          ],
          description: "Email destinatario (o array si son varios)."
        },
        subject: { type: "string" },
        html: { type: "string", description: "Cuerpo en HTML. Si vas a entregar un informe, usa HTML con estilos inline para que se vea bien en cualquier cliente de email." },
        text: { type: "string", description: "Versión texto plano del email (opcional, recomendado para deliverability)." },
        attachFileId: { type: "string", description: "OPCIONAL: ID de un File del workspace (de list_task_files) para adjuntar al email." }
      },
      required: ["to", "subject", "html"],
      additionalProperties: false
    }
  },
  {
    name: "send_whatsapp_message",
    description:
      "Envía un mensaje de WhatsApp REAL (no draft) inmediatamente vía WAHA. Mismas reglas que send_email: úsala para mensajes rutinarios/confirmaciones, NO para primer contacto comercial.\n\nEl número debe estar normalizado (con código país, sin +). Si pasas '676383281' o '+34676383281' la tool intenta normalizar a '34676383281'.",
    input_schema: {
      type: "object",
      properties: {
        toPhone: { type: "string", description: "Teléfono del destinatario. Cualquier formato — se normaliza." },
        body: { type: "string", description: "Texto del mensaje. Soporta emoji y saltos de línea \\n." },
        defaultCountryCode: { type: "string", description: "Código país a asumir si toPhone viene sin él (default '34' para España)." }
      },
      required: ["toPhone", "body"],
      additionalProperties: false
    }
  },
  // ──────────────────────────────────────────────────────────────
  // HOLDED: facturación / presupuestos / contactos (write)
  // ──────────────────────────────────────────────────────────────
  {
    name: "holded_create_invoice",
    description:
      "Crea una factura en Holded para un contacto existente. Requiere conocer el contactId — usa holded_list_contacts antes si solo tienes el nombre del cliente.\n\nLa factura se crea EN BORRADOR (status=0). Un admin la revisa y envía manualmente desde Holded.",
    input_schema: {
      type: "object",
      properties: {
        contactId: { type: "string", description: "ID del contacto en Holded (de holded_list_contacts)." },
        contactName: { type: "string", description: "Nombre del contacto (denormalizado, requerido por la API)." },
        items: {
          type: "array",
          description: "Líneas de la factura.",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Concepto del servicio o producto." },
              units: { type: "number", description: "Cantidad (default 1)." },
              subtotal: { type: "number", description: "Precio unitario SIN IVA en euros." },
              taxes: { type: "array", items: { type: "number" }, description: "Array de tipos de IVA, ej [21]. Default [21]." }
            },
            required: ["name", "subtotal"],
            additionalProperties: false
          }
        },
        date: { type: "number", description: "Timestamp UNIX de la fecha de emisión (default: ahora)." },
        dueDate: { type: "number", description: "Timestamp UNIX del vencimiento (opcional)." },
        notes: { type: "string", description: "Notas internas o para el cliente." },
        currency: { type: "string", description: "Código ISO de moneda. Default 'eur'." }
      },
      required: ["contactId", "contactName", "items"],
      additionalProperties: false
    }
  },
  {
    name: "holded_create_quote",
    description: "Crea un presupuesto (quote) en Holded. Mismos campos que invoice pero el documento es un PRESUPUESTO no factura.",
    input_schema: {
      type: "object",
      properties: {
        contactId: { type: "string" },
        contactName: { type: "string" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              units: { type: "number" },
              subtotal: { type: "number" },
              taxes: { type: "array", items: { type: "number" } }
            },
            required: ["name", "subtotal"],
            additionalProperties: false
          }
        },
        date: { type: "number" },
        dueDate: { type: "number" },
        notes: { type: "string" },
        currency: { type: "string" }
      },
      required: ["contactId", "contactName", "items"],
      additionalProperties: false
    }
  },
  // ──────────────────────────────────────────────────────────────
  // STRIPE write (suscripciones, customers, refunds)
  // ──────────────────────────────────────────────────────────────
  {
    name: "stripe_create_customer",
    description: "Crea un customer en Stripe. Útil tras cerrar deal con un lead — el customer queda listo para cobrarle vía payment_link o subscription. Idempotente por email (Stripe NO dedupe automático, así que si pasas el mismo email puede crear duplicado — usa stripe_list_customers antes si dudas).",
    input_schema: {
      type: "object",
      properties: {
        email: { type: "string" },
        name: { type: "string" },
        phone: { type: "string" },
        metadata: { type: "object", additionalProperties: { type: "string" }, description: "Pares clave-valor para auditoría. Ej: { lead_id: '...', source: 'meta_ads' }." }
      },
      required: ["email"],
      additionalProperties: false
    }
  },
  {
    name: "stripe_create_subscription",
    description: "Crea una suscripción recurrente en Stripe para un customer existente + un price existente. El price hay que crearlo previamente en el dashboard de Stripe (define producto + €/mes o €/año). Devuelve la subscription en estado 'incomplete' — el cliente recibe la URL de checkout para completar el pago. Útil para SaaS o servicios mensuales fijos.",
    input_schema: {
      type: "object",
      properties: {
        customerId: { type: "string", description: "ID del customer (de stripe_list_customers o stripe_create_customer)." },
        priceId: { type: "string", description: "ID del price (de stripe_list_prices)." },
        trialDays: { type: "number", description: "Días de trial sin cobro (opcional)." },
        metadata: { type: "object", additionalProperties: { type: "string" } }
      },
      required: ["customerId", "priceId"],
      additionalProperties: false
    }
  },
  {
    name: "stripe_list_prices",
    description: "Lista los products + prices configurados en Stripe — para descubrir qué priceId pasar a create_subscription o create_payment_link.",
    input_schema: {
      type: "object",
      properties: {
        active: { type: "boolean", description: "Default true (solo activos)." },
        limit: { type: "number" }
      },
      additionalProperties: false
    }
  },
  {
    name: "stripe_refund_charge",
    description: "Devuelve un charge previo en Stripe. Pasa amountCents para refund parcial (ej. 1500 = 15€); omite para refund completo. NO la uses sin confirmación del user — es operación financiera irreversible.",
    input_schema: {
      type: "object",
      properties: {
        chargeId: { type: "string" },
        amountCents: { type: "number" },
        reason: { type: "string", enum: ["duplicate", "fraudulent", "requested_by_customer"] }
      },
      required: ["chargeId"],
      additionalProperties: false
    }
  },
  // ──────────────────────────────────────────────────────────────
  // WORDPRESS write
  // ──────────────────────────────────────────────────────────────
  {
    name: "wp_list_posts",
    description: "Lista los posts de WordPress del cliente (config en Client.settings.wordpress, fallback al workspace). Útil para conocer qué contenido existe antes de publicar.",
    input_schema: {
      type: "object",
      properties: {
        clientId: { type: "string", description: "Opcional. Si no se pasa usa la config del workspace." },
        status: { type: "string", enum: ["publish", "draft", "private", "future", "any"] },
        search: { type: "string" },
        limit: { type: "number" }
      },
      additionalProperties: false
    }
  },
  {
    name: "wp_list_categories",
    description: "Lista categorías de WordPress (para saber qué categoryId pasar a wp_create_post).",
    input_schema: {
      type: "object",
      properties: { clientId: { type: "string" } },
      additionalProperties: false
    }
  },
  {
    name: "wp_create_post",
    description: "Crea un post en WordPress. Por defecto en DRAFT (status='draft') — el admin revisa y publica. Pasa status='publish' SOLO con confirmación explícita del user.\n\nPara SEO incluye yoastMetaTitle + yoastMetaDescription (compatible Yoast SEO + Rank Math).\nPara feature image: pasa featuredMediaUrl con una URL pública (la sube automáticamente al Media Library) o featuredMediaId si ya está subida.\n\nEl contenido debe ser HTML válido (con <p>, <h2>, <ul>, etc). Si tienes Markdown, convierte antes.",
    input_schema: {
      type: "object",
      properties: {
        clientId: { type: "string" },
        title: { type: "string" },
        content: { type: "string", description: "HTML válido." },
        excerpt: { type: "string" },
        status: { type: "string", enum: ["publish", "draft", "private", "future"], description: "Default 'draft'." },
        slug: { type: "string" },
        categories: { type: "array", items: { type: "number" } },
        tags: { type: "array", items: { type: "number" } },
        featuredMediaUrl: { type: "string", description: "URL pública de la imagen destacada — se descarga e importa al Media Library del WP." },
        featuredMediaId: { type: "number", description: "Alternativa: ID de media ya subida." },
        yoastMetaTitle: { type: "string" },
        yoastMetaDescription: { type: "string" }
      },
      required: ["title", "content"],
      additionalProperties: false
    }
  },
  {
    name: "wp_update_post",
    description: "Modifica un post existente. Pasa solo los campos que cambian.",
    input_schema: {
      type: "object",
      properties: {
        clientId: { type: "string" },
        postId: { type: "number" },
        title: { type: "string" },
        content: { type: "string" },
        excerpt: { type: "string" },
        status: { type: "string", enum: ["publish", "draft", "private", "future"] },
        categories: { type: "array", items: { type: "number" } },
        tags: { type: "array", items: { type: "number" } }
      },
      required: ["postId"],
      additionalProperties: false
    }
  },
  // ──────────────────────────────────────────────────────────────
  // IMAGEN IA con BRAND del cliente
  // ──────────────────────────────────────────────────────────────
  {
    name: "generate_brand_image",
    description: "Genera una imagen con IA (OpenAI gpt-image-1) aplicando el BRAND del cliente: brandBrief + colores + styleGuideCached. La imagen se sube a R2 y se adjunta a la task automáticamente.\n\nUSO: para PUBLICACIONES de redes sociales (post Instagram, carousel, story orgánico). El texto se compone aparte vía overlay editorial.\n\nNO LA USES para anuncios pagados Meta Ads — para eso usa `generate_meta_ad_creative` que genera el anuncio TERMINADO con copy + value props + CTA renderizados.\n\nFormatos: 'square' (1024×1024, IG feed), 'story' (1024×1792, IG/FB story), 'landscape' (1792×1024, FB feed/web banner), 'portrait' (1024×1536, Pinterest).\n\nQuality: 'low' (~$0.01/img, draft), 'medium' (~$0.04, default), 'high' (~$0.12, entrega final).\n\nNUNCA pongas texto en el prompt — la IA escribe mal letras. El texto se compone separado después.",
    input_schema: {
      type: "object",
      properties: {
        clientId: { type: "string", description: "Cliente al que aplicar el brand. Si no se pasa, la imagen es genérica (sin colores/style guide aplicados)." },
        prompt: { type: "string", description: "Descripción visual de la imagen (sin pedir texto). 1-3 frases descriptivas." },
        format: { type: "string", enum: ["square", "story", "landscape", "portrait"], description: "Default 'square'." },
        quality: { type: "string", enum: ["low", "medium", "high"], description: "Default 'medium'." }
      },
      required: ["prompt"],
      additionalProperties: false
    }
  },
  {
    name: "generate_meta_ad_creative",
    description:
      "Genera una CREATIVIDAD PUBLICITARIA TERMINADA para Meta Ads (Lead Ads, Tráfico, Conversiones). A diferencia de generate_brand_image, este endpoint le pide directamente a gpt-image-1 que pinte el anuncio COMPLETO con:\n- Imagen hero potente (40-60% del frame)\n- Headline grande renderizado encima (en español, con tipografía tipo Inter/Montserrat)\n- Subheadline / value props con iconos en fila\n- CTA en píldora contrastada al pie\n- Paleta de marca consistente\n\nEs el mismo motor que la sección 'Campañas Redes IA' del Hub — calidad profesional tipo Freepik/Canva, NO foto stock plana.\n\nIMPORTANTE: para que el modelo renderice los textos correctos, pásalos explícitos en `copy`:\n- headline: el gancho grande, 4-7 palabras\n- primaryText: subtítulo / contexto, 1 frase\n- callToAction: texto del botón (ej. 'Reclama tu indemnización', 'Consulta gratis', 'Empieza ahora')\n- valueProps: 3 ítems cortos (ej. ['Estudio gratuito', 'Sin compromisos', 'Pago al ganar'])\n- brandName: nombre del cliente para el pie\n\nFormatos: 'square' (FB/IG feed 1:1), 'portrait' (Stories/Reels 4:5), 'landscape' (right column 16:9).\n\nEjemplo para anuncio de despachos legales tipo el RS Advocats que tienes como referencia:\n  prompt: 'Despacho de abogados laborales premium, escena fotográfica realista de persona con caja de despido o documento, oficina moderna iluminación cinematográfica'\n  copy: {\n    headline: '¿Te han despedido?',\n    primaryText: 'Reclamamos lo que te corresponde',\n    valueProps: ['Estudio gratuito', 'Abogados especialistas', 'Sin compromisos'],\n    callToAction: 'Consulta GRATIS',\n    brandName: 'RS Advocats'\n  }\n  styleHint: 'Lujoso, profesional, paleta dorado + negro, tipografía elegante serif/sans mezclada'\n\nCoste: ~$0.04 medium / ~$0.12 high. Tarda 30-90s.",
    input_schema: {
      type: "object",
      properties: {
        clientId: { type: "string", description: "Cliente. Si se pasa, el brand brief + colores + style guide del cliente enriquecen el prompt automáticamente." },
        prompt: { type: "string", description: "Descripción de la ESCENA fotográfica que debe pintar — SIN incluir los textos (los textos van en copy). 1-3 frases describiendo: sujeto, ambiente, mood, paleta deseada." },
        copy: {
          type: "object",
          description: "Textos que la IA renderizará EN el anuncio. Pásalos en español, con tildes correctas. La IA renderiza tal cual.",
          properties: {
            headline: { type: "string", description: "Titular grande, 3-7 palabras. Captador de atención." },
            primaryText: { type: "string", description: "Subtítulo, 1 frase 8-15 palabras." },
            callToAction: { type: "string", description: "Texto del botón CTA. Ej: 'Reclama ahora', 'Consulta gratis', 'Apúntate'." },
            valueProps: {
              type: "array",
              items: { type: "string" },
              description: "3 value props cortos (3-5 palabras c/u) que aparecerán en fila con iconos."
            },
            brandName: { type: "string", description: "Nombre del cliente, para pie pequeño." }
          },
          additionalProperties: false
        },
        format: { type: "string", enum: ["square", "portrait", "landscape"], description: "square=feed 1:1 (default), portrait=Reels/Stories 4:5, landscape=right column 16:9." },
        quality: { type: "string", enum: ["low", "medium", "high"], description: "Default medium. High para entregas finales (~3x más caro)." },
        styleHint: { type: "string", description: "Override del style del cliente. Ej: 'Lujoso premium dorado y negro', 'Minimalista pastel', 'Urbano vibrante años 90'. Si no se pasa, se infiere del brandBrief del cliente." }
      },
      required: ["prompt"],
      additionalProperties: false
    }
  },
  {
    name: "record_lesson",
    description:
      "MEMORIA PERSISTENTE: graba una lección aprendida que se cargará en runs FUTUROS similares. Úsala cuando descubras algo útil durante este run que no quieres olvidar la próxima vez. Las lecciones se inyectan automáticamente al system prompt de runs futuros que matcheen el scope y triggerPattern.\n\nFORMATO de la lección: instrucción CORTA y ACCIONABLE. Mal: 'En mayo de 2026 hicimos X y resultó Y'. Bien: 'Cuando el user pegue múltiples tokens Meta en comentarios, usa el ÚLTIMO no el primero'.\n\nNO abuses — graba SOLO lecciones que ahorrarán tiempo en runs futuros (errores resueltos, patrones del cliente, configs por defecto que el user prefiere, etc.). Lecciones triviales o muy específicas a UNA task ensucian la memoria.\n\nLas duplicadas se deduplican automáticamente. Idempotente.",
    input_schema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          description:
            "Cuándo aplicar esta lección. Opciones:\n" +
            "  'general'                       → siempre cargar (úsalo con cuidado)\n" +
            "  'task_type:meta_lead_campaign'  → tasks de crear campañas Lead Ads\n" +
            "  'task_type:download_leads'      → tasks de descargar leads\n" +
            "  'task_type:report'              → tasks de generar informes\n" +
            "  'task_type:google_ads'          → tasks de Google Ads\n" +
            "  'task_type:billing'             → tasks de Holded/facturas\n" +
            "  'task_type:outbound_comms'      → tasks de email/whatsapp marketing\n" +
            "  'task_type:seo'                 → tasks de SEO\n" +
            "  'tool:meta_ads'                 → cualquier uso de meta_ads_*\n" +
            "  'client:<clientId>'             → solo tasks de UN cliente concreto\n" +
            "  'error_pattern:<keyword>'       → cuando aparezca cierto error"
        },
        lesson: {
          type: "string",
          description: "El texto de la lección. Corto (≤ 200 chars idealmente), accionable, en castellano. 'Cuando X, haz Y porque Z'."
        },
        triggerPattern: {
          type: "string",
          description:
            "OPCIONAL. Regex o keyword que debe estar en el contexto de la task para activar la lección (case-insensitive). Si null, se aplica siempre que el scope matchee. Ej: 'session has expired', 'rs advocats', 'meta\\\\s*ads'."
        }
      },
      required: ["scope", "lesson"],
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
/**
 * Fase 18 — Auto-approve por cliente.
 * Tras crear un draft, comprueba si el cliente de la tarea tiene
 * autoApproveDraftKinds que incluya este kind. Si sí, aprueba y
 * ejecuta sincrónicamente. Devuelve info para que el executor del
 * tool añada el resultado al output.
 */
async function maybeAutoApproveDraft(
  draftId: string,
  kind: string,
  ctx: ToolContext
): Promise<{ autoApproved: boolean; executionResult?: any }> {
  try {
    const task = await prisma.task.findFirst({
      where: { id: ctx.taskId, workspaceId: ctx.workspaceId },
      select: { clientId: true }
    });
    if (!task?.clientId) return { autoApproved: false };
    const mem = await prisma.aiClientMemory.findUnique({
      where: { clientId: task.clientId },
      select: { autoApproveDraftKinds: true }
    });
    if (!mem || !mem.autoApproveDraftKinds.includes(kind)) {
      return { autoApproved: false };
    }
    // Hay regla auto-approve: marcamos APPROVED y ejecutamos.
    await prisma.aiDraft.update({
      where: { id: draftId },
      data: {
        status: "APPROVED",
        reviewedById: ctx.config.userId, // firma: Sonia misma como reviewer auto
        reviewedAt: new Date(),
        reviewerNote: "Auto-aprobado por regla del cliente"
      }
    });
    const { executeDraft } = await import("./execute-draft");
    const result = await executeDraft(draftId);
    return { autoApproved: true, executionResult: result };
  } catch (e: any) {
    console.warn("[nv-ia auto-approve] fail:", e?.message ?? e);
    return { autoApproved: false };
  }
}

// Compacta una reseña GMB para el briefing — quitamos campos que el
// modelo no necesita (createTime ya viene como string, etc.) y dejamos
// reviewName porque se necesita para gmb_reply_to_review.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripReviewForBriefing(r: {
  reviewName: string;
  reviewer: string;
  rating: number;
  comment: string | null;
  createTime: string;
}) {
  return {
    reviewName: r.reviewName,
    reviewer: r.reviewer,
    rating: r.rating,
    comment: r.comment,
    createTime: r.createTime
  };
}

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
    // Auto-inyección de las 3 capas de memoria. Ahorra tool calls
    // extra y garantiza que la IA SIEMPRE arranca con el contexto
    // histórico completo: políticas globales del workspace, info
    // del miembro que pide la tarea (si es manual/mention), y
    // todo lo acumulado del cliente (decisiones, rechazos, etc).
    const [wsMemory, clientMemory] = await Promise.all([
      readWorkspaceMemory(ctx.workspaceId),
      task.clientId ? readClientMemory(ctx.workspaceId, task.clientId) : Promise.resolve("")
    ]);
    // Memoria del requester (quien enlazó la task): la sacamos del
    // AiAgentRun de este run.
    let requesterMemory: string | null = null;
    let requesterId: string | null = null;
    try {
      const thisRun = await prisma.aiAgentRun.findUnique({
        where: { id: ctx.runId },
        select: { requesterId: true }
      });
      requesterId = thisRun?.requesterId ?? null;
      if (requesterId) {
        const m = await readUserMemory(ctx.workspaceId, requesterId);
        if (m) requesterMemory = m;
      }
    } catch {}
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
        assignees: task.assignees.map((a: any) => a.user),
        // Valores de los campos de la plantilla rellenados al crear la tarea
        // (URL de ad account, web, presupuesto, emails, imágenes adjuntas en
        // campos "file" como [{name,url}], etc.). Sin esto Sonia no recibía
        // los datos del formulario y los pedía aunque estuvieran rellenos.
        customData: (task as any).customData ?? null
      },
      comments: comments.map((c) => ({
        id: c.id,
        author: c.author?.name ?? c.author?.email ?? "?",
        createdAt: c.createdAt,
        body: c.body
      })),
      workspaceMemory: wsMemory || null,
      requesterId,
      requesterMemory,
      clientMemory: clientMemory || null
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
    const auto = await maybeAutoApproveDraft(draft.id, "EMAIL", ctx);
    return {
      ok: true,
      draftId: draft.id,
      autoApproved: auto.autoApproved,
      executionResult: auto.executionResult,
      message: auto.autoApproved
        ? "Borrador de email creado y AUTO-ENVIADO (regla del cliente). " + (auto.executionResult?.ok ? "Entregado correctamente." : `Error al enviar: ${auto.executionResult?.error}`)
        : "Borrador de email creado. Quedará pendiente hasta que un admin lo apruebe en /admin/nv-ia/drafts."
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
    const auto = await maybeAutoApproveDraft(draft.id, "WHATSAPP", ctx);
    return {
      ok: true,
      draftId: draft.id,
      autoApproved: auto.autoApproved,
      executionResult: auto.executionResult,
      message: auto.autoApproved
        ? "Borrador de WhatsApp creado y AUTO-ENVIADO (regla del cliente)."
        : "Borrador de WhatsApp creado. Quedará pendiente hasta que un admin lo apruebe."
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
    const auto = await maybeAutoApproveDraft(draft.id, "EDITORIAL_POST", ctx);
    return {
      ok: true,
      draftId: draft.id,
      autoApproved: auto.autoApproved,
      message: auto.autoApproved
        ? "Borrador de post creado y AUTO-PROGRAMADO en /editorial como DRAFT."
        : "Borrador de post editorial creado. Quedará pendiente hasta que un admin lo apruebe."
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
    const auto = await maybeAutoApproveDraft(draft.id, "CALENDAR_EVENT", ctx);
    return {
      ok: true,
      draftId: draft.id,
      autoApproved: auto.autoApproved,
      message: auto.autoApproved
        ? "Borrador de evento creado y AUTO-AÑADIDO al calendario."
        : "Borrador de evento creado. Quedará pendiente hasta que un admin lo apruebe."
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

  async get_workspace_memory(_input, ctx) {
    const content = await readWorkspaceMemory(ctx.workspaceId);
    return { hasMemory: content.length > 0, content };
  },

  async update_workspace_memory(input, ctx) {
    const note = String(input?.note ?? "").trim();
    if (!note) return { error: "note vacío" };
    const type = ["observation", "preference", "decision", "rejected_draft", "restriction"].includes(input?.type)
      ? input.type
      : "observation";
    const r = await appendWorkspaceMemoryNote({
      workspaceId: ctx.workspaceId,
      note,
      type,
      by: "nv-ia"
    });
    if (!r.ok) return { error: r.error };
    return { ok: true, size: r.size };
  },

  async get_user_memory(input, ctx) {
    const userId = String(input?.userId ?? "").trim();
    if (!userId) return { error: "userId vacío" };
    const content = await readUserMemory(ctx.workspaceId, userId);
    return { hasMemory: content.length > 0, content, userId };
  },

  async update_user_memory(input, ctx) {
    const userId = String(input?.userId ?? "").trim();
    const note = String(input?.note ?? "").trim();
    if (!userId || !note) return { error: "userId y note son obligatorios" };
    const type = ["observation", "preference", "decision", "rejected_draft", "restriction"].includes(input?.type)
      ? input.type
      : "observation";
    const r = await appendUserMemoryNote({
      workspaceId: ctx.workspaceId,
      userId,
      note,
      type,
      by: "nv-ia"
    });
    if (!r.ok) return { error: r.error };
    return { ok: true, size: r.size };
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
        .filter((m) => m.userId !== ctx.config.userId) // excluir Sonia misma
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
          body: `Sonia te ha asignado una tarea`,
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
          body: `Sonia te ha asignado una subtarea: "${title.slice(0, 60)}"`,
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
    const auto = await maybeAutoApproveDraft(draft.id, "DRIVE_FILE", ctx);
    return {
      ok: true,
      draftId: draft.id,
      autoApproved: auto.autoApproved,
      message: auto.autoApproved
        ? "Borrador de archivo creado y AUTO-SUBIDO a Drive del workspace."
        : "Borrador de archivo de Drive creado. Al aprobar se subirá a la carpeta del workspace."
    };
  },

  async draft_gmb_post(input, ctx) {
    const type = String(input?.type ?? "").trim();
    const body = String(input?.body ?? "").trim();
    if (!["standard", "event", "offer"].includes(type)) {
      return { error: "type debe ser standard | event | offer" };
    }
    if (!body) return { error: "body vacío" };
    if (body.length > 1500) return { error: "body demasiado largo (>1500 chars)" };
    const clientId = input?.clientId ? String(input.clientId) : null;
    if (clientId) {
      const c = await prisma.client.findFirst({
        where: { id: clientId, workspaceId: ctx.workspaceId }
      });
      if (!c) return { error: "clientId no encontrado en el workspace" };
    }
    const title = String(input?.title ?? "").slice(0, 100);
    const draft = await prisma.aiDraft.create({
      data: {
        workspaceId: ctx.workspaceId,
        aiAgentRunId: ctx.runId,
        taskId: ctx.taskId,
        kind: "CUSTOM",
        title: `GMB ${type}: ${title || body.slice(0, 60)}`,
        payload: {
          // Marcamos subtype para distinguir de otros CUSTOM en UI.
          subtype: "gmb_post",
          gmbType: type,
          title,
          body,
          callToAction: input?.callToAction ? String(input.callToAction) : null,
          ctaUrl: input?.ctaUrl ? String(input.ctaUrl) : null,
          eventStart: input?.eventStart ? String(input.eventStart) : null,
          eventEnd: input?.eventEnd ? String(input.eventEnd) : null,
          clientId
        }
      }
    });
    return {
      ok: true,
      draftId: draft.id,
      message:
        "Borrador de post GMB creado. La integración con Google Business Profile aún no está activa, así que el admin lo copiará a GMB manualmente tras aprobar. Cuando se construya la integración, este draft se auto-publicará al aprobar."
    };
  },

  async get_pricing_rules(_input, ctx) {
    const services = await prisma.pricingService.findMany({
      where: { workspaceId: ctx.workspaceId, active: true },
      orderBy: { name: "asc" }
    });
    if (services.length === 0) {
      return {
        count: 0,
        message:
          "Sin reglas de pricing configuradas. El admin debe crearlas en /admin/nv-ia/pricing antes de que puedas negociar. Bloquea negociación con add_comment explicando."
      };
    }
    return {
      count: services.length,
      services: services.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        baseAmountEur: s.baseAmountEur,
        minAmountEur: s.minAmountEur,
        unit: s.unit,
        tradeoffs: s.tradeoffs
      }))
    };
  },

  async create_deal(input, ctx) {
    const items = Array.isArray(input?.items) ? input.items : [];
    if (items.length === 0) return { error: "items vacío" };
    // Valida cada item contra PricingService si trae serviceId
    for (const it of items) {
      if (it.serviceId) {
        const svc = await prisma.pricingService.findFirst({
          where: { id: it.serviceId, workspaceId: ctx.workspaceId }
        });
        if (!svc) return { error: `serviceId ${it.serviceId} no existe` };
        if (Number(it.amountEur) < svc.minAmountEur) {
          return {
            error: `precio ${it.amountEur}€ < minAmountEur ${svc.minAmountEur}€ del servicio ${svc.name}. Sube el precio o escala con close_deal(outcome=escalated).`
          };
        }
      }
    }
    const currentValueEur = items.reduce(
      (sum: number, it: any) => sum + Number(it.amountEur) * Number(it.units || 1),
      0
    );
    const deal = await prisma.deal.create({
      data: {
        workspaceId: ctx.workspaceId,
        leadId: input?.leadId ? String(input.leadId) : null,
        clientId: input?.clientId ? String(input.clientId) : null,
        contactName: input?.contactName ? String(input.contactName) : null,
        contactEmail: input?.contactEmail ? String(input.contactEmail) : null,
        contactPhone: input?.contactPhone ? String(input.contactPhone) : null,
        status: "PROSPECT",
        proposedItems: items as any,
        currentValueEur,
        notes: input?.notes ? String(input.notes) : null,
        negotiationLog: [
          {
            ts: new Date().toISOString(),
            actor: "nv-ia",
            action: "created",
            snapshot: { items, value: currentValueEur }
          }
        ] as any
      }
    });
    return { ok: true, dealId: deal.id, currentValueEur };
  },

  async propose_deal_to_lead(input, ctx) {
    const dealId = String(input?.dealId ?? "").trim();
    if (!dealId) return { error: "dealId vacío" };
    const channel = String(input?.channel ?? "").trim();
    if (!["email", "whatsapp"].includes(channel)) return { error: "channel debe ser email | whatsapp" };
    const deal = await prisma.deal.findFirst({
      where: { id: dealId, workspaceId: ctx.workspaceId }
    });
    if (!deal) return { error: "deal no encontrado" };

    const items = (deal.proposedItems as any[]) ?? [];
    const itemsText = items
      .map(
        (it: any) =>
          `· ${it.name}: ${it.units} × ${Number(it.amountEur).toFixed(2)}€${it.unit === "monthly" ? "/mes" : ""}${it.terms ? ` (${it.terms})` : ""}`
      )
      .join("\n");
    const total = items.reduce(
      (s: number, it: any) => s + Number(it.amountEur) * Number(it.units || 1),
      0
    );
    const cover = String(input?.coverMessage ?? "Te paso la propuesta:");

    // Creamos draft (email o whatsapp) con la propuesta formateada.
    // Marcamos el deal como PROPOSED.
    const body =
      `${cover}\n\nPropuesta:\n${itemsText}\n\nTotal: ${total.toFixed(2)}€ (sin IVA).\n\n` +
      `¿Te parece bien o quieres que ajustemos algo?`;
    let draftKind: string;
    let draftPayload: any;
    if (channel === "email") {
      const to = deal.contactEmail;
      if (!to) return { error: "Deal sin contactEmail — usa channel=whatsapp o añade email primero" };
      draftKind = "EMAIL";
      const html = body
        .split("\n\n")
        .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
        .join("");
      draftPayload = {
        to,
        subject: `Propuesta — ${items.length} servicio${items.length === 1 ? "" : "s"}`,
        html,
        text: body
      };
    } else {
      const { normalizePhone } = await import("@/lib/leads/waha");
      const phone = normalizePhone(deal.contactPhone ?? "");
      if (!phone) return { error: "Deal sin teléfono normalizable — usa channel=email" };
      draftKind = "WHATSAPP";
      draftPayload = { phoneNormalized: phone, text: body };
    }
    const draft = await prisma.aiDraft.create({
      data: {
        workspaceId: ctx.workspaceId,
        aiAgentRunId: ctx.runId,
        taskId: ctx.taskId,
        kind: draftKind as any,
        title: `Propuesta deal ${dealId.slice(0, 8)} → ${deal.contactName ?? deal.contactEmail ?? deal.contactPhone}`,
        payload: draftPayload
      }
    });
    await prisma.deal.update({
      where: { id: dealId },
      data: {
        status: "PROPOSED",
        negotiationLog: {
          push: {
            ts: new Date().toISOString(),
            actor: "nv-ia",
            action: "proposed",
            snapshot: { channel, draftId: draft.id }
          }
        } as any
      }
    });
    return { ok: true, draftId: draft.id, dealStatus: "PROPOSED" };
  },

  async counter_offer(input, ctx) {
    const dealId = String(input?.dealId ?? "").trim();
    const newItems = Array.isArray(input?.newItems) ? input.newItems : [];
    const justification = String(input?.justification ?? "").trim();
    if (!dealId || newItems.length === 0 || !justification) {
      return { error: "dealId, newItems y justification obligatorios" };
    }
    const deal = await prisma.deal.findFirst({
      where: { id: dealId, workspaceId: ctx.workspaceId }
    });
    if (!deal) return { error: "deal no encontrado" };

    // Validación rango — cada item con serviceId debe estar >= min
    for (const it of newItems) {
      if (it.serviceId) {
        const svc = await prisma.pricingService.findFirst({
          where: { id: it.serviceId, workspaceId: ctx.workspaceId }
        });
        if (svc && Number(it.amountEur) < svc.minAmountEur) {
          await prisma.deal.update({
            where: { id: dealId },
            data: {
              status: "ESCALATED",
              negotiationLog: {
                push: {
                  ts: new Date().toISOString(),
                  actor: "nv-ia",
                  action: "escalated_below_min",
                  snapshot: { service: svc.name, requested: it.amountEur, min: svc.minAmountEur }
                }
              } as any
            }
          });
          return {
            error: `Precio ${it.amountEur}€ bajo min ${svc.minAmountEur}€ de ${svc.name}. Deal marcado ESCALATED — humano debe decidir.`,
            escalated: true
          };
        }
      }
    }
    const newValueEur = newItems.reduce(
      (s: number, it: any) => s + Number(it.amountEur) * Number(it.units || 1),
      0
    );
    await prisma.deal.update({
      where: { id: dealId },
      data: {
        status: "NEGOTIATING",
        proposedItems: newItems as any,
        currentValueEur: newValueEur,
        negotiationLog: {
          push: {
            ts: new Date().toISOString(),
            actor: "nv-ia",
            action: "counter_offer",
            snapshot: { items: newItems, justification, value: newValueEur }
          }
        } as any
      }
    });
    // Sugerimos texto de respuesta para que Sonia lo use con draft_email/whatsapp
    const itemsText = newItems
      .map((it: any) => `· ${it.name}: ${it.units} × ${Number(it.amountEur).toFixed(2)}€${it.terms ? ` (${it.terms})` : ""}`)
      .join("\n");
    return {
      ok: true,
      newValueEur,
      suggestedReply:
        `He revisado tu propuesta. Te puedo dejar esto:\n\n${itemsText}\n\nTotal: ${newValueEur.toFixed(2)}€.\n\n${justification}\n\n¿Cerramos así?`,
      message: "Términos actualizados. Usa draft_email o draft_whatsapp con suggestedReply para enviar."
    };
  },

  async close_deal(input, ctx) {
    const dealId = String(input?.dealId ?? "").trim();
    const outcome = String(input?.outcome ?? "").trim();
    if (!["won", "lost", "escalated"].includes(outcome)) {
      return { error: "outcome debe ser won | lost | escalated" };
    }
    const reason = input?.reason ? String(input.reason) : null;
    const statusMap: Record<string, string> = {
      won: "CLOSED_WON",
      lost: "CLOSED_LOST",
      escalated: "ESCALATED"
    };
    const updated = await prisma.deal.update({
      where: { id: dealId },
      data: {
        status: statusMap[outcome],
        closedAt: outcome === "escalated" ? null : new Date(),
        closedReason: reason,
        negotiationLog: {
          push: {
            ts: new Date().toISOString(),
            actor: "nv-ia",
            action: `closed_${outcome}`,
            snapshot: { reason }
          }
        } as any
      }
    });
    // Si WON Y hay leadId, marcamos lead como "client"
    if (outcome === "won" && updated.leadId) {
      await prisma.lead.update({
        where: { id: updated.leadId },
        data: { contactStatus: "client" }
      }).catch(() => {});
    }
    return {
      ok: true,
      dealStatus: statusMap[outcome],
      nextStep:
        outcome === "won"
          ? "Crea factura/presupuesto con draft_holded_invoice o draft_holded_quote usando los proposedItems del deal."
          : outcome === "lost"
          ? "Considera update_client_memory con la razón del NO para futuras negociaciones."
          : "El admin tiene que revisar en /admin/nv-ia/deals."
    };
  },

  async meta_ads_list_ad_accounts(_input, ctx) {
    try {
      const accounts = await metaAdsListAdAccounts(ctx.workspaceId, ctx.adhocCredentials);
      return { count: accounts.length, accounts };
    } catch (e: any) {
      return { error: `Meta Ads no disponible: ${e?.message ?? e}` };
    }
  },
  async meta_ads_resolve_ad_account_by_name(input, ctx) {
    const frag = String(input?.nameFragment ?? "").trim();
    if (!frag) return { error: "nameFragment vacío" };
    try {
      const accounts = await metaAdsListAdAccounts(ctx.workspaceId, ctx.adhocCredentials);
      const norm = (s: string) =>
        (s ?? "")
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, "");
      const q = norm(frag);
      if (!q) return { error: "nameFragment inválido" };
      const scored = accounts
        .map((a: any) => {
          const n = norm(a.name);
          let score = 0;
          if (n === q) score = 100;
          else if (n.includes(q)) score = 70;
          else if (q.includes(n) && n.length >= 3) score = 50;
          return { id: a.id, name: a.name, score };
        })
        .filter((a) => a.score > 0)
        .sort((a, b) => b.score - a.score);
      if (scored.length === 0) {
        const sample = accounts.slice(0, 15).map((a: any) => `${a.name} (${a.id})`).join(", ");
        return {
          ok: false,
          match: null,
          message: `Ninguna cuenta coincide con "${frag}". Cuentas disponibles (primeras 15): ${sample}${accounts.length > 15 ? ` y ${accounts.length - 15} más` : ""}.`
        };
      }
      return {
        ok: true,
        match: { adAccountId: scored[0].id, name: scored[0].name },
        alternatives: scored.slice(1, 6).map((a) => ({ adAccountId: a.id, name: a.name }))
      };
    } catch (e: any) {
      return { error: `Meta Ads no disponible: ${e?.message ?? e}` };
    }
  },
  async meta_ads_list_campaigns(input, ctx) {
    try {
      const campaigns = await metaAdsListCampaigns({
        workspaceId: ctx.workspaceId,
        status: input?.status,
        limit: typeof input?.limit === "number" ? input.limit : 50,
        adhoc: adhocWithAdAccount(ctx.adhocCredentials, input?.adAccountId)
      });
      return { count: campaigns.length, campaigns };
    } catch (e: any) {
      return { error: `Meta Ads no disponible: ${e?.message ?? e}` };
    }
  },
  async meta_ads_get_campaign_insights(input, ctx) {
    const campaignId = String(input?.campaignId ?? "").trim();
    if (!campaignId) return { error: "campaignId vacío" };
    try {
      const insights = await metaAdsGetCampaignInsights({
        workspaceId: ctx.workspaceId,
        campaignId,
        datePreset: input?.datePreset ? String(input.datePreset) : undefined,
        since: input?.since ? String(input.since) : undefined,
        until: input?.until ? String(input.until) : undefined,
        adhoc: adhocWithAdAccount(ctx.adhocCredentials, input?.adAccountId)
      });
      return { ok: true, insights };
    } catch (e: any) {
      return { error: `Meta Ads no disponible: ${e?.message ?? e}` };
    }
  },
  async meta_ads_top_performers(input, ctx) {
    try {
      const top = await metaAdsTopPerformers({
        workspaceId: ctx.workspaceId,
        datePreset: input?.datePreset ? String(input.datePreset) : undefined,
        metric: input?.metric,
        limit: typeof input?.limit === "number" ? input.limit : 10,
        adhoc: adhocWithAdAccount(ctx.adhocCredentials, input?.adAccountId)
      });
      return { count: top.length, top };
    } catch (e: any) {
      return { error: `Meta Ads no disponible: ${e?.message ?? e}` };
    }
  },
  async meta_ads_download_leads(input, ctx) {
    try {
      const { metaAdsDownloadLeads, leadsToCsv } = await import("@/lib/integrations/meta-ads");
      const result = await metaAdsDownloadLeads({
        workspaceId: ctx.workspaceId,
        campaignId: input?.campaignId ? String(input.campaignId) : undefined,
        adsetId: input?.adsetId ? String(input.adsetId) : undefined,
        adId: input?.adId ? String(input.adId) : undefined,
        formId: input?.formId ? String(input.formId) : undefined,
        since: input?.since ? String(input.since) : undefined,
        until: input?.until ? String(input.until) : undefined,
        adhoc: adhocWithAdAccount(ctx.adhocCredentials, input?.adAccountId)
      });

      const attachAs = String(input?.attachAs ?? "json");
      const baseName = String(input?.filename ?? `leads-meta-${result.source.replace(/[^a-z0-9]/gi, "_")}-${new Date().toISOString().slice(0, 10)}`);

      if (attachAs === "json" || result.count === 0) {
        return {
          ok: true,
          count: result.count,
          source: result.source,
          leads: result.leads.slice(0, 100), // primeros 100 para no inflar contexto
          truncated: result.leads.length > 100
        };
      }

      if (attachAs === "csv") {
        const csv = leadsToCsv(result.leads);
        const { uploadAttachmentForTask } = await import("@/lib/files/sonia-upload");
        const file = await uploadAttachmentForTask({
          workspaceId: ctx.workspaceId,
          taskId: ctx.taskId,
          filename: `${baseName}.csv`,
          body: Buffer.from("﻿" + csv, "utf-8"), // BOM para Excel
          mimeType: "text/csv",
          uploadedByUserId: ctx.config.userId
        });
        await prisma.comment.create({
          data: {
            workspaceId: ctx.workspaceId,
            authorId: ctx.config.userId,
            targetType: "TASK",
            targetId: ctx.taskId,
            body: `📎 He adjuntado **${baseName}.csv** con ${result.count} leads (${file.sizeBytes} bytes). Source: ${result.source}.`
          }
        });
        return { ok: true, count: result.count, fileId: file.fileId, filename: file.filename };
      }

      if (attachAs === "xlsx") {
        // Usamos el builder estilizado en vez de xlsx community. Headers
        // azul corporativo blanco, zebra striping, columnas renombradas,
        // freeze pane + auto-filter. Calidad "entrega a cliente".
        const { buildStyledXlsx } = await import("@/lib/files/xlsx-builder");
        // Renombrar columnas técnicas a labels humanos.
        const PRETTY: Record<string, string> = {
          lead_id: "Lead ID",
          created_time: "Creado",
          ad_id: "Ad ID",
          form_id: "Form ID",
          campaign_id: "Campaign ID",
          adset_id: "Adset ID",
          full_name: "Nombre",
          phone_number: "Teléfono",
          email: "Email"
        };
        // Orden de columnas — prioriza datos de contacto.
        const PREFERRED_ORDER = [
          "created_time",
          "full_name",
          "email",
          "phone_number",
          "lead_id",
          "campaign_id",
          "adset_id",
          "ad_id",
          "form_id"
        ];
        const buf = await buildStyledXlsx({
          theme: "corporate",
          sheets: [
            {
              name: "Leads",
              title: `Leads — ${result.count}`,
              subtitle: `Source: ${result.source}`,
              rows: result.leads,
              columnLabels: PRETTY,
              columnOrder: PREFERRED_ORDER
            }
          ],
          meta: { title: baseName, creator: "Sonia (Hub)" }
        });
        const { uploadAttachmentForTask } = await import("@/lib/files/sonia-upload");
        const file = await uploadAttachmentForTask({
          workspaceId: ctx.workspaceId,
          taskId: ctx.taskId,
          filename: `${baseName}.xlsx`,
          body: buf,
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          uploadedByUserId: ctx.config.userId
        });
        await prisma.comment.create({
          data: {
            workspaceId: ctx.workspaceId,
            authorId: ctx.config.userId,
            targetType: "TASK",
            targetId: ctx.taskId,
            body: `📎 He adjuntado **${baseName}.xlsx** con ${result.count} leads. Source: ${result.source}.`
          }
        });
        return { ok: true, count: result.count, fileId: file.fileId, filename: file.filename };
      }

      return { error: `attachAs desconocido: ${attachAs}` };
    } catch (e: any) {
      return { error: `meta_ads_download_leads: ${e?.message ?? e}` };
    }
  },
  // ──────────────────────────────────────────────────────────────
  // META ADS — WRITE EXECUTORS
  // ──────────────────────────────────────────────────────────────
  async meta_ads_list_pages(_input, ctx) {
    try {
      const { metaAdsListPages } = await import("@/lib/integrations/meta-ads");
      const pages = await metaAdsListPages({
        workspaceId: ctx.workspaceId,
        adhoc: ctx.adhocCredentials
      });
      return { count: pages.length, pages };
    } catch (e: any) {
      return { error: `meta_ads_list_pages: ${e?.message ?? e}` };
    }
  },
  async meta_ads_list_lead_forms(input, ctx) {
    try {
      const { metaAdsListLeadForms } = await import("@/lib/integrations/meta-ads");
      const forms = await metaAdsListLeadForms({
        workspaceId: ctx.workspaceId,
        pageId: String(input?.pageId ?? ""),
        adhoc: adhocWithAdAccount(ctx.adhocCredentials, input?.adAccountId)
      });
      return { count: forms.length, forms };
    } catch (e: any) {
      return { error: `meta_ads_list_lead_forms: ${e?.message ?? e}` };
    }
  },
  async meta_ads_list_adsets(input, ctx) {
    try {
      const { metaAdsListAdsets } = await import("@/lib/integrations/meta-ads");
      const adsets = await metaAdsListAdsets({
        workspaceId: ctx.workspaceId,
        campaignId: String(input?.campaignId ?? ""),
        limit: typeof input?.limit === "number" ? input.limit : undefined,
        adhoc: adhocWithAdAccount(ctx.adhocCredentials, input?.adAccountId)
      });
      return { count: adsets.length, adsets };
    } catch (e: any) {
      return { error: `meta_ads_list_adsets: ${e?.message ?? e}` };
    }
  },
  async meta_ads_list_ads(input, ctx) {
    try {
      const { metaAdsListAds } = await import("@/lib/integrations/meta-ads");
      const ads = await metaAdsListAds({
        workspaceId: ctx.workspaceId,
        campaignId: input?.campaignId ? String(input.campaignId) : undefined,
        adsetId: input?.adsetId ? String(input.adsetId) : undefined,
        limit: typeof input?.limit === "number" ? input.limit : undefined,
        adhoc: adhocWithAdAccount(ctx.adhocCredentials, input?.adAccountId)
      });
      return { count: ads.length, ads };
    } catch (e: any) {
      return { error: `meta_ads_list_ads: ${e?.message ?? e}` };
    }
  },
  async meta_ads_targeting_search(input, ctx) {
    try {
      const { metaAdsTargetingSearch } = await import("@/lib/integrations/meta-ads");
      const results = await metaAdsTargetingSearch({
        workspaceId: ctx.workspaceId,
        q: String(input?.q ?? ""),
        type: input?.type ? String(input.type) : undefined,
        limit: typeof input?.limit === "number" ? input.limit : undefined,
        adhoc: ctx.adhocCredentials
      });
      return { count: results.length, results };
    } catch (e: any) {
      return { error: `meta_ads_targeting_search: ${e?.message ?? e}` };
    }
  },
  async meta_ads_create_lead_campaign(input, ctx) {
    try {
      const { metaAdsCreateLeadCampaign } = await import("@/lib/integrations/meta-ads");
      const result = await metaAdsCreateLeadCampaign({
        workspaceId: ctx.workspaceId,
        campaignName: String(input?.campaignName ?? ""),
        pageId: String(input?.pageId ?? ""),
        dailyBudgetEur: Number(input?.dailyBudgetEur ?? 0),
        countries: Array.isArray(input?.countries) ? input.countries.map(String) : ["ES"],
        ageMin: typeof input?.ageMin === "number" ? input.ageMin : undefined,
        ageMax: typeof input?.ageMax === "number" ? input.ageMax : undefined,
        formName: String(input?.formName ?? ""),
        formQuestions: Array.isArray(input?.formQuestions) ? input.formQuestions : [],
        privacyPolicyUrl: String(input?.privacyPolicyUrl ?? ""),
        imageFileId: String(input?.imageFileId ?? ""),
        adName: String(input?.adName ?? ""),
        primaryText: String(input?.primaryText ?? ""),
        headline: input?.headline ? String(input.headline) : undefined,
        description: input?.description ? String(input.description) : undefined,
        callToAction: input?.callToAction ? String(input.callToAction) : undefined,
        followUpActionUrl: input?.followUpActionUrl ? String(input.followUpActionUrl) : undefined,
        adhoc: ctx.adhocCredentials
      });
      // Comentario informativo firmado por Sonia con resumen.
      if (result.ok) {
        await prisma.comment.create({
          data: {
            workspaceId: ctx.workspaceId,
            authorId: ctx.config.userId,
            targetType: "TASK",
            targetId: ctx.taskId,
            body:
              `🚀 **Campaña Meta Ads creada (en PAUSED — pendiente de tu revisión):**\n\n` +
              `- Campaign: \`${result.campaignId}\`\n` +
              `- Adset: \`${result.adsetId}\`\n` +
              `- Lead Form: \`${result.formId}\`\n` +
              `- Ad: \`${result.adId}\`\n\n` +
              `[Abrir en Ads Manager para revisar y activar](${result.adsManagerUrl})\n\n` +
              `⚠️ La campaña está PAUSADA — entra en Ads Manager, revisa la creatividad y el copy, y dale a activar manualmente cuando esté lista.`
          }
        });
      } else {
        await prisma.comment.create({
          data: {
            workspaceId: ctx.workspaceId,
            authorId: ctx.config.userId,
            targetType: "TASK",
            targetId: ctx.taskId,
            body:
              `⚠️ **Fallo creando la campaña Meta Ads.**\n\n` +
              `Falló en el paso \`${result.step}\`: ${result.error}\n\n` +
              (result.campaignId ? `Campaign creado: \`${result.campaignId}\` (queda PAUSED)\n` : "") +
              (result.adsetId ? `Adset creado: \`${result.adsetId}\`\n` : "") +
              (result.formId ? `Lead Form creado: \`${result.formId}\`\n` : "") +
              `\nRevisa el error y vuélveme a llamar — los recursos creados quedan en Ads Manager.`
          }
        });
      }
      return result;
    } catch (e: any) {
      return { error: `meta_ads_create_lead_campaign: ${e?.message ?? e}` };
    }
  },
  async meta_ads_create_campaign(input, ctx) {
    try {
      // IDEMPOTENCIA: si esta task ya creó una campaña, devolverla en
      // lugar de crear duplicado. Sonia puede forzar el bypass pasando
      // forceCreate:true (ej. quiere crear A/B con la misma task).
      const { readResources, recordResources } = await import(
        "@/lib/ai/nv-ia/resource-registry"
      );
      if (!input?.forceCreate) {
        const state = await readResources(ctx.taskId);
        if (state.meta_ads?.campaignId) {
          // Solo reutilizamos si la campaña SIGUE viva en Meta. Si está
          // borrada/archivada (Meta no deja añadir adsets), la ignoramos y
          // creamos una nueva — sin esto la task se quedaba en bucle.
          const { metaAdsCampaignUsable } = await import("@/lib/integrations/meta-ads");
          const usable = await metaAdsCampaignUsable({
            workspaceId: ctx.workspaceId,
            campaignId: state.meta_ads.campaignId,
            adhoc: ctx.adhocCredentials
          });
          if (usable) {
            return {
              ok: true,
              id: state.meta_ads.campaignId,
              name: state.meta_ads.campaignName,
              deduped: true,
              message:
                "REUSING existing campaign from this task. Pass forceCreate:true if you really want a new one."
            };
          }
          // No usable → seguimos y creamos una nueva (se sobrescribe el registro).
        }
      }
      const { metaAdsCreateCampaign } = await import("@/lib/integrations/meta-ads");
      const r = await metaAdsCreateCampaign({
        workspaceId: ctx.workspaceId,
        name: String(input?.name ?? ""),
        objective: String(input?.objective ?? "OUTCOME_LEADS"),
        dailyBudgetEur: typeof input?.dailyBudgetEur === "number" ? input.dailyBudgetEur : undefined,
        lifetimeBudgetEur: typeof input?.lifetimeBudgetEur === "number" ? input.lifetimeBudgetEur : undefined,
        status: input?.status === "ACTIVE" ? "ACTIVE" : "PAUSED",
        adhoc: ctx.adhocCredentials
      });
      // Campaña nueva → limpiamos adset/ad viejos del registro (pertenecían a
      // la campaña anterior; si los dejáramos, el dedupe de adset/ad los
      // devolvería y fallarían por estar bajo una campaña distinta/borrada).
      await recordResources(ctx.taskId, {
        meta_ads: { campaignId: r.id, campaignName: r.name, adsetId: undefined, adId: undefined }
      });
      return { ok: true, ...r };
    } catch (e: any) {
      return { error: `meta_ads_create_campaign: ${e?.message ?? e}` };
    }
  },
  async meta_ads_create_adset(input, ctx) {
    try {
      const { readResources, recordResources } = await import(
        "@/lib/ai/nv-ia/resource-registry"
      );
      if (!input?.forceCreate) {
        const state = await readResources(ctx.taskId);
        if (state.meta_ads?.adsetId) {
          return {
            ok: true,
            id: state.meta_ads.adsetId,
            deduped: true,
            message: "REUSING existing adset from this task. Pass forceCreate:true to override."
          };
        }
      }
      const { metaAdsCreateAdset } = await import("@/lib/integrations/meta-ads");
      const r = await metaAdsCreateAdset({
        workspaceId: ctx.workspaceId,
        campaignId: String(input?.campaignId ?? ""),
        name: String(input?.name ?? ""),
        dailyBudgetEur: typeof input?.dailyBudgetEur === "number" ? input.dailyBudgetEur : undefined,
        targeting: typeof input?.targeting === "object" && input.targeting !== null ? input.targeting : { geo_locations: { countries: ["ES"] } },
        optimizationGoal: input?.optimizationGoal ? String(input.optimizationGoal) : undefined,
        billingEvent: input?.billingEvent ? String(input.billingEvent) : undefined,
        destinationType: input?.destinationType ? String(input.destinationType) : undefined,
        startTime: input?.startTime ? String(input.startTime) : undefined,
        endTime: input?.endTime ? String(input.endTime) : undefined,
        status: input?.status === "ACTIVE" ? "ACTIVE" : "PAUSED",
        promotedObject:
          input?.promotedObject && typeof input.promotedObject === "object"
            ? {
                pageId: input.promotedObject.pageId ? String(input.promotedObject.pageId) : undefined,
                applicationId: input.promotedObject.applicationId
                  ? String(input.promotedObject.applicationId)
                  : undefined,
                customEventType: input.promotedObject.customEventType
                  ? String(input.promotedObject.customEventType)
                  : undefined,
                customEventStr: input.promotedObject.customEventStr
                  ? String(input.promotedObject.customEventStr)
                  : undefined,
                productSetId: input.promotedObject.productSetId
                  ? String(input.promotedObject.productSetId)
                  : undefined,
                pixelId: input.promotedObject.pixelId ? String(input.promotedObject.pixelId) : undefined
              }
            : undefined,
        bidStrategy: input?.bidStrategy as any,
        bidAmountCents:
          typeof input?.bidAmountCents === "number" ? input.bidAmountCents : undefined,
        adhoc: ctx.adhocCredentials
      });
      await recordResources(ctx.taskId, { meta_ads: { adsetId: r.id } });
      return { ok: true, ...r };
    } catch (e: any) {
      return { error: `meta_ads_create_adset: ${e?.message ?? e}` };
    }
  },
  async meta_ads_create_lead_form(input, ctx) {
    try {
      const { readResources, recordResources } = await import(
        "@/lib/ai/nv-ia/resource-registry"
      );
      if (!input?.forceCreate) {
        const state = await readResources(ctx.taskId);
        if (state.meta_ads?.formId) {
          return {
            ok: true,
            id: state.meta_ads.formId,
            deduped: true,
            message: "REUSING existing lead form from this task. Pass forceCreate:true to override."
          };
        }
      }
      const { metaAdsCreateLeadForm } = await import("@/lib/integrations/meta-ads");
      const r = await metaAdsCreateLeadForm({
        workspaceId: ctx.workspaceId,
        pageId: String(input?.pageId ?? ""),
        name: String(input?.name ?? ""),
        questions: Array.isArray(input?.questions) ? input.questions : [],
        privacyPolicyUrl: String(input?.privacyPolicyUrl ?? ""),
        privacyPolicyLinkText: input?.privacyPolicyLinkText ? String(input.privacyPolicyLinkText) : undefined,
        followUpActionUrl: input?.followUpActionUrl ? String(input.followUpActionUrl) : undefined,
        locale: input?.locale ? String(input.locale) : undefined,
        adhoc: ctx.adhocCredentials
      });
      await recordResources(ctx.taskId, { meta_ads: { formId: r.id } });
      return { ok: true, ...r };
    } catch (e: any) {
      return { error: `meta_ads_create_lead_form: ${e?.message ?? e}` };
    }
  },
  async meta_ads_upload_image(input, ctx) {
    try {
      const { metaAdsUploadImage } = await import("@/lib/integrations/meta-ads");
      const r = await metaAdsUploadImage({
        workspaceId: ctx.workspaceId,
        fileId: input?.fileId ? String(input.fileId) : undefined,
        url: input?.url ? String(input.url) : undefined,
        adhoc: ctx.adhocCredentials
      });
      const { recordResources } = await import("@/lib/ai/nv-ia/resource-registry");
      await recordResources(ctx.taskId, { meta_ads: { imageHash: r.hash } });
      return { ok: true, ...r };
    } catch (e: any) {
      return { error: `meta_ads_upload_image: ${e?.message ?? e}` };
    }
  },
  async meta_ads_upload_video(input, ctx) {
    try {
      const { metaAdsUploadVideo } = await import("@/lib/integrations/meta-ads");
      const r = await metaAdsUploadVideo({
        workspaceId: ctx.workspaceId,
        fileId: input?.fileId ? String(input.fileId) : undefined,
        url: input?.url ? String(input.url) : undefined,
        adhoc: ctx.adhocCredentials
      });
      return { ok: true, ...r };
    } catch (e: any) {
      return { error: `meta_ads_upload_video: ${e?.message ?? e}` };
    }
  },
  async meta_ads_create_carousel_creative(input, ctx) {
    try {
      const { metaAdsCreateCarouselCreative } = await import("@/lib/integrations/meta-ads");
      const r = await metaAdsCreateCarouselCreative({
        workspaceId: ctx.workspaceId,
        name: String(input?.name ?? "Carrusel"),
        pageId: String(input?.pageId ?? ""),
        leadFormId: String(input?.leadFormId ?? ""),
        imageHashes: Array.isArray(input?.imageHashes) ? input.imageHashes.map(String) : [],
        primaryText: String(input?.primaryText ?? ""),
        cards: Array.isArray(input?.cards) ? input.cards : undefined,
        callToAction: input?.callToAction ? String(input.callToAction) : undefined,
        link: input?.link ? String(input.link) : undefined,
        adhoc: ctx.adhocCredentials
      });
      const { recordResources } = await import("@/lib/ai/nv-ia/resource-registry");
      await recordResources(ctx.taskId, { meta_ads: { creativeId: r.id } });
      return { ok: true, ...r };
    } catch (e: any) {
      return { error: `meta_ads_create_carousel_creative: ${e?.message ?? e}` };
    }
  },
  async meta_ads_create_video_creative(input, ctx) {
    try {
      const { metaAdsCreateVideoCreative } = await import("@/lib/integrations/meta-ads");
      const r = await metaAdsCreateVideoCreative({
        workspaceId: ctx.workspaceId,
        name: String(input?.name ?? "Vídeo"),
        pageId: String(input?.pageId ?? ""),
        leadFormId: String(input?.leadFormId ?? ""),
        videoId: String(input?.videoId ?? ""),
        thumbnailImageHash: String(input?.thumbnailImageHash ?? ""),
        primaryText: String(input?.primaryText ?? ""),
        headline: input?.headline ? String(input.headline) : undefined,
        description: input?.description ? String(input.description) : undefined,
        callToAction: input?.callToAction ? String(input.callToAction) : undefined,
        link: input?.link ? String(input.link) : undefined,
        adhoc: ctx.adhocCredentials
      });
      const { recordResources } = await import("@/lib/ai/nv-ia/resource-registry");
      await recordResources(ctx.taskId, { meta_ads: { creativeId: r.id } });
      return { ok: true, ...r };
    } catch (e: any) {
      return { error: `meta_ads_create_video_creative: ${e?.message ?? e}` };
    }
  },
  async meta_ads_create_custom_audience(input, ctx) {
    try {
      const { metaAdsCreateCustomAudience } = await import("@/lib/integrations/meta-ads");
      const r = await metaAdsCreateCustomAudience({
        workspaceId: ctx.workspaceId,
        name: String(input?.name ?? "Remarketing"),
        source: String(input?.source ?? "page") as any,
        sourceId: String(input?.sourceId ?? ""),
        retentionDays: typeof input?.retentionDays === "number" ? input.retentionDays : undefined,
        adhoc: ctx.adhocCredentials
      });
      const { recordResources } = await import("@/lib/ai/nv-ia/resource-registry");
      await recordResources(ctx.taskId, { meta_ads: { customAudienceId: r.id } as any });
      return { ok: true, ...r };
    } catch (e: any) {
      return { error: `meta_ads_create_custom_audience: ${e?.message ?? e}` };
    }
  },
  async meta_ads_create_ad_creative(input, ctx) {
    try {
      const { metaAdsCreateAdCreative } = await import("@/lib/integrations/meta-ads");
      const r = await metaAdsCreateAdCreative({
        workspaceId: ctx.workspaceId,
        name: String(input?.name ?? ""),
        pageId: String(input?.pageId ?? ""),
        leadFormId: String(input?.leadFormId ?? ""),
        imageHash: String(input?.imageHash ?? ""),
        primaryText: String(input?.primaryText ?? ""),
        headline: input?.headline ? String(input.headline) : undefined,
        description: input?.description ? String(input.description) : undefined,
        callToAction: input?.callToAction ? String(input.callToAction) : undefined,
        link: input?.link ? String(input.link) : undefined,
        adhoc: ctx.adhocCredentials
      });
      const { recordResources } = await import("@/lib/ai/nv-ia/resource-registry");
      await recordResources(ctx.taskId, { meta_ads: { creativeId: r.id } });
      return { ok: true, ...r };
    } catch (e: any) {
      return { error: `meta_ads_create_ad_creative: ${e?.message ?? e}` };
    }
  },
  async meta_ads_create_ad(input, ctx) {
    try {
      const { readResources, recordResources } = await import(
        "@/lib/ai/nv-ia/resource-registry"
      );
      if (!input?.forceCreate) {
        const state = await readResources(ctx.taskId);
        if (state.meta_ads?.adId) {
          return {
            ok: true,
            id: state.meta_ads.adId,
            deduped: true,
            message: "REUSING existing ad. Si quieres regenerar el creative, usa meta_ads_update_ad con creativeId nuevo."
          };
        }
      }
      const { metaAdsCreateAd } = await import("@/lib/integrations/meta-ads");
      const r = await metaAdsCreateAd({
        workspaceId: ctx.workspaceId,
        adsetId: String(input?.adsetId ?? ""),
        name: String(input?.name ?? ""),
        creativeId: String(input?.creativeId ?? ""),
        status: input?.status === "ACTIVE" ? "ACTIVE" : "PAUSED",
        adhoc: ctx.adhocCredentials
      });
      await recordResources(ctx.taskId, { meta_ads: { adId: r.id } });
      return { ok: true, ...r };
    } catch (e: any) {
      return { error: `meta_ads_create_ad: ${e?.message ?? e}` };
    }
  },
  async meta_ads_update_campaign(input, ctx) {
    try {
      const { metaAdsUpdateCampaign } = await import("@/lib/integrations/meta-ads");
      const r = await metaAdsUpdateCampaign({
        workspaceId: ctx.workspaceId,
        campaignId: String(input?.campaignId ?? ""),
        name: input?.name ? String(input.name) : undefined,
        status: input?.status as any,
        dailyBudgetEur: typeof input?.dailyBudgetEur === "number" ? input.dailyBudgetEur : undefined,
        lifetimeBudgetEur: typeof input?.lifetimeBudgetEur === "number" ? input.lifetimeBudgetEur : undefined,
        adhoc: ctx.adhocCredentials
      });
      return r;
    } catch (e: any) {
      return { error: `meta_ads_update_campaign: ${e?.message ?? e}` };
    }
  },
  async meta_ads_launch_ab_test(input, ctx) {
    try {
      const variants = Array.isArray(input?.variants) ? input.variants : [];
      if (variants.length < 2) return { error: "Necesitas al menos 2 variantes" };
      const { metaAdsLaunchAbTest } = await import("@/lib/meta/ab-testing");
      const result = await metaAdsLaunchAbTest({
        workspaceId: ctx.workspaceId,
        taskId: ctx.taskId,
        campaignId: String(input?.campaignId ?? ""),
        baseAdsetSettings: {
          targeting: input?.targeting,
          pageId: String(input?.pageId ?? ""),
          leadFormId: String(input?.leadFormId ?? ""),
          optimizationGoal: input?.optimizationGoal
            ? String(input.optimizationGoal)
            : undefined,
          dailyBudgetEurPerVariant:
            typeof input?.dailyBudgetEurPerVariant === "number"
              ? input.dailyBudgetEurPerVariant
              : undefined
        },
        variants: variants.map((v: any) => ({
          label: String(v.label),
          imageHash: String(v.imageHash),
          primaryText: String(v.primaryText),
          headline: v.headline ? String(v.headline) : undefined,
          description: v.description ? String(v.description) : undefined,
          callToAction: v.callToAction ? String(v.callToAction) : undefined
        })),
        evaluationHours:
          typeof input?.evaluationHours === "number" ? input.evaluationHours : undefined,
        evaluationStrategy: (input?.evaluationStrategy as any) ?? undefined,
        adhoc: ctx.adhocCredentials
      });
      return { ok: true, ...result };
    } catch (e: any) {
      return { error: `meta_ads_launch_ab_test: ${e?.message ?? e}` };
    }
  },
  async meta_ads_bulk_update_campaigns(input, ctx) {
    try {
      const ids = Array.isArray(input?.campaignIds)
        ? input.campaignIds.map(String).filter(Boolean)
        : [];
      if (ids.length === 0) return { error: "campaignIds vacío" };
      const { metaAdsBulkUpdateCampaigns } = await import("@/lib/integrations/meta-ads");
      const results = await metaAdsBulkUpdateCampaigns({
        workspaceId: ctx.workspaceId,
        campaignIds: ids,
        status: input?.status as any,
        dailyBudgetEur:
          typeof input?.dailyBudgetEur === "number" ? input.dailyBudgetEur : undefined,
        adhoc: ctx.adhocCredentials
      });
      const ok = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok);
      return {
        ok: failed.length === 0,
        summary: `${ok}/${results.length} OK${failed.length > 0 ? ` · ${failed.length} fallaron` : ""}`,
        results
      };
    } catch (e: any) {
      return { error: `meta_ads_bulk_update_campaigns: ${e?.message ?? e}` };
    }
  },
  async meta_ads_update_adset(input, ctx) {
    try {
      const { metaAdsUpdateAdset } = await import("@/lib/integrations/meta-ads");
      const r = await metaAdsUpdateAdset({
        workspaceId: ctx.workspaceId,
        adsetId: String(input?.adsetId ?? ""),
        name: input?.name ? String(input.name) : undefined,
        status: input?.status as any,
        dailyBudgetEur: typeof input?.dailyBudgetEur === "number" ? input.dailyBudgetEur : undefined,
        targeting: typeof input?.targeting === "object" && input.targeting !== null ? input.targeting : undefined,
        adhoc: ctx.adhocCredentials
      });
      return r;
    } catch (e: any) {
      return { error: `meta_ads_update_adset: ${e?.message ?? e}` };
    }
  },
  async meta_ads_update_ad(input, ctx) {
    try {
      const { metaAdsUpdateAd } = await import("@/lib/integrations/meta-ads");
      const r = await metaAdsUpdateAd({
        workspaceId: ctx.workspaceId,
        adId: String(input?.adId ?? ""),
        name: input?.name ? String(input.name) : undefined,
        status: input?.status as any,
        creativeId: input?.creativeId ? String(input.creativeId) : undefined,
        adhoc: ctx.adhocCredentials
      });
      return r;
    } catch (e: any) {
      return { error: `meta_ads_update_ad: ${e?.message ?? e}` };
    }
  },
  async meta_ads_get_ad_preview(input, ctx) {
    try {
      const { metaAdsGetAdPreview } = await import("@/lib/integrations/meta-ads");
      const r = await metaAdsGetAdPreview({
        workspaceId: ctx.workspaceId,
        adId: String(input?.adId ?? ""),
        format: input?.format ? String(input.format) : undefined,
        adhoc: ctx.adhocCredentials
      });
      return r;
    } catch (e: any) {
      return { error: `meta_ads_get_ad_preview: ${e?.message ?? e}` };
    }
  },
  async http_request(input, ctx) {
    // Cap por run para evitar abuso.
    ctx.httpRequests = ctx.httpRequests ?? { count: 0 };
    if (ctx.httpRequests.count >= 50) {
      return { error: "Tope de 50 http_request por run alcanzado. Termina la tarea o usa otra estrategia." };
    }
    ctx.httpRequests.count++;

    const url = String(input?.url ?? "").trim();
    if (!url) return { error: "url vacío" };
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { error: "URL inválida" };
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { error: "Solo http(s)" };
    }
    // Anti-SSRF básico: bloquear hosts internos / metadata cloud.
    const host = parsed.hostname.toLowerCase();
    const isPrivate =
      host === "localhost" ||
      host === "0.0.0.0" ||
      host === "169.254.169.254" || // AWS/GCP metadata
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) ||
      host.endsWith(".internal") ||
      host.endsWith(".local");
    if (isPrivate) {
      return { error: `Host bloqueado por seguridad (IP privada/metadata): ${host}` };
    }

    const method = String(input?.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {};
    if (input?.headers && typeof input.headers === "object") {
      for (const [k, v] of Object.entries(input.headers)) {
        if (typeof v === "string") headers[k] = v;
      }
    }
    const body = typeof input?.body === "string" ? input.body : undefined;
    if (body && body.length > 2 * 1024 * 1024) {
      return { error: "Body de request > 2MB" };
    }
    const timeoutMs = Math.max(1000, Math.min(30000, Number(input?.timeoutMs ?? 15000)));

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, {
        method,
        headers,
        body: ["GET", "HEAD"].includes(method) ? undefined : body,
        signal: ctrl.signal,
        redirect: "follow"
      });
      clearTimeout(timer);
      const respHeaders: Record<string, string> = {};
      r.headers.forEach((v, k) => {
        // Filtra cookies (riesgo de filtración de sesiones).
        if (k.toLowerCase() !== "set-cookie") respHeaders[k] = v;
      });
      const buf = Buffer.from(await r.arrayBuffer());
      const truncated = buf.length > 5 * 1024 * 1024;
      const slice = truncated ? buf.subarray(0, 5 * 1024 * 1024) : buf;
      // Intentar text UTF-8, fallback a base64 si binario.
      let bodyText: string;
      let bodyEncoding: "utf-8" | "base64" = "utf-8";
      try {
        bodyText = slice.toString("utf-8");
        // Heurística: si tiene muchos \x00 o caracteres de control,
        // probablemente es binario → mejor base64.
        const controlChars = bodyText.match(/[\x00-\x08\x0E-\x1F]/g);
        if (controlChars && controlChars.length > slice.length * 0.01) {
          bodyText = slice.toString("base64");
          bodyEncoding = "base64";
        }
      } catch {
        bodyText = slice.toString("base64");
        bodyEncoding = "base64";
      }
      return {
        ok: r.ok,
        status: r.status,
        statusText: r.statusText,
        headers: respHeaders,
        bodyEncoding,
        body: bodyText,
        truncated,
        sizeBytes: buf.length
      };
    } catch (e: any) {
      clearTimeout(timer);
      const msg = e?.name === "AbortError" ? `timeout tras ${timeoutMs}ms` : String(e?.message ?? e);
      return { error: `http_request: ${msg}` };
    }
  },

  async web_scrape_dynamic(input, ctx) {
    try {
      const url = String(input?.url ?? "").trim();
      if (!url) return { error: "url requerida" };
      const { scrapeDynamic } = await import("@/lib/scrape/dynamic");
      const res = await scrapeDynamic({
        workspaceId: ctx.workspaceId,
        url,
        waitForSelector: input?.waitForSelector ? String(input.waitForSelector) : undefined,
        waitMs: input?.waitMs ? Number(input.waitMs) : undefined,
        screenshot: !!input?.screenshot,
        timeoutMs: input?.timeoutMs ? Number(input.timeoutMs) : undefined
      });
      return res;
    } catch (e: any) {
      return { error: `web_scrape_dynamic: ${e?.message ?? e}` };
    }
  },

  async analyze_image_deep(input, ctx) {
    try {
      const imageUrl = String(input?.imageUrl ?? "").trim();
      if (!imageUrl) return { error: "imageUrl requerida" };
      let brandBrief: string | null = null;
      let clientIndustry: string | null = null;
      if (input?.clientId) {
        const c = await prisma.client.findFirst({
          where: { id: String(input.clientId), workspaceId: ctx.workspaceId },
          select: { brandBrief: true, industry: true }
        });
        brandBrief = c?.brandBrief ?? null;
        clientIndustry = c?.industry ?? null;
      }
      const { deepAnalyzeImage } = await import("@/lib/vision/deep-analyze");
      const analysis = await deepAnalyzeImage({
        workspaceId: ctx.workspaceId,
        imageUrl,
        brandBrief,
        clientIndustry
      });
      return analysis;
    } catch (e: any) {
      return { error: `analyze_image_deep: ${e?.message ?? e}` };
    }
  },

  async create_xlsx_workbook(input, ctx) {
    try {
      const filename = String(input?.filename ?? "").trim();
      if (!filename) return { error: "filename vacío" };
      const fromAttachments: string[] = Array.isArray(input?.fromAttachments)
        ? input.fromAttachments.filter((s: unknown) => typeof s === "string")
        : [];
      const inlineSheets: any[] = Array.isArray(input?.sheets) ? input.sheets : [];
      if (fromAttachments.length === 0 && inlineSheets.length === 0) {
        return { error: "Pasa fromAttachments y/o sheets — el libro estaría vacío." };
      }
      const summaryFirst = input?.summarySheetFirst !== false;
      const description = typeof input?.description === "string" ? input.description : "";
      const theme = (typeof input?.theme === "string" && ["corporate", "minimal", "dark"].includes(input.theme))
        ? input.theme
        : "corporate";
      const primaryColor = typeof input?.primaryColor === "string" ? input.primaryColor : undefined;

      const { downloadBuffer } = await import("@/lib/storage/r2");
      const { buildStyledXlsx } = await import("@/lib/files/xlsx-builder");
      const XLSX_legacy = await import("xlsx"); // solo para PARSEAR adjuntos viejos

      // Cargar contenido de adjuntos a sheets nuevos.
      const attachmentSheets: any[] = [];
      const failed: string[] = [];
      if (fromAttachments.length > 0) {
        const files = await prisma.file.findMany({
          where: {
            workspaceId: ctx.workspaceId,
            targetType: "TASK",
            targetId: ctx.taskId
          },
          orderBy: { createdAt: "asc" }
        });
        for (const pattern of fromAttachments) {
          const matched = files.filter(
            (f) =>
              f.name === pattern ||
              f.name.startsWith(pattern) ||
              f.name.includes(pattern)
          );
          if (matched.length === 0) {
            failed.push(`attachment:${pattern}: no match en ${files.length} archivos`);
            continue;
          }
          for (const f of matched) {
            try {
              const buf = await downloadBuffer(f.s3Key);
              const ext = (f.name.split(".").pop() || "").toLowerCase();
              let rows: Array<Record<string, unknown>> = [];
              if (ext === "csv") {
                const text = buf.toString("utf-8").replace(/^﻿/, "");
                const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
                if (lines.length === 0) continue;
                const parseLine = (line: string): string[] => {
                  const out: string[] = [];
                  let cur = "";
                  let inQ = false;
                  for (let i = 0; i < line.length; i++) {
                    const c = line[i];
                    if (inQ) {
                      if (c === '"') {
                        if (line[i + 1] === '"') { cur += '"'; i++; }
                        else inQ = false;
                      } else cur += c;
                    } else {
                      if (c === ",") { out.push(cur); cur = ""; }
                      else if (c === '"') inQ = true;
                      else cur += c;
                    }
                  }
                  out.push(cur);
                  return out;
                };
                const headers = parseLine(lines[0]);
                rows = lines.slice(1).map((line) => {
                  const vals = parseLine(line);
                  const obj: Record<string, unknown> = {};
                  headers.forEach((h, i) => (obj[h] = vals[i]));
                  return obj;
                });
              } else if (ext === "xlsx" || ext === "xls") {
                const srcWb = XLSX_legacy.read(buf, { type: "buffer" });
                const firstSheet = srcWb.SheetNames[0];
                rows = XLSX_legacy.utils.sheet_to_json(srcWb.Sheets[firstSheet], { raw: false }) as any;
              } else {
                failed.push(`attachment:${f.name}: ext ${ext} no soportada`);
                continue;
              }
              const sheetName = f.name.replace(/\.[^.]+$/, "");
              attachmentSheets.push({ name: sheetName, rows });
            } catch (e: any) {
              failed.push(`attachment:${f.name}: ${e?.message ?? e}`);
            }
          }
        }
      }

      // Normalizar las sheets inline al shape esperado por buildStyledXlsx.
      const normalizedInline = inlineSheets.map((s) => ({
        name: String(s?.name ?? "Hoja"),
        title: s?.title ? String(s.title) : undefined,
        subtitle: s?.subtitle ? String(s.subtitle) : undefined,
        rows: Array.isArray(s?.rows)
          ? s.rows.map((r: any) => (typeof r === "object" && r != null ? r : {}))
          : [],
        columnOrder: Array.isArray(s?.columnOrder) ? s.columnOrder.map(String) : undefined,
        columnLabels: typeof s?.columnLabels === "object" && s.columnLabels != null
          ? Object.fromEntries(
              Object.entries(s.columnLabels)
                .filter(([, v]) => typeof v === "string")
                .map(([k, v]) => [k, String(v)])
            )
          : undefined,
        columnWidths: typeof s?.columnWidths === "object" && s.columnWidths != null
          ? Object.fromEntries(
              Object.entries(s.columnWidths)
                .filter(([, v]) => typeof v === "number")
                .map(([k, v]) => [k, Number(v)])
            )
          : undefined
      }));

      const allSheets = summaryFirst
        ? [...normalizedInline, ...attachmentSheets]
        : [...attachmentSheets, ...normalizedInline];

      if (allSheets.length === 0) {
        return { error: "No se pudo añadir ninguna hoja al libro", failed };
      }

      const buf = await buildStyledXlsx({
        theme: theme as any,
        primaryColor,
        sheets: allSheets,
        meta: {
          title: input?.meta?.title,
          subject: input?.meta?.subject,
          company: input?.meta?.company,
          creator: "Sonia (Hub)"
        }
      });

      const { uploadAttachmentForTask } = await import("@/lib/files/sonia-upload");
      const safeName = /\.xlsx$/i.test(filename) ? filename : `${filename}.xlsx`;
      const file = await uploadAttachmentForTask({
        workspaceId: ctx.workspaceId,
        taskId: ctx.taskId,
        filename: safeName,
        body: buf,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        uploadedByUserId: ctx.config.userId
      });
      const sheetsList = allSheets.map((s) => `\`${s.name}\``).join(", ");
      const note = description
        ? description
        : `📎 He adjuntado **${safeName}** con ${allSheets.length} hojas: ${sheetsList}.`;
      await prisma.comment.create({
        data: {
          workspaceId: ctx.workspaceId,
          authorId: ctx.config.userId,
          targetType: "TASK",
          targetId: ctx.taskId,
          body: note
        }
      });
      return {
        ok: true,
        fileId: file.fileId,
        filename: file.filename,
        sheetsAdded: allSheets.map((s) => s.name),
        sheetsFailed: failed,
        sizeBytes: file.sizeBytes
      };
    } catch (e: any) {
      return { error: `create_xlsx_workbook: ${e?.message ?? e}` };
    }
  },
  async google_ads_list_campaigns(input, ctx) {
    try {
      const campaigns = await gadsListCampaigns({
        workspaceId: ctx.workspaceId,
        status: input?.status,
        limit: typeof input?.limit === "number" ? input.limit : 50
      });
      return { count: campaigns.length, campaigns };
    } catch (e: any) {
      return { error: `Google Ads no disponible: ${e?.message ?? e}` };
    }
  },
  async google_ads_get_metrics(input, ctx) {
    try {
      const metrics = await gadsCampaignMetrics({
        workspaceId: ctx.workspaceId,
        campaignId: input?.campaignId ? String(input.campaignId) : undefined,
        datePreset: input?.datePreset ? String(input.datePreset) : undefined,
        since: input?.since ? String(input.since) : undefined,
        until: input?.until ? String(input.until) : undefined
      });
      return { count: metrics.length, metrics };
    } catch (e: any) {
      return { error: `Google Ads no disponible: ${e?.message ?? e}` };
    }
  },

  async google_ads_create_budget(input, ctx) {
    try {
      const res = await gadsCreateCampaignBudget({
        workspaceId: ctx.workspaceId,
        name: String(input?.name ?? "").trim() || `budget-${Date.now()}`,
        amountEurDaily: Number(input?.amountEurDaily ?? 0),
        deliveryMethod: input?.deliveryMethod
      });
      return { ok: true, ...res };
    } catch (e: any) {
      return { error: `google_ads_create_budget: ${e?.message ?? e}` };
    }
  },
  async google_ads_create_campaign(input, ctx) {
    try {
      const res = await gadsCreateCampaign({
        workspaceId: ctx.workspaceId,
        name: String(input?.name ?? "").trim(),
        budgetResourceName: String(input?.budgetResourceName ?? ""),
        channelType: input?.channelType,
        status: input?.status ?? "PAUSED",
        startDate: input?.startDate,
        endDate: input?.endDate
      });
      return { ok: true, ...res, note: "Creada en PAUSED. Activa con google_ads_update_campaign_status cuando el humano valide." };
    } catch (e: any) {
      return { error: `google_ads_create_campaign: ${e?.message ?? e}` };
    }
  },
  async google_ads_update_campaign_status(input, ctx) {
    try {
      const res = await gadsUpdateCampaignStatus({
        workspaceId: ctx.workspaceId,
        campaignId: String(input?.campaignId ?? ""),
        status: input?.status
      });
      return { ok: true, ...res };
    } catch (e: any) {
      return { error: `google_ads_update_campaign_status: ${e?.message ?? e}` };
    }
  },
  async google_ads_update_budget(input, ctx) {
    try {
      const res = await gadsUpdateBudget({
        workspaceId: ctx.workspaceId,
        budgetId: String(input?.budgetId ?? ""),
        amountEurDaily: Number(input?.amountEurDaily ?? 0)
      });
      return { ok: true, ...res };
    } catch (e: any) {
      return { error: `google_ads_update_budget: ${e?.message ?? e}` };
    }
  },
  async google_ads_create_adgroup(input, ctx) {
    try {
      const res = await gadsCreateAdGroup({
        workspaceId: ctx.workspaceId,
        campaignId: String(input?.campaignId ?? ""),
        name: String(input?.name ?? "").trim(),
        cpcBidEur: input?.cpcBidEur ? Number(input.cpcBidEur) : undefined,
        status: input?.status ?? "PAUSED"
      });
      return { ok: true, ...res };
    } catch (e: any) {
      return { error: `google_ads_create_adgroup: ${e?.message ?? e}` };
    }
  },
  async google_ads_create_keywords(input, ctx) {
    try {
      const kws = Array.isArray(input?.keywords) ? input.keywords : [];
      if (!kws.length) return { error: "keywords vacío" };
      const res = await gadsCreateKeywords({
        workspaceId: ctx.workspaceId,
        adGroupId: String(input?.adGroupId ?? ""),
        keywords: kws.map((k: any) => ({
          text: String(k?.text ?? "").trim(),
          matchType: k?.matchType
        })).filter((k: any) => k.text)
      });
      return { ok: true, ...res };
    } catch (e: any) {
      return { error: `google_ads_create_keywords: ${e?.message ?? e}` };
    }
  },
  async google_ads_create_responsive_search_ad(input, ctx) {
    try {
      const res = await gadsCreateResponsiveSearchAd({
        workspaceId: ctx.workspaceId,
        adGroupId: String(input?.adGroupId ?? ""),
        finalUrl: String(input?.finalUrl ?? ""),
        headlines: Array.isArray(input?.headlines) ? input.headlines.map(String) : [],
        descriptions: Array.isArray(input?.descriptions) ? input.descriptions.map(String) : [],
        path1: input?.path1 ? String(input.path1) : undefined,
        path2: input?.path2 ? String(input.path2) : undefined
      });
      return { ok: true, ...res, note: "Ad creado en PAUSED." };
    } catch (e: any) {
      return { error: `google_ads_create_responsive_search_ad: ${e?.message ?? e}` };
    }
  },

  async ga4_get_report(input, ctx) {
    try {
      const out = await ga4GetReport({
        workspaceId: ctx.workspaceId,
        propertyId: input?.propertyId ? String(input.propertyId) : undefined,
        clientId: input?.clientId ? String(input.clientId) : undefined,
        datePreset: input?.datePreset ? String(input.datePreset) : undefined,
        since: input?.since ? String(input.since) : undefined,
        until: input?.until ? String(input.until) : undefined,
        metrics: Array.isArray(input?.metrics) ? input.metrics.map(String) : undefined,
        dimensions: Array.isArray(input?.dimensions) ? input.dimensions.map(String) : undefined,
        limit: input?.limit ? Number(input.limit) : undefined
      });
      return out;
    } catch (e: any) {
      return { error: `ga4_get_report: ${e?.message ?? e}` };
    }
  },
  async search_console_query(input, ctx) {
    try {
      const out = await searchConsoleQuery({
        workspaceId: ctx.workspaceId,
        siteUrl: input?.siteUrl ? String(input.siteUrl) : undefined,
        clientId: input?.clientId ? String(input.clientId) : undefined,
        since: input?.since ? String(input.since) : undefined,
        until: input?.until ? String(input.until) : undefined,
        datePreset: input?.datePreset ? String(input.datePreset) : undefined,
        dimensions: Array.isArray(input?.dimensions) ? input.dimensions : undefined,
        rowLimit: input?.rowLimit ? Number(input.rowLimit) : undefined
      });
      return out;
    } catch (e: any) {
      return { error: `search_console_query: ${e?.message ?? e}` };
    }
  },
  async generate_monthly_client_report(input, ctx) {
    try {
      let clientName = input?.clientName ? String(input.clientName) : undefined;
      const clientId = input?.clientId ? String(input.clientId) : undefined;
      if (clientId && !clientName) {
        const c = await prisma.client.findFirst({
          where: { id: clientId, workspaceId: ctx.workspaceId },
          select: { name: true }
        });
        clientName = c?.name ?? undefined;
      }
      const report = await generateMonthlyClientReport({
        workspaceId: ctx.workspaceId,
        clientId,
        clientName,
        datePreset: input?.datePreset ? String(input.datePreset) : undefined,
        since: input?.since ? String(input.since) : undefined,
        until: input?.until ? String(input.until) : undefined,
        include: Array.isArray(input?.include) ? input.include : undefined,
        primaryColor: input?.primaryColor ? String(input.primaryColor) : undefined
      });
      const file = await uploadAttachmentForTask({
        workspaceId: ctx.workspaceId,
        taskId: ctx.taskId,
        filename: report.filename,
        body: report.buffer,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        uploadedByUserId: ctx.config.userId
      });
      await prisma.comment.create({
        data: {
          workspaceId: ctx.workspaceId,
          authorId: ctx.config.userId,
          targetType: "TASK",
          targetId: ctx.taskId,
          body: report.summary + `\n\n📎 Informe completo: **${file.filename}**`
        }
      });
      return {
        ok: true,
        fileId: file.fileId,
        filename: file.filename,
        sizeBytes: file.sizeBytes,
        sources: report.sources,
        summary: report.summary.slice(0, 800)
      };
    } catch (e: any) {
      return { error: `generate_monthly_client_report: ${e?.message ?? e}` };
    }
  },

  async gmb_list_accounts(_input, ctx) {
    try {
      const accounts = await gmbListAccounts(ctx.workspaceId);
      return { count: accounts.length, accounts };
    } catch (e: any) {
      return { error: `gmb_list_accounts: ${e?.message ?? e}` };
    }
  },
  async gmb_list_locations(input, ctx) {
    try {
      const accountId = String(input?.accountId ?? "").trim();
      if (!accountId) return { error: "accountId requerido" };
      const locations = await gmbListLocations({ workspaceId: ctx.workspaceId, accountId });
      return { count: locations.length, locations };
    } catch (e: any) {
      return { error: `gmb_list_locations: ${e?.message ?? e}` };
    }
  },
  async gmb_list_reviews(input, ctx) {
    try {
      const reviews = await gmbListReviews({
        workspaceId: ctx.workspaceId,
        clientId: input?.clientId ? String(input.clientId) : undefined,
        accountId: input?.accountId ? String(input.accountId) : undefined,
        locationId: input?.locationId ? String(input.locationId) : undefined,
        pageSize: input?.pageSize ? Number(input.pageSize) : undefined,
        orderBy: input?.orderBy ? String(input.orderBy) : undefined
      });
      const negativos = reviews.filter((r) => r.rating > 0 && r.rating <= 3).length;
      const sinResponder = reviews.filter((r) => !r.reply).length;
      return {
        count: reviews.length,
        negativeOrNeutralCount: negativos,
        unansweredCount: sinResponder,
        reviews
      };
    } catch (e: any) {
      return { error: `gmb_list_reviews: ${e?.message ?? e}` };
    }
  },
  async gmb_reply_to_review(input, ctx) {
    try {
      const comment = String(input?.comment ?? "").trim();
      if (!comment) return { error: "comment vacío" };
      const res = await gmbReplyReview({
        workspaceId: ctx.workspaceId,
        reviewName: input?.reviewName ? String(input.reviewName) : undefined,
        accountId: input?.accountId ? String(input.accountId) : undefined,
        locationId: input?.locationId ? String(input.locationId) : undefined,
        clientId: input?.clientId ? String(input.clientId) : undefined,
        reviewId: input?.reviewId ? String(input.reviewId) : undefined,
        comment
      });
      return { ok: true, ...res };
    } catch (e: any) {
      return { error: `gmb_reply_to_review: ${e?.message ?? e}` };
    }
  },
  async gmb_delete_review_reply(input, ctx) {
    try {
      const res = await gmbDeleteReviewReply({
        workspaceId: ctx.workspaceId,
        reviewName: input?.reviewName ? String(input.reviewName) : undefined,
        accountId: input?.accountId ? String(input.accountId) : undefined,
        locationId: input?.locationId ? String(input.locationId) : undefined,
        reviewId: input?.reviewId ? String(input.reviewId) : undefined,
        clientId: input?.clientId ? String(input.clientId) : undefined
      });
      return res;
    } catch (e: any) {
      return { error: `gmb_delete_review_reply: ${e?.message ?? e}` };
    }
  },
  async gmb_create_post(input, ctx) {
    try {
      const summary = String(input?.summary ?? "").trim();
      if (!summary) return { error: "summary vacío" };
      const cta = input?.callToAction;
      const res = await gmbCreatePost({
        workspaceId: ctx.workspaceId,
        clientId: input?.clientId ? String(input.clientId) : undefined,
        accountId: input?.accountId ? String(input.accountId) : undefined,
        locationId: input?.locationId ? String(input.locationId) : undefined,
        summary,
        topicType: input?.topicType ?? "STANDARD",
        callToAction: cta
          ? { actionType: String(cta.actionType), url: cta.url ? String(cta.url) : undefined }
          : undefined,
        mediaUrl: input?.mediaUrl ? String(input.mediaUrl) : undefined,
        eventTitle: input?.eventTitle ? String(input.eventTitle) : undefined,
        eventStartIso: input?.eventStartIso ? String(input.eventStartIso) : undefined,
        eventEndIso: input?.eventEndIso ? String(input.eventEndIso) : undefined,
        offerCouponCode: input?.offerCouponCode ? String(input.offerCouponCode) : undefined,
        offerRedeemUrl: input?.offerRedeemUrl ? String(input.offerRedeemUrl) : undefined,
        offerTerms: input?.offerTerms ? String(input.offerTerms) : undefined,
        languageCode: input?.languageCode ? String(input.languageCode) : undefined
      });
      return { ok: true, ...res };
    } catch (e: any) {
      return { error: `gmb_create_post: ${e?.message ?? e}` };
    }
  },
  async gmb_unreplied_reviews_briefing(input, ctx) {
    try {
      const reviews = await gmbListReviews({
        workspaceId: ctx.workspaceId,
        clientId: input?.clientId ? String(input.clientId) : undefined,
        accountId: input?.accountId ? String(input.accountId) : undefined,
        locationId: input?.locationId ? String(input.locationId) : undefined,
        pageSize: input?.maxReviews ? Number(input.maxReviews) : 15
      });
      const unreplied = reviews.filter((r) => !r.reply);
      const positives = unreplied.filter((r) => r.rating >= 4);
      const neutral = unreplied.filter((r) => r.rating === 3);
      const negatives = unreplied.filter((r) => r.rating > 0 && r.rating <= 2);

      // Enriquecer con contexto cliente si tenemos clientId
      let clientContext: any = null;
      if (input?.clientId) {
        const c = await prisma.client.findFirst({
          where: { id: String(input.clientId), workspaceId: ctx.workspaceId },
          select: {
            name: true,
            brandBrief: true,
            brandColorPrimary: true,
            brandColorAccent: true,
            styleGuideCached: true,
            email: true,
            phone: true,
            website: true,
            notes: true
          }
        });
        if (c) {
          clientContext = {
            name: c.name,
            brandBrief: c.brandBrief?.slice(0, 800),
            styleGuide: c.styleGuideCached?.slice(0, 1500),
            colors: { primary: c.brandColorPrimary, accent: c.brandColorAccent },
            contact: {
              email: c.email,
              phone: c.phone,
              website: c.website
            },
            notes: c.notes?.slice(0, 400)
          };
        }
      }

      return {
        totalUnreplied: unreplied.length,
        bySentiment: {
          positives: positives.map(stripReviewForBriefing),
          neutral: neutral.map(stripReviewForBriefing),
          negatives: negatives.map(stripReviewForBriefing)
        },
        clientContext,
        instructions: {
          positives:
            "Agradece breve, menciona algo específico del comentario, invita a volver. Tono del brandBrief.",
          neutral:
            "Reconoce el feedback, pregunta amablemente qué mejorar. Cero defensiva.",
          negatives:
            "REQUIERE request_user_approval antes de publicar. Tono: reconocer, disculpa si procede, mover offline (teléfono/email del cliente). NUNCA negar ni atacar."
        }
      };
    } catch (e: any) {
      return { error: `gmb_unreplied_reviews_briefing: ${e?.message ?? e}` };
    }
  },

  async gmb_get_insights(input, ctx) {
    try {
      const res = await gmbGetInsights({
        workspaceId: ctx.workspaceId,
        clientId: input?.clientId ? String(input.clientId) : undefined,
        accountId: input?.accountId ? String(input.accountId) : undefined,
        locationId: input?.locationId ? String(input.locationId) : undefined,
        since: input?.since ? String(input.since) : undefined,
        until: input?.until ? String(input.until) : undefined,
        metrics: Array.isArray(input?.metrics) ? input.metrics.map(String) : undefined
      });
      return res;
    } catch (e: any) {
      return { error: `gmb_get_insights: ${e?.message ?? e}` };
    }
  },

  async weekly_social_summary(input, ctx) {
    try {
      const clientId = String(input?.clientId ?? "").trim();
      if (!clientId) return { error: "clientId requerido" };
      const delivery = (input?.delivery as string) ?? "comment";
      const result = await generateWeeklySocialSummary({
        workspaceId: ctx.workspaceId,
        clientId,
        networks: Array.isArray(input?.networks) ? input.networks : undefined,
        skipMetaAds: !!input?.skipMetaAds
      });

      const deliveryReport: Record<string, "ok" | "skipped" | string> = {};

      if (delivery === "comment" || delivery === "all") {
        await prisma.comment.create({
          data: {
            workspaceId: ctx.workspaceId,
            authorId: ctx.config.userId,
            targetType: "TASK",
            targetId: ctx.taskId,
            body: result.summary
          }
        });
        deliveryReport.comment = "ok";
      }

      if ((delivery === "whatsapp" || delivery === "all") && result.clientPhone) {
        try {
          const { sendText, normalizePhone } = await import("@/lib/leads/waha");
          const phoneNormalized = normalizePhone(result.clientPhone);
          if (!phoneNormalized) throw new Error("Teléfono inválido");
          await sendText({
            workspaceId: ctx.workspaceId,
            phoneNormalized,
            text: result.summary
          });
          deliveryReport.whatsapp = "ok";
        } catch (e: any) {
          deliveryReport.whatsapp = e?.message ?? String(e);
        }
      } else if (delivery === "whatsapp" || delivery === "all") {
        deliveryReport.whatsapp = "skipped: cliente sin teléfono";
      }

      if ((delivery === "email" || delivery === "all") && result.clientEmail) {
        try {
          const { sendEmail, isEmailEnabled } = await import("@/lib/integrations/email");
          if (!isEmailEnabled()) throw new Error("Email no configurado en el workspace");
          const subject =
            (input?.emailSubject as string | undefined) ??
            `Resumen semanal — ${result.clientName ?? "tu negocio"}`;
          // Markdown a texto plano para el email
          await sendEmail({
            to: result.clientEmail,
            subject,
            text: result.summary,
            html: `<pre style="font-family:Helvetica,Arial,sans-serif;white-space:pre-wrap;font-size:14px">${escapeHtml(
              result.summary
            )}</pre>`
          });
          deliveryReport.email = "ok";
        } catch (e: any) {
          deliveryReport.email = e?.message ?? String(e);
        }
      } else if (delivery === "email" || delivery === "all") {
        deliveryReport.email = "skipped: cliente sin email";
      }

      return {
        ok: true,
        clientName: result.clientName,
        delivery: deliveryReport,
        sources: result.sources,
        summaryPreview: result.summary.slice(0, 400)
      };
    } catch (e: any) {
      return { error: `weekly_social_summary: ${e?.message ?? e}` };
    }
  },

  async auto_tag_task(input, ctx) {
    try {
      const tags = Array.isArray(input?.tags) ? input.tags.slice(0, 3) : [];
      if (tags.length === 0) return { error: "tags vacío" };

      // Crea/recupera cada Tag (idempotente, único por workspace+name)
      const tagIds: string[] = [];
      const colorByTag: Record<string, string> = {
        urgente: "bg-rose-200",
        "requiere-cliente-final": "bg-amber-200",
        "creativo-pendiente": "bg-violet-200",
        "dato-faltante": "bg-slate-300",
        "reseña-negativa": "bg-orange-200",
        "campaña-activa": "bg-emerald-200",
        "informe-mensual": "bg-sky-200",
        seguimiento: "bg-indigo-200"
      };
      for (const name of tags) {
        const t = await prisma.tag.upsert({
          where: {
            workspaceId_name: { workspaceId: ctx.workspaceId, name: String(name) }
          },
          update: {},
          create: {
            workspaceId: ctx.workspaceId,
            name: String(name),
            color: colorByTag[String(name)] ?? "bg-slate-200"
          },
          select: { id: true }
        });
        tagIds.push(t.id);
      }

      // Aplicar a la task (idempotente)
      for (const tagId of tagIds) {
        await prisma.taskTag.upsert({
          where: { taskId_tagId: { taskId: ctx.taskId, tagId } },
          update: {},
          create: { taskId: ctx.taskId, tagId }
        });
      }

      return { ok: true, applied: tags };
    } catch (e: any) {
      return { error: `auto_tag_task: ${e?.message ?? e}` };
    }
  },

  async generate_voice_audio(input, ctx) {
    const text = String(input?.text ?? "").trim();
    if (!text) return { error: "text vacío" };
    if (text.length > 4000) return { error: "text demasiado largo (>4000)" };
    try {
      const buf = await elevenlabsSynthesize({ workspaceId: ctx.workspaceId, text });
      const filename = `nv-ia-voice-${Date.now()}.mp3`;
      const s3Key = buildS3Key({
        workspaceId: ctx.workspaceId,
        targetType: "TASK",
        targetId: ctx.taskId,
        filename
      });
      await uploadBuffer({ s3Key, body: buf, contentType: "audio/mpeg" });
      const file = await prisma.file.create({
        data: {
          workspaceId: ctx.workspaceId,
          name: filename,
          mimeType: "audio/mpeg",
          sizeBytes: buf.length,
          s3Key,
          targetType: "TASK",
          targetId: ctx.taskId,
          uploadedBy: ctx.config.userId
        }
      });
      return {
        ok: true,
        fileId: file.id,
        filename,
        sizeBytes: buf.length,
        durationApproxSeconds: Math.round(buf.length / 16_000), // rough estimate at 128kbps
        message: "Audio generado y adjuntado a la tarea. El admin lo escucha y decide si reenviarlo."
      };
    } catch (e: any) {
      return { error: `Voz falló: ${e?.message ?? e}` };
    }
  },

  async metricool_list_brands(_input, ctx) {
    try {
      const brands = await metricoolListBrands({ workspaceId: ctx.workspaceId });
      return {
        count: Array.isArray(brands) ? brands.length : 0,
        brands: (Array.isArray(brands) ? brands : []).map((b: any) => ({
          id: b.id ?? b.blogId,
          name: b.name ?? b.title,
          networks: b.networks ?? b.profiles
        }))
      };
    } catch (e: any) {
      return { error: `Metricool no disponible: ${e?.message ?? e}` };
    }
  },

  async metricool_get_stats(input, ctx) {
    try {
      const stats = await metricoolGetStats({
        workspaceId: ctx.workspaceId,
        blogId: input?.blogId ? String(input.blogId) : undefined,
        network: input?.network,
        from: input?.from ? String(input.from) : undefined,
        to: input?.to ? String(input.to) : undefined
      });
      // Cap defensivo del response — Metricool puede devolver mucho JSON
      const str = JSON.stringify(stats);
      if (str.length > 12_000) {
        return {
          ok: true,
          truncated: true,
          preview: str.slice(0, 12_000) + "...[truncado]"
        };
      }
      return { ok: true, stats };
    } catch (e: any) {
      return { error: `Metricool no disponible: ${e?.message ?? e}` };
    }
  },

  async make_list_teams(_input, ctx) {
    try {
      const { makeListTeams } = await import("@/lib/integrations/make");
      const teams = await makeListTeams(ctx.workspaceId);
      return { count: teams.length, teams };
    } catch (e: any) {
      return { error: `make_list_teams: ${e?.message ?? e}` };
    }
  },
  async make_list_scenarios(input, ctx) {
    try {
      const { makeListScenarios } = await import("@/lib/integrations/make");
      const scenarios = await makeListScenarios({
        workspaceId: ctx.workspaceId,
        teamId: input?.teamId ? Number(input.teamId) : undefined,
        query: input?.query ? String(input.query) : undefined,
        pageSize: input?.pageSize ? Number(input.pageSize) : undefined
      });
      return { count: scenarios.length, scenarios };
    } catch (e: any) {
      return { error: `make_list_scenarios: ${e?.message ?? e}` };
    }
  },
  async make_get_blueprint(input, ctx) {
    try {
      const { makeGetBlueprint } = await import("@/lib/integrations/make");
      const blueprint = await makeGetBlueprint({
        workspaceId: ctx.workspaceId,
        scenarioId: Number(input?.scenarioId)
      });
      return { blueprint };
    } catch (e: any) {
      return { error: `make_get_blueprint: ${e?.message ?? e}` };
    }
  },
  async make_create_scenario(input, ctx) {
    try {
      const { readResources, recordResources } = await import(
        "@/lib/ai/nv-ia/resource-registry"
      );
      if (!input?.forceCreate) {
        const state = await readResources(ctx.taskId);
        if (state.make?.scenarioId) {
          return {
            ok: true,
            id: state.make.scenarioId,
            deduped: true,
            message:
              "REUSING existing Make scenario from this task. Si necesitas el blueprint actual, llama make_get_blueprint. Pass forceCreate:true para crear otro."
          };
        }
      }
      const { makeCreateScenario } = await import("@/lib/integrations/make");
      const res = await makeCreateScenario({
        workspaceId: ctx.workspaceId,
        blueprint: input?.blueprint,
        name: input?.name ? String(input.name) : undefined,
        teamId: input?.teamId ? Number(input.teamId) : undefined,
        folderId: input?.folderId ? Number(input.folderId) : undefined,
        scheduling: input?.scheduling
      });
      await recordResources(ctx.taskId, { make: { scenarioId: res.id } });
      return { ok: true, ...res };
    } catch (e: any) {
      return { error: `make_create_scenario: ${e?.message ?? e}` };
    }
  },
  async make_activate_scenario(input, ctx) {
    try {
      const { makeActivateScenario } = await import("@/lib/integrations/make");
      await makeActivateScenario({
        workspaceId: ctx.workspaceId,
        scenarioId: Number(input?.scenarioId)
      });
      return { ok: true };
    } catch (e: any) {
      return { error: `make_activate_scenario: ${e?.message ?? e}` };
    }
  },
  async make_deactivate_scenario(input, ctx) {
    try {
      const { makeDeactivateScenario } = await import("@/lib/integrations/make");
      await makeDeactivateScenario({
        workspaceId: ctx.workspaceId,
        scenarioId: Number(input?.scenarioId)
      });
      return { ok: true };
    } catch (e: any) {
      return { error: `make_deactivate_scenario: ${e?.message ?? e}` };
    }
  },

  async make_raw_api(input, ctx) {
    try {
      const { makeRawCall } = await import("@/lib/integrations/make");
      const method = String(input?.method ?? "GET").toUpperCase() as
        | "GET"
        | "POST"
        | "PATCH"
        | "PUT"
        | "DELETE";
      const path = String(input?.path ?? "").trim();
      if (!path) return { error: "path requerido" };
      const result = await makeRawCall({
        workspaceId: ctx.workspaceId,
        method,
        path,
        body: input?.body,
        query: input?.query
      });
      return result;
    } catch (e: any) {
      return { error: `make_raw_api: ${e?.message ?? e}` };
    }
  },

  async holded_list_invoices(input, ctx) {
    try {
      const invoices = await holdedListInvoices({
        workspaceId: ctx.workspaceId,
        status: typeof input?.status === "number" ? input.status : undefined,
        limit: typeof input?.limit === "number" ? input.limit : 50
      });
      return {
        count: invoices.length,
        invoices: invoices.map((i) => ({
          id: i.id,
          docNumber: i.docNumber,
          contact: i.contactName ?? i.contact,
          desc: i.desc,
          date: i.date ? new Date(i.date * 1000).toISOString() : null,
          dueDate: i.dueDate ? new Date(i.dueDate * 1000).toISOString() : null,
          total: i.total,
          status: holdedInvoiceStatusLabel(i.status),
          statusCode: i.status,
          currency: i.currency
        }))
      };
    } catch (e: any) {
      return { error: `Holded no disponible: ${e?.message ?? e}` };
    }
  },

  async holded_list_contacts(input, ctx) {
    try {
      const contacts = await holdedListContacts({
        workspaceId: ctx.workspaceId,
        query: input?.query ? String(input.query) : undefined,
        limit: typeof input?.limit === "number" ? input.limit : 50
      });
      return {
        count: contacts.length,
        contacts: contacts.map((c) => ({
          id: c.id,
          name: c.name,
          email: c.email,
          phone: c.phone,
          code: c.code,
          isperson: c.isperson
        }))
      };
    } catch (e: any) {
      return { error: `Holded no disponible: ${e?.message ?? e}` };
    }
  },

  async holded_list_quotes(input, ctx) {
    try {
      const quotes = await holdedListQuotes({
        workspaceId: ctx.workspaceId,
        limit: typeof input?.limit === "number" ? input.limit : 50
      });
      return {
        count: quotes.length,
        quotes: quotes.map((q) => ({
          id: q.id,
          docNumber: q.docNumber,
          contact: q.contactName,
          desc: q.desc,
          total: q.total,
          status: holdedInvoiceStatusLabel(q.status)
        }))
      };
    } catch (e: any) {
      return { error: `Holded no disponible: ${e?.message ?? e}` };
    }
  },

  async draft_holded_invoice(input, ctx) {
    const items = Array.isArray(input?.items) ? input.items : [];
    if (items.length === 0) return { error: "items vacío — añade al menos una línea" };
    const draft = await prisma.aiDraft.create({
      data: {
        workspaceId: ctx.workspaceId,
        aiAgentRunId: ctx.runId,
        taskId: ctx.taskId,
        kind: "HOLDED_INVOICE",
        title: `Factura Holded → ${input?.contactName ?? input?.contactId ?? "?"}: ${input?.desc?.slice(0, 60) ?? "(sin desc)"}`,
        payload: {
          contactId: input?.contactId ?? null,
          contactName: input?.contactName ?? null,
          desc: input?.desc ?? null,
          items,
          notes: input?.notes ?? null
        }
      }
    });
    const auto = await maybeAutoApproveDraft(draft.id, "HOLDED_INVOICE", ctx);
    return {
      ok: true,
      draftId: draft.id,
      autoApproved: auto.autoApproved,
      message: auto.autoApproved
        ? "Factura creada y emitida en Holded."
        : "Borrador de factura creado. Quedará pendiente en /admin/nv-ia/drafts."
    };
  },

  async draft_holded_quote(input, ctx) {
    const items = Array.isArray(input?.items) ? input.items : [];
    if (items.length === 0) return { error: "items vacío" };
    const draft = await prisma.aiDraft.create({
      data: {
        workspaceId: ctx.workspaceId,
        aiAgentRunId: ctx.runId,
        taskId: ctx.taskId,
        kind: "HOLDED_QUOTE",
        title: `Presupuesto Holded → ${input?.contactName ?? input?.contactId ?? "?"}: ${input?.desc?.slice(0, 60) ?? "(sin desc)"}`,
        payload: {
          contactId: input?.contactId ?? null,
          contactName: input?.contactName ?? null,
          desc: input?.desc ?? null,
          items,
          notes: input?.notes ?? null
        }
      }
    });
    const auto = await maybeAutoApproveDraft(draft.id, "HOLDED_QUOTE", ctx);
    return {
      ok: true,
      draftId: draft.id,
      autoApproved: auto.autoApproved,
      message: auto.autoApproved
        ? "Presupuesto creado y enviado en Holded."
        : "Borrador de presupuesto creado. Pendiente de aprobación."
    };
  },

  async stripe_list_customers(input, ctx) {
    try {
      const customers = await stripeListCustomers({
        workspaceId: ctx.workspaceId,
        query: input?.query ? String(input.query) : undefined,
        limit: typeof input?.limit === "number" ? input.limit : 20
      });
      return {
        count: customers.length,
        customers: customers.map((c: any) => ({
          id: c.id,
          email: c.email,
          name: c.name,
          created: new Date(c.created * 1000).toISOString()
        }))
      };
    } catch (e: any) {
      return { error: `Stripe no disponible: ${e?.message ?? e}` };
    }
  },

  async stripe_list_invoices(input, ctx) {
    try {
      const invoices = await stripeListInvoices({
        workspaceId: ctx.workspaceId,
        customer: input?.customer ? String(input.customer) : undefined,
        status: input?.status,
        sinceDays: typeof input?.sinceDays === "number" ? input.sinceDays : undefined,
        limit: typeof input?.limit === "number" ? input.limit : 25
      });
      return {
        count: invoices.length,
        invoices: invoices.map((i: any) => ({
          id: i.id,
          number: i.number,
          customer: i.customer,
          amount_due: i.amount_due,
          amount_paid: i.amount_paid,
          currency: i.currency,
          status: i.status,
          due_date: i.due_date ? new Date(i.due_date * 1000).toISOString() : null,
          hosted_invoice_url: i.hosted_invoice_url
        }))
      };
    } catch (e: any) {
      return { error: `Stripe no disponible: ${e?.message ?? e}` };
    }
  },

  async draft_stripe_payment_link(input, ctx) {
    const productName = String(input?.productName ?? "").trim();
    const amount = Number(input?.amount) || 0;
    if (!productName) return { error: "productName vacío" };
    if (amount < 50) return { error: "amount mínimo Stripe es 50 céntimos" };
    const draft = await prisma.aiDraft.create({
      data: {
        workspaceId: ctx.workspaceId,
        aiAgentRunId: ctx.runId,
        taskId: ctx.taskId,
        kind: "STRIPE_PAYMENT_LINK",
        title: `Payment link Stripe → ${productName}: ${(amount / 100).toFixed(2)}€`,
        payload: {
          productName,
          amount,
          currency: input?.currency ?? "eur"
        }
      }
    });
    const auto = await maybeAutoApproveDraft(draft.id, "STRIPE_PAYMENT_LINK", ctx);
    return {
      ok: true,
      draftId: draft.id,
      autoApproved: auto.autoApproved,
      message: auto.autoApproved
        ? `Payment link creado en Stripe. URL: ${auto.executionResult?.externalId ?? "(en executionResult)"}`
        : "Borrador de payment link creado. Pendiente de aprobación."
    };
  },

  async start_client_workflow(input, ctx) {
    const workflowType = String(input?.workflowType ?? "").trim();
    let clientId = input?.clientId ? String(input.clientId) : null;
    if (!clientId) {
      const t = await prisma.task.findFirst({
        where: { id: ctx.taskId, workspaceId: ctx.workspaceId },
        select: { clientId: true }
      });
      clientId = t?.clientId ?? null;
    }
    if (!clientId) return { error: "La tarea no tiene cliente y no pasaste clientId" };
    const steps = getWorkflowDefinition(workflowType);
    if (!steps) return { error: `workflowType desconocido: ${workflowType}` };
    // No iniciar otro workflow del mismo tipo si ya hay uno ACTIVE
    const dup = await prisma.aiClientWorkflow.findFirst({
      where: { workspaceId: ctx.workspaceId, clientId, workflowType, status: "ACTIVE" }
    });
    if (dup) return { error: `Ya hay un workflow ${workflowType} activo para este cliente (id ${dup.id})` };
    const wf = await prisma.aiClientWorkflow.create({
      data: {
        workspaceId: ctx.workspaceId,
        clientId,
        workflowType,
        steps: steps as any,
        nextStepIdx: 0,
        status: "ACTIVE"
      }
    });
    return {
      ok: true,
      workflowId: wf.id,
      stepsTotal: steps.length,
      message: `Workflow '${workflowType}' iniciado con ${steps.length} pasos. El cron workflow-tick procesará el primero pronto.`
    };
  },

  async generate_image(input, ctx) {
    const prompt = String(input?.prompt ?? "").trim();
    if (!prompt) return { error: "prompt vacío" };
    if (prompt.length > 4000) return { error: "prompt demasiado largo (>4000)" };
    const sizeMap: Record<string, string> = {
      square: "1024x1024",
      portrait: "1024x1536",
      landscape: "1536x1024"
    };
    const size = sizeMap[String(input?.size ?? "square")] ?? "1024x1024";
    const purpose = String(input?.purpose ?? "image");
    try {
      const apiKey = await getOpenAiKeyForWorkspace(ctx.workspaceId);
      const resp = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-image-1",
          prompt,
          size,
          n: 1,
          response_format: "b64_json",
          quality: "medium"
        })
      });
      if (!resp.ok) {
        const txt = await resp.text();
        return { error: `OpenAI imagen ${resp.status}: ${txt.slice(0, 200)}` };
      }
      const data = await resp.json();
      const b64 = data?.data?.[0]?.b64_json;
      if (!b64) return { error: "OpenAI no devolvió imagen" };
      // Subir a R2 + crear File adjunto a la task
      const filename = `nv-ia-${purpose.replace(/[^a-z0-9-]/gi, "-").slice(0, 30)}-${Date.now()}.png`;
      const s3Key = buildS3Key({
        workspaceId: ctx.workspaceId,
        targetType: "TASK",
        targetId: ctx.taskId,
        filename
      });
      const buf = Buffer.from(b64, "base64");
      await uploadBuffer({ s3Key, body: buf, contentType: "image/png" });
      const file = await prisma.file.create({
        data: {
          workspaceId: ctx.workspaceId,
          name: filename,
          mimeType: "image/png",
          sizeBytes: buf.length,
          s3Key,
          targetType: "TASK",
          targetId: ctx.taskId,
          uploadedBy: ctx.config.userId
        }
      });
      return {
        ok: true,
        fileId: file.id,
        filename,
        size,
        sizeBytes: buf.length,
        message: "Imagen generada y adjuntada a la tarea actual."
      };
    } catch (e: any) {
      return { error: `Generación de imagen falló: ${e?.message ?? e}` };
    }
  },

  async query_knowledge_graph(input, ctx) {
    const query = String(input?.query ?? "").trim();
    if (!query) return { error: "query vacío" };
    const sinceDays = Math.min(Math.max(Number(input?.sinceDays) || 365, 1), 1825);
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
    const clientFilter = String(input?.clientFilter ?? "").trim();
    const industryFilter = String(input?.industryFilter ?? "").trim();

    // Resolvemos clientes que matchean filtros
    let clientIds: string[] | null = null;
    if (clientFilter || industryFilter) {
      const clients = await prisma.client.findMany({
        where: {
          workspaceId: ctx.workspaceId,
          ...(clientFilter ? { name: { contains: clientFilter, mode: "insensitive" as any } } : {}),
          ...(industryFilter ? { industry: { contains: industryFilter, mode: "insensitive" as any } } : {})
        },
        select: { id: true, name: true, industry: true }
      });
      clientIds = clients.map((c) => c.id);
      if (clientIds.length === 0) {
        return { count: 0, results: [], note: "No hay clientes que matcheen los filtros" };
      }
    }

    // Búsqueda semántica multi-tipo
    const results = await semanticSearch({
      workspaceId: ctx.workspaceId,
      query,
      topK: 25,
      entityTypes: ["TASK", "COMMENT", "PROJECT", "CLIENT", "DOCUMENT"]
    });

    // Para cada hit, resolvemos su clientId (de Task→clientId,
    // Project→clientId, Comment→targetType=Task→clientId, etc.)
    // y filtramos por clientIds + fecha si aplica.
    const enriched: any[] = [];
    for (const r of results) {
      let clientId: string | null = null;
      let entityDate: Date | null = null;
      try {
        if (r.entityType === "TASK") {
          const t = await prisma.task.findUnique({
            where: { id: r.entityId },
            select: { clientId: true, createdAt: true }
          });
          clientId = t?.clientId ?? null;
          entityDate = t?.createdAt ?? null;
        } else if (r.entityType === "COMMENT") {
          const c = await prisma.comment.findUnique({
            where: { id: r.entityId },
            select: { targetType: true, targetId: true, createdAt: true }
          });
          entityDate = c?.createdAt ?? null;
          if (c?.targetType === "TASK") {
            const t = await prisma.task.findUnique({
              where: { id: c.targetId },
              select: { clientId: true }
            });
            clientId = t?.clientId ?? null;
          }
        } else if (r.entityType === "PROJECT") {
          const p = await prisma.project.findUnique({
            where: { id: r.entityId },
            select: { clientId: true, createdAt: true }
          });
          clientId = p?.clientId ?? null;
          entityDate = p?.createdAt ?? null;
        } else if (r.entityType === "CLIENT") {
          clientId = r.entityId;
          const c = await prisma.client.findUnique({
            where: { id: r.entityId },
            select: { createdAt: true }
          });
          entityDate = c?.createdAt ?? null;
        }
      } catch {}
      if (clientIds && (!clientId || !clientIds.includes(clientId))) continue;
      if (entityDate && entityDate < since) continue;
      enriched.push({
        type: r.entityType,
        id: r.entityId,
        score: Math.round(r.score * 100) / 100,
        text: r.text.slice(0, 400),
        clientId,
        date: entityDate?.toISOString() ?? null
      });
    }

    // Agrupamos por cliente
    const byClient: Record<string, any[]> = {};
    for (const e of enriched) {
      const key = e.clientId ?? "(sin cliente)";
      byClient[key] = byClient[key] ?? [];
      byClient[key].push(e);
    }
    return {
      count: enriched.length,
      groups: Object.entries(byClient).map(([cid, items]) => ({
        clientId: cid,
        count: items.length,
        items
      }))
    };
  },

  async propose_new_tool(input, ctx) {
    const name = String(input?.name ?? "").trim();
    const description = String(input?.description ?? "").trim();
    const executorPseudoCode = String(input?.executorPseudoCode ?? "").trim();
    const rationale = String(input?.rationale ?? "").trim();
    if (!name || !/^[a-z_][a-z0-9_]*$/.test(name)) {
      return { error: "name debe ser snake_case (a-z, 0-9, _)" };
    }
    if (!description || !executorPseudoCode || !rationale) {
      return { error: "description, executorPseudoCode y rationale son obligatorios" };
    }
    // Anti-spam: máximo 3 propuestas por run
    const existingInRun = await prisma.aiProposedTool.count({
      where: { proposedByRunId: ctx.runId }
    });
    if (existingInRun >= 3) {
      return { error: "Ya has propuesto 3 tools en este run — concentra las mejoras" };
    }
    // Dedupe por name dentro del workspace
    const dup = await prisma.aiProposedTool.findFirst({
      where: { workspaceId: ctx.workspaceId, name, status: { in: ["PROPOSED", "APPROVED"] } }
    });
    if (dup) return { error: `Ya hay una tool propuesta con name="${name}" (status=${dup.status})` };

    const created = await prisma.aiProposedTool.create({
      data: {
        workspaceId: ctx.workspaceId,
        proposedByRunId: ctx.runId,
        name,
        description,
        inputSchema: input?.inputSchema ?? {},
        executorPseudoCode,
        rationale,
        status: "PROPOSED"
      }
    });
    return {
      ok: true,
      proposedToolId: created.id,
      message: "Propuesta guardada. El admin la verá en /admin/nv-ia/proposed-tools y decidirá si la implementa."
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

  async notify_user(input, ctx) {
    const userId = String(input?.userId ?? "").trim();
    const body = String(input?.body ?? "").trim();
    if (!userId || !body) return { error: "userId y body son obligatorios" };
    if (body.length > 280) return { error: "body demasiado largo (>280)" };
    // Validamos membership del workspace para no notificar a externos
    const m = await prisma.membership.findFirst({
      where: { workspaceId: ctx.workspaceId, userId },
      select: { userId: true }
    });
    if (!m) return { error: "ese user no pertenece al workspace" };
    if (userId === ctx.config.userId) return { error: "Sonia no se auto-notifica" };
    await prisma.notification.create({
      data: {
        userId,
        type: "ai_notify",
        body: `Sonia: ${body}`,
        link: input?.link ? String(input.link).slice(0, 500) : null
      }
    });
    return { ok: true };
  },

  async tag_task(input, ctx) {
    const names: string[] = Array.isArray(input?.tagNames)
      ? (input.tagNames as unknown[]).map((n) => String(n).trim()).filter(Boolean)
      : [];
    if (names.length === 0) return { error: "tagNames vacío" };
    if (names.length > 10) return { error: "máximo 10 tags" };
    // Upsert por (workspaceId, name) — crea las que no existan.
    const colors = ["bg-slate-200", "bg-sky-100", "bg-amber-100", "bg-emerald-100", "bg-rose-100", "bg-violet-100"];
    const tagIds: string[] = [];
    for (let i = 0; i < names.length; i++) {
      const t = await prisma.tag.upsert({
        where: { workspaceId_name: { workspaceId: ctx.workspaceId, name: names[i] } },
        create: {
          workspaceId: ctx.workspaceId,
          name: names[i],
          color: colors[i % colors.length]
        },
        update: {}
      });
      tagIds.push(t.id);
    }
    // Reemplazo: borra TaskTag existentes y crea los nuevos.
    await prisma.$transaction([
      prisma.taskTag.deleteMany({ where: { taskId: ctx.taskId } }),
      prisma.taskTag.createMany({
        data: tagIds.map((tagId) => ({ taskId: ctx.taskId, tagId }))
      })
    ]);
    return { ok: true, applied: names };
  },

  async set_task_due_date(input, ctx) {
    const raw = String(input?.dueDateIso ?? "").trim();
    let dueDate: Date | null = null;
    if (raw && raw !== "null") {
      const d = new Date(raw);
      if (isNaN(d.getTime())) return { error: "dueDateIso inválido (esperaba ISO 8601 o 'null')" };
      dueDate = d;
    }
    await prisma.task.update({
      where: { id: ctx.taskId },
      data: { dueDate }
    });
    return { ok: true, dueDate: dueDate?.toISOString() ?? null };
  },

  async set_task_priority(input, ctx) {
    const p = String(input?.priority ?? "").trim();
    if (!["LOW", "MEDIUM", "HIGH", "URGENT"].includes(p)) {
      return { error: "priority debe ser LOW | MEDIUM | HIGH | URGENT" };
    }
    await prisma.task.update({
      where: { id: ctx.taskId },
      data: { priority: p as any }
    });
    return { ok: true, priority: p };
  },

  async mark_complete(input, ctx) {
    const summary = String(input?.summary ?? "").trim();
    if (!summary) return { error: "summary vacío" };
    if (summary.length > 8000) return { error: "summary demasiado largo" };
    // 1. Comentario final firmado como Sonia
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
    // 2. Mover a la columna "completado" SOLO si el workspace lo activa
    // explícitamente (settings.aiAgent.moveToDoneOnComplete = true). Por
    // defecto NO cambiamos de columna: el user organiza su kanban a mano y
    // no quiere que Sonia le mueva las tarjetas al terminar.
    let doneStatus: string | null = null;
    try {
      const wsCfg = await prisma.workspace.findUnique({
        where: { id: ctx.workspaceId },
        select: { settings: true }
      });
      const moveOnComplete = (wsCfg?.settings as any)?.aiAgent?.moveToDoneOnComplete === true;
      if (moveOnComplete) {
        const task = await prisma.task.findUnique({
          where: { id: ctx.taskId },
          select: { projectId: true }
        });
        if (task?.projectId) {
          const project = await prisma.project.findUnique({
            where: { id: task.projectId },
            select: { kanbanColumns: true }
          });
          const cols = Array.isArray((project as any)?.kanbanColumns)
            ? ((project as any).kanbanColumns as Array<any>)
            : [];
          if (cols.length > 0) {
            const explicitDone = cols.find((c) => c?.isDone === true);
            const byName = explicitDone
              ? null
              : cols.find((c) =>
                  /(hecho|done|complete|completad|publicad|finalizad|terminad)/i.test(
                    `${c?.label ?? ""} ${c?.id ?? ""}`
                  )
                );
            const last = cols
              .slice()
              .sort((a, b) => (a?.order ?? 0) - (b?.order ?? 0))
              .at(-1);
            doneStatus = explicitDone?.id ?? byName?.id ?? last?.id ?? "DONE";
          } else {
            doneStatus = "DONE";
          }
        }
      }
    } catch {
      // Si algo falla, NO movemos de columna.
    }

    await prisma.task.update({
      where: { id: ctx.taskId },
      data: { completedAt: new Date(), ...(doneStatus ? { status: doneStatus } : {}) }
    });
    return {
      ok: true,
      commentId: comment.id,
      completed: true,
      status: doneStatus ?? "(columna sin cambios)"
    };
  },
  async attach_file_to_task(input, ctx) {
    const filename = String(input?.filename ?? "").trim();
    const mimeType = String(input?.mimeType ?? "").trim();
    const contentText = typeof input?.contentText === "string" ? input.contentText : null;
    const contentBase64 = typeof input?.contentBase64 === "string" ? input.contentBase64 : null;
    const description =
      typeof input?.description === "string" ? input.description.trim() : "";

    if (!filename) return { error: "filename vacío" };
    if (!mimeType) return { error: "mimeType vacío" };
    if (!contentText && !contentBase64) {
      return { error: "Debes pasar contentText O contentBase64." };
    }
    if (contentText && contentBase64) {
      return { error: "Pasa SOLO uno: contentText o contentBase64, no ambos." };
    }
    let buf: Buffer;
    try {
      buf = contentText
        ? Buffer.from(contentText, "utf-8")
        : Buffer.from(contentBase64!, "base64");
    } catch (e: any) {
      return { error: `decode falló: ${e?.message ?? e}` };
    }
    // Límite suave: 15MB. Más grande probablemente sea ruido.
    if (buf.length > 15 * 1024 * 1024) {
      return { error: `Archivo demasiado grande: ${humanSize(buf.length)} (max 15MB)` };
    }
    try {
      const result = await uploadAttachmentForTask({
        workspaceId: ctx.workspaceId,
        taskId: ctx.taskId,
        filename,
        body: buf,
        mimeType,
        uploadedByUserId: ctx.config.userId
      });
      // Comentario informativo firmado como Sonia.
      const note = description || `He adjuntado el archivo **${filename}** (${humanSize(buf.length)}).`;
      await prisma.comment.create({
        data: {
          workspaceId: ctx.workspaceId,
          authorId: ctx.config.userId,
          targetType: "TASK",
          targetId: ctx.taskId,
          body: `📎 ${note}`,
          bodyJson: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: `📎 ${note}` }] }]
          }
        }
      });
      return {
        ok: true,
        fileId: result.fileId,
        filename: result.filename,
        sizeBytes: result.sizeBytes,
        mimeType: result.mimeType
      };
    } catch (e: any) {
      return { error: `attach falló: ${e?.message ?? e}` };
    }
  },
  async attach_report_to_task(input, ctx) {
    const filename = String(input?.filename ?? "informe.html").trim();
    const title = String(input?.title ?? "").trim();
    const markdown = String(input?.markdown ?? "").trim();
    const subtitle =
      typeof input?.subtitle === "string" ? input.subtitle.trim() : undefined;
    const footer = typeof input?.footer === "string" ? input.footer.trim() : undefined;
    if (!title) return { error: "title vacío" };
    if (!markdown) return { error: "markdown vacío" };
    if (markdown.length > 200_000) {
      return { error: "markdown demasiado largo (>200KB)" };
    }
    const bodyHtml = markdownToHtmlBody(markdown);
    const html = wrapAsReportHtml({ title, bodyHtml, subtitle, footer });
    const safeName = /\.html?$/i.test(filename) ? filename : `${filename}.html`;
    try {
      const result = await uploadAttachmentForTask({
        workspaceId: ctx.workspaceId,
        taskId: ctx.taskId,
        filename: safeName,
        body: Buffer.from(html, "utf-8"),
        mimeType: "text/html",
        uploadedByUserId: ctx.config.userId
      });
      const note = `📎 He adjuntado el informe **${title}** como ${safeName} (${humanSize(result.sizeBytes)}). Ábrelo en el navegador para verlo maquetado; usa Ctrl+P → "Guardar como PDF" si lo quieres en PDF para el cliente.`;
      await prisma.comment.create({
        data: {
          workspaceId: ctx.workspaceId,
          authorId: ctx.config.userId,
          targetType: "TASK",
          targetId: ctx.taskId,
          body: note,
          bodyJson: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: note }] }]
          }
        }
      });
      return {
        ok: true,
        fileId: result.fileId,
        filename: result.filename,
        sizeBytes: result.sizeBytes
      };
    } catch (e: any) {
      return { error: `attach_report falló: ${e?.message ?? e}` };
    }
  },
  async validate_credentials(input, ctx) {
    const { validateWorkspaceCredentials } = await import("@/lib/credentials/validate");
    const requested = Array.isArray(input?.integrations)
      ? (input.integrations.map((s: any) => String(s)) as any[])
      : [];
    const r = await validateWorkspaceCredentials({
      workspaceId: ctx.workspaceId,
      integrations: requested.length > 0 ? requested : undefined,
      adhoc: ctx.adhocCredentials
    });
    return {
      ok: r.invalid.length === 0,
      checked: r.checked,
      valid: r.valid,
      invalid: r.invalid,
      summary:
        r.invalid.length === 0
          ? `Las ${r.valid.length} integraciones funcionan.`
          : `${r.invalid.length} integración(es) con problemas: ${r.invalid.map((i) => i.integration).join(", ")}.`
    };
  },
  async escalate_to_claude(input, ctx) {
    const reason = String(input?.reason ?? "").trim();
    const blockingType = String(input?.blockingType ?? "other").trim();
    const suggestedFix =
      typeof input?.suggestedFix === "string" ? input.suggestedFix.trim() : "";
    const whatIDid =
      typeof input?.whatICompletedAnyway === "string"
        ? input.whatICompletedAnyway.trim()
        : "";
    if (!reason) return { error: "reason vacío" };

    // 1) Comentario informativo al user explicando que escalamos
    //    para mejorar el sistema. Tono honesto: "no he podido X
    //    pero Claude lo va a arreglar".
    const noteLines = [
      `⚙️ **He escalado esta limitación a Claude Code para que mejore el sistema.**`,
      ``,
      `**Bloqueo (${blockingType}):** ${reason}`,
      whatIDid ? `\n**Lo que sí he completado:** ${whatIDid}` : "",
      suggestedFix ? `\n**Propuesta:** ${suggestedFix}` : "",
      ``,
      `Claude analizará el código, aplicará la mejora correspondiente, y re-procesará esta tarea automáticamente. Recibirás una notificación cuando esté lista.`
    ].filter(Boolean);
    const noteText = noteLines.join("\n");
    await prisma.comment.create({
      data: {
        workspaceId: ctx.workspaceId,
        authorId: ctx.config.userId,
        targetType: "TASK",
        targetId: ctx.taskId,
        body: noteText,
        bodyJson: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: noteText }] }]
        }
      }
    });

    // 2) Marcar el run como REQUIRES_HUMAN antes de disparar la
     // escalación — para que escalateRunToGitHub lea el status
     // correcto y genere el issue. NOTA: el runner aún no ha
     // terminado, pero asumimos que esto es lo último que llama.
    await prisma.aiAgentRun.update({
      where: { id: ctx.runId },
      data: {
        status: "REQUIRES_HUMAN",
        summary: `Escalado a Claude: ${reason.slice(0, 200)}`,
        error: `[${blockingType}] ${reason}${suggestedFix ? ` | Fix sugerido: ${suggestedFix}` : ""}`,
        finishedAt: new Date()
      }
    });

    // 3) NO disparamos escalateRunToGitHub aquí — eso lo hace
    //    process-run.ts cuando ve status=REQUIRES_HUMAN tras el
    //    cierre del run. Disparar desde dos sitios causaba carrera
    //    al actualizar el log (último escritor gana, perdíamos la
    //    entrada de escalation).

    return {
      ok: true,
      escalated: true,
      message:
        "Run marcado como REQUIRES_HUMAN. Issue de mejora se crea en background. NO sigas trabajando — termina el run aquí."
    };
  },

  async request_user_approval(input, ctx) {
    const question = String(input?.question ?? "").trim();
    const action = String(input?.actionSummary ?? "").trim();
    const risk = String(input?.riskLevel ?? "medium").trim() as
      | "low"
      | "medium"
      | "high";
    if (!question) return { error: "question vacío" };

    // Autopilot: si el cliente está en modo autonomous (Trust >= 80
    // confirmado manualmente por el admin), saltamos aprobaciones de
    // riesgo low/medium. high siempre requiere aprobación.
    if (risk !== "high") {
      const task = await prisma.task.findFirst({
        where: { id: ctx.taskId, workspaceId: ctx.workspaceId },
        select: { clientId: true }
      });
      if (task?.clientId) {
        const client = await prisma.client.findFirst({
          where: { id: task.clientId, workspaceId: ctx.workspaceId }
        });
        const autonomous = !!(client as any)?.settings?.aiAgent?.autonomous;
        if (autonomous) {
          // Deja una nota informativa (auditoría) pero no bloquea.
          await prisma.comment.create({
            data: {
              workspaceId: ctx.workspaceId,
              authorId: ctx.config.userId,
              targetType: "TASK",
              targetId: ctx.taskId,
              body: `🤖 _(autopilot)_ Ejecutando sin pedir confirmación: **${action}** (${risk}).`
            }
          });
          return {
            ok: true,
            autoApproved: true,
            message:
              "Cliente en modo autopilot. Aprobación NO requerida para riesgo " +
              risk +
              ". Sigue ejecutando la acción."
          };
        }
      }
    }

    const riskEmoji = risk === "high" ? "🚨" : risk === "medium" ? "⚠️" : "🔍";
    const noteText = [
      `${riskEmoji} **Necesito tu aprobación antes de seguir.**`,
      ``,
      `**Acción:** ${action || "(sin descripción)"}`,
      `**Pregunta:** ${question}`,
      ``,
      `Contéstame con **"ok"**, **"sí"**, **"adelante"** para que ejecute, o **"no"** / **"cancela"** para abortar. Cualquier otra respuesta la interpretaré como instrucción adicional.`
    ].join("\n");

    await prisma.comment.create({
      data: {
        workspaceId: ctx.workspaceId,
        authorId: ctx.config.userId,
        targetType: "TASK",
        targetId: ctx.taskId,
        body: noteText,
        bodyJson: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: noteText }] }]
        }
      }
    });

    // Marca el run como REQUIRES_HUMAN para que el flow del polling
    // muestre el badge naranja "Sonia necesita ayuda". Cuando el user
    // comenta, se relanza la task — Sonia leerá la respuesta y seguirá.
    await prisma.aiAgentRun.update({
      where: { id: ctx.runId },
      data: {
        status: "REQUIRES_HUMAN",
        summary: `Esperando aprobación: ${question.slice(0, 160)}`,
        finishedAt: new Date()
      }
    });

    return {
      ok: true,
      awaitingApproval: true,
      message:
        "Pregunta enviada al admin. Run marcado REQUIRES_HUMAN. TERMINA el run aquí — cuando el admin responda, la task se relanza y leerás su contestación en los comentarios."
    };
  },

  async schedule_followup(input, ctx) {
    try {
      const title = String(input?.title ?? "").trim();
      const whenIso = String(input?.whenIso ?? "").trim();
      if (!title) return { error: "title vacío" };
      const dueDate = new Date(whenIso);
      if (Number.isNaN(dueDate.getTime())) return { error: "whenIso inválido" };

      // Si hay clientId, encadenamos el cliente al proyecto IA del workspace
      // (asumimos que ya está creado — si no, la task se crea sin project).
      const clientId = input?.clientId ? String(input.clientId) : undefined;
      let projectId: string | undefined;
      // Reutilizamos el proyecto del padre si existe; si no, dejamos sin
      // project (queda en "tareas sin proyecto", todavía accionable).
      const parent = await prisma.task.findFirst({
        where: { id: ctx.taskId, workspaceId: ctx.workspaceId },
        select: { projectId: true }
      });
      if (parent?.projectId) projectId = parent.projectId;

      const task = await prisma.task.create({
        data: {
          workspaceId: ctx.workspaceId,
          title: `🔁 ${title}`,
          description:
            (typeof input?.description === "string" ? input.description : "") +
            `\n\n_(Auto-creada por Sonia como seguimiento de la task ${ctx.taskId})_`,
          status: "TODO",
          priority: "NORMAL",
          projectId,
          clientId: clientId ?? null,
          dueDate
        } as any
      });
      return {
        ok: true,
        taskId: task.id,
        scheduledFor: dueDate.toISOString(),
        message: `Followup programado: la task '${task.title}' aparecerá el ${dueDate.toISOString()}.`
      };
    } catch (e: any) {
      return { error: `schedule_followup: ${e?.message ?? e}` };
    }
  },

  async delegate_to_human(input, ctx) {
    try {
      const ref = String(input?.userIdOrEmail ?? "").trim();
      if (!ref) return { error: "userIdOrEmail vacío" };
      const title = String(input?.title ?? "").trim();
      if (!title) return { error: "title vacío" };
      // Buscar el user por id o email dentro del workspace
      const user = await prisma.user.findFirst({
        where: {
          OR: [{ id: ref }, { email: ref }],
          memberships: { some: { workspaceId: ctx.workspaceId } }
        },
        select: { id: true, name: true, email: true }
      });
      if (!user) return { error: `Usuario '${ref}' no encontrado en el workspace.` };

      const dueDate = input?.dueDate
        ? new Date(String(input.dueDate))
        : new Date(Date.now() + 3 * 86400_000);

      const parent = await prisma.task.findFirst({
        where: { id: ctx.taskId, workspaceId: ctx.workspaceId },
        select: { projectId: true, clientId: true }
      });

      const task = await prisma.task.create({
        data: {
          workspaceId: ctx.workspaceId,
          title: `👤 ${title}`,
          description:
            (typeof input?.description === "string" ? input.description : "") +
            `\n\n_(Delegada por Sonia desde la task ${ctx.taskId})_`,
          status: "TODO",
          priority: (input?.priority as any) ?? "NORMAL",
          projectId: parent?.projectId,
          clientId: parent?.clientId,
          dueDate,
          assignees: { create: [{ userId: user.id }] }
        } as any
      });

      // Comentario en la task original para que el admin vea el reparto.
      await prisma.comment.create({
        data: {
          workspaceId: ctx.workspaceId,
          authorId: ctx.config.userId,
          targetType: "TASK",
          targetId: ctx.taskId,
          body: `👤 He delegado a **${user.name ?? user.email ?? user.id}** una sub-tarea: "${task.title}". Vence el ${dueDate.toISOString().slice(0, 10)}.`
        }
      });

      return {
        ok: true,
        taskId: task.id,
        assignedTo: { id: user.id, name: user.name, email: user.email },
        message: `Task delegada a ${user.name ?? user.email}. Yo puedo seguir con la mía.`
      };
    } catch (e: any) {
      return { error: `delegate_to_human: ${e?.message ?? e}` };
    }
  },

  async send_email(input, ctx) {
    try {
      const { sendEmail, sendEmailWithAttachment, isEmailEnabled } = await import("@/lib/integrations/email");
      if (!isEmailEnabled()) {
        return { error: "Email no configurado. Define RESEND_API_KEY en el workspace." };
      }
      const to = Array.isArray(input?.to) ? input.to.map(String) : String(input?.to ?? "");
      const subject = String(input?.subject ?? "");
      const html = String(input?.html ?? "");
      const text = input?.text ? String(input.text) : undefined;
      if (!subject || !html) return { error: "subject y html son obligatorios" };

      const attachFileId = input?.attachFileId ? String(input.attachFileId) : null;
      if (attachFileId) {
        const file = await prisma.file.findFirst({
          where: { id: attachFileId, workspaceId: ctx.workspaceId }
        });
        if (!file) return { error: `File ${attachFileId} no encontrado` };
        const { downloadBuffer } = await import("@/lib/storage/r2");
        const buf = await downloadBuffer(file.s3Key);
        const result = await sendEmailWithAttachment({
          to: Array.isArray(to) ? to[0] : to,
          subject,
          html,
          text,
          attachment: { filename: file.name, content: buf, contentType: file.mimeType }
        });
        await prisma.comment.create({
          data: {
            workspaceId: ctx.workspaceId,
            authorId: ctx.config.userId,
            targetType: "TASK",
            targetId: ctx.taskId,
            body: `📧 Email enviado a **${Array.isArray(to) ? to.join(", ") : to}** con adjunto **${file.name}**. Asunto: "${subject}". ID Resend: \`${result.id}\``
          }
        });
        return { ok: true, id: result.id, attached: file.name };
      }
      const result = await sendEmail({ to, subject, html, text });
      await prisma.comment.create({
        data: {
          workspaceId: ctx.workspaceId,
          authorId: ctx.config.userId,
          targetType: "TASK",
          targetId: ctx.taskId,
          body: `📧 Email enviado a **${Array.isArray(to) ? to.join(", ") : to}**. Asunto: "${subject}". ID Resend: \`${result.id}\``
        }
      });
      return { ok: true, id: result.id };
    } catch (e: any) {
      return { error: `send_email: ${e?.message ?? e}` };
    }
  },
  async send_whatsapp_message(input, ctx) {
    try {
      const { sendText, normalizePhone } = await import("@/lib/leads/waha");
      const rawPhone = String(input?.toPhone ?? "");
      const country = input?.defaultCountryCode ? String(input.defaultCountryCode) : "34";
      const phone = normalizePhone(rawPhone, country);
      if (!phone) return { error: `Teléfono inválido: ${rawPhone}` };
      const body = String(input?.body ?? "");
      if (!body) return { error: "body vacío" };

      const result = await sendText({
        workspaceId: ctx.workspaceId,
        phoneNormalized: phone,
        text: body
      });
      await prisma.comment.create({
        data: {
          workspaceId: ctx.workspaceId,
          authorId: ctx.config.userId,
          targetType: "TASK",
          targetId: ctx.taskId,
          body: `💬 WhatsApp enviado a **+${phone}**. Mensaje: "${body.slice(0, 100)}${body.length > 100 ? "…" : ""}"`
        }
      });
      return { ok: true, phone, result };
    } catch (e: any) {
      return { error: `send_whatsapp_message: ${e?.message ?? e}` };
    }
  },
  async holded_create_invoice(input, ctx) {
    try {
      const { holdedCreateInvoice } = await import("@/lib/integrations/holded");
      const items = Array.isArray(input?.items) ? input.items : [];
      if (items.length === 0) return { error: "items vacío" };
      const payload: any = {
        contactId: String(input?.contactId ?? ""),
        contact: String(input?.contactName ?? ""),
        items: items.map((it: any) => ({
          name: String(it.name ?? ""),
          units: typeof it.units === "number" ? it.units : 1,
          subtotal: Number(it.subtotal ?? 0),
          taxes: Array.isArray(it.taxes) ? it.taxes : [21]
        })),
        currency: input?.currency ? String(input.currency) : "eur"
      };
      if (input?.date) payload.date = Number(input.date);
      if (input?.dueDate) payload.dueDate = Number(input.dueDate);
      if (input?.notes) payload.notes = String(input.notes);
      const result = await holdedCreateInvoice({ workspaceId: ctx.workspaceId, payload });
      await prisma.comment.create({
        data: {
          workspaceId: ctx.workspaceId,
          authorId: ctx.config.userId,
          targetType: "TASK",
          targetId: ctx.taskId,
          body: `🧾 Factura Holded creada (BORRADOR): \`${result.docNumber ?? result.id}\` para **${input?.contactName}**. Revisa y envía desde Holded.`
        }
      });
      return { ok: true, ...result };
    } catch (e: any) {
      return { error: `holded_create_invoice: ${e?.message ?? e}` };
    }
  },
  async holded_create_quote(input, ctx) {
    try {
      const { holdedCreateQuote } = await import("@/lib/integrations/holded");
      const items = Array.isArray(input?.items) ? input.items : [];
      if (items.length === 0) return { error: "items vacío" };
      const payload: any = {
        contactId: String(input?.contactId ?? ""),
        contact: String(input?.contactName ?? ""),
        items: items.map((it: any) => ({
          name: String(it.name ?? ""),
          units: typeof it.units === "number" ? it.units : 1,
          subtotal: Number(it.subtotal ?? 0),
          taxes: Array.isArray(it.taxes) ? it.taxes : [21]
        })),
        currency: input?.currency ? String(input.currency) : "eur"
      };
      if (input?.date) payload.date = Number(input.date);
      if (input?.dueDate) payload.dueDate = Number(input.dueDate);
      if (input?.notes) payload.notes = String(input.notes);
      const result = await holdedCreateQuote({ workspaceId: ctx.workspaceId, payload });
      await prisma.comment.create({
        data: {
          workspaceId: ctx.workspaceId,
          authorId: ctx.config.userId,
          targetType: "TASK",
          targetId: ctx.taskId,
          body: `📄 Presupuesto Holded creado: \`${result.docNumber ?? result.id}\` para **${input?.contactName}**.`
        }
      });
      return { ok: true, ...result };
    } catch (e: any) {
      return { error: `holded_create_quote: ${e?.message ?? e}` };
    }
  },
  async stripe_create_customer(input, ctx) {
    try {
      const { stripeCreateCustomer } = await import("@/lib/integrations/stripe-light");
      const meta = typeof input?.metadata === "object" && input.metadata !== null
        ? Object.fromEntries(Object.entries(input.metadata).filter(([, v]) => typeof v === "string").map(([k, v]) => [k, String(v)]))
        : undefined;
      const r = await stripeCreateCustomer({
        workspaceId: ctx.workspaceId,
        email: String(input?.email ?? ""),
        name: input?.name ? String(input.name) : undefined,
        phone: input?.phone ? String(input.phone) : undefined,
        metadata: meta
      });
      return { ok: true, ...r };
    } catch (e: any) {
      return { error: `stripe_create_customer: ${e?.message ?? e}` };
    }
  },
  async stripe_create_subscription(input, ctx) {
    try {
      const { stripeCreateSubscription } = await import("@/lib/integrations/stripe-light");
      const meta = typeof input?.metadata === "object" && input.metadata !== null
        ? Object.fromEntries(Object.entries(input.metadata).filter(([, v]) => typeof v === "string").map(([k, v]) => [k, String(v)]))
        : undefined;
      const r = await stripeCreateSubscription({
        workspaceId: ctx.workspaceId,
        customerId: String(input?.customerId ?? ""),
        priceId: String(input?.priceId ?? ""),
        trialDays: typeof input?.trialDays === "number" ? input.trialDays : undefined,
        metadata: meta
      });
      return { ok: true, ...r };
    } catch (e: any) {
      return { error: `stripe_create_subscription: ${e?.message ?? e}` };
    }
  },
  async stripe_list_prices(input, ctx) {
    try {
      const { stripeListPrices } = await import("@/lib/integrations/stripe-light");
      const items = await stripeListPrices({
        workspaceId: ctx.workspaceId,
        active: typeof input?.active === "boolean" ? input.active : true,
        limit: typeof input?.limit === "number" ? input.limit : undefined
      });
      return { count: items.length, items };
    } catch (e: any) {
      return { error: `stripe_list_prices: ${e?.message ?? e}` };
    }
  },
  async stripe_refund_charge(input, ctx) {
    try {
      const { stripeRefundCharge } = await import("@/lib/integrations/stripe-light");
      const r = await stripeRefundCharge({
        workspaceId: ctx.workspaceId,
        chargeId: String(input?.chargeId ?? ""),
        amountCents: typeof input?.amountCents === "number" ? input.amountCents : undefined,
        reason: input?.reason as any
      });
      return { ok: true, ...r };
    } catch (e: any) {
      return { error: `stripe_refund_charge: ${e?.message ?? e}` };
    }
  },
  async wp_list_posts(input, ctx) {
    try {
      const { wpListPosts } = await import("@/lib/integrations/wordpress");
      const items = await wpListPosts({
        workspaceId: ctx.workspaceId,
        clientId: input?.clientId ? String(input.clientId) : null,
        status: input?.status as any,
        search: input?.search ? String(input.search) : undefined,
        limit: typeof input?.limit === "number" ? input.limit : undefined
      });
      return { count: items.length, items };
    } catch (e: any) {
      return { error: `wp_list_posts: ${e?.message ?? e}` };
    }
  },
  async wp_list_categories(input, ctx) {
    try {
      const { wpListCategories } = await import("@/lib/integrations/wordpress");
      const items = await wpListCategories({
        workspaceId: ctx.workspaceId,
        clientId: input?.clientId ? String(input.clientId) : null
      });
      return { count: items.length, items };
    } catch (e: any) {
      return { error: `wp_list_categories: ${e?.message ?? e}` };
    }
  },
  async wp_create_post(input, ctx) {
    try {
      const { wpCreatePost } = await import("@/lib/integrations/wordpress");
      const r = await wpCreatePost({
        workspaceId: ctx.workspaceId,
        clientId: input?.clientId ? String(input.clientId) : null,
        title: String(input?.title ?? ""),
        content: String(input?.content ?? ""),
        excerpt: input?.excerpt ? String(input.excerpt) : undefined,
        status: (input?.status as any) ?? "draft",
        slug: input?.slug ? String(input.slug) : undefined,
        categories: Array.isArray(input?.categories) ? input.categories.map(Number) : undefined,
        tags: Array.isArray(input?.tags) ? input.tags.map(Number) : undefined,
        featuredMediaUrl: input?.featuredMediaUrl ? String(input.featuredMediaUrl) : undefined,
        featuredMediaId: typeof input?.featuredMediaId === "number" ? input.featuredMediaId : undefined,
        yoastMetaTitle: input?.yoastMetaTitle ? String(input.yoastMetaTitle) : undefined,
        yoastMetaDescription: input?.yoastMetaDescription ? String(input.yoastMetaDescription) : undefined
      });
      await prisma.comment.create({
        data: {
          workspaceId: ctx.workspaceId,
          authorId: ctx.config.userId,
          targetType: "TASK",
          targetId: ctx.taskId,
          body: `📝 Post WordPress creado (${r.status}): [${input?.title}](${r.link})`
        }
      });
      return { ok: true, ...r };
    } catch (e: any) {
      return { error: `wp_create_post: ${e?.message ?? e}` };
    }
  },
  async wp_update_post(input, ctx) {
    try {
      const { wpUpdatePost } = await import("@/lib/integrations/wordpress");
      const r = await wpUpdatePost({
        workspaceId: ctx.workspaceId,
        clientId: input?.clientId ? String(input.clientId) : null,
        postId: Number(input?.postId ?? 0),
        title: input?.title ? String(input.title) : undefined,
        content: input?.content ? String(input.content) : undefined,
        excerpt: input?.excerpt !== undefined ? String(input.excerpt) : undefined,
        status: input?.status as any,
        categories: Array.isArray(input?.categories) ? input.categories.map(Number) : undefined,
        tags: Array.isArray(input?.tags) ? input.tags.map(Number) : undefined
      });
      return { ok: true, ...r };
    } catch (e: any) {
      return { error: `wp_update_post: ${e?.message ?? e}` };
    }
  },
  async generate_brand_image(input, ctx) {
    try {
      const { generateBrandImage } = await import("@/lib/files/brand-image");
      // Inferir clientId del task si no se pasa.
      let clientId = input?.clientId ? String(input.clientId) : null;
      if (!clientId) {
        const task = await prisma.task.findUnique({
          where: { id: ctx.taskId },
          select: { clientId: true }
        });
        clientId = task?.clientId ?? null;
      }
      const r = await generateBrandImage({
        workspaceId: ctx.workspaceId,
        clientId,
        prompt: String(input?.prompt ?? ""),
        format: input?.format as any,
        quality: input?.quality as any,
        attachToTaskId: ctx.taskId,
        uploadedByUserId: ctx.config.userId
      });
      await prisma.comment.create({
        data: {
          workspaceId: ctx.workspaceId,
          authorId: ctx.config.userId,
          targetType: "TASK",
          targetId: ctx.taskId,
          body: `🎨 Imagen generada con IA y adjuntada (${(r.sizeBytes / 1024).toFixed(0)} KB${clientId ? `, brand del cliente aplicado` : ""}).`
        }
      });
      return {
        ok: true,
        fileId: r.fileId,
        sizeBytes: r.sizeBytes,
        url: r.url
      };
    } catch (e: any) {
      return { error: `generate_brand_image: ${e?.message ?? e}` };
    }
  },

  async generate_meta_ad_creative(input, ctx) {
    try {
      // Inferir clientId del task si no se pasa
      let clientId = input?.clientId ? String(input.clientId) : null;
      let client: any = null;
      if (!clientId) {
        const task = await prisma.task.findUnique({
          where: { id: ctx.taskId },
          select: { clientId: true }
        });
        clientId = task?.clientId ?? null;
      }
      if (clientId) {
        client = await prisma.client.findFirst({
          where: { id: clientId, workspaceId: ctx.workspaceId } as any
        });
      }

      // Enriquecer prompt con brand
      let promptEnriched = String(input?.prompt ?? "").trim();
      if (client) {
        const parts: string[] = [];
        if (client.brandBrief?.trim()) {
          parts.push(`About the brand: ${client.brandBrief.slice(0, 400)}`);
        }
        parts.push(
          `Brand colors: primary ${client.brandColorPrimary}, accent ${client.brandColorAccent}.`
        );
        if (client.styleGuideCached?.trim()) {
          parts.push(`Brand style guide: ${client.styleGuideCached.slice(0, 1200)}`);
        }
        promptEnriched = parts.join("\n") + "\n\n" + promptEnriched;
      }

      const format = (input?.format as string) ?? "square";
      const size =
        format === "portrait"
          ? "1024x1536"
          : format === "landscape"
            ? "1536x1024"
            : "1024x1024";

      const { generateAdImage } = await import("@/lib/meta/generate-content");
      const copyForGeneration = input?.copy
        ? {
            headline: input.copy.headline,
            primaryText: input.copy.primaryText,
            callToAction: input.copy.callToAction,
            brandName: input.copy.brandName ?? client?.name,
            valueProps: Array.isArray(input.copy.valueProps)
              ? input.copy.valueProps.map(String)
              : undefined
          }
        : undefined;

      // QC LOOP: gpt-image-1 alucina texto en español ~10% de las veces
      // ("Esfudio gratumo" vs "Estudio gratuito"). Generamos hasta 3
      // intentos pasando OCR vs textos esperados; si pasa la QC,
      // adjuntamos y terminamos. Si no pasa tras 3, adjuntamos la
      // mejor con un warning para que Sonia decida.
      const MAX_ATTEMPTS = 3;
      let lastUrl: string | null = null;
      let lastBuf: Buffer | null = null;
      let lastQc: any = null;
      const { qcAdImage } = await import("@/lib/meta/ad-image-qc");

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const url = await generateAdImage({
          workspaceId: ctx.workspaceId,
          prompt: promptEnriched,
          size: size as any,
          quality: (input?.quality as any) ?? "medium",
          campaignId: `task-${ctx.taskId}`,
          adId: `creative-${Date.now()}-${attempt}`,
          copy: copyForGeneration,
          settings: {
            styleHint: input?.styleHint ? String(input.styleHint) : undefined
          }
        });
        const r = await fetch(url);
        const buf = Buffer.from(await r.arrayBuffer());
        lastUrl = url;
        lastBuf = buf;

        // Si no hay copy, no hay nada que QC. Damos por buena la 1ª.
        if (!copyForGeneration) {
          lastQc = { passed: true, mismatches: [], matched: [], ocrText: "" };
          break;
        }
        const qc = await qcAdImage({
          workspaceId: ctx.workspaceId,
          imageBuffer: buf,
          mimeType: "image/png",
          expected: copyForGeneration
        });
        lastQc = qc;
        if (qc.passed) break;
        // Si no pasa y aún quedan intentos, re-generamos
        console.warn(
          `[qc] ad image attempt ${attempt}/${MAX_ATTEMPTS} FAILED: ${qc.mismatches.map((m: any) => m.expected).join(" · ")}`
        );
      }

      const filename = `meta-ad-${Date.now()}.png`;
      const file = await uploadAttachmentForTask({
        workspaceId: ctx.workspaceId,
        taskId: ctx.taskId,
        filename,
        body: lastBuf!,
        mimeType: "image/png",
        uploadedByUserId: ctx.config.userId
      });

      const qcStatus = lastQc?.passed
        ? "✅ QC pasado — todos los textos legibles"
        : `⚠️ QC con avisos tras ${MAX_ATTEMPTS} intentos: ${lastQc?.mismatches?.length ?? 0} texto(s) con erratas o no legibles`;

      await prisma.comment.create({
        data: {
          workspaceId: ctx.workspaceId,
          authorId: ctx.config.userId,
          targetType: "TASK",
          targetId: ctx.taskId,
          body: `🎨 Creatividad Meta Ads generada (${(lastBuf!.length / 1024).toFixed(0)} KB${client ? `, brand del cliente aplicado` : ""}).\n\n${qcStatus}.${lastQc && !lastQc.passed ? `\n\nTextos con problema: ${lastQc.mismatches.map((m: any) => m.expected).join(", ")}` : ""}`
        }
      });

      return {
        ok: true,
        fileId: file.fileId,
        filename: file.filename,
        sizeBytes: lastBuf!.length,
        url: lastUrl,
        qc: {
          passed: lastQc?.passed ?? false,
          mismatches: lastQc?.mismatches ?? [],
          matched: lastQc?.matched ?? [],
          attemptsUsed: lastQc?.passed ? "ok" : `${MAX_ATTEMPTS} (no logrado)`
        }
      };
    } catch (e: any) {
      return { error: `generate_meta_ad_creative: ${e?.message ?? e}` };
    }
  },

  async record_lesson(input, ctx) {
    try {
      const { recordLesson } = await import("@/lib/ai/nv-ia/lessons");
      const scope = String(input?.scope ?? "general").trim();
      const lesson = String(input?.lesson ?? "").trim();
      const triggerPattern = input?.triggerPattern ? String(input.triggerPattern).trim() : null;
      if (!lesson) return { error: "lesson vacía" };
      const result = await recordLesson({
        workspaceId: ctx.workspaceId,
        scope,
        lesson,
        triggerPattern,
        source: "sonia_self",
        taskId: ctx.taskId
      });
      return {
        ok: true,
        lessonId: result.id,
        created: result.created,
        message: result.created
          ? "Lección guardada — se cargará en runs futuros similares."
          : "Lección ya existía — useCount incrementado."
      };
    } catch (e: any) {
      return { error: `record_lesson: ${e?.message ?? e}` };
    }
  }
};

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
