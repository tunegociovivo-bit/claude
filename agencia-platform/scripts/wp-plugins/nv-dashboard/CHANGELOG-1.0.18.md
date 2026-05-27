# NV Dashboard v1.0.18

## Fixes (post-instalación v1.0.17)

Dos bugs reportados en producción al usar el widget "Abrir en Claude" sobre
el post 15430 (Clínica March, Rochar):

### 🐛 Bug 1 — "ESTE CLIENTE NO TIENE SUBCARPETA DOCUMENTADA EN REFS NV"

**Síntoma**: aunque la activación de v1.0.17 pre-pobló la opción
`nv_dashboard_refs_drive_folders` con la subcarpeta de Clínica March
(`1noErP4aDPoTqdvgL-HwKh8zz6EGfkEJw` con sub-niveles Rochar, Pacientes,
Trabajadores, Clínica), el mensaje del widget seguía diciendo que no había
subcarpeta documentada.

**Causa raíz**: mismatch de slug. v1.0.17 pre-pobló las claves con guiones
(`clinica-march`, `negocio-vivo`), pero los términos `nv_cliente` de NV
están guardados con underscore (`clinica_march`, `negocio_vivo`) — el
comentario explícito en `class-rest-api.php` v1.0.16 lo confirmaba: «regex
incluye underscore para slugs como 'clinica_march'».

**Fix**:

1. La pre-población de la activación ahora usa underscores (`clinica_march`,
   `negocio_vivo`, `aquaking`).
2. **Migración automática**: si vienes de v1.0.17, al activar v1.0.18 se
   detectan las claves con guion en la opción existente y se rescriben a
   underscore — preservando los IDs Drive ya configurados, sin perder datos.
3. **Lookup defensivo en `cliente_config`**: prueba el slug tal cual + variante
   con underscore + variante con guion. Así da igual qué formato use el cliente
   en WP — el endpoint encuentra los refs.

### 🐛 Bug 2 — Claude propone Nano Banana Pro cuando hay GPT-Image-2 configurado

**Síntoma**: tras pasar el enlace de Drive, el otro Claude respondió «antes
de tirar de Nano Banana Pro y regenerar...» — pero Clínica March está
configurado con `gpt-image-2` en NV Dashboard → Configuración.

**Causa raíz**: `claude-widget.js` (v1.0.7-v1.0.17) **no llamaba a
`/cliente-config/{slug}`**. Solo usaba los datos estáticos localizados por
`class-claude-widget.php` (post + cliente + asset). El mensaje resultante
no incluía nada sobre el modelo configurado, así que el chat externo elegía
modelo por su cuenta. Inconsistencia con el flujo del calendario
(`dashboard.js → nvGenerarImagenesConClaude`), que sí fetcheaba
`cliente-config` y por eso ese flujo sí funcionaba bien.

**Fix**: `claude-widget.js` ahora fetchea `cliente-config` cuando
`tipo=imagen`. El mensaje incluye dos bloques nuevos:

1. **🤖 MODELO DE IMAGEN CONFIGURADO** — modelo, provider, endpoint, auth.
   Si `openai_required` y hay key, incluye también la OpenAI key + ejemplo
   de llamada lista para copiar (tanto `/v1/images/edits` como
   `/v1/images/generations`). Termina con: «IMPORTANTE: usa EL MODELO
   CONFIGURADO ARRIBA. NO improvises otro».
2. **🚨 REFS VISUALES — REGLA CRÍTICA** — root + subcarpeta + sub-niveles
   + workflow Drive MCP. (v1.0.17 ya tenía este bloque pero ahora viene del
   mismo `cliente-config`, fuente única de verdad.)

Pre-fetch en `document.ready` para que el cache esté caliente cuando David
pulse el botón (sin perceptible latencia añadida).

## Cambios técnicos

- `nv-dashboard.php`:
  - Pre-población usa underscores.
  - Migración automática v1.0.17 → v1.0.18 que rescribe keys con guion.
- `class-rest-api.php`:
  - `cliente_config` con lookup tolerante (slug as-is / underscore / guion).
- `class-claude-widget.php`:
  - Eliminado el campo `driveRefs` del `wp_localize_script` — ahora todo
    viene de `cliente-config` para tener una única fuente.
  - Mantiene `clienteSlug` localizado, que es lo que usa el JS para fetchear.
- `admin/js/claude-widget.js`:
  - Nuevo helper `fetchClienteConfig()` con cache.
  - `buildMessage(tipo, orden, cfg)` ahora acepta cfg como tercer arg.
  - `openInClaude` y `previewMessage` async — esperan al fetch.
  - Pre-fetch en `document.ready` para warmar el cache.
  - Bloques de modelo + refs reemplazan el bloque de refs estático de v1.0.17.

## Compatibilidad

- 100% backward compatible con v1.0.17.
- Si tenías la opción `nv_dashboard_refs_drive_folders` configurada con
  guiones en v1.0.17, la migración la convierte automáticamente a underscores.
  Tus IDs Drive se preservan.
- Si tenías la opción configurada con tus propias claves (no las default),
  también se preservan — la migración solo rescribe el formato de la key,
  no toca los valores.
- El bloque de modelo solo aparece en mensajes de revisión `tipo=imagen`.
  Otros tipos (copy, hashtags, estrategia, video, otro) no se ven afectados.
