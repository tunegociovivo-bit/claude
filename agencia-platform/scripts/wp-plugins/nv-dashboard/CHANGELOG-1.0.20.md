# NV Dashboard v1.0.20

## 🐛 Fix del bloqueo de auth recurrente al subir imágenes

Reportado por el otro Claude al regenerar el post 15430 v3 (Clínica March):

> Sin credenciales no puedo subir.
> Confirmado HTTP 401 otra vez en los tres endpoints:
> POST /wp-json/nv/v1/subir-imagen-post/15430   → 401 rest_forbidden
> POST /wp-json/nv/v1/actualizar-publicacion/15430 → 401 rest_forbidden
> POST /wp-json/wp/v2/media                     → 401 rest_forbidden
> Es la tercera vez consecutiva (Aquaking 28-abr, Clínica March 30-abr v1, ahora).

**Causa raíz**: v1.0.17 introdujo Bearer auth con la constante `NV_API_TOKEN`,
pero requería que David la definiera manualmente en `wp-config.php`. Mientras
no lo hiciera, el Claude externo se quedaba sin método de auth y los endpoints
seguían devolviendo 401. Además, el prompt no incluía el token explícitamente
— el Claude externo tenía que adivinar credenciales de su memoria persistente,
y no siempre las localizaba.

**Fix** (cero configuración manual):

1. **Auto-generación del token** en la activación: opción
   `nv_dashboard_api_token` con valor `nvtok_{48_chars_random}`. Si no existe,
   se crea automáticamente. Fallback en `plugins_loaded` para sites que se
   actualizan sin pasar por activate (algunos updaters de WP no lo disparan).

2. **`check_permission` acepta tres métodos**:
   1. Sesión WP con `edit_posts` (existente, para el dashboard interno).
   2. Bearer matching constante `NV_API_TOKEN` (existente desde v1.0.17, opt-in).
   3. **NUEVO**: Bearer matching opción `nv_dashboard_api_token` (default,
      auto-generada). Es el método que va a usar el Claude externo.

3. **El token se inyecta literal en el prompt**: tanto el widget "Abrir en
   Claude" como "Generar imágenes con Claude" ahora incluyen el valor real
   del token junto al `Authorization: Bearer ...`. El Claude externo no
   tiene que adivinar nada.

4. **Settings UI nuevo** en NV Dashboard → Configuración → 🔑 API Token:
   - Muestra el token actual en una caja copiable.
   - Botón **📋 Copiar** al portapapeles.
   - Botón **🔄 Rotar** que invalida el actual y genera uno nuevo en 1 clic.
   - Endpoint REST `POST /rotar-api-token` (`manage_options` only) por debajo.

## 🔒 Tradeoff de seguridad — leído y asumido

El token va a aparecer en URLs de `claude.ai/new?q=...`, en logs de
conversación de Claude.ai y en historial del navegador. **Tiene un alcance
mucho más limitado que la OpenAI key** que arreglamos en v1.0.19:

| Vector | OpenAI key (v1.0.18) | API token NV (v1.0.20) |
|---|---|---|
| Qué puede hacer si se filtra | Quemar dinero ilimitado en la cuenta de David | Subir imágenes / actualizar posts en el WP de NV |
| Modelo de coste si se abusa | Ilimitado en USD | Disco / publicaciones del CPT (recuperable) |
| Tiempo para detectar abuso | Variable (factura mensual) | Inmediato (publicaciones extrañas en feed) |
| Tiempo para cortar | Rotar key + revisar facturación | Click "🔄 Rotar" en settings |
| Alcance de la rotación | Empieza desde cero en Settings | Empieza desde cero en Settings |

**Recomendación**: rotar el token cada cierto tiempo (mensualmente, p.ej.) y
siempre que haya sospecha de exposición pública (capturas compartidas, etc.).

## Cambios técnicos

- `nv-dashboard.php`:
  - Helpers `nv_dashboard_get_api_token()` y `nv_dashboard_regenerate_api_token()`.
  - Activación llama al getter para crear el token si no existe.
  - `plugins_loaded` también lo asegura (fallback para upgrades sin re-activate).
  - Localización `nvDashboard` (`admin_enqueue_scripts`) ahora incluye `apiToken` y `siteUrl`.
- `class-rest-api.php`:
  - `check_permission` admite Bearer matching el option (en addición al constante).
  - Nuevos endpoints `GET /api-token` y `POST /rotar-api-token` (ambos `manage_options`).
- `class-claude-widget.php`:
  - `build_context` añade `apiToken` al objeto localizado.
- `admin/views/settings.php`:
  - Nuevo card "🔑 API Token del plugin (Bearer auth)" con display + copy + rotate.
- `admin/js/claude-widget.js`:
  - Bloque de OpenAI: `Authorization: Bearer ' + ctx.apiToken` (literal).
  - Nuevo bloque "🔐 AUTH PARA SUBIR/ACTUALIZAR EL POST" antes del cierre,
    visible para todos los `tipoRevision` (no solo imagen). El Claude externo
    siempre sabe cómo autenticarse.
- `admin/js/dashboard.js` (`nvGenerarImagenesConClaude`):
  - Bloque de proxy: `Authorization: Bearer ' + nvDashboard.apiToken` (literal).
  - Bloque de subir-imagen-post: cambia "Basic auth con alejandronegociovivo +
    app password" → "Bearer {token}". Más simple y sin dependencias de memoria.

## Compatibilidad

- 100% backward compatible con v1.0.19.
- Si tenías `NV_API_TOKEN` definido en `wp-config.php`, sigue funcionando como
  fallback. La opción auto-generada es independiente.
- Si rotas el token desde la UI, los próximos prompts lo recogerán automáticamente
  (la JS lee de `wp_localize_script` que se regenera en cada page load).

## Verificación post-instalación (1 minuto)

1. Activa v1.0.20.
2. Ve a NV Dashboard → Configuración. Comprueba que aparece la nueva card
   "🔑 API Token del plugin" con un token `nvtok_...`.
3. Abre cualquier publicación de Clínica March → widget "🤖 Pedir revisión a Claude"
   → tipo "🖼️ Cambiar imagen" → orden cualquiera → 👁 Previsualizar.
4. Confirma que en el bloque "🔐 AUTH PARA SUBIR/ACTUALIZAR EL POST" aparece el
   token literal `nvtok_...` (no `{NV_API_TOKEN_NO_DISPONIBLE}`).
5. (Solo si vas a probar end-to-end) Pulsa "🤖 Abrir en Claude" y deja que el
   Claude externo regenere la imagen. Esta vez no debería dar 401.
