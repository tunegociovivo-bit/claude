# NV Dashboard v1.0.23

## 🎯 Publicación multi-cliente — workflow estacional

Funcionalidad nueva pedida en la conversación de v1.0.22: poder crear una
misma publicación (día de la madre, navidad, black friday, etc.) en varios
clientes a la vez, con copy adaptado por IA al brief de cada uno.

### Cómo funciona

1. **NV Dashboard → Editorial** → botón nuevo "🎯 Publicación multi-cliente"
   (visible siempre, también cuando estás en "todos los clientes").
2. Modal pide:
   - **Fecha y hora** (la fecha pre-rellena automáticamente con el próximo
     domingo, que es el caso uso típico para este flow).
   - **Tipo de contenido**: imagen / reel / carrusel / story / vídeo.
   - **Redes sociales**: checkboxes (Facebook + Instagram marcadas por defecto).
   - **Tema/brief**: textarea libre. Ejemplo: *"Día de la madre — felicitación
     cálida y emotiva, no comercial. Llamada a apreciar a las madres."*
   - **Clientes**: lista con checkbox por cliente. Botones "Todos / Ninguno"
     arriba. Los clientes sin Brief de marca aparecen con ⚠️ amarilla.
   - **Saltar duplicados**: checkbox marcado por defecto. Si un cliente ya
     tiene una publicación en esa fecha exacta, no la pisa.
3. Click "🚀 Generar publicaciones".
4. El backend, para cada cliente seleccionado:
   - Llama a Anthropic API (Claude Sonnet 4.5) con el brief de marca + el
     tema del usuario. Genera **copy adaptado al tono del cliente** + 12-15
     hashtags + sugerencia visual.
   - Crea un borrador de `nv_publicacion` con todo relleno: fecha, tipo,
     redes, copy, hashtags, sugerencia visual, asignado al cliente.
   - Te lo deja como **borrador**, no se publica solo. Tú revisas y apruebas.
5. El modal muestra resumen: creadas (con link a editar), saltadas (con motivo),
   errores. "Cerrar y recargar calendario" actualiza la vista para que veas
   los nuevos eventos en su día.

### Coste y tiempo

- Tiempo: ~5-10 segundos por cliente (llamada Anthropic). Para 5 clientes
  ~30s, para 10 clientes ~1 min. El backend procesa secuencial para que
  errores en uno no rompan los demás.
- Coste estimado con Sonnet 4.5: ~$0.005-0.01 por publicación (input largo
  por el brief, output mediano). Para 10 publicaciones del día de la madre
  son ~$0.10.
- Si un cliente falla la llamada AI, se crea el borrador igual pero vacío,
  con el motivo del error guardado en la respuesta. Puedes editarlo a mano
  o reintentar solo ese cliente.

### Sin Anthropic key configurada

Si no hay key en NV Dashboard → Configuración → Anthropic API, el plugin
crea los borradores con la fecha/tipo/redes correctos pero **sin copy ni
hashtags**. Tendrás que rellenarlos a mano o usar el widget Claude por
publicación. La operación se completa igual, no falla.

## 📝 Brief de marca (term meta nuevo, opcional)

Campo nuevo en el formulario de cliente (Editorial → Clientes → editar):

> Posicionamiento, tono y audiencia. Se usa para adaptar el copy generado
> por IA. Opcional pero muy recomendado.

Es un textarea libre. Sugerencia de qué incluir:
- Sector / nicho específico
- Tono de voz (formal, casual, técnico, comercial, cercano…)
- Audiencia objetivo (edades, ubicación, perfil)
- Eslóganes o frases recurrentes
- Cosas a EVITAR (lenguaje, comparaciones, temas sensibles)

Ejemplo para Clínica March:

```
Clínica de medicina estética y cirugía plástica en Marbella, Costa del Sol.
Tono cálido, profesional y cercano. Audiencia: mujeres 30-55 años con poder
adquisitivo medio-alto, residentes en Costa del Sol o turistas. Eslogan:
"En Clínica March cuidamos de ti". Evitar: lenguaje agresivo de venta,
comparaciones con otras clínicas, antes/después de pacientes sin consentimiento
RGPD verificado.
```

Cuanto más concreto el brief, mejor adaptación AI. Sin brief, la AI infiere
del nombre del cliente — funciona pero con menos precisión.

## Cambios técnicos

- `nv-dashboard.php`: bump 1.0.22 → 1.0.23.
- `includes/class-cliente-meta.php`:
  - Nuevo método `get_brand_brief($term_id)`.
  - Render de textarea "📝 Brief de marca" en `render_form_fields`.
  - Save handler en `save_term_meta` (con `delete_term_meta` si vacío).
- `includes/class-rest-api.php`:
  - Nuevo endpoint `POST /publicaciones-multi-cliente`.
  - Handler `publicaciones_multi_cliente($request)` (~120 LOC):
    valida inputs, itera clientes, llama AI por cada uno, crea posts.
  - Helper privado `find_existing_publication($term_id, $fecha)` para
    detectar duplicados.
  - Helper privado `build_titulo_multi_cliente($tema, $cliente_name)`
    que extrae el primer fragmento útil del tema antes de "—" o "."
    para titular limpio.
  - Helper privado `generar_copy_para_cliente(...)` que llama a Anthropic
    con el system+user prompt, parsea JSON tolerante (acepta ```json fences```).
- `admin/views/editorial.php`:
  - Botón "🎯 Publicación multi-cliente" siempre visible (fuera del
    condicional `cliente_actual === 'all'`).
  - Modal con form completo (fecha, hora, tipo, redes, tema, lista
    clientes con checkbox y warning si falta brief, skip duplicados).
  - Aviso en el banner "selecciona un cliente" mencionando el flow nuevo.
- `admin/js/dashboard.js`: handlers
  - `nvAbrirMultiCliente()`: abre modal, pre-rellena fecha próximo domingo.
  - `nvCerrarMultiCliente()`: cierra.
  - `nvMultiClienteToggleAll(checked)`: toggle todos los checkbox.
  - `nvLanzarMultiCliente()`: valida inputs, hace POST al endpoint, renderiza
    resultado con detalles plegables (creadas / saltadas / errores).

## Compatibilidad

- 100% backward compatible con v1.0.22.
- Si el campo Brief está vacío, el plugin usa "(sin brief específico —
  adapta el tono según lo que sugiera el nombre del cliente)" como fallback.
- Funciona sin OAuth Drive (la generación AI no toca Drive). Solo necesita
  la Anthropic API key, que ya estaba en uso desde v1.0.8 para `generar-mes-ai`.

## Verificación post-instalación

1. Activa v1.0.23.
2. Editorial → Clientes → editar Clínica March → comprueba que aparece el
   nuevo bloque "📝 Brief de marca". Pega un brief breve y guarda.
3. Repite para los otros clientes que vayas a usar en el flow multi-cliente.
4. Editorial → botón "🎯 Publicación multi-cliente" arriba.
5. Pon fecha = próximo domingo, hora = 12:00, tipo = imagen, redes = FB+IG,
   tema = "Día de la madre — felicitación cálida y emotiva", marca todos
   los clientes con brief, click "🚀 Generar publicaciones".
6. Espera ~30-60s. Resumen abajo del modal con links a editar cada borrador.
7. Click "Cerrar y recargar calendario". Verás los eventos del domingo
   en el calendario, en estado borrador.
8. Abre uno, revisa el copy. Si te gusta, marca aprobado y listo.
