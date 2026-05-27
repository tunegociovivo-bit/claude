# v1.0.52 — Texto sin biselado + layout "frame" estilo Guardamuebles Reva

## Lo que David reportó tras v1.0.51

> "1. Las refs visuales subidas no se reflejan en las generaciones (todas las
>     refs tienen franja verde corporativa + cápsulas de texto, pero las nuevas
>     creaciones son texto plano sobre la imagen).
>  2. No quiero textos con biselados de ningún tipo."

## Cambios

1. **Texto limpio sin biselado.** Eliminado el stroke contrastante de 8 direcciones
   que añadí en v1.0.51 para legibilidad. Pipeline minimal: sombra sutil + fill
   plano + faux-bold opcional. Para legibilidad sobre fondos contrastantes la
   solución correcta es el layout "frame" (cápsulas), no contornos de texto.

2. **Layout "frame" — replica el patrón visual del calendario editorial de
   Guardamuebles Reva:**
   - Triángulo diagonal en color primary del cliente, esquina superior derecha
   - Última palabra del nombre del cliente como logo en la franja, color
     contrastante con la luminancia del primary (negro sobre lima, blanco sobre
     azul oscuro, etc.)
   - Una cápsula independiente por cada `headline_lines` con fondo opaco:
     · `color:white` → fondo negro semi-opaco, texto blanco
     · `color:accent` → fondo accent del cliente, texto contrastante
     · `color:primary` → fondo primary del cliente, texto contrastante
   - Apilado vertical en la zona inferior izquierda
   - Auto-fit del tamaño si el texto desborda la cápsula

3. **Selector "Patrón visual" en la ficha del cliente** (Editorial → Clientes
   → editar → 🎨 Branding):
   - `clean` (default): texto plano sobre la imagen, sin chrome
   - `frame`: triángulo diagonal + cápsulas (estilo Guardamuebles Reva)

4. **Persistencia y getters:**
   - `nv_visual_pattern` en term_meta del cliente
   - `NV_Cliente_Meta::get_visual_pattern($term_id)` con fallback a `clean`
   - El renderer ramifica entre `apply_clean_text_overlay` y `apply_frame_layout`
     según el valor

## Cómo activar el patrón frame para Guardamuebles Reva

1. Plugins → Desactivar NV Dashboard → Borrar → Subir
   `nv-dashboard-v1_0_52.zip` → Activar.

2. WP Admin → NV Dashboard → Editorial → Clientes → editar **Guardamuebles Reva**.

3. Scroll a 🎨 Branding → buscar **Patrón visual** (justo después de los colores
   corporativos) → seleccionar **🟩 Frame — franja diagonal + cápsulas**.

4. Guardar.

5. Volver al calendario, abrir cualquier post de Guardamuebles Reva con imagen,
   y pulsar **🔄 Re-aplicar texto**. Verás el patrón nuevo aplicado.

6. Si quieres que TODAS las imágenes nuevas que generes ya salgan con el frame,
   no hace falta nada más: cualquier post nuevo de ese cliente leerá la
   configuración automáticamente.

## Nota sobre las refs visuales y el prompt de imagen

Las refs visuales del cliente ya alimentan el `image_style_guide` cacheado que
se inyecta en el prompt de gpt-image-2 (paleta hex, mood, composición). Lo que
NO funcionaba antes es que esa guía se quedaba en una descripción textual y
gpt-image-2 no replicaba el chrome (franja+cápsulas) con precisión — porque la
AI compone visualmente "a sentimiento", no por geometría exacta.

La forma correcta de garantizar un patrón visual fiel al brief del cliente es
componerlo en post-procesado por PHP/GD, NO depender de que la AI lo replique.
Eso es exactamente lo que hace el layout `frame`.
