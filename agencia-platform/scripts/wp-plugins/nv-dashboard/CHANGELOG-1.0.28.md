# NV Dashboard v1.0.28

Imágenes de referencia visual por cliente — Claude las analiza para
extraer el ADN visual de la marca e inyectarlo en cada generación.

## El problema con v1.0.27

El logo y los textos compuestos resolvían la branding visible, pero la
imagen base (la que pinta gpt-image-2) seguía siendo genérica: sin la
paleta cromática de la marca, sin el estilo fotográfico del cliente,
sin el "look and feel" propio. La razón es técnica:

- gpt-image-2 es text-to-image puro. **No puede mirar imágenes**.
- Por mucho que escribas un brief de marca textual, "tono cálido y
  profesional" significa cosas muy distintas para cada cliente.
- La única forma de transmitir un estilo visual concreto es darle
  parámetros precisos (colores hex, tipo de luz, composición, mood)
  que el generador entiende.

## La solución: Claude vision como intérprete

Claude Sonnet 4.5 sí es vision-capable. El flujo nuevo:

1. Subes 3-10 imágenes de referencia por cliente (posts existentes,
   fotos del cliente, ejemplos de competencia que te gusten…).
2. Cuando se genera una publicación, **Anthropic recibe las refs** + el
   brief y produce los outputs habituales (copy, hashtags, headline…)
   más uno nuevo: **`image_style_guide`** — descripción precisa en
   inglés de paleta exacta (colores hex que Claude identifica),
   tipografía visible, estilo fotográfico, composición, mood.
3. Ese style guide se inyecta automáticamente en el prompt de
   gpt-image-2 con la etiqueta "CRITICAL VISUAL STYLE GUIDE (extracted
   from client reference images, follow it precisely)".

Resultado: la imagen generada respeta la paleta y el estilo reales del
cliente sin que tú tengas que escribir nada manual. Tampoco hace falta
pre-extraer un style guide "fijo" del cliente — cada generación mira
las refs frescas, y el guide se adapta al tema concreto si conviene.

## Sección "📚 Imágenes de referencia visual" en el formulario de cliente

Editorial → Clientes → editar → bajo "🎨 Branding":

- **Grid de thumbnails** con las refs subidas. Botón ❌ rojo en cada
  una para quitar.
- Botón "📷 Añadir imágenes de referencia" abre el media uploader
  nativo de WP en modo multi-select. Subes varias de golpe, se añaden
  al grid sin recargar.
- Contador en vivo: "*N imágenes actualmente (recordar guardar)*".

Las imágenes se guardan como term meta `nv_reference_images` (JSON
array de attachment IDs). El plugin verifica al leer que cada ID sigue
existiendo en la Media Library.

## Procesamiento server-side de las refs

Cuando se envían a Claude:
- Máximo 5 refs por llamada (suficiente para extraer estilo, controla
  coste de tokens).
- Cada imagen se redimensiona a 1024px lado largo con GD.
- Conversión a JPEG calidad 80 antes de base64 (más compacto).
- Se envían como content blocks tipo `image` en el array de mensajes
  de la Anthropic Messages API.

Coste estimado por llamada (con 5 refs):
- ~10K input tokens (refs + brief + prompt)
- ~600 output tokens
- Sonnet 4.5: ~$0.04 por cliente con vision

Para flow multi-cliente de 10 clientes con refs: **~$0.45 en Anthropic
+ $0.50 en gpt-image-2 = ~$1 por flow completo**. Sigue siendo barato.

## Tiempos

La llamada Anthropic con vision tarda ~3-5s más que sin vision (procesar
imágenes). El timeout del helper se sube de 90s a 120s para tener
margen. En el flow multi-cliente:

- Sin refs: Fase 1 ~10s/cliente, Fase 2 ~25s/cliente
- Con refs: Fase 1 ~14s/cliente, Fase 2 ~25s/cliente

Diferencia despreciable y la mejora visual lo compensa con creces.

## Compatibilidad

- 100% backward compatible con v1.0.27.
- Si un cliente NO tiene refs, todo funciona como antes (sin
  `image_style_guide`).
- Si lo tiene, se inyecta automáticamente en cada generación.
- Las publicaciones generadas con v1.0.27 (sin style guide) siguen tal
  cual. Si las regeneras con v1.0.28, ya tendrán style guide si el
  cliente tiene refs.

## Cambios técnicos

- `nv-dashboard.php`: 1.0.27 → 1.0.28.
- `includes/class-cliente-meta.php`:
  - 2 nuevos métodos: `get_reference_images($term_id)` (devuelve array
    de IDs validados) y `get_reference_images_data($term_id)` (devuelve
    array de `{id, thumb, full}` para render).
  - Sección "📚 Imágenes de referencia visual" en `render_form_fields`
    con grid de thumbnails + botón uploader (multi-select) + JS para
    añadir/quitar tiles + sync con hidden input CSV.
  - Save handler para `nv_reference_images` desde input CSV.
- `includes/class-rest-api.php`:
  - Nuevo helper privado
    `prepare_reference_images_for_anthropic($term_id, $max=5)`:
    carga refs, resize a 1024px con GD, convierte a JPEG q80, devuelve
    array de content blocks tipo `image`.
  - `generar_copy_para_cliente`:
    - Llama al helper para obtener refs.
    - Si hay refs, modifica el system_prompt para mencionar la tarea de
      extraer estilo, añade un párrafo en el user prompt avisando de
      las refs adjuntas, y pide un campo extra `image_style_guide` en
      el JSON.
    - Construye `messages[0].content` como array (texto + imágenes)
      cuando hay refs, o como string legacy cuando no.
    - Timeout sube a 120s para acomodar latencia de vision.
  - Devolución incluye `image_style_guide`.
  - `publicaciones_multi_cliente` persiste `_nv_image_style_guide`
    como post_meta junto al resto de extras.
  - `generar_imagen_publicacion` lee el post_meta y, si tiene
    contenido, lo inyecta en el prompt de gpt-image-2 con la etiqueta
    "CRITICAL VISUAL STYLE GUIDE".

## Verificación post-instalación

### Setup inicial (5-10 min, una vez por cliente)

1. Activa v1.0.28.
2. Editorial → Clientes → editar **Clínica March**.
3. Baja a "📚 Imágenes de referencia visual".
4. Click "📷 Añadir imágenes de referencia".
5. Sube 5-10 imágenes representativas del estilo de Clínica March:
   - 2-3 fotos del Dr. Torres y Rochar (estilo de retrato corporativo).
   - 2-3 de las instalaciones (estilo de fotografía de espacios).
   - 1-2 posts existentes que te gustaron de la clínica.
   - 1-2 ejemplos de competencia o referentes que te encantaron y que
     queréis emular.
6. Guarda. Repite para los demás clientes que vayas a usar en
   multi-cliente.

### Test del flow

1. Editorial → 🎯 Publicación multi-cliente.
2. Marca **1 cliente que tenga refs subidas** (Clínica March).
3. Tema corto: "Test ADN visual — generación con refs".
4. Mantén checkboxes habituales (logo, titular).
5. 🚀 Generar.
6. Espera ~50s (la fase 1 va ahora a ~14s por la latencia de vision).
7. **Compara la imagen resultante con las refs**: la paleta de colores,
   la luz, el tipo de composición y la sensación general deberían
   parecerse mucho más al estilo del cliente que en v1.0.27.

### Comprobar el style_guide generado

Si quieres ver lo que Claude extrae internamente:
- WP Admin → Publicaciones → editar la publicación creada.
- En la consola de DevTools del navegador, ejecuta:
  ```js
  fetch('/wp-json/wp/v2/nv_publicacion/<POST_ID>?context=edit')
    .then(r => r.json())
    .then(d => console.log(d.meta._nv_image_style_guide))
  ```
- Verás algo como: *"Primary palette: #2A4D6E warm navy, #D2A039 gold
  accent, #F5F1E8 cream background. Soft natural lighting, shallow
  depth of field. Centered subjects, ample negative space. Mood:
  warm, professional, aspirational, slightly aspirational..."*

## Limitaciones conocidas

- Sin GD compilado con FreeType en el hosting, las refs no se pueden
  redimensionar y se omiten — la generación funciona pero sin
  style_guide. (Mismo requisito que v1.0.27 para el compositing.)
- Anthropic limita la API a imágenes de hasta 5MB cada una. El
  redimensionado a 1024px las deja muy por debajo de ese umbral
  (típicamente <300KB en JPEG q80).
- La calidad del style_guide depende mucho de la calidad de las refs.
  Si subes 5 fotos borrosas de móvil, Claude no podrá extraer una
  paleta clara. Sube imágenes nítidas y representativas.
- Las refs se reenvían en cada generación (no hay caché). Para flows
  de 10 clientes con 5 refs cada uno son ~50 imágenes uploaded a
  Anthropic. La latencia de red puede notarse — dale margen.
