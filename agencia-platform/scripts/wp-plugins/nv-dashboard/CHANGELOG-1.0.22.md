# NV Dashboard v1.0.22

Tres bloques pedidos en la conversación de v1.0.21: página propia de Clientes,
integración con Drive Picker oficial de Google, y auto-creación de estructura
de carpetas en Drive.

## B2 · Página propia "👥 Clientes"

Sustituye el atajo a la pantalla nativa de WP por un dashboard visual:

- **Stats de un vistazo**: total clientes, configurados (🟢), pendientes (🟡),
  sin Drive (⚪), inválidos (🔴) — cada uno con su color y contador grande.
- **Grid de tarjetas** (responsive, 360px cada una). Por cliente:
  - Nombre + slug.
  - Badge de estado (mismo código de color que las stats).
  - 📝 Número de publicaciones.
  - 🤖 Modelo IA configurado.
  - 📁 Número de subcarpetas Drive (con `<details>` expandible que las lista
    con su tipo semántico).
  - Link directo "📂 Abrir carpeta en Drive →" cuando aplica.
  - Botones rápidos: Editar · Ver publicaciones · Drive.
- **Color del borde** según estado: verde / amarillo / gris / rojo. Imposible
  no ver de un vistazo qué clientes están listos para producción.

La pantalla nativa de WP queda accesible desde el submenú "↳ Lista WP" por
si la prefieres para acciones masivas.

## C-Picker · Drive Picker oficial de Google

Integración completa con la **Google Drive Picker API** y **Google Identity
Services** (versión moderna de OAuth 2.0, no la deprecated `gapi.auth2`).

### Botones nuevos en el formulario de cliente

- **📁 Seleccionar de Drive** (junto al campo "Carpeta raíz"): abre el modal
  oficial de Google. Navegas a tu Drive entero, marcas la carpeta del cliente,
  click "Seleccionar". El ID se rellena automáticamente en el campo y la
  validación pasa a verde.
- **📁 Añadir desde Drive…** (junto a "Añadir subcarpeta"): si ya tienes el
  root del cliente puesto, abre el Picker DENTRO de esa carpeta para
  seleccionar varias subcarpetas en bloque (multi-select habilitado). Cada
  una se añade como fila al repeater con tipo semántico inferido del nombre.

### Arquitectura

El access token se obtiene client-side via `google.accounts.oauth2.initTokenClient`
y se cachea en memoria de la pestaña. Las llamadas al Picker y a Drive API
las hace el browser directamente — el plugin no almacena refresh tokens en
servidor. Más simple y más seguro.

Scopes pedidos:
- `drive.readonly` — para que el Picker pueda navegar y previsualizar.
- `drive.file` — para auto-crear carpetas (solo afecta a archivos creados
  por la propia app; no da acceso a tu Drive entero).

### Fallback

Si no hay credenciales OAuth configuradas en NV Dashboard → Configuración,
el JS detecta y aborta sin error. Los botones del Picker no aparecen, pero
el formulario sigue funcionando con el campo URL/ID manual de v1.0.21.

## Auto-crear estructura · Botón "✨ Auto-crear estructura…"

Modal con plantillas predefinidas para clientes nuevos:

| Plantilla | Subcarpetas estándar |
|---|---|
| 🏥 Clínica médica/estética | Persona destacada · Equipo · Pacientes · Instalaciones · Logo y brand |
| 💼 Agencia / Negocio propio | Persona destacada · Equipo · Logo y brand |
| ⚖️ Profesional / Despacho | Persona destacada · Despacho/Instalaciones · Logo y brand |
| 🛒 Ecommerce / B2C | Productos · Instalaciones · Logo y brand |
| ⚪ Vacío | Solo carpeta raíz, sin subcarpetas |

Flujo:
1. Click "✨ Auto-crear estructura…" → abre modal.
2. Selecciona la **carpeta padre** (ej: REFS NV master) con el Picker.
3. Pon el nombre de la carpeta nueva (por defecto = nombre del cliente).
4. Elige plantilla.
5. Click "Crear estructura". El JS:
   - Pide access token a Google.
   - Crea la carpeta raíz dentro de la padre vía Drive API.
   - Crea cada subcarpeta dentro de esa raíz.
   - Aplica los IDs al formulario automáticamente: marca modo "configurado",
     rellena `nv_drive_root_id`, añade filas de subcarpetas con sus tipos.
6. Click guardar y listo. Sin entrar a Drive a hacer clicks manuales.

## Settings · Card "📁 Google Drive Picker (OAuth)"

Nuevo card en NV Dashboard → Configuración con:

- Campo OAuth Client ID.
- Campo API Key.
- **Guía paso a paso (5 min)** dentro de un `<details>` con los 6 pasos
  exactos en Google Cloud Console: crear proyecto, habilitar APIs (Drive +
  Picker), pantalla de consentimiento OAuth, scopes, Client ID con tu
  dominio en orígenes JS autorizados, API Key con restricciones por
  referrer.

## Cambios técnicos

- **NUEVO**: `admin/views/clientes.php` (~140 LOC) — dashboard visual.
- **NUEVO**: `admin/js/drive-picker.js` (~430 LOC) — Picker + auto-create.
- `includes/class-admin-pages.php`:
  - Submenú "👥 Clientes" apunta a `render_clientes()` (página nueva)
    en lugar del atajo `edit-tags.php`.
  - Submenú secundario "↳ Lista WP" preserva el atajo nativo.
  - Save de Settings guarda `nv_dashboard_google_client_id` y
    `nv_dashboard_google_api_key`.
- `includes/class-cliente-meta.php`:
  - `enqueue_picker_assets($hook)` carga `drive-picker.js` solo en
    `edit-tags.php` y `term.php` con `?taxonomy=nv_cliente`.
  - Localiza `nvDrivePicker` con clientId, apiKey, siteUrl.
- `admin/views/settings.php`: nuevo card OAuth con guía paso a paso.

## Compatibilidad

- 100% backward compatible con v1.0.21.
- Sin OAuth configurado, todo lo de v1.0.21 sigue funcionando — los
  botones del Picker simplemente no aparecen.
- El `<details>` de la guía OAuth está colapsado por defecto, no estorba.

## Verificación post-instalación

### Sin OAuth (instalación inmediata)
1. Activa v1.0.22.
2. NV Dashboard → 👥 Clientes: aparece el grid nuevo con tus 3 clientes
   migrados (Clínica March, Negocio Vivo, Aquaking) en verde.
3. Click "Editar" en Clínica March: el formulario sigue funcionando como
   en v1.0.21, sin botones de Picker.

### Con OAuth (después de los 5 min de setup)
1. Sigue la guía en NV Dashboard → Configuración → 📁 Google Drive Picker.
2. Pega Client ID + API Key, guarda.
3. Edita un cliente: aparecen los 3 botones nuevos (Seleccionar de Drive,
   Añadir desde Drive, Auto-crear estructura).
4. Click "Seleccionar de Drive" la primera vez: te pide consentimiento de
   Google (una vez por dominio). Acepta los scopes drive.readonly y
   drive.file.
5. Picker oficial se abre. Navegas, seleccionas, IDs rellenados solos.

## Limitaciones conocidas

- El access token se cachea solo durante la sesión del navegador. Si
  cierras la pestaña y vuelves, el primer click pedirá consentimiento de
  nuevo (dura 1 segundo).
- En la pantalla "Añadir cliente" (no editar), el botón Auto-crear coge el
  nombre del input "name". Si lo dejas vacío, lo pone como "Cliente".
- Picker requiere que estés logueado en Google con la cuenta que diste de
  alta como Test User en la consola. Si tienes varias cuentas en el
  navegador, asegúrate que es la correcta.
