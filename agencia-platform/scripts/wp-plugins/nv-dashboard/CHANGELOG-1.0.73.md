# NV Dashboard 1.0.73 — Pointer a la memoria operativa NV para revisiones de vídeo

## El problema

Una revisión de tipo **vídeo** generada desde el widget "🤖 Pedir revisión
a Claude" abría `claude.ai/new?q=...` con solo el contexto genérico de la
publicación (copy, hashtags, asset, orden) y el bloque de auth Bearer. El
Claude externo NO recibía pista alguna de que existe:

- Un **pipeline NV Reels** documentado (Seedream V4.5 Edit → Seedance Pro
  1080p → ElevenLabs → Freepik AI music → FFmpeg).
- Las **reglas v1–v13 de Reels NV** (pantallas tipográficas, sidechain,
  loudnorm, aspect ratio, etc.).
- Una **memoria operativa maestra** alojada en Google Drive con todo lo
  anterior, los endpoints verificados, las API keys y las lecciones
  aprendidas.

Resultado: el chat externo improvisaba (caso documentado 12/05/2026: post
415 Mar Costa del Sol → entregó un "montaje Ken Burns con MoviePy" sobre
imágenes Mystic, en vez de seguir el pipeline real).

Para revisiones de **imagen** este problema ya estaba resuelto desde
v1.0.18: el widget inyectaba un bloque con modelo configurado + refs Drive
+ workflow obligatorio. Vídeo se había quedado sin equivalente.

## El fix

`admin/js/claude-widget.js`:

### 1. Constantes globales `NV_MEMORIA_OPERATIVA`

Añadidas en el top del módulo. Centralizan los IDs de Drive (doc maestro
+ carpeta REFS NV raíz). Si David mueve el doc o cambia los IDs basta con
actualizar este bloque y reempaquetar — no hay que tocar nada más.

```javascript
const NV_MEMORIA_OPERATIVA = {
    doc_master_file_id: '1Ss-Jr0O1rvxeDRJola-_wdZmK5bNZICK',
    doc_master_title:   '🧠 MEMORIA OPERATIVA NEGOCIO VIVO',
    doc_master_url:     'https://drive.google.com/file/d/.../view',
    refs_root_folder_id:'1Z2Hr5Ec-11RCKX00vtKrnPAt8RzgkrCx',
};
```

### 2. Pre-fetch de `cliente-config` también para vídeo

`openInClaude()` y `previewMessage()` antes solo llamaban a
`/wp-json/nv/v1/cliente-config/{slug}` si la revisión era de imagen.
Ahora también se llama para vídeo, para tener disponibles las refs Drive
configuradas por cliente (cuando aplique a tomas con personas
identificables).

```javascript
if (tipo === 'imagen' || tipo === 'video') {
    cfg = await fetchClienteConfig();
}
```

### 3. Nuevo bloque inyectado cuando `tipoRevision === 'video'`

Tres sub-secciones, en este orden:

**3.1 🚨 MEMORIA OPERATIVA NV — LEER ANTES DE EMPEZAR**

Le dice al Claude externo dónde leer la fuente de verdad antes de tocar
nada: fileId del doc maestro, URL legible, ID de la carpeta REFS NV, y
qué herramienta usar (`Google Drive → read_file_content`). Lista lo que
encontrará dentro (pipeline, reglas v1–v13, endpoints Freepik, config
ElevenLabs, lecciones aprendidas).

**3.2 🎬 PIPELINE NV REELS — RESUMEN**

Resumen inline del pipeline (Seedream V4.5 Edit → Seedance Pro 1080p →
ElevenLabs → Freepik AI music → FFmpeg). Suficiente para que el chat
externo sepa qué buscar en el doc maestro, sin duplicar el detalle (que
sigue siendo único en Drive — evitamos desincronización).

Prohibición explícita de sustituir el pipeline por un montaje Ken Burns.
Recordatorio del aspect ratio correcto (`social_story_9_16`, no
`portrait_9_16` que está deprecated en Freepik).

**3.3 📁 REFS VISUALES DEL CLIENTE**

Tres ramas según `cfg.refs_drive.drive_mode`, paralelo a lo que ya hace
el bloque de imagen:

- `no_drive_refs` → seguir sin reference_images, basándose en la
  sugerencia visual.
- `configured` → mostrar root + cliente_folder + subfolders_v2 tipados,
  con workflow Drive MCP → tmpfiles → reference_images.
- `pending` / no configurado → seguir sin refs si la escena no requiere
  persona identificable; parar y avisar si sí la requiere.

## Archivos modificados

- `admin/js/claude-widget.js` (constantes top + 2 ifs + bloque nuevo ~110
  líneas).
- `nv-dashboard.php` (version 1.0.72 → 1.0.73).

## Cómo verificar

1. Editar cualquier publicación de tipo `reel`.
2. En "🤖 Pedir revisión a Claude": seleccionar "🎬 Cambiar / editar
   vídeo", escribir cualquier orden, pulsar "👁 Previsualizar mensaje".
3. Debe aparecer el nuevo bloque "🚨 MEMORIA OPERATIVA NV — LEER ANTES
   DE EMPEZAR" con el fileId `1Ss-Jr0O1rvxeDRJola-_wdZmK5bNZICK`.
4. Para "🖼️ Cambiar imagen" todo debe seguir igual que en 1.0.72 (no
   se ha tocado ese bloque).

## Notas

- El bloque solo se inyecta para revisiones de vídeo. El resto de tipos
  (copy, hashtags, estrategia, otro) sigue sin contexto extra, igual que
  en 1.0.72.
- Si en el futuro David quiere un pointer similar para otros tipos (por
  ejemplo "copy" con guidelines de tono editorial en Drive), se replica
  el patrón en 5 minutos.
