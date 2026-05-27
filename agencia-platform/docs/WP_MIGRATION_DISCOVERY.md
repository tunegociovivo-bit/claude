# Discovery: migración de plugins WordPress → Plataforma Next.js

Auditoría inicial de los 4 plugins de `hub.negociovivo.com` que se planea migrar
a la plataforma Agencia Hub.

---

## 1. Generador de Reseñas IA PRO (v3.0)

**Funcionalidad** — Generador automático de reseñas con OpenAI. Shortcode
`[cuadro_ia_dinamico cliente_id="slug"]` que crea reseñas sintéticas y redirige
al cliente a Trustpilot/Google para publicar.

**Modelo de datos** — Sin tablas custom. Todo en `wp_options`:
- `resenas_ia_api_key` — OpenAI API key
- `resenas_ia_clientes` — array serializado de clientes
- `hist_ia_{slug}` — últimas 5 reseñas por cliente

**Integraciones** — OpenAI (gpt-4o-mini / gpt-4o / gpt-4-turbo)

**Tamaño** — 1 PHP, ~360 líneas. **Complejidad: trivial.**

**Plan de migración** — Módulo dentro de `/admin/reviews-generator`:
- Tabla `ReviewClient` (workspaceId, slug, name, web, target_url, themes, banned_words, etc.)
- Tabla `ReviewHistory` (workspaceId, clientSlug, body, createdAt)
- Endpoint `POST /api/v1/reviews/generate` (proxy OpenAI, reusa cifrado de API key del workspace)
- Página pública embebible o widget JS

---

## 2. NV Dashboard (v1.0.77)

**Funcionalidad** — Dashboard editorial unificado para gestionar calendario
de publicaciones multi-cliente. Genera contenido con Claude/OpenAI, exporta
a Metricool, gestiona revisiones, PWA con manifest dinámico.

**Modelo de datos**
- CPT: `nv_publicacion`
- Taxonomía: `nv_cliente`
- ACF fields (campos por publicación: redes, URLs, formatos)
- Options:
  - `nv_dashboard_webhook_secret`
  - `nv_dashboard_api_token` (Bearer nvtok_*)
  - `nv_dashboard_anthropic_api_key`, `nv_dashboard_openai_api_key`
  - `nv_dashboard_metricool_brand_name`
  - `nv_dashboard_refs_drive_folders` (JSON Drive folder IDs)
  - `nv_dashboard_avatares_urls`

**Endpoints REST** — Namespace `nv/v1`, 20+ rutas:
`/publicaciones`, `/aprobar-mes`, `/marcar-programado`, `/generar-mes-ai`,
`/test-anthropic`, `/crear-publicacion`, `/registrar-revision/:id`,
`/historial-revisiones/:id`, `/actualizar-publicacion/:id`,
`/reprogramar/:id`, `/duplicar-mes`, `/stats-granulares`,
`/media-duplicados`, `/borrar-adjunto/:id`, `/regenerar-secret`,
`/subir-imagen-post/:id`, `/publicaciones-sin-asset`,
`/cliente-config/:slug`, `/pwa/manifest`.

**Admin pages** — Vista General, Editorial, Clientes, Configuración,
Diagnóstico, Status.

**Integraciones**
- Anthropic Claude (claude-sonnet-4-5 default)
- OpenAI (imágenes gpt-image-2 + fallback texto)
- Metricool (export)
- Google Drive (folder refs por cliente)
- Google Sign-In (redirect post-login)

**Frontend** — Shortcode `[nv_publicaciones]`, rewrite `/nv-dashboard` con
class `NV_Public_Dashboard`, PWA manifest.

**Tamaño** — 20 PHP, ~14.000 líneas. **Complejidad: muy alta.**

**Plan de migración** — Módulo grande `/admin/editorial`:
- Tabla `EditorialPost` (workspaceId, clientId, scheduledFor, content, networks Json, format, status, revisions Json, mediaUrls, asanaId)
- Endpoints REST equivalentes bajo `/api/v1/editorial/*`
- Reusar el wrapper Anthropic ya existente (`lib/ai/anthropic.ts`)
- Integración Metricool (nuevo wrapper `lib/integrations/metricool.ts`)
- Integración Drive (nuevo, OAuth2 server-side)
- Versionado de revisiones en tabla separada `EditorialRevision`
- PWA: añadir `app/manifest.ts` y service worker
- **Riesgo:** dependencia profunda de ACF — hay que mapear cada campo ACF a columna o JSON.

---

## 3. NV Leads Pro (v1.3.2)

**Funcionalidad** — Captación masiva de leads desde Google My Business.
Búsquedas por keyword+localidad, BD propia, scoring de leads, detección
de competidores, openers de WhatsApp con IA, secuencias automáticas vía
Evolution API (WAHA).

**Modelo de datos** — 11 tablas custom:
- `nvl_searches` (keyword, location, status, provincia, total)
- `nvl_leads` (place_id, nombre, rating, reviews_json, score, urgency, ai_opener, whatsapp_checked, contact_status)
- `nvl_competitors` (lead_id, position, rating)
- `nvl_messages` (variaciones de templates)
- `nvl_templates` (plantillas genéricas)
- `nvl_sequences`, `nvl_sequence_steps`, `nvl_lead_sequences`
- `nvl_inbox` (mensajes entrantes WhatsApp)
- `nvl_exclusions`, `nvl_optouts`

**Options** — `nvl_google_api_key`, `nvl_evolution_api_url`, `nvl_evolution_api_key`

**Endpoints / cron**
- REST: `nvl/v1/webhook/{token}` (Evolution callbacks)
- AJAX: `nvl_render_preview`
- **Cron `nvl_process_pending_searches` cada 2 min**
- **Cron `nvl_process_send_queue` cada 1 min**

**Integraciones** — Google Places, Evolution API/WAHA, IA propia (openers)

**Tamaño** — 37 PHP, ~5.800 líneas. **Complejidad: muy alta.**

**Plan de migración** — Módulo grande `/admin/leads`:
- 11 tablas Prisma (lead, search, competitor, sequence, etc.) — schema migration
- Replicar `LeadScorer` y `DataQuality` (lógica caja negra, auditar al migrar)
- Sustituir cron WP por **Trigger.dev / Inngest / Bull queue** en Railway
  (alternativa: cron job de GitHub Actions cada minuto disparando endpoint protegido)
- Webhook nuevo `/api/v1/leads/webhook/[token]` — reconfigurar en WAHA
- `lib/integrations/google-places.ts` con manejo de paginación por provincia
- `lib/integrations/evolution.ts` con retry policy
- **Riesgo alto:** estado distribuido (inbox + secuencias + optouts) — transacciones críticas.

---

## 4. Voice Reviews (v1.0.0)

**Funcionalidad** — Reseñas guiadas por voz. Cliente graba 20-30s con Web
Audio API, Whisper transcribe, Claude/OpenAI redacta borrador editable,
copia al portapapeles y redirige a Google/Trustpilot.

**Modelo de datos**
- CPT: `voice_review_business` (post type)
- Meta campos: `vr_name`, `vr_intro_text`, `vr_disclaimer`, `vr_google_url`, `vr_trustpilot_url`, `vr_max_seconds`, `vr_short_url`
- Options: `vr_settings` (config global)

**Endpoints REST** — `voice-reviews/v1`:
- `POST /transcribe` — WAV → Whisper
- `POST /draft` — transcript → Claude (default) / OpenAI (fallback)
- Rate limit 8 req/min por IP

**Integraciones** — OpenAI Whisper, Claude, OpenAI Chat, Bitly (short URLs)

**Frontend** — Shortcode `[voice_review id="N"]`, templates `frontend.php` + `standalone.php`, JS de grabación con Web Audio API.

**Tamaño** — 11 PHP, ~1.650 líneas. **Complejidad: media.**

**Plan de migración** — Módulo `/admin/voice-reviews`:
- Tabla `VoiceBusiness` (workspaceId, name, slug, intro_text, disclaimer, google_url, trustpilot_url, max_seconds, short_url)
- Página pública en `/r/[slug]` con la UI de grabación
- Endpoints `/api/v1/voice/transcribe` (multipart audio → Whisper) y `/api/v1/voice/draft` (transcript → Claude/OpenAI)
- Rate limit con Redis (Upstash gratuito) o memoria si volumen bajo
- Bitly opcional, o usar el dominio propio + slug corto

---

## Resumen estratégico

| Plugin | Esfuerzo | Prioridad sugerida | Bloqueantes |
|---|---|---|---|
| Generador Reseñas | 2-3 días | Alta (fácil win) | API key OpenAI |
| Voice Reviews | 1 semana | Media | API keys + Web Audio testing |
| NV Dashboard | 3-4 semanas | Alta (es el corazón) | Mapeo ACF + Metricool API + Drive OAuth |
| NV Leads Pro | 4-6 semanas | Media | Cron infra + Google Places + WAHA |

**Recomendación de orden de migración**:
1. **Generador Reseñas** (sprint corto, asienta el patrón de "módulo por plugin")
2. **Voice Reviews** (frontend público + audio, hay que probar Web Audio en Railway)
3. **NV Dashboard** (la migración estrella — el flujo editorial multi-cliente)
4. **NV Leads Pro** (el más complejo por cron + estado distribuido — al final)

Cada migración tendrá su propio PR con:
- Schema migration de Prisma
- Endpoints REST equivalentes
- UI admin
- Script de importación de datos históricos (lectura desde WP REST API + WP-CLI export)
- Documentación de configuración (API keys + secrets)
- Pruebas de integración con sandbox de cada servicio externo
