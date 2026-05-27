# NV Dashboard 1.0.71 — Dimensiones por formato + adaptar publicaciones

## Resumen
Los clientes ahora pueden tener **dimensiones de imagen personalizadas por tipo
de publicación** (imagen, reel, carrusel, story, video). Además, cualquier
publicación ya generada se puede **adaptar a otro formato** con un clic,
regenerando la imagen con IA en el nuevo aspect ratio.

## Cambios

### 📐 Ajustes de cliente → "Dimensiones por formato"
- Nueva sección en *Editorial → Clientes → editar cliente* con un selector de
  preset + W×H editable para cada tipo de publicación.
- Presets incluidos: Instagram Feed (4:5), Cuadrado (1:1), Reel/Story (9:16),
  Apaisado (16:9), TikTok, YouTube, YouTube Shorts, Pinterest (2:3),
  LinkedIn (1.91:1), Facebook link, X/Twitter (16:9), y `custom`.
- Defaults profesionales si el cliente no toca nada (1080×1350 imagen,
  1080×1920 reel/story, 1080×1080 carrusel, 1920×1080 video).
- Storage: `term_meta('nv_dimensiones_formatos')` por cliente.

### 🎨 Pipeline de generación respeta las dimensiones
- `generate_image_via_openai` ahora elige el size soportado por gpt-image-2
  (1024×1024 / 1024×1536 / 1536×1024) más cercano al ratio configurado del
  cliente, en lugar del mapa estático antiguo.
- `generate_image_via_freepik` elige el `aspect_ratio` Freepik más cercano
  (square_1_1, social_story_9_16, widescreen_16_9, traditional_3_4, classic_4_3).
- Tras la generación, **reencuadre cover centrado** al tamaño exacto del
  cliente. Sirve para los 4 flujos: multi-cliente, generar imagen individual,
  re-aplicar overlay, y proxy Claude.
- Nuevo helper `NV_Cliente_Meta::get_dimensions_for_tipo($term_id, $tipo)` →
  `['width', 'height', 'preset']`.

### 📐 Botón "Adaptar formato" en publicación ya generada
- Modal de previsualización del calendario: junto a "Re-aplicar texto",
  ahora hay un botón **"📐 Adaptar formato"** que despliega selector de tipo
  + calidad y dispara una regeneración con IA en el nuevo ratio.
- Widget Claude (pantalla individual de la publicación): bloque dedicado
  "📐 Adaptar a otro formato".
- Cambia el `nv_tipo` automáticamente si seleccionas un tipo distinto al
  actual.
- Limpia el backup `_nv_attachment_pre_overlay` antiguo para que la nueva
  imagen sea limpia desde cero.

### 🛠️ Implementación técnica
- Nuevo endpoint REST `POST /nv/v1/adaptar-formato/<id>` con body
  `{ tipo_target, quality, [width, height] }`.
- Nueva propiedad estática `NV_Rest_API::$dimension_override` para inyectar
  medidas puntuales durante el request "adaptar-formato" sin tocar el meta
  del cliente.
- Helper `ensure_image_matches_client_dimensions($post_id, $attachment_id, $cliente)`
  + `resize_image_cover($path, $w, $h)` (estrategia "cover" centrada, preserva
  alpha en PNG/WEBP).
- `_nv_image_dimensions` se persiste como post meta en cada generación para
  trazabilidad.

### Compatibilidad
- 100% retrocompatible. Clientes que no toquen la sección "Dimensiones por
  formato" siguen usando los presets de toda la vida (4:5 imagen, 9:16 reel,
  1:1 carrusel, etc.) pero ahora se garantiza el tamaño exacto en píxeles.
- Las publicaciones existentes (sin `_nv_image_dimensions` meta) no se tocan
  hasta que se regeneren o se adapten.

## Archivos modificados
- `nv-dashboard.php` (versión)
- `includes/class-cliente-meta.php` (presets, helpers, UI, save handler)
- `includes/class-rest-api.php` (endpoint adaptar-formato, override, resize, pipeline)
- `includes/class-claude-widget.php` (botón Adaptar formato en widget)
- `admin/js/dashboard.js` (botón + handler en modal calendario)
- `admin/js/trash-and-toasts.js` (helper window.nvAdaptarFormatoForPost)
- `admin/js/claude-widget.js` (handler del botón en widget)
