# Project Log — Agencia Hub (negociovivo)

> Bitácora resumida de todo lo que se ha construido en este proyecto.
> Este archivo se actualiza con cada PR/commit relevante para que las próximas
> sesiones de trabajo tengan el contexto completo del estado actual de la
> plataforma.
>
> Última actualización generada manualmente: 2026-05-15.

## Resumen del proyecto

Plataforma interna estilo Notion + Asana + Agencia para **Negocio Vivo**.
URL en producción: https://hub.negociovivo.app (Cloudflare → Railway).
Stack: Next.js 14 (App Router) + Prisma 5 + Postgres (Railway) + Tailwind + TipTap + dnd-kit + NextAuth.
Cloudflare R2 para archivos. Web Push para móvil. GitHub Actions para crons.

Es el corazón operativo de la agencia: tareas, clientes, proyectos, documentos,
calendario, asistente IA (Claude), redactor, reseñas IA, voice reviews, y
módulos pendientes (NV Dashboard editorial, NV Leads Pro) heredados del
hub.negociovivo.com legacy en WordPress.

## Cronología de hitos (más reciente arriba)

### Personalización + AI cost tracking + backups + log
- `/admin/workspace`: cambio de nombre y logo de la plataforma.
- Foto de perfil por usuario (subida vía R2 o URL manual). Self-service en `/perfil`.
- `/admin/ia-usage`: panel con totales y desglose por proyecto, trabajador,
  feature y modelo en buckets diario/semanal/mensual/anual.
- `lib/ai/usage.ts` instrumentando todos los call sites de Anthropic y OpenAI.
- `/admin/seguridad`: backups manuales + histórico + descarga.
- Cron diario `.github/workflows/backup-daily.yml`.
- Este archivo de log.

### Columnas custom + bulk + subtareas completas + delete proyecto + WP imports keys
- Task.status enum→String para soportar columnas custom.
- `/admin/columnas`: añadir, reordenar, renombrar columnas del Kanban.
- Modo "Seleccionar" en /tareas con BulkActionBar: delete, move_status,
  move_project, assign (replace o add).
- Subtareas son ahora tareas completas: click abre la subtarea con su propio
  panel (descripción, adjuntos, comentarios, asignados). Pila de navegación
  con breadcrumb "Volver a [padre]".
- Borrar proyecto con doble confirmación (modal en dos pasos + escribir
  nombre exacto + ?confirm=<id> en backend).
- Bug fix: `/inicio` Equipo ahora solo muestra trabajadores del workspace
  actual (antes findMany global).
- Bug fix: Voice Reviews banner ahora consulta `/admin/ai-settings` y solo
  muestra warning si las keys realmente faltan.

### WP importer (auto) + Plataformas sidebar
- Plugin WP `agencia-exporter.php` que el admin sube una vez.
- `/admin/wp-import`: trae API keys (Anthropic, OpenAI, Google Places,
  Evolution, Metricool, Drive refs) + clientes Reseñas IA + Voice Reviews
  businesses. NV Dashboard publicaciones y NV Leads tablas se aparcan en
  `workspace.settings.pendingImport` hasta migrar el schema completo.
- Per-section try/catch + tope 2 MB para no romper Postgres JSON column.
- `/admin/plataformas`: catálogo de plugins migrados con toggle de visibilidad
  por workspace y selección de qué trabajadores pueden usar cada uno.
- Sidebar muestra sección "Plataformas" debajo de "Proyectos".

### Voice Reviews (segundo plugin WP migrado)
- Schema VoiceBusiness + endpoints `/voice/transcribe` (Whisper) y `/voice/draft`.
- `/admin/voice-reviews` UI y widget público en `/v/[slug]` con MediaRecorder.
- Public widget: grabación con countdown, transcripción, borrador editable,
  copy → Google Business / Trustpilot.

### Reseñas IA (primer plugin WP migrado)
- Schema ReviewClient + ReviewHistory + helper OpenAI (`lib/ai/openai.ts`).
- `/admin/reviews` para gestionar clientes y guardar OpenAI API key cifrada
  con AES-256-GCM en workspace.settings.ai.
- Widget público `/r/[slug]` embebible vía iframe.

### Push notifications + comentarios + adjuntos + subtareas
- Schema PushSubscription + Notification.
- VAPID + service worker en /public/sw.js. Push se dispara en @mentions y
  en recordatorios pre-deadline (cron diario via GitHub Actions).
- Comentarios con `@email` y autocompletar en MentionTextarea.
- Subtareas inline + adjuntos vía R2 con upload directo presigned.

### Permisos por proyecto + drag & drop
- ProjectMember table.
- API filtra projects y tasks por membresía (admins ven todo).
- `/admin/proyectos` con modal de acceso (toggle público/privado por
  presencia de miembros).
- Drag & drop con @dnd-kit: tareas entre columnas, dentro de columna y
  reorden de columnas.

### Cimiento + módulos iniciales
- 25 modelos Prisma, NextAuth (credenciales + Google), API REST v1, MCP server.
- Tareas (Kanban + lista), Clientes (CRM), Documentos (TipTap), Calendario,
  Databases custom estilo Notion, Asistente IA con tool use.

## Variables de entorno necesarias

| Variable | Para qué | Estado típico |
|---|---|---|
| `DATABASE_URL` | Postgres | Railway lo provee |
| `NEXTAUTH_SECRET` | Sesiones + cifrado AES | Configurado |
| `NEXTAUTH_URL` | URL canónica | https://hub.negociovivo.app |
| `ANTHROPIC_API_KEY` | Fallback (preferir setting workspace) | Opcional |
| `OPENAI_API_KEY` | Fallback | Opcional |
| `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_BUCKET`, `STORAGE_PUBLIC_URL` | R2 para archivos + backups | Pendiente activar |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_CONTACT_EMAIL` | Push al móvil | Pendiente activar |
| `INTERNAL_CRON_TOKEN` | GitHub Actions → endpoints internos | Pendiente |
| `HUB_BASE_URL` (en GitHub Secrets) | URL para cron | Pendiente |

## Pendientes en backlog

- Migrar NV Dashboard editorial (3-4 semanas; ACF + Metricool + Drive OAuth).
- Migrar NV Leads Pro (4-6 semanas; 11 tablas + Google Places + WAHA cron).
- Web Push: integrar también para "asignación de tarea" y "cambio de estado".
- Editor por bloques estilo Elementor (extensiones TipTap custom).
- Multi-proyecto por tarea (schema breaking).
- Backup a Google Drive (OAuth) y al VPS (SCP cuando se roten credenciales).
- SMS / WhatsApp notificaciones usando la Evolution API + teléfono del usuario.

## Decisiones importantes

- **Status enum → String**: para soportar columnas custom sin migración
  destructiva. Los IDs por defecto siguen siendo `TODO`, `IN_PROGRESS`,
  `REVIEW`, `DONE`, `CANCELLED`.
- **Bootstrap via `prisma db push --accept-data-loss`**: no mantenemos
  migraciones formales; las evoluciones de schema son aditivas. Se ejecuta
  en Pre-deploy Command de Railway: `npm run db:bootstrap`.
- **API keys cifradas en `workspace.settings`** con AES-256-GCM derivado
  de NEXTAUTH_SECRET. No vuelven al cliente en claro nunca.
- **Push notifications via Web Push, NO SMS** — el teléfono se guarda para
  futuras notificaciones SMS/WhatsApp cuando se integre.

## Cómo retomar trabajo en este proyecto

1. Lee primero `docs/WP_MIGRATION_DISCOVERY.md` para entender qué plugins
   quedan pendientes de migrar.
2. Revisa la rama activa `claude/internal-project-platform-ZezvX` y su
   PR (#1) en `tunegociovivo-bit/claude`.
3. Estado de producción: `git pull` + `npm install` + lee este log + revisa
   PROJECT_LOG.md.
4. Si vas a cambiar el schema: hazlo aditivo. Pre-deploy aplicará `db push`
   automáticamente.
5. Tras cualquier mejora importante, **actualiza este archivo** con el
   resumen del commit en la sección "Cronología".
