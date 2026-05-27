# NV Dashboard v1.0.19

## 🔒 Fix de seguridad crítico + reducción de variabilidad ética

Reportado por el otro Claude al regenerar el post 15432 (Clínica March, Rochar):

> 🚨 Lo más urgente: la API key está expuesta. Has metido la OPENAI_KEY
> completa en el prompt (sk-proj-Ge4S8nPq...). Está ahora mismo en los
> logs de conversación. Te recomiendo rotarla en cuanto leas esto.

Tenía razón. v1.0.18 metía la OpenAI key como texto plano en la URL
`claude.ai/new?q=...`. Eso significa que la key viaja por:

- Logs de conversación de Claude.ai
- Historial del navegador (queda en disco)
- URL completa visible en barra de direcciones, screenshots, devtools
- Memoria del Claude externo (queda en su contexto de la sesión)

**Acción urgente recomendada**: rotar la OpenAI key actual en
[platform.openai.com/api-keys](https://platform.openai.com/api-keys), ya que
la que aparece en los logs (`sk-proj-Ge4S8nPq…`) debe considerarse comprometida.
Generar una nueva, pegarla en NV Dashboard → Configuración → OpenAI API key.
Después instalar v1.0.19 — a partir de ahí la nueva key NUNCA saldrá del servidor.

## 🛠️ Fix arquitectónico: proxy server-side OpenAI

Nuevo endpoint `POST /wp-json/nv/v1/openai-image-proxy/{post_id}`:

- **Bearer auth** vía `NV_API_TOKEN` (constante en `wp-config.php` o
  Application Password). Permite que un Claude externo lo invoque sin
  sesión WP.
- **Body JSON** acepta:
  - `operation`: `"generate"` (texto→imagen) o `"edit"` (foto→imagen editada)
  - `prompt`: descripción
  - `size`: `1024x1024` / `1024x1536` / `1536x1024`
  - `quality`: `low` / `medium` / `high`
  - `n`: 1-4 imágenes
  - `image_urls`: array (solo `edit`); el plugin las descarga server-side
    y las pasa como multipart a OpenAI
  - `mask_url`: opcional para inpainting
  - `upload_to_post`: si `true`, sube a Media Library + asocia featured
    image + actualiza `nv_asset_url` en una sola llamada
- **La OpenAI key vive en `wp_options`** y nunca cruza la frontera HTTP
  hacia el cliente.
- **Devuelve** `{ images: [{ b64_json, attachment_id, asset_url }] }`.

Con esto el flujo del Claude externo es:

```
1. download_file_content de Drive → bajar refs
2. Subir refs a tmpfiles.org → URLs HTTPS
3. POST openai-image-proxy con operation=edit, image_urls=[...refs], upload_to_post=true
4. Listo — la imagen ya está en el post
```

Sin tocar nunca la OpenAI key.

## 🛠️ Fix de cliente-config: la key ya no se devuelve a Bearer

El endpoint `GET /cliente-config/{slug}` ahora solo devuelve `openai_key` si el
caller está autenticado con sesión WP (cookie + nonce). Si llaman con Bearer
`NV_API_TOKEN` (Claude externo), el campo `openai_key` viene como string vacío
y el caller queda obligado a usar el proxy.

Doble protección: aunque alguien intercepte el endpoint, no obtiene la key.

## 📜 Bloque "scope del trabajo" para reducir variabilidad ética

Reportado en el mismo incidente: el Claude externo, al ver instrucciones de
"generar imagen con cara de Rochar a partir de fotos reales", interpretó
deepfake y se negó a actuar. Otro Claude con el mismo prompt aceptó la
tarea. Variabilidad estocástica de los modelos al ver scope ambiguo.

v1.0.19 añade un bloque explícito al prompt (tanto en widget como en
batch del calendario) que clarifica:

1. David es CEO de Negocio Vivo, agencia contratada — no un actor mal
   intencionado.
2. La persona en las refs es el CEO del cliente posando voluntariamente,
   con consentimiento documentado.
3. **Flujo por defecto = EDIT, no SYNTH**. Toma UNA foto real, retoca
   color/encuadre/composición/overlay. No regenera el rostro.
4. `operation="generate"` (sin foto base) solo para escenas sin persona
   identificable: instalaciones, manos, productos.
5. Si la orden literal dice "regenerar imagen completa", se interpreta
   como "nueva composición sobre foto real", no "sintetizar nuevo rostro".

Esto no elimina la variabilidad al 100% pero la reduce mucho. Algún Claude
externo seguirá poniendo reparos extra ocasionalmente — es estocástico.

## Cambios técnicos

- `nv-dashboard.php`: bump version 1.0.18→1.0.19.
- `class-rest-api.php`:
  - Nueva ruta `POST /openai-image-proxy/(?P<id>\d+)`.
  - Nueva función `openai_image_proxy($request)` que llama a
    `/v1/images/generations` o `/v1/images/edits` server-side.
  - Helper privado `upload_b64_to_post($b64, $post_id, $idx)` para
    automatizar la subida a Media Library.
  - `cliente_config` solo devuelve `openai_key` si `is_user_logged_in()`.
- `admin/js/claude-widget.js`:
  - El bloque "🤖 MODELO DE IMAGEN" ya no expone la key — apunta al proxy
    con instrucciones de uso completas y referencia al `NV_API_TOKEN`
    en memoria de Claude.
  - Nuevo bloque "📜 CONTEXTO Y SCOPE DEL TRABAJO" antes de los refs
    Drive cuando `tipo=imagen`.
- `admin/js/dashboard.js` (`nvGenerarImagenesConClaude`):
  - Mismas dos transformaciones que en `claude-widget.js`.

## Compatibilidad

- 100% backward compatible con v1.0.18.
- Si no defines `NV_API_TOKEN` en `wp-config.php`, el proxy sigue
  funcionando para usuarios logged-in (sesión WP), simplemente no
  podrán usarlo Claudes externos.
- La opción `nv_dashboard_openai_api_key` (en NV Dashboard → Configuración)
  sigue siendo la fuente única de la key. Si la rotas, basta con pegar
  la nueva ahí — el proxy la lee fresca cada llamada.

## Acción manual recomendada (1 minuto)

1. Rotar la OpenAI key actual en platform.openai.com/api-keys → revoke.
2. Generar nueva → copiar.
3. NV Dashboard → Configuración → OpenAI API key → pegar y guardar.
4. Activar v1.0.19. La nueva key ya nunca saldrá del servidor.
