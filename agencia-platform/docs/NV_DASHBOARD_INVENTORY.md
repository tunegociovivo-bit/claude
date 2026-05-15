# Inventario NV Dashboard 1.0.77

Mapa exhaustivo del plugin WordPress original. Sirve como referencia para la
migración al hub (Next.js). El código fuente está en
`scripts/wp-plugins/nv-dashboard/`.

## 1. Modelo de datos por publicación (ACF)

| Campo | Tipo | Default |
|---|---|---|
| `nv_fecha_publicacion` | datetime | requerido |
| `nv_tipo` | select | `imagen` (reel/imagen/carrusel/story) |
| `nv_redes` | checkbox | `["instagram","facebook"]` (+ linkedin, tiktok, twitter, youtube, pinterest) |
| `nv_estado` | select | `borrador` (borrador/revision/aprobado/programado/publicado) |
| `nv_copy` | textarea | requerido |
| `nv_hashtags` | text | "" |
| `nv_first_comment` | textarea | "" |
| `nv_asset_url` | url | requerido (Drive) |
| `nv_assets_extras` | repeater (0-9) | [] |
| `nv_aprobar_metricool` | bool | false |
| `nv_metricool_id` | text | auto |
| `nv_csv_url` | url | auto |

## 2. Modelo de datos por cliente (Cliente Meta)

### 2.1 Drive
- `nv_drive_mode` ("configured"/"pending"/"no_drive_refs")
- `nv_drive_root_id` (carpeta raíz)
- `nv_drive_subfolders` (JSON `[{name,id,type}]`)

Tipos subcarpeta: persona_destacada, equipo, pacientes_usuarios, instalaciones,
productos, logo_brand, otros.

### 2.2 Brief & Branding
- `nv_brand_brief` (textarea)
- `nv_logo_attachment_id` (PNG)
- `nv_logo_position` ("br"/"bl"/"tr"/"tl", default "br")
- `nv_font_attachments` (JSON `[{id,weight,path}]`)
- `nv_cliente_website` (URL)

### 2.3 Colores
- `nv_brand_color_primary` (#1F2937)
- `nv_brand_color_accent` (#2563EB)
- `nv_brand_color_text` (#FFFFFF)

Resolución: meta explícita → extracción de `nv_style_guide_cached` → paleta
neutra default.

### 2.4 Refs visuales
- `nv_reference_images` (JSON `[{id,type,person_name}]`)
- `nv_style_guide_cached` (texto en inglés generado por Claude vision)
- `nv_style_guide_hash` (MD5 para invalidar caché)

### 2.5 Patrón visual
- `nv_visual_pattern` ("clean"/"frame", default "clean")
- `nv_refs_fidelity` (0-100, default 50)

### 2.6 Competencia
- `nv_competidores` (textarea: URL/nombre por línea)

### 2.7 Dimensiones por formato (JSON)
Presets: ig_feed_4_5 (1080×1350), ig_square_1_1 (1080×1080), ig_reel_9_16
(1080×1920), ig_landscape_16_9 (1920×1080), ig_story_9_16 (1080×1920),
tiktok_9_16, yt_16_9, yt_short_9_16, pinterest_2_3, linkedin_1_91_1,
fb_link_1_91_1, twitter_16_9, custom.

Defaults: imagen 1080×1350, reel 1080×1920, carrusel 1080×1080, story
1080×1920, video 1920×1080.

## 3. Endpoints REST (`/wp-json/nv/v1/…`)

Lectura/escritura básica:
- `GET /publicaciones` (filtros cliente/mes/estado)
- `POST /actualizar-publicacion/{id}`
- `POST /crear-publicacion`
- `DELETE /publicacion/{id}`
- `POST /reprogramar/{id}` (drag&drop)
- `POST /duplicar-mes`
- `POST /aprobar-mes` (genera CSV + dispara webhook Make)
- `GET /publicaciones-sin-asset`
- `GET /publicaciones-multi-cliente` (mismo copy adaptado en N clientes)

Cliente:
- `GET /cliente-config/{slug}`
- `POST /analizar-web-cliente`
- `POST /actualizar-guia-estilo/{term_id}`
- `POST /analizar-competencia/{id}`

IA / imágenes:
- `POST /generar-mes-ai` (cantidad, brief, mix, calidad, fidelity, refs_types, copy_length, img_opts)
- `POST /generar-imagen-publicacion/{id}` (gpt-image-2 / Freepik / Seedream)
- `POST /reaplicar-overlay/{id}` (re-aplica logo+headlines sin re-generar)
- `POST /adaptar-formato/{id}` (regenera en otro ratio)
- `POST /subir-imagen-post/{id}`
- `POST /openai-image-proxy/{id}` (Bearer token)

Diagnóstico:
- `GET /diagnostico`
- `GET /diagnostico-publicaciones-huerfanas`
- `POST /reparar-publicaciones-huerfanas`
- `GET /media-duplicados`
- `POST /test-imagen-publicacion/{id}`
- `GET /diag-refs/{slug}`
- `GET /reel-prereq-check`
- `POST /reparar-headline-unicode`
- `GET /stats-granulares`
- `GET /health` (público)

Auth/secret:
- `POST /regenerar-secret`
- `GET /api-token`, `POST /rotar-api-token`

Webhook Make → WP:
- `POST /marcar-programado` (X-NV-Secret)

WP-config (peligroso):
- `GET /wp-config-analyze`
- `POST /wp-config-fix`

## 4. Calendario editorial (admin)

Vistas: calendario mensual FullCalendar 6.1.10, lista.

Filtros: por cliente (dropdown), por mes (nav), estado visual (○/●/▶), tipos
(reel/imagen/carrusel/story como chips coloreados).

Acciones por publicación:
- Editar (modal)
- Aprobar/desaprobar (toggle `nv_aprobar_metricool`)
- Re-aplicar texto (overlay sobre imagen existente)
- Adaptar formato (regenerar en otro tipo/ratio)
- Generar imagen
- Drag&drop reprogramar
- Drag a papelera (borrar)

Acciones de mes (cliente seleccionado):
- Generar mes con Claude (cantidad, brief, mix, redes, quality, fidelity,
  refs_types, copy_length 0-100, overlay opts, análisis competencia)
- Duplicar mes
- Aprobar mes y generar CSV
- Generar imágenes con Claude (modal con prompt copyable a claude.ai)

Multi-cliente: crear misma pub en N clientes con copy adaptado.

Diagnóstico huérfanas: lista de pubs sin fecha (publish status) con botones
"Convertir a borrador" / "Borrar".

## 5. IA (Claude Widget en edit publicación)

Metabox lateral con acciones rápidas: ✍️ Mejorar copy, 😊 Casual, 💼 Corporate,
📏 Acortar mitad, #️⃣ +10 hashtags, 🔀 3 variantes.

Workflow: selector tipo (imagen/video/copy/hashtags/estrategia/otro), textarea
"orden", previsualizar, abrir en claude.ai con contexto completo URL-encoded.

Historial revisiones en postmeta `_nv_revisiones_historial`.

Sub-widget: Adaptar a otro formato (select tipo+quality+regenerar).

## 6. Vista pública para cliente

URL: `/nv-dashboard/?vista=editorial|overview&cliente={slug}`. Sin login =
read-only. Con edit_posts = interactivo. Topbar fija, selector cliente,
embebible en iframe (X-Frame-Options removido). Shortcode
`[nv_dashboard cliente="x" vista="editorial" mes="2026-05" height="1200"]`.

## 7. CSV Metricool

Path: `/uploads/nv-dashboard/metricool-{cliente}-{mes}.csv`. BOM UTF-8.
Columnas: Text, Date, Time, Facebook, Twitter, Instagram, LinkedIn,
GoogleMyBusiness, TikTok, YouTube, Pinterest, Bluesky, Picture Url 1-10,
First Comment Text, Brand Name, Auto Publish.

Text = copy + "\n\n" + hashtags. Auto Publish = TRUE.

## 8. Webhook Make

Trigger: POST `/aprobar-mes`. Payload:
`{cliente, mes, csv_url, count, approved, timestamp}`.

## 9. PWA (v1.0.77)

Manifest dinámico en `/wp-json/nv/v1/pwa-manifest.json`. Iconos en
`assets/pwa/`. Add-to-home-screen, modo standalone. NO service worker.

## 10. Login redirect (v1.0.76)

Tras login, redirige a URL configurada (solo edit_posts). Respeta
`redirect_to` query. Hook `login_redirect` prio 100. `wp_safe_redirect()`.

## Extras

- **API Token** `nvtok_…48ch` (option `nv_dashboard_api_token`).
- **Webhook Secret** 40ch (option `nv_dashboard_webhook_secret`).
- **Font uploads** TTF/OTF/WOFF/WOFF2 habilitados para admin/editor.
- **Modelos imagen** por cliente: gpt-image-2 / seedream-v4-5-edit (default Freepik) / mystic-2-5 / nano-banana-pro.
- **Análisis competencia**: Claude lee competidores → temas + tone +
  sugerencias.
- **Análisis web cliente**: Claude vision sobre URL → logo + colores + fuente.
- **Length copy slider**: 0-25 ultra-directo, 25-50 corto, 50-75 medio,
  75-100 largo.
