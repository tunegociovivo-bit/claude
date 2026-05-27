# v1.0.58 — Persona en escena (la cara del CEO sale cuando el copy lo pide)

## Por qué esta versión

Tras instalar v1.0.57, David generó un post con copy "Rochar te escucha, te cuida, te acompaña". Resultado: imagen de **dos manos**, sin Rochar. El plugin v1.0.57 funcionó técnicamente correcto, pero el problema era de raíz: la AI de Phase 1 (Anthropic) generaba el `image_prompt` priorizando "espacio para texto" e ignorando que el headline mencionaba al CEO.

Ejemplo del image_prompt que la AI propuso para ese post:

> "Close-up editorial photography of two women's hands in a gesture of trust and companionship... showing hands and lower forearms... no faces, no focal elements, reserved for text overlay"

Con un prompt así, daba igual que v1.0.57 pasara las fotos de Rochar como `image=` a OpenAI: el prompt EXPLÍCITAMENTE pedía manos sin caras, y OpenAI obedeció el prompt sobre las refs.

## Lo que cambia v1.0.58

**Una nueva regla en el system prompt de Phase 1** (función `build_image_prompt_for_multi_cliente`), insertada antes de la regla de Text Safe Zone:

```
g0) PERSONA EN ESCENA — REGLA CRÍTICA:

Si el copy o el headline_lines mencionan EXPLÍCITAMENTE a una persona
específica (nombre propio como Rochar, o roles como CEO, doctor/a,
fundador/a, director/a, especialista, cirujano/a) Y/O usan lenguaje
de atención directa primera persona ("te escucho", "te cuido",
"te atiende", "cuidamos de ti", "contigo"), entonces:

  · El sujeto principal de la escena DEBE ser esa persona (rostro
    visible, mirada hacia cámara o ligeramente desviada, expresión
    coherente con el copy).

  · NO sustituyas la persona por una escena alternativa (manos,
    instrumental, pasillo de clínica, instalaciones). Eso falsifica
    el mensaje del copy: si el copy dice 'Rochar te escucha',
    la imagen DEBE mostrar a Rochar, no a dos manos genéricas.

  · La text safe zone (g) sigue aplicándose: la persona ocupa el
    tercio opuesto al texto, no se solapan.

Si el copy NO menciona persona específica ni usa lenguaje de
atención directa, entonces sí puedes proponer escenas conceptuales
(instrumental, instalaciones, productos, manos en detalle) — esa
variedad es deseable cuando el copy lo permite.
```

Con esta regla, la AI de Phase 1 deberá generar un image_prompt que **incluya a Rochar visible en escena** cuando el copy lo mencione, en lugar de sustituirlo por manos. Cuando v1.0.57 detecte la persona y pase las refs a OpenAI, el prompt + las refs serán coherentes y la cara saldrá parecida a Rochar real.

## Mejora del endpoint de diagnóstico

El endpoint `GET /wp-json/nv/v1/test-imagen-publicacion/{id}` ahora devuelve los meta nuevos de v1.0.57 para diagnóstico:

- `meta.image_endpoint_used`: `"edits"` o `"generations"` (qué hizo el plugin)
- `meta.image_refs_used`: JSON array de attachment IDs pasados como ref a OpenAI
- `meta.image_refs_detection`: razones del heurístico (`["person_keyword:rochar"]` etc.)

Sin esta mejora, era imposible verificar desde fuera si v1.0.57 estaba ejecutándose correctamente.

## Lo que NO toca v1.0.58

- ✅ `generate_image_via_openai` (la del calendario, modificada en v1.0.57) — INTACTA
- ✅ Heurístico de detección de refs — INTACTO
- ✅ Overlays, layouts, brand colors — INTACTOS
- ✅ Endpoint `openai_image_proxy` (botón Claude post a post) — INTACTO

## Cambios técnicos exactos

`includes/class-rest-api.php`:

**1.** Función `build_image_prompt_for_multi_cliente` (~línea 2918): añadidas 7 líneas con la nueva regla `g0) PERSONA EN ESCENA` insertada antes del bloque `g) TEXT SAFE ZONE`.

**2.** Función `test_imagen_publicacion` (~línea 5196): añadidas 3 líneas en el array de meta para exponer `image_endpoint_used`, `image_refs_used`, `image_refs_detection`.

Total cambios: ~10 líneas añadidas en 2 puntos. Cero refactorizaciones.

## Aplicación

### Paso 1 — Subir e instalar
Plugins → Subir → `nv-dashboard-v1_0_58.zip` → Reemplazar → Activar.

### Paso 2 — Generar post de prueba
Calendario → 1 publicación nueva de Clínica March con copy mencionando "Rochar" o "te escucha".

### Paso 3 — Verificar diagnóstico
```
curl.exe -sS -u "info@negociovivo.com:TdPq gf8H fwYS qOCP RnEy Fjuf" "https://hub.negociovivo.com/wp-json/nv/v1/test-imagen-publicacion/{ID_NUEVO}"
```

En la respuesta `meta`:
- `image_endpoint_used` debe ser `"edits"` ← v1.0.57 funcionó
- `image_refs_used` debe contener IDs (ej: `[36, 37, 38]`) ← refs pasadas
- `image_refs_detection` debe contener `person_keyword:rochar` o similar
- `image_prompt` debe describir a una persona (no manos)

Si todos coinciden y la imagen aún no muestra a Rochar reconocible, entonces el problema queda en la capacidad de gpt-image-2 con `/edits` y habría que pasar a entrenar un LoRA específico (servicio externo, ~30-50€ una vez). Pero antes de ir ahí, esta versión debería resolver el caso normal.

## Coste

Ningún cambio sobre v1.0.57. El cambio del system prompt no afecta a costes
de OpenAI (Phase 1 sigue siendo Anthropic Claude, mismo modelo). Phase 2
puede ir por `/edits` o `/generations` según el heurístico de v1.0.57.
