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
import { gadsListCampaigns, gadsCampaignMetrics } from "@/lib/integrations/google-ads";
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
  // @ts-expect-error — mismo motivo. Code execution corre en sandbox de
  // Anthropic, sin acceso a nuestros datos — solo cálculos puros que
  // la IA escribe en Python (estadística, gráficos, análisis numérico).
  { type: "code_execution_20260120", name: "code_execution" },
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
    name: "meta_ads_list_campaigns",
    description:
      "Lista las campañas de Meta Ads del adAccount configurado. Filtra por status (ACTIVE, PAUSED, ARCHIVED). Devuelve id, name, objetivo, budget.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["ACTIVE", "PAUSED", "ARCHIVED"] },
        limit: { type: "number" }
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
        until: { type: "string" }
      },
      required: ["campaignId"],
      additionalProperties: false
    }
  },
  {
    name: "meta_ads_top_performers",
    description:
      "Top campañas Meta por una métrica (spend, impressions, ctr, reach) en un rango. Útil para informes y análisis cross-campaña sin tener que pedir cada insights por separado.",
    input_schema: {
      type: "object",
      properties: {
        metric: { type: "string", enum: ["spend", "impressions", "ctr", "reach"] },
        datePreset: { type: "string" },
        limit: { type: "number" }
      },
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
        assignees: task.assignees.map((a: any) => a.user)
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
  async meta_ads_list_campaigns(input, ctx) {
    try {
      const campaigns = await metaAdsListCampaigns({
        workspaceId: ctx.workspaceId,
        status: input?.status,
        limit: typeof input?.limit === "number" ? input.limit : 50,
        adhoc: ctx.adhocCredentials
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
        adhoc: ctx.adhocCredentials
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
        adhoc: ctx.adhocCredentials
      });
      return { count: top.length, top };
    } catch (e: any) {
      return { error: `Meta Ads no disponible: ${e?.message ?? e}` };
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
    // 2. Status → DONE
    await prisma.task.update({
      where: { id: ctx.taskId },
      data: { status: "DONE", completedAt: new Date() }
    });
    return { ok: true, commentId: comment.id, completed: true };
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
  }
};

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
