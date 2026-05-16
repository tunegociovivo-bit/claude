/**
 * MEMORIA DEL PROYECTO — referencia única para futuras sesiones.
 *
 * Si abres una sesión nueva con Claude y te dice "no recuerdo lo
 * anterior", apúntale a este archivo. Contiene TODO lo que se ha
 * decidido, construido y dejado pendiente en este proyecto.
 *
 * Cuando termines un sprint significativo, añade una entrada al
 * array `SPRINTS` aquí (no en BD) para que quede en git. Las notas
 * más volátiles (descubrimientos del día, recordatorios) van en
 * la sección editable de /admin/memoria-claude (BD).
 */

export const PROJECT_OVERVIEW = `
Agencia Hub — plataforma multi-tenant para gestionar una agencia
digital (Negocio Vivo). Reemplaza progresivamente a Asana + Drive
+ documentos sueltos. Objetivos:

- Tareas en kanban editable, comentarios rich con adjuntos
- CRM ligero (clientes con prioridad, info, accesos cifrados)
- Calendario editorial + portal público para que el cliente
  apruebe publicaciones sin login
- Documentos tipo Notion (TipTap + bloques + jerarquía)
- Integración Google Calendar bidi, Asana (read-only) para migración
- Búsqueda semántica con embeddings (OpenAI text-embedding-3-small)
- Cmd+K palette global con búsqueda léxica + semántica mezcladas
- Notificaciones push (web-push), email digests, in-app, mentions
- Soft-delete con papelera de 30 días + cron de purga
- Auditoría completa de acciones sensibles (MRR change, deletes,…)

Stack: Next.js 14 App Router + Prisma + PostgreSQL + Cloudflare R2
+ Redis (opcional) + Resend (email) + Anthropic + OpenAI Whisper +
TipTap + Tailwind. Hosting: Railway (rama
claude/internal-project-platform-ZezvX), dominio hub.negociovivo.app.
`.trim();

export const ARCHITECTURE_NOTES = `
## Decisiones de arquitectura importantes

### Multi-tenant
Cada cliente del SaaS es un Workspace. TODOS los modelos llevan
workspaceId y las queries filtran por él. Los handlers usan
withApi({ scope }, fn) en lib/api/handler.ts que valida sesión
o API key, scope, y rate-limit.

### Polymorphic relations sin FK
Comment.targetId apunta a Task | Document | Client | Project según
targetType. NO usar @relation con fields:[targetId] — Prisma genera
FK contra TODOS los modelos y Postgres exige que el id exista en
todas a la vez, lo que rompe inserts. La integridad se mantiene en
código. (Bug histórico arreglado en commit b5268f7.)

### Comments rich
- Schema: body String (legacy, texto plano o JSON stringified) +
  bodyJson Json? (TipTap doc canónico). Las lecturas prefieren
  bodyJson; al primer GET de un comentario legacy se hace lazy
  migration y se rellena bodyJson en background.
- El editor (CommentEditor.tsx) escribe en ambos. Importer de Asana
  también.

### Soft delete
Task, Project, Document, Client tienen deletedAt + deletedById.
Cualquier query de UI filtra por deletedAt:null. El cron
/api/cron/trash-purge purga lo que lleva >30 días. /admin/papelera
permite restaurar o purgar a mano. (commit 0f24c6f)

### Tokens y secrets
Todo lo cifrado pasa por lib/ai/crypto.ts (AES-GCM con NEXTAUTH_SECRET):
- AsanaConnection.accessTokenEnc
- GoogleCalendarConnection.accessTokenEnc / refreshTokenEnc
- Workspace.settings.ai.{anthropicApiKey, openaiApiKey}
- Workspace.settings.integrations.googleDrive.serviceAccountJsonEncrypted
JAMÁS escribir tokens en código fuente; siempre /admin/* o env vars.

### URLs de R2 firmadas caducan a 1h
Las imágenes editoriales generadas con IA persisten la URL firmada
en BD. Cuando el user vuelve >1h después, la imagen está rota.
lib/storage/resign.ts re-firma al vuelo extrayendo el s3Key del
path. Aplicado en endpoints que sirven posts: /api/v1/editorial/
posts/{[id],}, /api/public/approval/[token]. Recomendación
permanente: configurar STORAGE_PUBLIC_URL (custom domain de R2)
para que las imágenes nuevas no firmen nunca.

### Storage binarios nativos
Next.js 14 con app router NO bundlea bien binarios .node de
@napi-rs/canvas, sharp, @resvg/resvg-js. Hay dos sitios donde
declararlo en next.config.js:
  experimental.serverComponentsExternalPackages  → Server Components
  webpack.config.externals (server-side)         → Route Handlers
Si falta cualquiera de los dos, builds rompen con "Module parse
failed: Unexpected character" sobre el .node. (commit 8592ad2.)

### Search semántico sin pgvector
SearchEmbedding guarda los vectores como Json (1536 floats con
text-embedding-3-small, pre-normalizados para que dot product =
cosine). semanticSearch carga TODOS los vectores del workspace en
memoria y calcula. Aceptable hasta ~50k items por workspace; más
allá hay que migrar a pgvector — los vectores ya están en formato
correcto, solo cambia el motor de cálculo.

### Polling de Google Calendar
El cron /api/cron/calendar-sync hace pull incremental cada 15 min
con syncToken de Google. Adicionalmente, /api/integrations/google-
calendar/webhook recibe push notifications en tiempo real (cuando
el watch channel está activo). Los canales caducan a 30 días max;
el cron /api/cron/calendar-watch-renew los renueva cada 24h si
caducan en <48h.

### Idempotencia Asana
Todo lleva asanaId @unique:
- Task.asanaId
- Project.asanaId
- Client.asanaId
- Comment.asanaId (story.gid)
- File.asanaId (attachment.gid)
Si re-ejecutas un import, NADA se duplica: las filas existentes se
actualizan, las nuevas se crean. Stats marcan "skipped" vs "imported".

### Convenciones de UX
- Botón principal: bg-brand-600 hover:bg-brand-700 text-white
- Destructivo: rose-600 bg / border
- Banner ok: bg-emerald-50 border-emerald-200
- Banner warn: bg-amber-50 border-amber-200
- Prioridad ALTA cliente: degradado rose-100→rose-50 + ring rose-300
- Tasks vencidas: tarjeta animate-pulse bg-rose-600 cuando <1h
- Cmd+K: palette global montado en AppChrome
`.trim();

export const GOTCHAS = `
## Gotchas conocidos

1. **Comment con FK polimórfico**: si vuelves a meter @relation
   en Comment.task o Comment.document, los inserts fallarán con
   "Comment_doc_fk (index) violated". No tocar — ver
   ARCHITECTURE_NOTES → "Polymorphic relations sin FK".

2. **Botón "Grabar reunión" requiere tarea persistida**: en
   "Nueva tarea", openMeetingRecorder() guarda la tarea primero
   con un POST y luego abre el grabador. Si falta título o
   proyecto, falla con error inline.

3. **prisma db push NO se ejecuta en deploy**: cada vez que
   añades un campo nuevo al schema, hay que correr db push contra
   la BD productiva manualmente (o vía endpoint admin si es
   urgente — ejemplo: /api/v1/admin/db-fix-comment-fks).

4. **Stripe / facturación**: NO existe todavía. No prometer
   features de billing hasta que esté.

5. **El user pidió NO MODIFICAR NADA EN ASANA** hasta que el
   Hub esté al 100%. Asana es solo lectura. Cualquier intento
   de escritura (cerrar tareas, añadir comentarios) está prohibido.

6. **Los tokens del chat van a git si los pegamos al código**.
   SIEMPRE guardarlos cifrados vía la UI de admin. El user pegó
   un token de Asana real en el chat; el endpoint POST /api/v1/
   admin/asana/import lo cifra automáticamente al primer uso.

7. **Las imágenes generadas con IA caducaban a 1h** (URL firmada
   en BD). Resuelto con lib/storage/resign.ts en lectura. La
   solución definitiva es STORAGE_PUBLIC_URL en env.

8. **Railway sirve la rama claude/internal-project-platform-ZezvX**.
   El dominio hub.negociovivo.app está apuntado a esa rama, NO a
   main. Si quieres que se aplique a "producción real", merge a
   main y cambia la rama del servicio.

9. **El user prueba importaciones de Asana por partes**
   (1 proyecto, ver que va bien, repetir). No lanzar imports
   masivos hasta que él los pida.
`.trim();

/**
 * Sprints completados, en orden cronológico. Cuando termines un
 * sprint, añade una entrada al final. NO borres entradas previas.
 *
 * Formato deliberadamente breve: el detalle está en cada commit;
 * esto es solo el índice navegable.
 */
export const SPRINTS = [
  {
    range: "cf37cb2 → bff78d9",
    title: "Bases del editor rich + comentarios",
    summary:
      "TipTap StarterKit + Image + Link + Placeholder + Mention. " +
      "CommentEditor con drag&drop, paste y subida vía signed URLs. " +
      "CommentRenderer con fallback a texto plano legacy."
  },
  {
    range: "e1747c2 → 72fa2a6",
    title: "Slash commands + menciones en descripciones y docs",
    summary:
      "buildMentionSuggestion reusable (popup sin tippy). " +
      "extension SlashCommands en RichTextEditor con 11 bloques. " +
      "Notificaciones por mención en task description / document."
  },
  {
    range: "63c4670 → 582768a",
    title: "Cmd+K + Mi día + cron daily-digest",
    summary:
      "CommandPalette global con búsqueda léxica. /mi-dia con " +
      "vencidas/hoy/mañana/eventos/notificaciones. /api/cron/" +
      "daily-digest manda email resumen a las 06:30 UTC."
  },
  {
    range: "2ec98dd → 0f24c6f",
    title: "Infra: audit log, rate limit, soft delete, papelera",
    summary:
      "AuditLog model reutilizado. rate-limit en memoria con " +
      "buckets sliding window. Soft delete unificado + " +
      "/admin/papelera + cron purge 30d."
  },
  {
    range: "a87a8a8 → c946202",
    title: "Portal cliente público + reuniones IA + subtareas auto",
    summary:
      "/p/cliente/[token] reutiliza el ClientApprovalLink. " +
      "MeetingRecorder: graba audio → Whisper → Claude resume → " +
      "comentario rich con secciones. action_items → subtareas con " +
      "1 click. Threading bidireccional en posts editoriales."
  },
  {
    range: "503143e",
    title: "PWA + offline básico",
    summary:
      "Service worker con cache de shell, stale-while-revalidate " +
      "API, IndexedDB outbox para mutaciones offline. Banner " +
      "online/offline + botón instalar app."
  },
  {
    range: "726da6d → 1c91906",
    title: "Webhooks salientes + deliverables genéricos",
    summary:
      "dispatchWebhook con HMAC-SHA256, retry exponencial, deliveries. " +
      "Modelo Deliverable + DeliverableDecision: cliente aprueba " +
      "PDFs y archivos sueltos en el portal."
  },
  {
    range: "a372fe2 → eff5b0b",
    title: "Calendario editorial público + responsive + tests E2E",
    summary:
      "MonthGrid en /p/editorial. Kanban/tabla con columnas " +
      "condicionales en mobile. Playwright config + 3 specs " +
      "tolerantes (skip si no hay user)."
  },
  {
    range: "ffff62b → 7ebcf70",
    title: "Google Calendar bidireccional + push notifications",
    summary:
      "OAuth fuera de next-auth (scope calendar). Sync engine pull/" +
      "push con loop detection por timestamp. Cron de 15min + " +
      "webhook receiver. Watch channels renovados cada 24h."
  },
  {
    range: "43f0c5b → 731a650",
    title: "Búsqueda semántica + adjuntos con progreso",
    summary:
      "SearchEmbedding (Json sin pgvector). text-embedding-3-small " +
      "normalizado. Hooks en endpoints. /admin/busqueda con " +
      "cobertura + reindex manual. CommentEditor con XHR progress."
  },
  {
    range: "548cc69 → b5268f7",
    title: "Migración Asana al 100% + fix Comment FK",
    summary:
      "asanaId en Comment/File. Permalink + custom_fields preservados. " +
      "Adjuntos descargados a R2 (externos como link). Followers " +
      "como co-asignados. Multi-proyecto via TaskProject. Cifrado " +
      "lazy de tokens. CRITICAL: quitar @relation polimórficas de " +
      "Comment para que inserts no rompan."
  },
  {
    range: "c611c5f → c3cdc69",
    title: "UX kanban + cliente ALTA + endpoint diagnóstico",
    summary:
      "Doble click rename columna kanban + paleta de 11 colores " +
      "(con tonos intensos). Cliente prioridad ALTA con degradado " +
      "rose intenso. /api/v1/admin/db-fix-comment-fks que tira los " +
      "FK rotos sin necesidad de db push."
  },
  {
    range: "f5fa532 → 6e15df4",
    title: "Asana select-all + token persistido + seed E2E + comentarios semánticos",
    summary:
      "Botones seleccionar/deseleccionar todos los proyectos Asana. " +
      "GET /admin/asana/connection. UI con banner 'token guardado'. " +
      "scripts/seed-e2e.ts reproducible. /admin/reindex incluye " +
      "COMMENT. Comentarios indexados al crearse."
  },
  {
    range: "4e44c97 → 8592ad2",
    title: "Multi-proyecto Asana + followers + fix build webpack",
    summary:
      "Tasks en N proyectos via TaskProject. Followers → " +
      "TaskAssignee. Adjuntos externos con badge UI. Test E2E de " +
      "comentar. CRITICAL: next.config.js webpack.externals con " +
      "@napi-rs/canvas/sharp/resvg porque " +
      "serverComponentsExternalPackages no cubre Route Handlers."
  }
] as const;

export const PENDIENTES = `
## Pendientes conocidos al cierre del último sprint

- E2E: subir adjunto a tarea, aprobar post desde /p/editorial
- Notificar al CLIENTE por email cuando el equipo responde en el
  hilo del portal de aprobación (hoy solo se notifica al equipo
  cuando el cliente comenta).
- Vacaciones / cumpleaños de miembros si vienen como custom fields
  de Asana (no se trabaja todavía).
- UI editorial: cuando un attachment de un post es externo
  (gdrive/dropbox), debería mostrar el badge "externo" como en
  AttachmentList.
- Si pgvector está disponible en la BD productiva, considerar
  migrar SearchEmbedding a vector(1536) — el resign de vectores
  ya está en formato correcto.
- Test de carga de la búsqueda semántica con >10k items por
  workspace (hoy es teoría, no se ha medido en producción).

## Cosas que DEJAR como están (no son bugs)

- Comment NO debe tener @relation polimórfica.
- Las URLs firmadas de R2 caducan a 1h: lo gestiona resign.ts;
  no migrar a guardar s3Key dedicado hasta que sea necesario.
- El user pidió NO MODIFICAR NADA EN ASANA. Es solo lectura.
- Tokens NO van al repo. Solo cifrados en BD vía /admin/*.
- El dominio sirve la rama claude/internal-project-platform-ZezvX,
  no main. Cualquier merge a main debe ser deliberado.
`.trim();

export type Sprint = (typeof SPRINTS)[number];
