# Inventario NV Leads Pro (versión 1.x)

Mapa exhaustivo del plugin WordPress original `nv-leads-pro/`. Sirve como
referencia para la migración al hub.

## 1. Schema (tablas wp_)

| Tabla | Columnas clave |
|---|---|
| `nvl_searches` | id, keyword, location, scope (custom/spain), status, total_provinces, processed_provinces, current_province, total_results, error_message, created_by, timestamps |
| `nvl_leads` | id, search_id, place_id (UNIQUE), name, formatted_address, province, phone, international_phone, website, rating, reviews_count, reviews_json, positive_pct, negative_pct, neutral_pct, price_level, category, types, lat/lng, position, gmb_url, business_status, raw_data, **score**, **score_breakdown**, **urgency**, **ai_opener**, ai_opener_generated_at, **has_whatsapp**, whatsapp_checked_at, **contact_status**, notes, timestamps |
| `nvl_competitors` | id, lead_id, competitor_place_id, name, position, rating, reviews_count |
| `nvl_messages` | id, lead_id, template_id, rendered_message, channel, instance_name, phone_normalized, status, scheduled_at, sent_at, send_attempts, last_error, external_message_id, priority, created_at |
| `nvl_templates` | id, name, body, is_default, timestamps |
| `nvl_sequences` | id, name, description, is_active, is_default, created_at |
| `nvl_sequence_steps` | id, sequence_id, step_order, delay_days, template_body, channel, stop_if_responded |
| `nvl_lead_sequences` | id, lead_id, sequence_id (UNIQUE), current_step_index, status (active/paused/completed/stopped), enrolled_at, completed_at, stopped_reason |
| `nvl_inbox` | id, lead_id, phone_normalized, channel, direction (in/out), message_text, external_message_id, instance_name, **classification**, **classification_confidence**, **classification_reason**, is_read, received_at |
| `nvl_exclusions` | id, match_type (name), match_value, match_mode (contains/exact), reason, created_at |
| `nvl_optouts` | id, phone_normalized (UNIQUE), lead_id, reason, source (manual/ai_classification), created_at |

## 2. Captación (Google Places API New)

- Endpoint: `places.googleapis.com/v1/places:searchText`
- Query: `{keyword} en {location}`, `regionCode=ES`, `languageCode=es`
- `locationBias`: circle(lat,lng,50km) si provincia tiene coords
- Hasta 3 páginas (60 resultados máx)
- Place Details opcional para reviews + horarios
- 52 provincias + Ceuta + Melilla (con capital + lat/lng + CCAA)
- Scope: `custom` (1 provincia) o `spain` (todas)
- Loop por batches (`batch_size`, default 5)
- Dedup: UNIQUE(search_id, place_id)
- Validación keyword opcional con IA (descarta si name+category no encaja)

## 3. Lead scorer (reglas + heurística, NO IA)

Devuelve `{ score: 0-100, urgency: critica|alta|media|baja|descartar, breakdown }`.

Señales:
- Negocio cerrado → score=0, descartar
- Posición ranking (0-25, punto dulce 4-15)
- Rating INVERTIDO (rating bajo = score alto, 0-20)
- % reseñas negativas (0-15)
- Recuento reseñas (0-15, dormidas suben)
- Competencia (0-15, gap claro sube)
- Sin web (0-5)
- Presencia online recient (0-10)

Urgencia: 70+ crítica · 50-69 alta · 30-49 media · 10-29 baja · <10 descartar.

## 4. Plantillas + variaciones anti-fingerprint

Placeholders (20+):
`{{nombre_negocio}}` `{{direccion}}` `{{provincia}}` `{{telefono}}` `{{web}}`
`{{rating}}` `{{rating_estrellas}}` `{{resenas}}` `{{pct_positivas}}`
`{{pct_negativas}}` `{{posicion}}` `{{keyword}}` `{{competidor_top}}` (1-3)
`{{competidores_lista}}` `{{score}}` `{{urgencia}}` `{{opener_ia}}`

Variaciones (anti-spam-detect WhatsApp):
- Saludo rotado: Hola / Buenas / Buenos días / Qué tal
- Sinonimia léxica (~15 patrones)
- Puntuación variable
- Saltos de párrafo aleatorios
- Emoji esporádico (1 de 6: 🙌👋✨📍👀🙂)

## 5. Secuencias drip

- Secuencia tiene N steps (step_order, delay_days, template_body, stop_if_responded)
- Default 4 pasos: 0d, +3d, +5d, +7d
- Enroll: crea registro lead_sequences + encola paso 0
- Cron procesa: si paso enviado OK → encola siguiente con scheduled_at = now + delay_days
- Para si: respuesta clasificada como ≠ off_topic, opt_out, manual, max-intentos (3)

## 6. Send queue + rate limit

- Cron cada minuto procesa 1 mensaje queued
- scheduled_at respeta:
  - Delay mínimo/máximo entre envíos
  - Ventana horaria (default 09:00-20:00)
  - No weekends (configurable)
  - Daily limit (default 80/día)
- 3 reintentos antes de pausar

## 7. WhatsApp (WAHA HTTP API)

- Base URL configurable
- Header: `X-Api-Key`
- Endpoints: `POST /api/sendText`, `GET /api/sessions/{name}`,
  `POST /api/sessions/start`, `GET /api/{session}/auth/qr?format=image`,
  validación de números
- Webhook entrante: `POST /wp-json/nvl/v1/webhook/{token}`
  - Payload WAHA: `{event, session, payload:{from, body, fromMe}}`
- Estados: queued / sending / sent / delivered / read / failed
- Por ahora 1 instancia por workspace

## 8. Inbox + clasificación IA

Clases válidas: `interested | objection | info_request | opt_out | off_topic | positive_no | auto_reply`.

Modelo: claude-haiku-4-5-20251001 por defecto.

Acciones automáticas:
- `interested|objection|info_request` → lead `contact_status=responded` + para secuencia
- `opt_out` → añade a optouts + para secuencia

Heurística fallback (sin IA): STOP/BAJA → opt_out, etc.

## 9. Exclusiones + opt-outs

- `nvl_exclusions`: patrones de nombre (contains/exact). Si match al crear lead → `contact_status=excluded`.
- `nvl_optouts`: teléfonos a no contactar. Disparada por IA o manual.

## 10. Analytics

- Funnel: total / with_phone / with_wa / contacted / responded / client / discarded
- Score distribution: 80-100, 60-79, 40-59, 20-39, 0-19
- Urgency breakdown
- Messages last 30 days (timeline)
- Responses last 30 days (timeline)
- Top provincias

## 11. Data quality

- WhatsApp batch check (válida en WAHA, marca has_whatsapp 0/1)
- Find duplicate groups (GROUP BY place_id)
- Rescore batch

## 12. CSV exporter

Columnas: ID, Nombre, Provincia, Dirección, Teléfono, Web, Rating, Reseñas,
% positivas, % negativas, Posición, Score, Urgencia, Estado, GMB URL,
Place ID, Categoría, Competidor 1-3.

## 13. Cron

- `nvl_process_pending_searches`: cada 2 min, procesa batch de provincias
- `nvl_process_send_queue`: cada 1 min, envía 1 mensaje
- Locks transient para evitar race

## 14. Panel admin (12 pantallas)

Dashboard / Analytics / Nueva búsqueda / Búsquedas / Cola de envío /
Bandeja / Secuencias / Exclusiones / Plantillas / Ajustes /
Detalle búsqueda / Detalle lead.

## 15. Settings (wp_options['nvl_settings'])

- Google: `google_api_key`, `batch_size` (5), `results_per_query` (60),
  `fetch_details` (on), `competitor_count` (3), `validate_keyword_match` (on)
- WAHA: `evolution_api_url`, `evolution_api_key`, `evolution_instance`,
  `whatsapp_country_code` (34), `validate_wa_before_send` (on)
- Envío: `send_enabled` (on), `send_delay_min` (60), `send_delay_max` (180),
  `send_window_start` (09:00), `send_window_end` (20:00),
  `send_on_weekends` (off), `daily_limit` (80), `enable_variations` (on),
  `send_paused` (off)
- IA: `ai_provider`, `ai_api_key`, `ai_model_opener`, `ai_model_classifier`,
  `ai_enabled_opener` (on), `ai_enabled_classify` (on)
- Otros: `language` (es), `region` (es), `webhook_token` (auto)
