# v1.0.55 — Text Safe Zone explícita en el prompt de imagen

## Lo reportado por David

> "Hay que crear alguna regla para que los textos los sitúe siempre en la
> parte de la imagen que sea menos importante. En esta imagen ha puesto
> el texto justo encima de lo verdaderamente relevante de la imagen, cuando
> debería estar en la parte superior derecha donde no hay nada relevante."

Caso ejemplo: imagen de Clínica March con manos del cirujano (sujeto principal)
en la zona inferior izquierda, exactamente donde el plugin colocó el texto
"EL TOQUE HUMANO QUE MARCA MARCH".

## Diagnóstico

El bug NO está en el renderer (el texto se posiciona donde dice
`text_placement`). El bug está aguas arriba: **la regla en el prompt de
imagen era demasiado genérica** ("ample empty negative space at the bottom")
y gpt-image-2 igual metía el sujeto principal en la zona supuestamente
"reservada".

David lo dijo claro: "lo ideal es que el prompt que se envía para generar
la imagen ya lleve esa regla detallada". Eso es exactamente lo correcto.

## Fix v1.0.55 — TRES puntos del pipeline reforzados

### 1. System prompt de Phase 1 (Claude → image_prompt baked)

Cuando Claude piensa la publicación y construye el `image_prompt` que luego
se enviará a gpt-image-2, ahora recibe instrucciones MUCHO más detalladas:

- **Workflow obligatorio**: identificar sujeto → decidir tercio → text_placement
  = tercio opuesto → escribir image_prompt con la text safe zone como
  instrucción de composición DURA, no opcional.
- **Plantillas de redacción** en inglés para cada placement (top/center/bottom)
  con vocabulario específico ("visually quiet", "out-of-focus", "shallow depth
  of field with that area defocused", etc.).
- **Anti-patrón explícito**: la AI sabe ahora que escribir solo "ample empty
  negative space at the bottom" no funciona, y se le exige PROHIBIR
  explícitamente sujetos / caras / manos / elementos focales en esa zona.

### 2. Builder fallback (cuando NO hay image_prompt baked)

`build_image_prompt_for_multi_cliente()` ahora recibe `$text_placement` y
genera la text safe zone con detalle según el valor:

- **bottom**: "BOTTOM 35% must be visually empty... STRICTLY NO subjects, NO
  faces, NO hands, NO product close-ups, NO focal elements, NO readable
  signage, NO logos, NO objects in that bottom 35%."
- **top**: equivalente en zona superior.
- **center**: wide shot con sujeto a un lado y centro horizontal vacío.

Cierra siempre con "This text safe zone rule overrides any other compositional
preference. If in doubt, prioritize keeping the safe zone empty over filling
the frame."

### 3. Regenerate individual (post-by-post)

Dos mejoras:

- **Refuerzo automático en posts antiguos**: cuando se regenera un post cuyo
  `_nv_image_prompt` baked ya existe pero NO menciona la text safe zone, el
  plugin la añade automáticamente al final. Esto cubre todas las
  publicaciones generadas con versiones del system prompt anteriores a la 1.0.55.
- **Fallback** (cuando no hay baked): aplica la misma regla detallada del
  builder.

## Cómo verificar

1. Plugins → Desactivar/Borrar/Subir `nv-dashboard-v1_0_55.zip` → Activar.

2. **Verificación del fix en post existente** (Clínica March):
   - Abrir el post problemático (el del screenshot)
   - **NO** uses "🔄 Re-aplicar texto" — eso solo recompone el overlay sobre
     la imagen actual, que ya tiene el sujeto mal colocado. Para verificar
     este fix hay que REGENERAR la imagen.
   - Editar el post → en el editor → widget Claude → "Regenerar imagen". O
     si tienes el botón en el modal de preview, ese.
   - El nuevo prompt incluirá la text safe zone detallada y la imagen
     resultante debería respetarla.

3. **Verificación en post NUEVO**: lanza una publicación cualquiera (multi-
   cliente o generar-mes) y observa que la imagen tiene la zona reservada
   limpia y el texto cae en zona vacía.

## Lo que NO arregla v1.0.55

- Posts ANTIGUOS cuyas imágenes YA están generadas y no se vuelven a
  regenerar: el texto seguirá sobre el sujeto principal porque la imagen
  base no cambia. Solo regenerar la imagen aplica el fix.

- Casos donde gpt-image-2 simplemente desobedezca el prompt (puede pasar
  con escenas muy pobladas o cuando hay conflicto entre la text safe zone
  y la composición pedida). En esos casos hay que regenerar — un mejor prompt
  reduce drásticamente la frecuencia pero no la elimina al 100%.

- Honestidad: no he medido cuánto reduce la tasa de fallo. Con prompts
  específicos suele ser un salto cualitativo grande, pero conviene observar
  varias generaciones antes de declarar victoria.

## Pendiente del hilo anterior

Sigues con `nv-dashboard-v1_0_54.zip` instalado (pre-requisitos para reels).
Cuando me pegues el JSON del botón **🔍 Verificar pre-requisitos**, arranco
la Fase 1 del pipeline de reels.
