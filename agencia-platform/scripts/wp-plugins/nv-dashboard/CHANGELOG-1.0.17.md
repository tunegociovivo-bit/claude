# NV Dashboard v1.0.17

## Novedades

### 🚨 Drive REFS NV como fuente canónica única de refs visuales

Los mensajes que se envían a Claude (tanto desde el botón "Abrir en Claude"
del widget de cada publicación como desde "Generar imágenes con Claude" del
calendario) ahora incluyen un bloque CRÍTICO que establece:

- Drive carpeta `REFS NV` (root ID `1Z2Hr5Ec-11RCKX00vtKrnPAt8RzgkrCx`) es la
  **única** fuente canónica para imágenes de referencia (caras de cliente,
  productos, brand assets).
- PROHIBIDO usar adjuntos de Asana, web del cliente, Slack u otras fuentes
  como sustituto. Antes Claude tendía a buscar refs en Asana cuando no le
  decían explícitamente dónde mirar.
- Si el cliente no tiene subcarpeta documentada → PARAR y avisar a David,
  NO improvisar fuentes alternativas.

**IDs Drive pre-poblados en la activación** (opción `nv_dashboard_refs_drive_folders`):

| Cliente | Subcarpeta raíz | Sub-niveles |
|---|---|---|
| Clínica March | `1noErP4aDPoTqdvgL-HwKh8zz6EGfkEJw` | Rochar Villameriel (CEO), Pacientes, Trabajadores, Instalaciones clínica |
| Negocio Vivo | `1RXtAnNe6K_cdE9-8rWqG5R_YKt_u2y6j` | David Rios (blazer outfit + caras) |
| Aquaking | `1hBfWOP7UUcGdaSBMSVbLVMU9EuGsbXFG` | (sin sub-niveles) |

**Pendientes de crear y documentar** (David los está organizando):
Clínica Capilar March, Praxis zum Schloss, RSAdvocats, ESAEM. Hasta que existan,
cualquier petición de imagen para esos clientes hará PARAR a Claude pidiendo
el ID antes de continuar.

### 🔐 Auth Bearer alternativo (NV_API_TOKEN)

`check_permission()` en la REST API ahora acepta dos métodos de autenticación:

1. **Bearer token** vía constante `NV_API_TOKEN` en `wp-config.php` —
   recomendado para Claudes externos / chats que no tienen sesión WP.
2. **Application Password** estándar (Basic Auth) — mantenido como antes
   para usuarios autenticados.

Para activar Bearer:

```php
// En wp-config.php (antes de "/* That's all, stop editing! */")
define( 'NV_API_TOKEN', 'tu-token-secreto-largo' );
```

Header en cada request:

```
Authorization: Bearer <NV_API_TOKEN>
```

Sin esta constante, el plugin sigue funcionando exactamente igual que antes
(solo Application Password). Es opt-in.

### Cambios técnicos

- `nv-dashboard.php`: pre-rellena opción `nv_dashboard_refs_drive_folders`
  en la activación si está vacía.
- `class-rest-api.php`:
  - `check_permission($request)` añade fallback Bearer.
  - `cliente_config` añade campo `refs_drive` en la respuesta con
    `root_folder_id` + `cliente_folder`.
- `class-claude-widget.php`: `build_context` añade `clienteSlug` y
  `driveRefs` al objeto JS localizado.
- `admin/js/claude-widget.js`: `buildMessage` inyecta bloque
  "🚨 REFS VISUALES — REGLA CRÍTICA" cuando `tipo=imagen`.
- `admin/js/dashboard.js`: `nvGenerarImagenesConClaude` inyecta el mismo
  bloque tras el bloque de modelo, antes de "LO QUE QUIERO QUE HAGAS".

### Compatibilidad

- 100% backward-compatible. Si no defines `NV_API_TOKEN`, el plugin
  funciona idéntico a v1.0.16.
- La opción `nv_dashboard_refs_drive_folders` se pre-rellena solo si está
  vacía — si ya la habías configurado, se respeta.
- El bloque de refs Drive solo aparece en mensajes de revisión `tipo=imagen`
  o en "Generar imágenes con Claude". Otros tipos (copy, hashtags, estrategia)
  no se ven afectados.
