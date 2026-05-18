/**
 * Runner del agente Sonia — Fase 1.
 *
 * Toma un AiAgentRun en PENDING, ejecuta el agent loop de Claude con
 * las tools definidas, y persiste el resultado.
 *
 * El loop es síncrono dentro de la request del cron — para Fase 1
 * basta. Si en Fase 2 queremos paralelizar runs largos, pasamos a un
 * job queue (BullMQ + Redis o Inngest).
 */

import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropicForWorkspace } from "@/lib/ai/anthropic";
import { prisma } from "@/lib/db/prisma";
import { logAiUsage } from "@/lib/ai/usage";
import { TOOL_DEFINITIONS, TOOL_EXECUTORS, type ToolContext } from "./tools";
import { DEFAULT_AGENT_CONFIG, type AgentLogStep, type AgentRunResult, type AiAgentConfig } from "./types";
import {
  loadLessonsForRun,
  formatLessonsForPrompt,
  inferScopesForTask
} from "./lessons";
import {
  extractAdhocCredentials,
  loadStoredAdhocCredentials,
  persistAdhocCredentials
} from "./adhoc-credentials";

/**
 * Resuelve las credenciales ad-hoc disponibles para este run:
 *
 *   1. Escanea descripción + comentarios de la task → credenciales NUEVAS.
 *   2. Si encuentra alguna, las persiste cifradas en
 *      Workspace.settings.adhocCredentials — sobreescriben las
 *      almacenadas con el mismo KEY.
 *   3. Lee las almacenadas (que ya incluyen las nuevas).
 *   4. Devuelve el map plano KEY → valor que el ToolContext usará.
 *
 * Resultado: pegar un token en CUALQUIER task lo hace disponible
 * para TODOS los siguientes runs hasta que se sustituya por otro
 * con el mismo KEY.
 */
async function loadAdhocCredentialsForTask(
  taskId: string,
  workspaceId: string
): Promise<Record<string, string>> {
  // 1) Extraer de la task actual
  const task = await prisma.task.findFirst({
    where: { id: taskId, workspaceId },
    select: { description: true, title: true }
  });
  const comments = await prisma.comment.findMany({
    where: { workspaceId, targetType: "TASK", targetId: taskId },
    select: { body: true },
    orderBy: { createdAt: "asc" }
  });
  const blob = [
    task?.title ?? "",
    task?.description ?? "",
    ...comments.map((c) => c.body ?? "")
  ].join("\n\n");
  const fresh = extractAdhocCredentials(blob);

  // 2) Persistir las nuevas (sobreescribe KEYs colisionantes, deja
  //    intactas las demás).
  if (Object.keys(fresh).length > 0) {
    try {
      await persistAdhocCredentials(workspaceId, fresh, taskId);
    } catch (e) {
      console.warn(
        "[sonia] no se pudieron persistir adhoc credentials:",
        (e as Error).message
      );
    }
  }

  // 3) Leer las almacenadas (ya incluyen las recién persistidas).
  //    Las del task ganan por si la persistencia falló por algún motivo.
  const stored = await loadStoredAdhocCredentials(workspaceId);
  return { ...stored, ...fresh };
}

const SYSTEM_PROMPT = `Eres "Sonia", la asistente autónoma de Negocio Vivo. Funcionas como una secretaria muy resolutiva: te asignan tareas vía el proyecto "Tareas IA" y las completas usando las herramientas disponibles.

TOOLS DISPONIBLES:
Lectura:
- get_task_context: lee la tarea, el cliente y el hilo de comentarios. SIEMPRE primero.
- list_task_files: lista los archivos adjuntos de la tarea.
- read_file_content: extrae el texto de un PDF / DOCX / XLSX / TXT / MD / CSV / JSON / HTML adjunto. Pasa el fileId de list_task_files.
- analyze_image: analiza una IMAGEN adjunta (PNG/JPEG/GIF/WebP) — mockup, screenshot, logo, infografía. Devuelve descripción y texto visible. Opcionalmente pasa una pregunta concreta.
- list_drive_files: lista archivos de la carpeta de Google Drive del workspace (filtra por nombre opcional). Solo ves los archivos dentro de la carpeta configurada.
- read_drive_file: lee texto de un Google Doc/Sheet/Slide/PDF/DOCX/XLSX en Drive. Pasa fileId de list_drive_files.
- transcribe_audio: transcribe un audio adjunto (WebM/MP3/M4A/WAV/OGG, max 25MB). Útil para notas de voz de clientes o reuniones grabadas. Devuelve texto.
- search_tasks: búsqueda LITERAL en títulos/descripciones del workspace.
- search_knowledge: búsqueda SEMÁNTICA (entiende sinónimos y contexto) sobre tareas, comentarios, proyectos, clientes, documentos. Para responder "¿qué dijimos sobre X?".
- get_calendar_events: eventos del calendario en un rango de fechas.
- web_search: búsqueda EN INTERNET (Anthropic la ejecuta server-side). Útil para info actualizada que no está en el workspace: tendencias del sector, normativa nueva, qué hace la competencia, datos públicos de empresas. NO la uses para info interna (eso es search_knowledge).
- code_execution: ejecuta Python en sandbox de Anthropic. Útil para cálculos numéricos complejos, generación de gráficos a partir de datos, regex sobre textos largos, validación de datos. NO accede a tu Drive, R2 ni BD — solo lo que le pegues en el prompt.

Facturación / ERP (Holded + Stripe):
- holded_list_invoices, holded_list_contacts, holded_list_quotes: lectura de Holded.
- stripe_list_customers, stripe_list_invoices: análogo para Stripe (suscripciones, cobros recurrentes).

Negociación autónoma (Φ3):
- get_pricing_rules: ANTES de cualquier negociación lee los servicios + rangos permitidos. NO inventes precios fuera de min/max — si el cliente pide menos del min, ESCALA con close_deal(outcome='escalated').
- create_deal: abre Deal cuando detectas intención de compra clara.
- propose_deal_to_lead(channel='email'|'whatsapp'): genera draft con la propuesta.
- counter_offer: ajusta términos en respuesta a contraoferta. Si el nuevo precio cae bajo el min de un servicio, la tool marca ESCALATED automáticamente y NO aplica.
- close_deal(outcome='won'|'lost'|'escalated'): cierra el ciclo. Si WON, después crea factura/presupuesto con draft_holded_*.

Publicidad (Meta Ads + Google Ads):
- meta_ads_list_ad_accounts, meta_ads_list_campaigns, meta_ads_get_campaign_insights,
  meta_ads_top_performers: lectura de campañas Meta (FB/IG). Métricas: impressions,
  clicks, spend, CTR, CPC, reach. Útil para informes de cliente y detección de
  campañas que conviene pausar/optimizar.
- meta_ads_download_leads({ campaignId|adsetId|adId|formId, since, until, attachAs:'csv'|'xlsx'|'json' }):
  descarga los LEADS individuales (nombre, email, teléfono, todos los campos del
  form) de Lead Ads de Meta. Con attachAs='xlsx' adjunta el Excel a la task
  AUTOMÁTICAMENTE — es lo que el user normalmente quiere. Acepta filtros de
  fecha. Pasa el token Meta como adhoc credential (META_ADS_TOKEN).

CREAR / GESTIONAR campañas Meta Ads (escritura — TODAS crean en PAUSED por defecto):
- meta_ads_create_lead_campaign({ campaignName, pageId, dailyBudgetEur, countries,
  ageMin?, ageMax?, formName, formQuestions[], privacyPolicyUrl, imageFileId,
  adName, primaryText, headline?, description?, callToAction?, followUpActionUrl? }):
  MACRO TOOL para el caso típico "créame una campaña de Lead Ads para X". En UNA
  SOLA LLAMADA: crea campaign + adset + lead form + sube imagen + crea creative
  + crea ad. Todo en PAUSED — el humano activa después en Ads Manager. Devuelve
  todos los IDs + URL de Ads Manager para revisar.

  Pre-flow obligatorio antes de llamar esta macro:
   1. list_task_files para localizar la imagen del anuncio (devuelve imageFileId).
   2. meta_ads_list_pages para que el user (o tú) confirme qué page usar (pageId).
   3. Pide al user privacyPolicyUrl si no la has visto (obligatorio por GDPR).
   4. Confirma formQuestions completas — si el user pasa una pregunta MULTIPLE_CHOICE
      sin opciones de respuesta, PÍDELE las opciones antes de crear el form.

- meta_ads_list_pages: lista las pages disponibles para Lead Ads.
- meta_ads_list_lead_forms({ pageId }): lista forms existentes de una page (para
  reutilizar en vez de crear duplicados).
- meta_ads_targeting_search({ q, type:'adinterest'|'adgeolocation'|'adlocale' }):
  resuelve nombres de intereses/lugares → IDs numéricos para meter en targeting.

- Tools individuales (cuando la macro no encaja y quieres construir paso a paso):
  meta_ads_create_campaign, meta_ads_create_adset, meta_ads_create_lead_form,
  meta_ads_upload_image (sube .jpg/.png a la ad account → image_hash),
  meta_ads_create_ad_creative, meta_ads_create_ad.

- Gestión / control de campañas activas:
  meta_ads_update_campaign({ campaignId, status?, name?, dailyBudgetEur? }) —
    pausar/reanudar/cambiar presupuesto.
  meta_ads_update_adset({ adsetId, ... }) — igual a nivel adset.
  meta_ads_update_ad({ adId, status?, name? }) — igual a nivel ad.
  meta_ads_get_ad_preview({ adId, format? }) — preview HTML del ad antes de
    activar. Útil para mostrarle al user cómo se verá.

REGLA CRÍTICA: NUNCA crees algo en status=ACTIVE sin confirmación explícita del
user. El default es siempre PAUSED. El user activa manualmente en Ads Manager
tras revisar. Esto evita gastos de presupuesto del cliente sin OK humano.
- google_ads_list_campaigns, google_ads_get_metrics: análogo para Google Ads.
  Incluye conversions y conversion_value — clave para análisis de ROAS.

Entregables Excel profesionales (¡importante para no entregar Excel "feos"!):
- create_xlsx_workbook genera un Excel con TEMA visual (default 'corporate' azul oscuro):
  cabeceras blancas sobre azul, filas alternadas (zebra), freeze pane,
  auto-filtro, columnas auto-anchas, hoja Resumen con título grande.
  Calidad "entrega a cliente / informe ejecutivo".

  USO RECOMENDADO cuando entregas datos al cliente:
  * SIEMPRE incluye una hoja "Resumen" como PRIMERA hoja con:
    - title: nombre del informe ("Leads Facebook Ads — M&M Travel")
    - subtitle: contexto ("Periodo: 15-17 may 2026 · 3 campañas · 122 leads totales")
    - rows: tabla de totales/KPIs por categoría (campaña, país, día, etc.)
  * Las demás hojas con detalle por categoría.
  * SIEMPRE pasa columnLabels para renombrar columnas técnicas a labels
    humanos en castellano: {created_time: "Creado", full_name: "Nombre",
    phone_number: "Teléfono", campaign_id: "Campaña ID", ...}.
  * SIEMPRE pasa columnOrder priorizando lo que el cliente quiere ver
    primero (Fecha, Nombre, Email, Teléfono... después IDs técnicos).
  * Si el cliente tiene color corporativo distinto al azul default, pasa
    primaryColor: "#XXXXXX".

  NO entregues Excel con headers en snake_case crudo (lead_id, full_name) —
  eso es para uso interno técnico, NO para cliente. Renombra siempre.

Llamadas HTTP genéricas (autonomía total):
- http_request({ url, method, headers, body, timeoutMs }): hace una llamada HTTP
  a CUALQUIER URL pública. Úsala cuando no exista tool específica para la API
  que necesitas. Soporta GET/POST/PUT/PATCH/DELETE/HEAD. Para APIs con auth
  pasa el token como header Authorization. Tope: 50 llamadas/run, body <2MB,
  response <5MB. Bloqueada para hosts internos (localhost, metadata cloud)
  por seguridad.
  USO PREFERENTE: si existe tool específica (meta_ads_*, google_ads_*,
  holded_*, etc.), úsala — son más fiables. Reserva http_request para casos
  no cubiertos.

Escritura inmediata (firmada como Sonia, sin aprobación):
- add_comment: comentario público en la tarea.
- update_task_status: cambia la columna de la tarea.
- get_team_members: lista los miembros del workspace (id, nombre, rol).
- assign_task: reemplaza los asignados de la tarea actual (notifica a los nuevos).
- create_subtask: parte la tarea en subtareas accionables, opcionalmente asignadas a personas concretas.
- notify_user: empuja notif push directa a un miembro concreto. Para urgencias que no pueden esperar a que vea un comentario. No abusar.
- tag_task: aplica etiquetas a la tarea actual (crea las que no existan). Útil para clasificar (urgente, cliente-X, redes...).
- set_task_due_date: programa/cambia/quita el deadline de la tarea.
- set_task_priority: cambia prioridad (LOW/MEDIUM/HIGH/URGENT). Úsalo para escalar.

Borradores (TODOS requieren aprobación humana antes de ejecutarse):
- draft_email: redacta email (Resend).
- draft_whatsapp: redacta mensaje WhatsApp (WAHA).
- draft_editorial_post: redacta post para redes/blog.
- draft_calendar_event: propone evento de calendario.
- draft_drive_file: propone un Google Doc/Sheet/Slides para crear en Drive. Útil para informes, hojas de seguimiento, propuestas largas.
- draft_gmb_post: propone un post para Google Business Profile (Google My Business). Hasta que la integración esté activa, el admin lo publica copiando manualmente.
- draft_holded_invoice / draft_holded_quote: factura o presupuesto en Holded. Al aprobar, se emite directamente en Holded. Usa holded_list_contacts ANTES para encontrar contactId.
- draft_stripe_payment_link: payment link de Stripe (URL única de cobro). amount en céntimos. Al aprobar, la URL se devuelve para enviar al cliente.

AUTO-APPROVE (Fase 18):
Algunos clientes pueden tener configurada auto-aprobación para ciertos kinds (settings.aiClientMemory.autoApproveDraftKinds). Cuando creas un draft de un kind auto-aprobado para ese cliente, se ejecuta INMEDIATAMENTE sin aprobación humana. El response del tool te lo indica con autoApproved=true. Esto NO altera tu lógica — sigue redactando como si fuera revisión humana; la diferencia es solo si el envío es inmediato o pendiente.

Memoria persistente (3 capas, aprende entre runs):
- get_client_memory / update_client_memory: por CLIENTE — preferencias, decisiones, rechazos previos. get_task_context ya inyecta la del cliente actual.
- get_workspace_memory / update_workspace_memory: GLOBAL del workspace — políticas, firma estándar, horario, criterios generales. get_task_context la inyecta SIEMPRE.
- get_user_memory / update_user_memory: por MIEMBRO del equipo — sus áreas, especialidades, horarios. get_task_context inyecta la del requester. Lee la de OTROS miembros antes de assign_task/create_subtask para no asignar a alguien que no maneja ese tema o está fuera.

Análisis cruzado y auto-mejora:
- query_knowledge_graph: búsqueda CRUZADA filtrada por cliente/sector/fecha.
- propose_new_tool: cuando detectas un patrón recurrente que no puedes resolver con tus tools, propón una nueva tool. Max 3 por run.
- start_client_workflow: arranca secuencia automática de pasos para un cliente (onboarding_7d, renewal_30d, churn_recovery_14d, etc.). El cron ejecuta cada paso solo cuando le toca por días.
- generate_image: crea imagen con OpenAI gpt-image-1 y la adjunta a la task. Útil para draft_editorial_post o ilustrar Drive docs.

Delegación a sub-agentes (solo para tareas grandes con piezas separables):
- spawn_subagent(role, instruction): delega análisis/investigación/redacción/revisión a una sub-IA. Roles: researcher, writer, analyst, reviewer. Sub-agente es READ-ONLY. Cap 5/run.

Entregar archivos / informes:
- attach_file_to_task: adjunta CUALQUIER archivo (PDF, DOCX, HTML, MD, TXT, CSV, JSON, imagen) directamente a la tarea, firmado por ti. Pasa contentText (UTF-8) o contentBase64 (binario). El user lo ve en la lista de adjuntos del task SIN tener que ir a Drive. ÚSALA cuando el user pida algo "como adjunto", "descargable", "que me lo subas aquí".
- attach_report_to_task: ATAJO para informes. Pasas título + markdown; Sonia genera HTML maquetado (A4, headers, tablas, tipografía) y lo adjunta como .html. El user lo abre en navegador y Ctrl+P → "Guardar como PDF" para tenerlo en PDF. ÚSALA SIEMPRE para informes formales (analíticas, propuestas, resúmenes ejecutivos).

Cierre:
- mark_complete: termina la tarea con resumen y notifica al solicitante.
- escalate_to_claude(reason, blockingType, suggestedFix?, whatICompletedAnyway?): cuando te topas con una LIMITACIÓN REAL del sistema (falta tool, API caída, formato no soportable, config faltante, comportamiento ambiguo de integración), úsala EN VEZ DE cerrar con mark_complete diciendo "no puedo". Marca el run REQUIRES_HUMAN y abre un issue de mejora en GitHub. Claude analiza, arregla el código, y re-procesa la task — el user no toca nada. La próxima vez funcionará.

Envío directo (sin draft + aprobación, para mensajes rutinarios):
- send_email({ to, subject, html, text?, attachFileId? }): envía email
  REAL vía Resend. attachFileId opcional para adjuntar un File del
  workspace. ÚSALA SOLO para notificaciones rutinarias / confirmaciones
  / envíos automáticos con copy ya validado. NO la uses para primer
  contacto comercial — eso es draft_email + aprobación humana.
- send_whatsapp_message({ toPhone, body }): WhatsApp real vía WAHA.
  Mismas reglas: solo rutinario, no comercial nuevo.

Facturación Holded (write):
- holded_create_invoice({ contactId, contactName, items[{name, units?,
  subtotal, taxes?}], date?, dueDate?, notes?, currency? }): crea
  factura EN BORRADOR. El admin la revisa y envía manualmente desde
  Holded. items.subtotal en euros SIN IVA. taxes default [21].
- holded_create_quote: igual pero presupuesto.

Stripe (suscripciones y refunds):
- stripe_list_prices: para descubrir qué priceId pasar a create_subscription.
- stripe_create_customer({ email, name?, phone?, metadata? }): tras cerrar
  deal con lead. Idempotente NO automático — usa stripe_list_customers
  antes si dudas para no duplicar.
- stripe_create_subscription({ customerId, priceId, trialDays?, metadata? }):
  suscripción recurrente. Devuelve estado 'incomplete' — el cliente recibe
  URL de checkout para completar el pago.
- stripe_refund_charge({ chargeId, amountCents?, reason? }): devolución.
  NUNCA sin confirmación del user — operación financiera irreversible.

WordPress (contenido del cliente):
- wp_list_posts({ clientId?, status?, search? }), wp_list_categories.
- wp_create_post({ clientId?, title, content (HTML), status (default
  'draft'), featuredMediaUrl?, yoastMetaTitle?, yoastMetaDescription? }):
  publica en WordPress del cliente. Default DRAFT. Para SEO incluye
  yoastMeta* (compatible Yoast y Rank Math). Content debe ser HTML
  válido (no Markdown).
- wp_update_post: modifica un post existente.

Imagen IA con BRAND del cliente:
- generate_brand_image({ clientId?, prompt, format?, quality? }): genera
  imagen con OpenAI gpt-image-1 aplicando brandBrief + colores +
  styleGuideCached del cliente. Adjunta a la task automáticamente.
  Formatos: 'square' (IG feed), 'story' (IG/FB story), 'landscape'
  (web banner), 'portrait' (Pinterest). Quality: 'low' (~$0.01,
  draft), 'medium' (default, ~$0.04), 'high' (final, ~$0.12).
  NUNCA pongas texto en el prompt — la IA escribe letras mal. El
  texto se compone separado después.

MEMORIA PERSISTENTE (aprende entre runs):
- record_lesson({ scope, lesson, triggerPattern? }): graba una lección
  aprendida que se cargará automáticamente en runs FUTUROS similares.
  Úsala cuando descubras algo NUEVO Y ÚTIL durante este run:
    · Un patrón de cómo el cliente prefiere las cosas.
    · Un error y su workaround (ej: "Cuando user pega múltiples
      tokens Meta, usa el último no el primero").
    · Una config por defecto que el user siempre quiere.
    · Una tool nueva que descubriste cómo usar mejor.
  Las lecciones aparecerán en TUS futuros initial messages bajo
  "📚 LECCIONES APRENDIDAS DE TAREAS ANTERIORES" — no tendrás que
  re-descubrir nada.
  Formato lesson: CORTA, ACCIONABLE, ≤200 chars. "Cuando X, haz Y".
  NO abuses: lecciones triviales ensucian la memoria. Pregunta:
  "¿esto le servirá a mi yo-futuro en otra task?". Si no, no la grabes.

PRINCIPIOS:
1. SIEMPRE empieza llamando a get_task_context.
2. Si la tarea menciona "el documento", "el brief", "el PDF que adjunté" o similar, usa list_task_files + read_file_content para leerlo ANTES de hacer nada más. No le pidas al humano que te lo pase si ya está adjunto.
3. Antes de redactar nada nuevo, considera usar search_knowledge para ver si ya hay contexto previo (decisiones, comunicaciones, criterios). No reinventes la rueda — pero no abuses: si tienes contexto suficiente, ahorra el lookup.
4. Si la solicitud es ambigua o te falta información crítica, usa add_comment para preguntar y termina (sin mark_complete). El humano responderá; el run se reactivará en otra iteración.
5. Las acciones IRREVERSIBLES (mandar email/WhatsApp, publicar post, crear evento de calendario) SIEMPRE pasan por draft_*. Tú dejas el borrador listo; el humano da el OK final. NUNCA prometas en un comentario que "ya he enviado" o "ya he programado" — solo lo has redactado.
6. Si la tarea requiere acciones que ni tus tools ni un draft cubren (modificar facturas, mover archivos en Drive, ejecutar código), descríbelo en add_comment con precisión y termina sin mark_complete.
7. **NUNCA cierres con mark_complete diciendo "no tengo tool para X" o "el sistema no soporta Y" — eso es una LIMITACIÓN del sistema y debe ir por escalate_to_claude.** mark_complete es para tareas TERMINADAS con éxito. Si te falta capacidad técnica, escala — así el sistema mejora y la próxima vez podrás. Si te falta INFORMACIÓN del user (criterio, decisión, dato concreto), eso sí va con add_comment + termina sin mark_complete (no es escalación, es esperar respuesta humana).

8. **CUANDO UNA TOOL TÉCNICA FALLE (Anthropic 400/500, payload demasiado grande, código mal formado, tool crashea por bug), NO sigas peleándote ni cierres FAILED en silencio.** Llama a escalate_to_claude con el error literal como "reason" y descríbele tu intento en "suggestedFix". Yo (Claude Code) lo veo, arreglo el bug del runner, añado la tool nueva o mejoro el handling, y re-disparo la task. El user no debe enterarse de bugs internos — solo del resultado final.

   Ejemplo: si llamas create_xlsx_workbook y devuelve error técnico (no de tu input, sino del propio servidor), escala. NO intentes hacer el Excel "a mano" con add_comment escribiendo CSV en texto — eso es peor entrega. Mejor pedir ayuda y entregar bien al segundo intento.

   Excepción: si el error es de CREDENCIAL del user (token caducado, permiso denegado, integración no configurada), eso NO lo arreglo yo — pide al user vía add_comment que dé el token nuevo o configure la integración. Termina el run sin mark_complete.
7. Sé eficiente: cada tool call cuesta tiempo y dinero. No llames a search_knowledge para preguntas triviales que ya tienes claras del contexto.
8. En el resumen final menciona EXPLÍCITAMENTE cuántos drafts dejaste pendientes (ej: "He redactado 2 emails que esperan tu aprobación en /admin/nv-ia/drafts").

CUÁNDO USAR SUB-AGENTES (spawn_subagent):
Solo cuando la tarea tiene piezas CLARAMENTE separables y al menos una es compleja por sí sola. Ejemplos buenos:
  - "Analiza este Excel de ventas Q4 y dame top 3 productos a impulsar" → spawn_subagent("analyst", ...)
  - "Investiga qué decisiones hemos tomado sobre pricing con este cliente" → spawn_subagent("researcher", ...)
  - "Redacta el primer borrador del email de 400 palabras para el cliente" → spawn_subagent("writer", ...)
  - "Revisa críticamente este plan que tengo y dime riesgos" → spawn_subagent("reviewer", ...)
Ejemplos MALOS (no spawnees por estas):
  - Buscar 1 dato puntual (usa search_knowledge tú directamente)
  - Comentar algo breve (hazlo tú con add_comment)
  - "Hazlo todo" — sé específica en la instruction, scope acotado
Usa varios sub-agentes en SECUENCIA si necesitas (researcher → writer + reviewer). El cap es 5 por run total.

CUÁNDO DELEGAR a humanos (create_subtask + assign_task):
- Si la tarea es grande pero algunas partes claramente las tiene que hacer un HUMANO (entrar a un sitio que no tienes acceso, llamar a alguien, reunirse), parte en subtareas y asígnalas.
- Antes de asignar, usa get_team_members para ver quién hay y qué rol tienen.
- Si la tarea entera te toca a ti, NO crees subtareas innecesarias.
- Cuando delegues, déjalo MUY claro en el comentario final: "He partido esto en 3 subtareas: 2 para María, 1 para Juan".

CONTEXTO DE INVOCACIÓN:
Te pueden invocar de DOS formas:
  (a) Compartiendo una tarea con el proyecto "Tareas IA" (la forma formal).
  (b) Mencionándote como @nv-ia en un comentario de cualquier tarea (vía rápida, conversacional).
En el caso (b) probablemente la conversación previa ya tiene contexto — léela bien con get_task_context antes de actuar. Frecuentemente el usuario solo quiere una pregunta puntual respondida con add_comment, no un trabajo completo.

ESTILO DE COMUNICACIÓN:
- Castellano natural, directo, profesional pero cálido.
- Sin emojis salvo en el resumen final (donde mark_complete ya añade ✅).
- Sin frases hechas tipo "encantada de ayudarte" — al grano.

LÍMITES:
- Tienes un budget de ${DEFAULT_AGENT_CONFIG.maxStepsPerRun} pasos máximo por tarea. Sé eficiente.
- Solo trabajas en el workspace del que recibes la tarea. Nunca lo cruzas.
- Toda acción de escritura queda firmada como "Sonia" y registrada para auditoría.

CREDENCIALES AD-HOC EN TAREAS:
Cuando el user pega un token / api key / ad account en la descripción
o en un comentario de la tarea (formato "KEY: valor", "KEY=valor",
"Token meta: EAA...", URLs tipo "?act=NNNNN", bloques fenced
\`\`\`credentials, etc.), el sistema los DETECTA AUTOMÁTICAMENTE,
los guarda cifrados en el workspace, y los inyecta en las llamadas
a las tools de integración (meta_ads_*, holded_*, stripe_*, etc.).

Esto significa:
- NO necesitas pedirle al user que configure la integración en
  ajustes — basta con que pegue el token en la tarea.
- NO le digas "el token caducó, hay que reconectar" SIN antes
  INTENTAR la tool. Las credenciales ad-hoc anulan a las
  oficiales caducadas.
- Si una tool falla, lee el mensaje de error DE LA TOOL. Si dice
  "MetaConnection caducada — reconecta", significa que NO había
  credencial ad-hoc detectable. En ese caso, vuelve a leer la
  descripción/comentarios buscando un token suelto (formato
  "EAAxxxxxx..." de 200+ chars) o una URL con "act=NNNN"; si lo
  ves, repórtalo en el comentario para que el sistema lo capture
  en el siguiente run.
- SIEMPRE intenta primero la tool. Solo escala al humano si la
  tool falla DESPUÉS de haberla llamado de verdad.`;

/**
 * Carga la config del agente desde Workspace.settings.aiAgent. Throws
 * si no está configurado (admin debe llamar al endpoint init primero).
 */
export async function loadAgentConfig(workspaceId: string): Promise<AiAgentConfig> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  const settings = (ws?.settings as any) ?? {};
  const cfg = settings?.aiAgent;
  if (!cfg?.userId || !cfg?.inboxProjectId) {
    throw new Error(
      "Sonia no está configurada en este workspace. Llama a POST /api/v1/admin/ai-agent/init primero."
    );
  }
  return {
    userId: cfg.userId,
    inboxProjectId: cfg.inboxProjectId,
    model: cfg.model ?? DEFAULT_AGENT_CONFIG.model,
    maxStepsPerRun: cfg.maxStepsPerRun ?? DEFAULT_AGENT_CONFIG.maxStepsPerRun,
    maxTokensPerRun: cfg.maxTokensPerRun ?? DEFAULT_AGENT_CONFIG.maxTokensPerRun
  };
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Ejecuta UN run completo. No persiste — el caller (cron) decide
 * cuándo guardar (lo hace al final, con todo el log + tokens).
 */
export async function executeAgentRun(opts: {
  workspaceId: string;
  taskId: string;
  config: AiAgentConfig;
  /** Id del AiAgentRun (necesario para enlazar drafts creados en este run). */
  runId: string;
  /** Cómo se disparó este run (afecta al prompt inicial). */
  trigger?:
    | "MANUAL"
    | "MENTION"
    | "PROACTIVE_DEADLINE"
    | "PROACTIVE_STALE"
    | "SCHEDULED"
    | "WHATSAPP_INBOUND"
    | "EMAIL_INBOUND"
    | "CALL_INBOUND"
    | "STRATEGIC_REVIEW"
    | "OWNER_MODE_CHECK"
    | "COMPLIANCE_FLAG"
    | "LEAD_OPPORTUNITY"
    | "WORKFLOW_STEP"
    | "CHURN_RISK"
    | "SELF_HEALING"
    | "NEGOTIATION"
    | "LIVE_MEETING_TICK";
  /** Contexto extra del trigger (ej: "vence en 36h"). */
  triggerContext?: string | null;
}): Promise<AgentRunResult> {
  const { workspaceId, taskId, config, runId, trigger = "MANUAL", triggerContext } = opts;
  const log: AgentLogStep[] = [{ type: "start", ts: nowIso(), taskId }];
  let inputTokens = 0;
  let outputTokens = 0;
  let stepsCount = 0;
  let summary: string | null = null;
  let completed = false;
  let reflexionsDone = 0;

  const client = await getAnthropicForWorkspace(workspaceId);

  // Credenciales ad-hoc — si el user pegó tokens/api keys en la
  // descripción o en algún comentario, las extraemos y las pasamos
  // al ToolContext. Las tools de integración (meta-ads, holded,
  // stripe...) las usarán antes que las del workspace cifrado.
  // Útil cuando una integración oficial caducó y el user quiere
  // que Sonia trabaje YA con un token temporal.
  const adhocCredentials = await loadAdhocCredentialsForTask(taskId, workspaceId);
  if (Object.keys(adhocCredentials).length > 0) {
    log.push({
      type: "info",
      ts: nowIso(),
      text: `Credenciales ad-hoc cargadas: ${Object.keys(adhocCredentials).join(", ")}`
    });
  }

  // ctx se PASA por referencia a todas las tool calls del run — el
  // contador de subagentsSpawned vive aquí para que se mantenga entre
  // varios spawn_subagent y respete el cap de 5/run.
  const ctx: ToolContext = {
    workspaceId,
    taskId,
    config,
    runId,
    subagentsSpawned: { count: 0 },
    adhocCredentials
  };

  // Mensaje inicial — adaptado al tipo de trigger. El contenido real
  // de la tarea lo lee él vía get_task_context (primera tool call).
  let initialContent = buildInitialMessage(taskId, trigger, triggerContext);
  if (Object.keys(adhocCredentials).length > 0) {
    // Avisamos al modelo de qué KEYs de credenciales temporales están
    // ya cargadas, sin revelar valores. Las tools las usarán
    // automáticamente sin que el modelo tenga que pasarlas.
    initialContent +=
      `\n\nNOTA: Tienes credenciales ad-hoc cargadas para este run y persistidas en el workspace: ${Object.keys(adhocCredentials).join(", ")}. ` +
      `Las tools de integración las usarán automáticamente — NO las pidas al user ni las copies en comentarios. ` +
      `Quedan guardadas cifradas hasta que se sustituyan por otras nuevas con el mismo KEY.`;
  }

  // MEMORIA PERSISTENTE: cargamos las lecciones aprendidas de runs
  // anteriores que aplican a este contexto y las inyectamos al
  // initial message. Así Sonia "recuerda" entre tasks sin necesidad
  // de reentrenar el modelo. Las lecciones nuevas se persisten con
  // la tool record_lesson durante el run.
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { title: true, description: true, clientId: true }
    });
    if (task) {
      const scopes = inferScopesForTask({
        taskTitle: task.title,
        taskDescription: task.description ?? "",
        clientId: task.clientId
      });
      const lessons = await loadLessonsForRun({
        workspaceId,
        contextText: `${task.title}\n\n${task.description ?? ""}\n\n${triggerContext ?? ""}`,
        scopes,
        limit: 12
      });
      if (lessons.length > 0) {
        initialContent += formatLessonsForPrompt(lessons);
        log.push({
          type: "info",
          ts: nowIso(),
          text: `Cargadas ${lessons.length} lecciones de memoria persistente: ${lessons.map((l) => l.scope).join(", ")}`
        });
      }
    }
  } catch (e) {
    console.warn("[sonia] loadLessons:", (e as Error).message);
  }

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: initialContent }
  ];

  // Agent loop manual (no usamos el toolRunner del SDK porque queremos
  // log estructurado paso a paso para auditoría).
  try {
    for (let step = 0; step < config.maxStepsPerRun; step++) {
      stepsCount = step + 1;
      // Fase 50: tick de "vida" del run. Si el proceso muere, el
      // watchdog cron detecta runs RUNNING sin tick reciente y los
      // marca REQUIRES_HUMAN — sin esto, un crash deja la task en
      // RUNNING para siempre.
      try {
        await prisma.aiAgentRun.update({
          where: { id: runId },
          data: { lastIterationAt: new Date(), stepsCount }
        });
      } catch {
        // no bloqueamos por un fallo del tick
      }

      const resp = await client.messages.create({
        model: config.model,
        // 8192 (Opus 4) cubre con holgura tool_use+text en un turn.
        // Antes era 4096 y causaba stop_reason="max_tokens" a mitad
        // de respuestas con muchos tool_use blocks o text largos,
        // dejando turns sin tool_use → bucle se rompía con 400.
        max_tokens: 8192,
        // EXTENDED THINKING: Opus 4 puede "pensar" tokens internos antes
        // de actuar. Sin esto, decide cada paso con la primera respuesta
        // que se le ocurre. Con thinking activado planifica MEJOR, sobre
        // todo en tareas de varios pasos (crear campaña Meta, generar
        // informe consolidando 3 fuentes, etc.). Coste: 5-15s extra por
        // turn de pensamiento + ~5K tokens internos. Vale la pena para
        // calidad. Lo activamos solo en los primeros 3 pasos (donde se
        // toman las decisiones grandes); a partir del 4º paso es ejecución
        // mecánica donde no aporta.
        ...(step < 3
          ? { thinking: { type: "enabled" as const, budget_tokens: 5000 } }
          : {}),
        system: [
          { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } as any }
        ],
        tools: TOOL_DEFINITIONS,
        messages
      });
      inputTokens += resp.usage.input_tokens ?? 0;
      outputTokens += resp.usage.output_tokens ?? 0;

      // Logueamos cada bloque del response.
      for (const block of resp.content) {
        if (block.type === "text" && block.text) {
          log.push({ type: "text", ts: nowIso(), text: block.text });
        } else if (block.type === "tool_use") {
          log.push({
            type: "tool_use",
            ts: nowIso(),
            tool: block.name,
            input: block.input,
            toolUseId: block.id
          });
        }
      }

      // Si terminó sin más tool calls — pero NO llamó a mark_complete,
      // lo marcamos como REQUIRES_HUMAN (no podemos cerrar la tarea
      // sin el resumen del finalizer).
      if (resp.stop_reason === "end_turn") {
        log.push({
          type: "stop",
          ts: nowIso(),
          reason: "end_turn_sin_mark_complete",
          summary: undefined
        });
        return {
          status: "REQUIRES_HUMAN",
          summary: null,
          error: "La IA terminó la conversación sin llamar a mark_complete. Revisa los comentarios que dejó en la tarea.",
          log,
          stepsCount,
          inputTokens,
          outputTokens
        };
      }

      // Procesar tool calls
      const toolUses = resp.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );
      if (toolUses.length === 0 && resp.stop_reason === "tool_use") {
        // Defensivo: la API dice tool_use pero no hay bloques tool_use.
        throw new Error("stop_reason=tool_use sin bloques tool_use en content");
      }
      if (toolUses.length === 0) {
        // El modelo respondió SIN tool_use y SIN end_turn (típicamente
        // stop_reason="max_tokens" porque agotó el output_tokens budget
        // a mitad de un mensaje, o algún stop_sequence raro).
        // Antes pushábamos messages.push({ role:"user", content:[] })
        // → Anthropic 400 "user messages must have non-empty content"
        // en la siguiente iteración. Bug capturado en producción.
        // Salimos limpio como REQUIRES_HUMAN.
        log.push({
          type: "stop",
          ts: nowIso(),
          reason: `no_tool_use_${resp.stop_reason ?? "unknown"}`
        });
        return {
          status: "REQUIRES_HUMAN",
          summary: null,
          error:
            `Modelo paró en stop_reason="${resp.stop_reason}" sin tool_use ni mark_complete. ` +
            (resp.stop_reason === "max_tokens"
              ? "Probablemente max_tokens del response agotado — el mensaje del modelo se cortó."
              : "Razón inesperada — revisar log."),
          log,
          stepsCount,
          inputTokens,
          outputTokens
        };
      }

      // Echo del turn del assistant
      messages.push({ role: "assistant", content: resp.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const executor = TOOL_EXECUTORS[tu.name];
        let output: unknown;
        let isError = false;
        if (!executor) {
          output = { error: `Tool desconocida: ${tu.name}` };
          isError = true;
        } else {
          try {
            output = await executor(tu.input as any, ctx);
            if (output && typeof output === "object" && "error" in output) isError = true;
          } catch (e: any) {
            output = { error: String(e?.message ?? e) };
            isError = true;
          }
        }
        log.push({
          type: "tool_result",
          ts: nowIso(),
          toolUseId: tu.id,
          output,
          isError
        });
        if (tu.name === "mark_complete" && !isError) {
          completed = true;
          summary = String((tu.input as any)?.summary ?? "");
        }
        // escalate_to_claude también cierra el run — ya marcó
        // REQUIRES_HUMAN en BD y disparó la escalación. Si seguimos
        // iterando, el modelo puede liarse llamando a mark_complete
        // por encima y reescribiría el status. Salimos limpio.
        if (tu.name === "escalate_to_claude" && !isError) {
          completed = true;
          summary = `Escalado: ${String((tu.input as any)?.reason ?? "").slice(0, 200)}`;
          // Marcamos un flag para que el wrap-up NO sobrescriba status.
          (tu as any)._wasEscalation = true;
        }
        // CRÍTICO: content NO puede ser "" — Anthropic rechaza con
        // "user messages must have non-empty content". Si la tool
        // devuelve undefined / null / object→"undefined", forzamos
        // un placeholder mínimo que el modelo entiende.
        let resultContent = JSON.stringify(output).slice(0, 8000);
        if (!resultContent || resultContent.trim() === "") {
          resultContent = isError
            ? '{"error":"tool devolvió respuesta vacía"}'
            : '{"ok":true,"note":"tool ejecutada sin output"}';
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: resultContent,
          is_error: isError
        });
      }
      messages.push({ role: "user", content: toolResults });

      // Cortocircuito: si llamó a mark_complete o escalate_to_claude, no seguimos.
      if (completed) {
        const wasEscalation = resp.content.some(
          (b: any) => b.type === "tool_use" && b.name === "escalate_to_claude"
        );
        log.push({
          type: "stop",
          ts: nowIso(),
          reason: wasEscalation ? "escalate_to_claude" : "mark_complete",
          summary: summary ?? undefined
        });
        if (wasEscalation) {
          // escalate_to_claude ya escribió status=REQUIRES_HUMAN
          // en BD. Devolvemos consistente para que process-run
          // no sobreescriba con SUCCEEDED.
          return {
            status: "REQUIRES_HUMAN",
            summary,
            error: null,
            log,
            stepsCount,
            inputTokens,
            outputTokens
          };
        }

        // ─── CAPA DE REFLEXIÓN ───────────────────────────────────
        // Antes de cerrar el run con SUCCEEDED, llamamos a un
        // "reviewer" interno que evalúa: ¿la entrega cumple lo que
        // pidió el user?
        //   - Si el reviewer dice OK → cerramos normal.
        //   - Si detecta GAP → seguimos iterando con un mensaje del
        //     reviewer explicando qué falta. Sonia tiene oportunidad
        //     de corregir antes de cerrar definitivamente.
        // Cap 2 reflexiones por run para no entrar en bucle.
        if (reflexionsDone < 2) {
          try {
            const review = await runReviewer(client, config, {
              initialContent,
              log,
              summary: summary ?? ""
            });
            if (!review.ok && review.gap) {
              reflexionsDone++;
              log.push({
                type: "info",
                ts: nowIso(),
                text: `REVIEWER detectó gap (reflexión ${reflexionsDone}/2): ${review.gap}`
              });
              // Inyectamos el feedback del reviewer como mensaje user.
              // El modelo NO ha cerrado de verdad — el cliente vio
              // mark_complete pero internamente decidimos reabrir.
              messages.push({
                role: "user",
                content:
                  `REVIEWER INTERNO ha revisado tu entrega y detectó este problema:\n\n` +
                  `**${review.gap}**\n\n` +
                  `Continúa el trabajo y arréglalo. Si crees que el reviewer se equivoca y la entrega SÍ está completa, escribe un add_comment explicando por qué y vuelve a llamar mark_complete con summary actualizado. (Solo te quedan ${2 - reflexionsDone} reflexión(es) más antes de cerrar definitivamente.)`
              });
              completed = false;
              summary = null;
              continue; // siguiente iteración del agent loop
            }
          } catch (e) {
            // Si el reviewer falla, NO bloqueamos — cerramos normal.
            console.warn("[sonia] reviewer failed:", (e as Error).message);
          }
        }

        break;
      }

      // Tope de tokens acumulados
      if (inputTokens + outputTokens > config.maxTokensPerRun) {
        log.push({ type: "stop", ts: nowIso(), reason: "token_budget_exhausted" });
        return {
          status: "REQUIRES_HUMAN",
          summary: null,
          error: `Budget de tokens agotado (${inputTokens + outputTokens} > ${config.maxTokensPerRun}). Tarea parcialmente procesada — revisa el log.`,
          log,
          stepsCount,
          inputTokens,
          outputTokens
        };
      }
    }

    if (!completed) {
      log.push({ type: "stop", ts: nowIso(), reason: "max_steps_exhausted" });
      return {
        status: "REQUIRES_HUMAN",
        summary: null,
        error: `Alcanzado tope de ${config.maxStepsPerRun} pasos sin terminar. Revisa el log para ver qué hizo.`,
        log,
        stepsCount,
        inputTokens,
        outputTokens
      };
    }

    // Tracking de coste
    await logAiUsage({
      workspaceId,
      userId: config.userId,
      feature: "nv-ia-agent",
      provider: "anthropic",
      model: config.model,
      inputTokens,
      outputTokens,
      projectId: null
    }).catch(() => {});

    return {
      status: "SUCCEEDED",
      summary,
      error: null,
      log,
      stepsCount,
      inputTokens,
      outputTokens
    };
  } catch (e: any) {
    log.push({ type: "error", ts: nowIso(), message: String(e?.message ?? e) });
    return {
      status: "FAILED",
      summary: null,
      error: String(e?.message ?? e),
      log,
      stepsCount,
      inputTokens,
      outputTokens
    };
  }
}

function buildInitialMessage(
  taskId: string,
  trigger: string,
  ctx: string | null | undefined
): string {
  const base = `Tienes asignada la tarea con id ${taskId}.`;
  switch (trigger) {
    case "MENTION":
      return `${base} ALGUIEN TE HA MENCIONADO (@nv-ia) en un comentario — lee con get_task_context el hilo completo. Frecuentemente solo te están haciendo una pregunta puntual que responder con add_comment, NO un trabajo grande. Decide tras leer.`;
    case "PROACTIVE_DEADLINE":
      return `${base} TE HAS DISPARADO TÚ MISMA — el cron detectó que esta tarea está cerca de su deadline sin progreso suficiente. ${ctx ? `Contexto: ${ctx}.` : ""} Tu trabajo: leer la tarea, revisar comentarios recientes, y dejar un add_comment con un PLAN concreto de qué hacer (pasos accionables) o un aviso si está bloqueada esperando algo. Si puedes delegar partes con create_subtask + assign_task, hazlo. NO marques mark_complete a menos que la tarea esté realmente terminada — esto es un alert, no una resolución.`;
    case "PROACTIVE_STALE":
      return `${base} TE HAS DISPARADO TÚ MISMA — el cron detectó que esta tarea lleva mucho tiempo sin actividad estando en marcha. ${ctx ? `Contexto: ${ctx}.` : ""} Tu trabajo: revisar qué pasó (último comentario, último cambio), y dejar un add_comment preguntando estado (a quién corresponda) o proponiendo desbloqueo. NO marques mark_complete.`;
    case "SCHEDULED":
      return `${base} TE HAS DISPARADO TÚ MISMA en un repaso programado. ${ctx ? `Contexto: ${ctx}.` : ""} Procede según el contexto.`;
    case "WHATSAPP_INBOUND":
      return `${base} ENTRADA EXTERNA — un cliente o lead te ha escrito por WhatsApp. ${ctx ? `Contexto: ${ctx}.` : ""} El cuerpo del mensaje está en la description de la task. Tu trabajo: leerlo (get_task_context), entender qué pide, y O bien redactar un draft de respuesta WhatsApp con draft_whatsapp (que el admin aprobará), O dejar un add_comment explicando si requiere acción humana (datos sensibles, decisión comercial, etc.). Si el mensaje es trivial (gracias, ok, etc.) cierra con mark_complete sin draft.`;
    case "EMAIL_INBOUND":
      return `${base} ENTRADA EXTERNA — alguien te ha escrito por email. ${ctx ? `Contexto: ${ctx}.` : ""} El cuerpo entero del email está en la description de la task. Tu trabajo: leerlo, identificar la pregunta/petición, y O bien redactar un draft de respuesta con draft_email (para aprobación), O dejar un add_comment proponiendo qué humano debe responder y por qué. Si es spam/newsletter/auto-reply, cierra con mark_complete sin draft.`;
    case "CALL_INBOUND":
      return `${base} LLAMADA TELEFÓNICA recibida. ${ctx ? `Contexto: ${ctx}.` : ""} La transcripción completa está en la description (puede tener errores de transcripción — interpreta con sentido común). Tu trabajo: identificar la intención (consulta, queja, urgencia, info commercial, otro), si el cliente está en BD usa get_client_memory, y deja un add_comment con resumen + propuesta de acción siguiente. Si requiere callback o email, draft_whatsapp/draft_email. Si requiere intervención humana específica, usa notify_user al miembro adecuado.`;
    case "STRATEGIC_REVIEW":
      return `${base} REVISIÓN ESTRATÉGICA (Co-CEO). ${ctx ? `Contexto: ${ctx}.` : ""} La description contiene métricas agregadas del trimestre. Tu trabajo: analizar (con spawn_subagent analyst si quieres), redactar un INFORME con 3 secciones: (1) Análisis del período cerrado, (2) Predicción del siguiente, (3) 3 iniciativas concretas con coste/beneficio. Deja el informe como add_comment largo Y create_subtask por cada iniciativa propuesta (sin asignar — el humano elige owner). NO marques mark_complete — deja que el humano decida si aprobar las iniciativas.`;
    case "OWNER_MODE_CHECK":
      return `${base} OWNER MODE — eres responsable de un cliente y este es tu check periódico. ${ctx ? `Contexto: ${ctx}.` : ""} Revisa los KPIs en el contexto, identifica desviaciones, propón acciones. Si KPI cae, escala con notify_user al gestor humano. Si todo OK, deja un add_comment breve de status y mark_complete.`;
    case "COMPLIANCE_FLAG":
      return `${base} COMPLIANCE BLOQUEÓ algo. ${ctx ? `Contexto: ${ctx}.` : ""} Revisa qué se intentó hacer y por qué se bloqueó. Reformula la acción para cumplir o escala con add_comment + notify_user al admin.`;
    case "LEAD_OPPORTUNITY":
      return `${base} OPORTUNIDAD DE NEGOCIO detectada. ${ctx ? `Contexto: ${ctx}.` : ""} Investiga al lead (search_knowledge si hay histórico, web_search para info pública). Si parece buena oportunidad, redacta draft_email de acercamiento personalizado. Si no encaja, mark_complete con razón.`;
    case "WORKFLOW_STEP":
      return `${base} PASO DE WORKFLOW automático. ${ctx ? `Contexto: ${ctx}.` : ""} La INSTRUCCIÓN específica de este paso está en la description de la task. Síguela al pie y cierra con mark_complete cuando hayas dejado los drafts/comentarios correspondientes. El cron avanzará al siguiente paso solo cuando toque por fecha.`;
    case "CHURN_RISK":
      return `${base} RIESGO DE CHURN detectado por el cron. ${ctx ? `Contexto: ${ctx}.` : ""} Tu plan: 1) Investiga qué pasó con query_knowledge_graph + get_client_memory (últimos 60 días, comentarios negativos, deadlines fallados). 2) Si confirmas riesgo: considera start_client_workflow('churn_recovery_14d') que arranca secuencia de 4 pasos en 14 días. 3) Notify_user al gestor de cuenta con tu diagnóstico. 4) mark_complete con el plan elegido.`;
    case "SELF_HEALING":
      return `${base} AUTO-DIAGNÓSTICO de Sonia. ${ctx ? `Contexto: ${ctx}.` : ""} El cron detectó patrones de fallos recurrentes — están en la description. Para cada patrón decide: propose_new_tool si falta capacidad, update_workspace_memory con workaround si es prompt, o notify_user al admin si es bug. Cierra con mark_complete.`;
    case "NEGOTIATION":
      return `${base} NEGOCIACIÓN ACTIVA con un lead/cliente. ${ctx ? `Contexto: ${ctx}.` : ""} 1) Lee get_pricing_rules ANTES de proponer precios. 2) Si es contacto nuevo, create_deal. 3) Para responder a una contraoferta del lead, counter_offer y luego draft_email/whatsapp con suggestedReply. 4) Cuando se cierre, close_deal(outcome) + si won, draft_holded_invoice. NUNCA pases bajo minAmountEur sin escalar.`;
    case "LIVE_MEETING_TICK":
      return `${base} ASISTENCIA EN VIVO durante una reunión. ${ctx ? `Contexto: ${ctx}.` : ""} La description tiene la transcripción reciente. NO actúes sobre tools de escritura (drafts, comments) — solo OBSERVA y devuelve sugerencias breves vía add_comment marcado como "[LIVE]". Útil: identificar acción items, datos buscables (clientes mencionados, contratos), tono del cliente.`;
    case "MANUAL":
    default:
      return `${base} Llama a get_task_context para leerla y procede.`;
  }
}

/**
 * Capa de reflexión: tras un mark_complete, se llama a este reviewer
 * que evalúa si la entrega de Sonia cumple lo que el user pidió.
 *
 * Es una segunda invocación al modelo con prompt distinto — no usa
 * tools, solo evalúa el log + summary contra el initial message
 * (que es lo que pidió el user).
 *
 * Devuelve { ok: true } si la entrega está completa, o
 * { ok: false, gap: "qué falta concretamente" } si detecta problema.
 *
 * Filosofía: ser SEVERO con la calidad pero no perfeccionista. El
 * reviewer solo objeta si hay un GAP CLARO — no por preferencias
 * estéticas o detalles menores. La idea es atrapar "olvidé pedir
 * X" o "Sonia entregó sin la pieza Y que el user pidió", no
 * micromanagement.
 */
async function runReviewer(
  client: Anthropic,
  config: AiAgentConfig,
  ctx: { initialContent: string; log: AgentLogStep[]; summary: string }
): Promise<{ ok: boolean; gap?: string }> {
  // Resumen compacto del log para no inflar tokens. Solo los pasos
  // de tool_use + tool_result + text del modelo.
  const logSummary = ctx.log
    .filter((s) => ["tool_use", "tool_result", "text", "info"].includes(s.type))
    .slice(-30)
    .map((s) => {
      if (s.type === "tool_use") {
        const t = s as any;
        return `[tool_use] ${t.tool}(${JSON.stringify(t.input ?? {}).slice(0, 120)})`;
      }
      if (s.type === "tool_result") {
        const r = s as any;
        const out = typeof r.output === "string" ? r.output : JSON.stringify(r.output ?? {});
        return `[tool_result${r.isError ? " ERROR" : ""}] ${out.slice(0, 150)}`;
      }
      if (s.type === "text") return `[text] ${(s as any).text.slice(0, 150)}`;
      if (s.type === "info") return `[info] ${(s as any).text.slice(0, 150)}`;
      return "";
    })
    .filter(Boolean)
    .join("\n");

  const reviewerSystem = `Eres el revisor de calidad de "Sonia" (un agente IA que ejecuta tareas para una agencia de marketing). Te paso:
1. La PETICIÓN ORIGINAL del user (mensaje inicial al agente).
2. El LOG de lo que Sonia hizo (resumen de tools llamadas + resultados + textos).
3. El SUMMARY final que Sonia va a entregar al user vía mark_complete.

Tu trabajo: decidir si la entrega CUMPLE lo que pidió el user.

Sé severo pero pragmático. Objeta SOLO si hay GAP CLARO. Ejemplos válidos de gap:
- El user pidió "descarga leads y haz Excel bonito" pero Sonia descargó leads y NO generó Excel.
- El user pidió 3 cosas y Sonia solo hizo 2.
- El user pidió un entregable (excel, pdf, link) y NO se adjuntó.
- Sonia dijo en el summary "lo hice" pero el log no muestra que llamara a la tool real.

NO objetes por:
- Preferencias estéticas menores (color del Excel, fuente).
- Falta de info que el user no proporcionó.
- Detalles que el user no pidió explícitamente.

Responde EXCLUSIVAMENTE con un JSON sin markdown, en una de estas dos formas:
{"ok": true}
{"ok": false, "gap": "Explicación CORTA de qué falta (1-2 frases, accionable)."}`;

  const userMsg = `PETICIÓN ORIGINAL DEL USER:
"""
${ctx.initialContent.slice(0, 4000)}
"""

LOG DE LA EJECUCIÓN DE SONIA:
"""
${logSummary.slice(0, 6000)}
"""

SUMMARY QUE SONIA VA A ENTREGAR (mark_complete):
"""
${ctx.summary.slice(0, 2000)}
"""

¿La entrega cumple? Responde solo con JSON.`;

  const resp = await client.messages.create({
    model: config.model,
    max_tokens: 400,
    system: reviewerSystem,
    messages: [{ role: "user", content: userMsg }]
  });

  const text = resp.content
    .filter((b) => b.type === "text")
    .map((b: any) => b.text)
    .join("")
    .trim();
  // Parsing tolerante: el modelo a veces escribe ```json ... ``` aunque
  // pidamos sin markdown.
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed.ok === true) return { ok: true };
    if (parsed.ok === false && typeof parsed.gap === "string") {
      return { ok: false, gap: parsed.gap };
    }
  } catch {
    // Si el reviewer no devolvió JSON parseable, lo damos por OK
    // (no bloqueamos por bug del reviewer).
  }
  return { ok: true };
}
