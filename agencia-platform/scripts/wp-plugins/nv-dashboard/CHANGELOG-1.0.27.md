# NV Dashboard v1.0.27

Casillas clickeables de estilo de imagen + branding por cliente
+ post-procesado real con logos y textos compuestos.

## Por qué

En v1.0.26 las imágenes se generaban pero salían genéricas: sin logos,
sin textos relevantes, sin elementos de marca. La razón es que gpt-image-2
es text-to-image puro — no incorpora archivos de logo y al pedirle texto
lo escribe con typos (~30% en español para palabras >8 letras).

Solución: **post-procesado server-side con PHP/GD**. La IA genera el
fondo limpio, y el plugin compone encima logo + textos generados por
Anthropic + dato + CTA usando una fuente real (sin typos).

## 6 casillas nuevas en el modal multi-cliente

Sección "🎨 Estilo de imagen", debajo del checkbox de "Generar también
la imagen":

| Casilla | Default | Qué hace |
|---|---|---|
| 🏷️ Añadir logo corporativo | ✅ | Compone el logo del cliente sobre la imagen, 18% de ancho, esquina configurable |
| 📝 Añadir titular sobre la imagen | ✅ | Anthropic genera headline 4-8 palabras, se compone con la fuente del cliente, banda oscura semi-transparente |
| 📊 Añadir dato destacado | ☐ | Anthropic genera cifra/hito breve, se compone como banda dorada inferior izquierda |
| 🚀 Añadir CTA visible | ☐ | Anthropic genera call-to-action 1-3 palabras, se compone como botón dorado inferior central |
| 💛 Tipo emotivo | ☐ | Modifica el prompt de imagen hacia tono cálido, humano, conexión emocional |
| 🛒 Tipo comercial | ☐ | Modifica el prompt hacia tono comercial, producto en primer plano, energía dinámica |

Las dos primeras vienen marcadas por defecto (lo más útil).
Tono emotivo y comercial son mutuamente compatibles pero raramente útiles
a la vez — la IA los mezcla.

## Sección "🎨 Branding" en el formulario de cada cliente

Editorial → Clientes → editar → bajo el bloque "📝 Brief de marca":

- **Logo corporativo**: media uploader WP nativo. Recomendado PNG con
  transparencia, mín 400px. Si subes JPG con fondo blanco, se verá feo
  en imágenes oscuras.
- **Posición del logo**: 4 opciones (esquinas). Default: inferior derecha.
- **Fuente personalizada**: TTF u OTF. Si subes la fuente del logo,
  los textos compuestos serán visualmente consistentes. Si no subes
  ninguna, se usa **Poppins Bold** (incluida en el plugin).

El plugin permite ahora subir TTF/OTF a la Media Library de WP (por
defecto WP los rechaza).

## Composición técnica

Server-side con PHP GD (FreeType para texto). 4 elementos por imagen:

1. **Logo**: redimensionado a 18% del ancho, posicionado en la esquina
   elegida, con margen del 3.5%, alpha preservado (PNG con transparencia
   se respeta).
2. **Titular** (zona superior, 10% desde arriba): texto en blanco con
   sombra suave + banda oscura semi-transparente detrás para legibilidad.
   Tamaño: 5.5% de la altura. Wrapping automático en líneas si excede
   85% de ancho.
3. **Dato destacado** (zona 85% desde arriba): banda dorada NV (#D2A039)
   con texto negro alineado a la izquierda. Tamaño: 3.8% de altura.
   Máximo 55% de ancho.
4. **CTA visible** (zona 93% desde arriba): "botón" centrado en dorado
   #D2A039, texto blanco en MAYÚSCULAS, padding extra. Tamaño: 4.5%
   de altura.

Todos los textos pasan por el helper `wrap_text_for_imagettf` que parte
en líneas usando `imagettfbbox` para medir ancho real.

## Modificaciones del prompt de gpt-image-2

Cuando hay logo o texto activos, el prompt incluye instrucciones
explícitas para que la IA deje **espacio limpio** en las zonas donde
irán los overlays:

> IMPORTANTE: deja espacio limpio (sin sujeto principal ni elementos
> competidores) en la zona inferior derecha (15% del área) para
> superponer un logo, y en la franja superior central (20% de altura)
> para superponer un titular.

Y siempre se pide a la IA que **no escriba texto en la imagen**
("NO incluyas texto, letras, palabras, números ni marcas de agua").

Cuando hay tono emotivo activo:

> Tono visual: cálido, humano, emocional. Uso de luz suave dorada,
> expresiones afectivas, cercanía. Evita objetos comerciales o de venta.

Cuando hay tono comercial:

> Tono visual: comercial, producto en primer plano, energía dinámica,
> colores vibrantes, sensación de oferta o llamada a actuar.

## Aviso si falta logo o fuente

Si pides logo y el cliente no tiene logo subido, el endpoint devuelve
`overlay_warnings` con el motivo concreto:

> Logo solicitado pero el cliente no tiene logo subido (Editorial →
> Clientes → editar → 🎨 Branding)

La imagen sigue generándose con los demás overlays disponibles. No
falla la operación entera por un overlay faltante.

## Cambios técnicos

- `nv-dashboard.php`: 1.0.26 → 1.0.27.
- `assets/fonts/Poppins-Bold.ttf`: nueva, fuente por defecto (~156KB).
- `includes/class-cliente-meta.php`:
  - 4 nuevos métodos: `get_logo_attachment_id`, `get_logo_position`,
    `get_font_attachment_id`, `get_font_path` (con fallback a Poppins),
    `get_logo_path`.
  - Sección "🎨 Branding" en `render_form_fields` con media uploaders
    via `wp_enqueue_media()` + JS inline para los frames `wp.media`.
  - Save handler para los 3 campos nuevos.
  - Filter `upload_mimes` para permitir TTF/OTF en la Media Library.
- `includes/class-rest-api.php`:
  - `publicaciones_multi_cliente`: lee 6 nuevos parámetros img_opts,
    los persiste como `_nv_img_opts` post_meta para que la fase 2 los
    lea, y los pasa a Anthropic.
  - `generar_copy_para_cliente`: nuevo argumento `$img_opts` que
    condiciona el JSON pedido (incluye headline / dato_destacado /
    cta_visible solo cuando sus checkboxes están activos).
  - `generar_imagen_publicacion`:
    - Lee img_opts del body o de `_nv_img_opts` meta.
    - Modifica el prompt de gpt-image-2 según tone_emotivo /
      tone_comercial / espacio limpio para overlays.
    - Tras generar, invoca `composite_overlays_on_image` con logo,
      headline, dato y cta.
    - Devuelve `overlay_warnings` con motivos de overlays faltantes.
  - 3 helpers privados nuevos:
    - `composite_overlays_on_image($base_path, $opts)`: GD-based
      compositing.
    - `draw_text_with_band($img, $text, $font, $opts)`: dibuja texto
      con banda de fondo opcional + sombra.
    - `wrap_text_for_imagettf($text, $font, $size, $max_width)`:
      word wrap usando `imagettfbbox`.
- `admin/views/editorial.php`: nueva fila `nv-mc-img-style-row` con
  6 checkboxes en grid 2 columnas.
- `admin/js/dashboard.js`: recoge `imgOpts` de los checkboxes y los
  envía en ambas fases.

## Compatibilidad

- 100% backward compatible con v1.0.26.
- Las imágenes generadas en v1.0.26 (sin overlays) siguen tal cual.
- Si pides regenerar una imagen vieja con `force: true`, se regenera
  CON overlays usando los meta del post (que probablemente están vacíos
  porque se creó antes de v1.0.27). Para que tenga headline/dato/cta,
  hay que repetir el flow multi-cliente desde cero o editar manualmente
  los meta del post.

## Verificación post-instalación

### Setup inicial (5 min, una vez)

1. Activa v1.0.27.
2. Editorial → Clientes → editar **Clínica March**.
3. Baja a "🎨 Branding". Click "📷 Seleccionar / subir logo", sube el
   PNG del logo de Clínica March. Selecciona posición.
4. (Opcional) "🔤 Seleccionar / subir fuente". Si tienes la fuente
   corporativa de la clínica, súbela. Si no, salta.
5. Guarda. Repite para los demás clientes (Negocio Vivo, Aquaking…).

### Test del flow completo

1. Editorial → 🎯 Publicación multi-cliente.
2. Marca 1 cliente que tenga logo subido.
3. Tema corto: "Día de la madre — felicitación cálida".
4. Verifica que están marcados:
   - ✅ Generar también la imagen (medium)
   - ✅ Añadir logo corporativo
   - ✅ Añadir titular sobre la imagen
   - ☐ El resto
5. (Opcional) marca "💛 Tipo emotivo" para este caso.
6. 🚀 Generar.
7. Espera ~50s (10s fase 1 + 35s fase 2).
8. La miniatura del resultado debe mostrar la imagen generada **con el
   logo en la esquina y un titular en la parte superior**.
9. Si falta logo en la imagen pero pediste logo, mira el aviso amarillo
   en la tarjeta — ahí estará el motivo (típicamente: "el cliente no
   tiene logo subido").

### Test con overlays adicionales

1. Repite el flow marcando también:
   - ☑️ Añadir dato destacado
   - ☑️ Añadir CTA visible
2. La imagen final debe tener: logo (esquina), titular (arriba), dato
   destacado (banda dorada inferior izquierda), CTA (botón dorado abajo
   centro).

## Limitaciones conocidas

- Si tu hosting no tiene GD compilado con FreeType (raro pero pasa en
  algunos VPS muy básicos), el endpoint devolverá `no_gd` en
  `overlay_warnings` y la imagen se entrega sin overlays. El logo
  tampoco se compone porque `imagecreatefrompng` requiere GD también.
  Si tu hosting es decente (SiteGround, Kinsta, WP Engine, Bluehost,
  Hostinger…) GD viene de serie con FreeType.
- WebP está soportado pero requiere `imagewebp` (PHP 7.0+ con GD ≥ 2.1).
- Las fuentes con caracteres no latinos extendidos pueden mostrar
  glifos faltantes. Para español, Poppins-Bold cubre todo (incluyendo
  ñ, tildes y signos de puntuación dobles ¿¡).
- El logo se redimensiona a 18% del ancho. Para logos muy alargados
  horizontalmente puede quedar pequeño. En esos casos, sube una
  versión cuadrada del logo (con padding transparente) — se verá mejor.
