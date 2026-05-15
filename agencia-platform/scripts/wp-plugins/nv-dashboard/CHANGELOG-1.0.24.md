# NV Dashboard v1.0.24

Dos ajustes pedidos tras probar v1.0.23.

## 📅 Las publicaciones aparecen en el calendario inmediatamente

Antes (v1.0.23): el endpoint multi-cliente creaba los posts con
`post_status = 'draft'`, así que no aparecían en el calendario hasta que
los aprobaras manualmente.

Ahora (v1.0.24): se crean con `post_status = 'publish'`, aparecen en el
calendario al instante para que los revises visualmente. **El estado
editorial sigue siendo `borrador`** (campo ACF `nv_estado`), así no se
disparan los flujos de Metricool ni nada hasta que tú apruebes
manualmente con el botón de aprobación.

Distinción importante en este plugin:

| Campo | Función | Multi-cliente v1.0.24 |
|---|---|---|
| `post_status` (WP) | Visibilidad en calendario | `publish` (aparece) |
| `nv_estado` (ACF) | Estado editorial real | `borrador` (pendiente revisión) |
| `nv_aprobar_metricool` (ACF) | Flag para CSV Metricool | `false` (no aprobado) |

Resultado: las ves todas en el calendario, las revisas visualmente, las
apruebas/editas/borras según convenga.

## 🖱️ Click en fecha vacía → publicación rápida para el cliente filtrado

Antes: el botón "🎯 Publicación multi-cliente" era el único punto de
entrada al flujo. Para una sola publicación urgente de un cliente
concreto, tenías que abrir el modal y desmarcar todos menos uno.

Ahora: hacer click en cualquier día vacío del calendario abre el mismo
modal con dos pre-rellenos automáticos:

1. **Fecha**: la del día clicado (campo de fecha ya rellenado).
2. **Cliente seleccionado**: si tienes un cliente filtrado en el dropdown
   superior del dashboard, ese cliente queda **único marcado** (resto
   desmarcados). Si tienes "Todos los clientes" filtrado, abre el modal
   normal sin tocar los checkboxes (puedes elegir manualmente).

UX:

```
Tienes "Clínica March" filtrada → click en "5 de mayo" del calendario
  → modal abierto con fecha=2026-05-05, solo Clínica March marcado
  → escribes el tema y click "🚀 Generar"
  → publicación creada y visible en el calendario en ~10s
```

```
Tienes "Todos los clientes" filtrado → click en "5 de mayo"
  → modal abierto con fecha=2026-05-05, sin checkboxes pre-marcados
  → marcas los clientes que quieras y procedes
```

## Pistas en la UI

- Texto "**o click directo en una fecha vacía del calendario**" junto al
  botón multi-cliente, para que el atajo sea descubrible.
- Tip extendido en la barra de acciones cuando estás filtrando un cliente:
  *"arrastra eventos para reprogramarlos · click en un día vacío para
  crear publicación rápida"*.

## Cambios técnicos

- `nv-dashboard.php`: bump 1.0.23 → 1.0.24.
- `includes/class-rest-api.php`:
  - `publicaciones_multi_cliente`: cambia `'post_status' => 'draft'` →
    `'post_status' => 'publish'`. Añade comentario explicando la
    distinción entre WP status y editorial status.
- `admin/js/dashboard.js`:
  - Nuevo handler `dateClick` en FullCalendar.
  - Nueva función global `nvAbrirMultiClienteParaFecha(fechaISO)` que
    pre-rellena fecha y filtra cliente según `window.nvCliente`.
- `admin/views/editorial.php`:
  - Pistas textuales junto al botón multi-cliente y en la barra de
    acciones por cliente.

## Compatibilidad

- 100% backward compatible con v1.0.23.
- Las publicaciones que creaste con v1.0.23 siguen estando en `draft`.
  Si quieres que aparezcan en el calendario, marca cada una manualmente
  como "publicada" (botón Publicar de WP) — solo afecta a las creadas
  antes de v1.0.24, no a las nuevas.

## Verificación post-instalación

1. Activa v1.0.24.
2. Editorial → click en cualquier día vacío del calendario.
3. El modal debe abrirse con la fecha rellenada en ese día.
4. Si tenías un cliente filtrado, debe aparecer ese único marcado.
5. Pon un tema corto, click 🚀 Generar.
6. Cierra el modal y recarga. La publicación debe aparecer YA en el
   calendario, en estado editorial "borrador" (no aprobada para Metricool).
