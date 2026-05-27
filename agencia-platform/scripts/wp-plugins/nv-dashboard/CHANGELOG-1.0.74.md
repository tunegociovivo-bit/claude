# NV Dashboard 1.0.74 — Branding del cliente en el prompt de vídeo

## Contexto

v1.0.73 introdujo el bloque "🚨 MEMORIA OPERATIVA NV" en el prompt de
revisiones de vídeo, redirigiendo al Claude externo al doc maestro de
Drive. El doc tiene el pipeline genérico (Seedream V4.5 Edit → Seedance
Pro 1080p → ElevenLabs → Freepik AI music → FFmpeg) pero NO contiene la
identidad visual por cliente — eso vive como term meta del taxonomy
`nv_cliente`.

Resultado: el Claude externo, al construir las pantallas tipográficas y
overlays FFmpeg, acababa usando los defaults Negocio Vivo (dorado
`#D2A039`, Poppins Bold) para cualquier cliente, en lugar de la paleta y
tipografía que David tiene configuradas en la ficha del cliente.

## Lo que añade v1.0.74

### Backend — `includes/class-rest-api.php`

`GET /wp-json/nv/v1/cliente-config/{slug}` ahora devuelve un campo
`branding` adicional con todo lo que el Claude externo necesita para
producir vídeo con la identidad correcta:

```json
"branding": {
  "colors_explicit":    { "primary": "...", "accent": "...", "text_on_primary": "..." },
  "colors_resolved":    { "primary": "...", "accent": "...", "text_on_primary": "..." },
  "fonts": [
    { "weight": "regular", "url": "https://.../Playfair-Regular.ttf", "filename": "..." },
    { "weight": "bold",    "url": "https://.../Playfair-Bold.ttf",    "filename": "..." }
  ],
  "logo_url":           "https://.../logo.png",
  "logo_position":      "bottom-right",
  "brand_brief":        "Texto del brief (tono, audiencia, posicionamiento)...",
  "website":            "https://...",
  "visual_pattern":     "Fotografía editorial, luz natural cálida...",
  "refs_fidelity":      "alta",
  "style_guide":        "Mediterranean luxury aesthetic. Palette dominated by...",
  "style_guide_truncated": false,
  "dimensions": {
    "reel":     { "width": 1080, "height": 1920 },
    "imagen":   { "width": 1080, "height": 1350 },
    "carrusel": { "width": 1080, "height": 1080 }
  }
}
```

Notas:

- **Colores**: se devuelven tanto `colors_explicit` (lo que David puso
  literalmente en la ficha, con campos vacíos si no configuró) como
  `colors_resolved` (siempre 3 hex válidos, con fallback automático
  desde la style guide o paleta neutra por defecto). El JS marca cada
  color con `(explícito)` o `(fallback automático)` para que el Claude
  externo sepa si confiar a ciegas o pedir confirmación.

- **Fuentes**: vienen como URLs públicas de la Media Library
  (`wp_get_attachment_url`). El Claude externo las descarga al sandbox
  y las pasa directamente a FFmpeg `drawtext fontfile=…`. Soporta el
  storage tipado de v1.0.63 (varias fuentes por cliente con weight
  semántico: regular, bold, italic…).

- **Style guide**: el texto generado por Claude vision sobre las refs
  visuales del cliente (cacheado en `nv_style_guide_cached`). Suele
  contener una descripción densa del look & feel. Se trunca a 1200
  caracteres en la respuesta para no inflar el prompt — si el chat
  externo necesita más detalle, puede fetchear el endpoint completo.

- **Dimensions**: las resoluciones que el cliente tiene configuradas
  por tipo de contenido (reel, imagen, carrusel, story…). Útil para
  parametrizar correctamente Seedream/Seedance y FFmpeg sin asumir
  1080×1920 universal.

### Frontend — `admin/js/claude-widget.js`

Nueva sub-sección `🎨 BRANDING DEL CLIENTE — usar en FFmpeg / overlays`
inyectada en el bloque de revisión de vídeo (después del resumen del
pipeline, antes de las refs Drive). Renderiza cada campo del payload
`branding` solo si tiene valor (no ensucia el prompt con "(vacío)").

Si el endpoint devuelve `branding: null` (no debería pasar, pero por si
acaso), el JS imprime un bloque explícito **"BRANDING DEL CLIENTE — no
recibido"** instruyendo a parar y avisar a David antes de inventar
colores/fuentes.

Incluye una línea clave que evita el bug v1.0.73: cuando hay fuente
bold del cliente, **prevalece sobre la regla v4 de Reels NV** (que pide
Poppins Bold como default Negocio Vivo). Los clientes externos no
tienen por qué adoptar la tipografía de la agencia.

## Tamaño del prompt

Con branding completo (3 colores, 2 fuentes, logo, brief, patrón, web,
style guide, dimensions) el prompt total queda en ~6.600 caracteres,
todavía por debajo del aviso de truncación del widget (7.500 chars).

Para clientes sin branding configurado: ~4.700 chars (igual que 1.0.73,
porque el bloque entero se sustituye por una sola línea de aviso).

## Compatibilidad

- El bloque `branding` solo se inyecta para `tipoRevision === 'video'`.
- Para `tipoRevision === 'imagen'` la respuesta del endpoint incluye
  ahora el campo `branding` extra, pero el JS de imagen no lo consume
  (sigue funcionando exactamente como en 1.0.73). Si más adelante David
  quiere replicar este bloque en imagen, son 5 líneas de JS.

## Archivos modificados

- `includes/class-rest-api.php` — campo `branding` en `cliente_config()`.
- `admin/js/claude-widget.js` — sub-sección branding en buildMessage.
- `nv-dashboard.php` — version 1.0.73 → 1.0.74.

## Cómo verificar

1. En NV Dashboard → Editorial → Clientes, edita un cliente y
   configura colores brand + sube alguna fuente TTF/OTF + brief de
   marca.
2. Editar una publicación de tipo reel de ese cliente.
3. En "🤖 Pedir revisión a Claude": tipo "🎬 Cambiar / editar vídeo" →
   escribe orden → "👁 Previsualizar mensaje".
4. Debe aparecer la sección "🎨 BRANDING DEL CLIENTE — usar en FFmpeg
   / overlays" con los hex, las URLs de fuentes, el logo, etc.
