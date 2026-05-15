# NV Dashboard v1.0.21

## 🎯 Gestión de Drive refs en el formulario del cliente

Hasta v1.0.20, las refs Drive vivían en una opción JSON global pre-poblada
a mano. Crear un cliente nuevo (Capilar March, Praxis, RSAdvocats, ESAEM…)
requería tocar el JSON o esperar a que algún Claude tropezara con el "este
cliente no tiene refs" para luego corregirlo.

v1.0.21 mueve esta gestión al **formulario nativo de WP de añadir/editar
cliente** y hace los datos obligatorios, validados, y atados al término.

### A1. Formulario integrado en Editorial → Clientes

Al añadir o editar un cliente aparece un nuevo bloque "📁 Refs visuales de
Google Drive" con:

- **Selector de modo** (radio):
  - ✅ Sí, refs configuradas
  - ⏳ Sí, pero pendientes de configurar
  - 🚫 Este cliente no usa Drive refs
- **Carpeta raíz del cliente**: campo URL/ID con extracción automática del
  ID al pegar una URL completa (`drive.google.com/drive/folders/<ID>`).
  Validación inline: borde rojo + mensaje de error si el formato no es
  reconocible (los IDs Drive son 20-60 chars `[a-zA-Z0-9_-]`).
- **Repeater de subcarpetas** con tres campos por fila:
  - Nombre libre (ej: "Rochar CEO")
  - URL/ID Drive (mismo extractor automático)
  - **Tipo semántico** (selector): persona_destacada, equipo,
    pacientes_usuarios, instalaciones, productos, logo_brand, otros.

Validación al guardar: si marcas "configuradas" pero la URL raíz no es
válida, el plugin lo degrada a "pendiente" y muestra un warning persistente.

### A2. Prompt con tres ramas (claude-widget.js + dashboard.js)

El bloque "🚨 REFS VISUALES" en los mensajes a Claude ahora se ramifica:

| drive_mode    | Comportamiento del prompt |
|---------------|---------------------------|
| `configured`  | Bloque actual con root + subniveles + workflow Drive MCP. Añade guía de selección por `type` semántico ("persona_destacada → cuando el copy menciona al CEO"). |
| `no_drive_refs` | "David ha marcado este cliente como sin refs. Genera con `operation=generate` sin foto base. NO pares a preguntar." |
| `pending` o roto | "PARAR. Avisar a David para que entre en Editorial → Clientes y configure este cliente. NO improvisar refs externas." |

Esto resuelve el bug de fondo: hasta ahora, un cliente sin entrada en el
JSON producía un mensaje confuso para Claude. Ahora hay decisión explícita.

### A3. Slug normalizado a underscore automáticamente

Hook `created_nv_cliente` que convierte slugs nuevos `clinica-capilar-march`
→ `clinica_capilar_march`. Garantiza consistencia con la convención de NV
y previene la incidencia que arreglamos en v1.0.18 (mismatch entre slug
del término y key del JSON).

Solo aplica a clientes **nuevos**. Los existentes con guion no se tocan
(podrían tener publicaciones asociadas).

### A4. Admin notice persistente para clientes pendientes

En todas las pantallas relevantes de NV Dashboard (lista de clientes, lista
de publicaciones, edit de publicación, dashboard general) aparece un aviso
naranja listando los clientes con `drive_mode = pending`, con link directo
a editar cada uno. Imposible olvidarse.

### B1. Columna de estado en la lista de clientes

`Editorial → Clientes` muestra ahora dos columnas nuevas:

- **📁 Drive**: 🟢 Configurado · 🟡 Pendiente · ⚪ Sin Drive · 🔴 Inválido
- **Sub**: número de subcarpetas registradas

De un vistazo ves qué clientes están listos para producción.

### B4. Sub-tipos semánticos de subcarpetas

Las subcarpetas ahora tienen un `type` que se inyecta en el prompt para
que Claude sepa cuál usar para qué escena, sin depender de buscar por nombre
libre. La migración asigna tipos automáticamente con heurística sobre el
nombre (ej: nombre con "CEO" → `persona_destacada`).

## 🛠️ Migración automática

El JSON global `nv_dashboard_refs_drive_folders` se migra automáticamente a
term meta la primera vez que un admin entra al admin tras instalar v1.0.21:

1. Busca cada cliente del JSON viejo en `nv_cliente`.
2. Tolera mismatch de slug (probará guion y underscore).
3. Crea term meta:
   - `nv_drive_mode` = `configured` si tenía `root_id`, si no `pending`.
   - `nv_drive_root_id` = `root_id` del JSON.
   - `nv_drive_subfolders` = array convertido con tipos inferidos por nombre.
4. Si un cliente ya tenía term meta (edición manual previa), no se pisa.
5. Marca con flag `nv_dashboard_drive_refs_migrated_to_term_meta = true`
   para no repetir.

El JSON viejo se mantiene en `wp_options` solo como fallback del
`root_folder_id` global (REFS NV master). El resto deja de leerse.

## Arquitectura — Term meta como source of truth

Cambio importante: los datos de Drive del cliente ahora viven en **term
meta** en lugar de en una opción global. Ventajas:

- Cada cliente lleva sus propios datos en su registro.
- Borrar un cliente → desaparecen sus refs (no quedan huérfanas).
- Renombrar un cliente → no rompe el lookup (term_id no cambia).
- Backup/restore vía export estándar de términos.

Endpoint `cliente_config` ahora consulta `NV_Cliente_Meta::get_cliente_drive_config()`
y devuelve el campo `drive_mode` además de los datos. Compatibilidad total
con el formato `subfolders` legacy + nuevo campo `subfolders_v2` con tipos.

## Cambios técnicos

- **NUEVO**: `includes/class-cliente-meta.php` (~570 LOC) — clase completa
  con form fields, save, validación, columnas, notices, migración, helpers.
- `nv-dashboard.php`: carga e inicializa la nueva clase.
- `includes/class-rest-api.php`: `cliente_config` lee de term meta vía
  `NV_Cliente_Meta::get_cliente_drive_config()`. Devuelve `drive_mode` y
  `subfolders_v2` (con tipos) además del formato legacy.
- `admin/js/claude-widget.js`: tres ramas según `drive_mode`. Pinta tipos
  semánticos cuando hay `subfolders_v2`. Guía de selección por tipo en el
  modo `configured`.
- `admin/js/dashboard.js`: mismas tres ramas en `nvGenerarImagenesConClaude`.

## Próximos pasos (v1.0.22)

Reservados para la siguiente entrega:

- **B2**: página propia "Clientes" en el menú de NV Dashboard con
  dashboard visual de estado, # publicaciones, modelo IA, link rápido de
  edición. Es un layer encima de B1.
- **C-Picker**: integración con Google Drive Picker API. Botón "📁
  Seleccionar de Drive" abre el modal nativo de Google, navegas a REFS NV,
  marcas las subcarpetas a añadir. Requiere setup OAuth en Google Cloud
  Console (15 min, una vez).
- **Auto-crear estructura**: para clientes nuevos, botón que crea
  automáticamente el árbol de subcarpetas estándar en REFS NV vía Drive
  API. Requiere OAuth con scope drive.file.

Cuando termines de instalar v1.0.21, paso la guía OAuth y arranco v1.0.22.

## Verificación post-instalación (5 min)

1. Activa v1.0.21. La migración corre automáticamente al entrar al admin.
2. **Editorial → Clientes**: comprueba que aparecen las dos columnas nuevas
   (📁 Drive, Sub). Clínica March, Negocio Vivo, Aquaking deben aparecer
   como 🟢 Configurado. El resto como 🟡 Pendiente.
3. Edita Clínica March: verifica que ves el bloque "📁 Refs visuales de
   Google Drive" con los datos migrados (modo "configured", root_id de
   la carpeta CLINICA MARCH, 4 subcarpetas con tipos asignados).
4. Crea un cliente nuevo de prueba. Marca "🚫 No usa Drive refs". Guarda.
5. En cualquier publicación de ese cliente nuevo, abre el widget Claude →
   tipo Imagen → Previsualizar. Comprueba que el bloque dice "📁 REFS
   VISUALES — NO APLICA PARA ESTE CLIENTE".
6. Borra el cliente de prueba.
