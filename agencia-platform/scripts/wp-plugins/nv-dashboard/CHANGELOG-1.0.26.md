# NV Dashboard v1.0.26

Fix del error "Unexpected token '<'" en la generación multi-cliente con imagen.

## El problema

En v1.0.25, con la opción "✨ Generar también la imagen" activada y varios
clientes seleccionados, el modal devolvía:

> ❌ Error de red: Unexpected token '<', "..."

Ese error es la firma clásica de **timeout PHP**: el servidor mata la
petición a los 60-120 segundos (límite estándar de la mayoría de hostings),
devuelve la página HTML del error de Apache/nginx, y el JS al intentar
parsearla como JSON encuentra el `<` del `<html>` y peta.

La causa: el endpoint v1.0.25 hacía **toda la operación en una sola
petición HTTP** — para cada cliente: llamada a Anthropic (~10s) +
llamada a OpenAI image gen (~25s) = ~35s/cliente. Para 5 clientes son
~3 minutos, encima del límite del hosting.

`@set_time_limit(900)` no soluciona porque la mayoría de hostings (sobre
todo gestionados como SiteGround, WP Engine, Kinsta…) tienen esa función
deshabilitada por seguridad — el límite real es el de Apache/nginx que
no se puede cambiar desde PHP.

## La solución: dos fases

Refactor de la arquitectura del flujo multi-cliente:

### Fase 1 — Crear posts (rápido)

El endpoint `POST /publicaciones-multi-cliente` ahora **solo hace Anthropic
+ crear posts**. Sin imágenes. Tiempo: ~10s por cliente, ~50s para 5
clientes. Cómodamente bajo cualquier timeout.

### Fase 2 — Generar imágenes (paralelo, JS-driven)

Después de la Fase 1, el JS itera por cada post creado y llama al
endpoint independiente `POST /generar-imagen-publicacion/{id}` (que ya
existía en v1.0.25). **3 imágenes en paralelo** para acelerar sin saturar.

Cada imagen es una petición HTTP independiente de ~25s. Imposible que
dé timeout, ni siquiera en hostings agresivos. Si una falla, las demás
siguen su curso.

### Tiempos resultantes

| Clientes | v1.0.25 (1 petición) | v1.0.26 (fase 1 + fase 2 paralelo) |
|---|---|---|
| 3 | ~105s ❌ timeout | ~30s + ~25s = 55s ✅ |
| 5 | ~175s ❌ timeout | ~50s + ~50s = 100s ✅ |
| 10 | ~350s ❌ imposible | ~100s + ~85s = 185s ✅ |
| 15 | imposible | ~150s + ~125s = 275s ✅ |

## Mejoras adicionales en el UI

### Detección de HTML en respuesta

Si el servidor sigue devolviendo HTML por algún motivo en la Fase 1,
el JS ahora **detecta y muestra un mensaje claro**:

> ❌ El servidor devolvió HTML en vez de JSON (probablemente timeout
> PHP del hosting). HTTP 504. Snippet: …
>
> Sugerencias:
> • Reduce a 3-5 clientes por lote
> • Pide al hosting que suba `max_execution_time` a 300s

Antes solo veías "Unexpected token '<'" sin contexto.

### Progreso en tiempo real

Durante la Fase 2 ves:

> ⏳ Fase 1 OK · Fase 2/2: generando imágenes en paralelo (3 a la vez)…
> **3 / 5** imágenes procesadas · **2 OK** · **1 fallidas**

El contador se actualiza cada vez que termina una imagen.

### Render con miniaturas

El resumen final muestra una grid de tarjetas, una por cliente, con la
imagen generada visible directamente (preview real). Si una falló, ves
el cuadro rojo discontinuo con el motivo concreto.

## Cambios técnicos

- `nv-dashboard.php`: 1.0.25 → 1.0.26.
- `includes/class-rest-api.php`:
  - `publicaciones_multi_cliente`: timeout reducido a 180s (suficiente
    para la fase 1). Default de `generate_image` cambiado a `false`
    (la JS no envía el flag, server-side ya no llama a OpenAI).
  - El parámetro `generate_image` se mantiene por compat con llamadas
    directas a la API que quieran el flujo todo-en-uno (no recomendado
    para más de 3 clientes).
- `admin/js/dashboard.js`:
  - `nvLanzarMultiCliente` reescrita con dos fases independientes.
  - Detección de respuesta HTML y mensaje de error específico.
  - Worker pool con concurrencia 3 para Fase 2.
  - Render de progreso en tiempo real en Fase 2.
- `admin/views/editorial.php`: descripción del modal actualizada para
  reflejar la nueva arquitectura.

## Compatibilidad

- 100% backward compatible con v1.0.25 a nivel de datos. Las
  publicaciones que creaste antes siguen como están.
- El endpoint `/publicaciones-multi-cliente` sigue aceptando
  `generate_image: true` en su body (para automatizaciones externas vía
  Make o similar). Pero el JS del plugin ya no lo envía — siempre va
  por las dos fases.

## Verificación post-instalación

1. Activa v1.0.26.
2. Editorial → 🎯 Publicación multi-cliente.
3. Marca 3 clientes y un tema corto, "✨ Generar también la imagen"
   marcado, calidad medium.
4. 🚀 Generar.
5. Debes ver dos fases distintas:
   - Fase 1: "creando 3 publicaciones con copy IA"
   - Fase 2: "Fase 2/2: generando imágenes en paralelo (3 a la vez)…"
     con contador "X / 3 imágenes procesadas".
6. Al terminar: tarjetas con miniaturas reales en el resumen.
7. Cierra y recarga calendario. Las 3 publicaciones aparecen en su día
   con la imagen como portada.

## Si aún ves "Unexpected token '<'" en la Fase 1

Significa que ni siquiera la Fase 1 (~50s para 5 clientes) cabe en el
límite del hosting. Soluciones:

1. **Reduce el lote**: 2-3 clientes por ejecución. Repite el flujo
   varias veces.
2. **Pide al hosting que suba `max_execution_time` a 300s** (es lo
   estándar para WP con plugins serios). Si están en SiteGround o
   similar, el técnico de soporte lo cambia en 5 min.
3. **Comprueba si tienes un firewall/CDN delante** (Cloudflare, etc.)
   que esté cortando peticiones largas. En Cloudflare, "Page Rules"
   permite excluir el endpoint `/wp-json/nv/v1/*` del timeout.
