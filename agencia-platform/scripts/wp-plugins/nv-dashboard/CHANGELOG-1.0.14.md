# NV Dashboard v1.0.14

## Novedades

### 1. Shortcode `[nv_dashboard]` — calendario embebible en cualquier página

Crea una página WordPress, pega el shortcode y el calendario aparece embebido:

```
[nv_dashboard]
[nv_dashboard cliente="aquaking"]
[nv_dashboard cliente="negocio-vivo" vista="editorial" mes="2026-05" height="1400"]
[nv_dashboard vista="overview"]
[nv_dashboard cliente="aquaking" aprobacion="0"]
```

**Atributos**:
- `cliente`: slug del cliente (default `all`)
- `vista`: `editorial` | `overview` (default `editorial`)
- `mes`: `YYYY-MM` (default mes actual)
- `height`: altura del iframe en px (default `1200`)
- `aprobacion`: `1`|`0` mostrar botón aprobación rápida (default `1`)

El shortcode renderiza un iframe que apunta a la URL pública existente
(`/nv-dashboard/`), evitando conflictos CSS/JS con el tema activo.

### 2. Botón de aprobación rápida sobre cada publicación del calendario

Sin abrir el detalle. Click en el círculo `○` de la esquina del evento
para aprobar (pasa a `✓` verde). Click de nuevo para desaprobar.

- Optimistic UI con feedback (toast)
- Solo visible para usuarios con permiso `edit_posts`
- Funciona en vista mes y vista lista
- Actualiza el contador del approve bar en tiempo real
