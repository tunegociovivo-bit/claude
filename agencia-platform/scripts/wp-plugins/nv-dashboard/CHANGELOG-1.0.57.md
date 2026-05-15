# v1.0.57 — Refs visuales automáticas en el calendario (la cara de Rochar sale real)

## Lo que esta versión hace

Cierra la brecha entre dos flujos del plugin que hacían cosas distintas:

- **Botón "🎨 Generar imágenes con Claude"** (post a post manual): pasaba refs locales como `image=` a `/v1/images/edits` → cara de Rochar consistente.
- **Calendario "Generar publicaciones ahora"** (lote): nunca pasaba refs → solo prompt textual a `/v1/images/generations` → cara genérica.

A partir de v1.0.57, **el calendario detecta automáticamente** cuándo una escena necesita una persona reconocible (CEO, doctor, "te escucho", etc.) y, si el cliente tiene `nv_reference_images` configuradas, pasa las fotos como `image[]=` a `/v1/images/edits` igual que el botón Claude.

Para escenas conceptuales (mudanzas, instalaciones, manos cuidando, instrumental) sigue yendo por `/generations` puro como antes — preserva la variedad visual.

## Cómo decide cuándo usar refs

Heurístico simple sobre el copy + headline + first_comment del post:

**Activan refs** (palabras clave en el copy):
- `rochar`, `director`, `directora`, `doctor/a`, `dr.`, `dra.`, `ceo`, `fundador/a`, `dueño/a`, `experto/a`, `especialista`, `cirujano/a`
- `te escucho/escucha`, `te cuida/cuido`, `te atiende/atiendo`
- `consulta`, `atención personalizada`, `cuidamos de ti`, `te acompaña/acompaño`, `contigo`

**Bloquean refs** (anti-patrón — gana sobre lo anterior):
- `instalaciones`, `instrumental`, `producto/s`, `manos cuidando`, `detalle macro`, `caja/s`

Esta lógica está validada con 8 casos reales (posts de Clínica March y REVA generados durante la investigación) — todos clasifican correctamente.

## Lo que NO toca esta versión

- ✅ `apply_clean_text_overlay`, `apply_frame_layout` — INTACTAS
- ✅ Configuración del cliente (brand_colors, visual_pattern, font, logo) — INTACTA
- ✅ `nv_reference_images`, `nv_drive_subfolders`, `nv_style_guide_cached` — INTACTOS
- ✅ Endpoint `openai_image_proxy` (botón Claude post a post) — INTACTO, sigue funcionando igual
- ✅ Flujo Freepik (seedream-v4-5-edit, mystic, etc.) — INTACTO

## Cambios técnicos exactos

`includes/class-rest-api.php`:

**1. Función `generate_image_via_openai`** — firma extendida + lógica nueva:
```php
// ANTES
private static function generate_image_via_openai($prompt, $tipo, $quality)

// AHORA
private static function generate_image_via_openai($prompt, $tipo, $quality, $term_id_cliente = 0, $copy_hint = '')
```

Cuerpo:
- Lee `nv_reference_images` del cliente (máx 4)
- Detecta keywords en `copy_hint` (copy + headline + first_comment)
- Si hay refs Y necesita persona Y no es escena anti-patrón:
  - Construye multipart con boundary
  - Lee archivos del disco (`get_attached_file()`)
  - POST a `/v1/images/edits` con `image[]=` para cada ref
- Si no: POST a `/v1/images/generations` con prompt puro (legacy)
- Devuelve `[b64, used_refs, endpoint_used, detection_reasons]` para trazabilidad

**2. Callsite en `generate_image_for_post`** (línea ~2848):
- Construye `copy_hint` desde `$copy + $first_comment + headline_lines`
- Pasa `$term->term_id` y `$copy_hint` a la función
- Persiste `_nv_image_endpoint_used`, `_nv_image_refs_used`, `_nv_image_refs_detection` en post_meta para trazabilidad

**Líneas tocadas**: ~80 en una sola función + 25 en el callsite. Cero cambios fuera.

## Mantenido de v1.0.56

- Fix bug Unicode `CLuoocdNICA` (líneas 1577 y 2435 con `JSON_UNESCAPED_UNICODE`)
- Endpoint `/wp-json/nv/v1/reparar-headline-unicode`

## Coste

- `/v1/images/generations` (sin refs): ~0,21€/imagen high quality
- `/v1/images/edits` (con refs): ~0,26-0,30€/imagen high quality (+25-40%)

Para 30 posts/mes con ~50% de mezcla refs/conceptual: +1,50€/mes aprox.

## Trazabilidad post-generación

Cada post nuevo tendrá meta nuevos que permiten diagnosticar:

- `_nv_image_endpoint_used`: `"edits"` o `"generations"`
- `_nv_image_refs_used`: JSON array de attachment IDs usados como ref
- `_nv_image_refs_detection`: JSON array de razones (`["person_keyword:rochar"]`, `["BLOCKED_BY_object_keyword:instalaciones"]`, etc.)

Si una imagen sale mal o no como esperado, mirar estos meta indica si el plugin detectó correctamente la necesidad de refs o no.

## Aplicación (3 pasos)

### Paso 1 — Subir e instalar

Hub admin → Plugins → Subir nuevo → `nv-dashboard-v1_0_57.zip` → Reemplazar versión actual → Activar.

### Paso 2 — Reparar posts corruptos del bug Unicode

(Si no se hizo ya con v1.0.56)
```
curl.exe -sS -u "info@negociovivo.com:TdPq gf8H fwYS qOCP RnEy Fjuf" -X POST "https://hub.negociovivo.com/wp-json/nv/v1/reparar-headline-unicode"
```

Y re-aplicar overlay en los reparados:
```
curl.exe -sS -u "info@negociovivo.com:TdPq gf8H fwYS qOCP RnEy Fjuf" -X POST "https://hub.negociovivo.com/wp-json/nv/v1/reaplicar-overlay/13"
curl.exe -sS -u "info@negociovivo.com:TdPq gf8H fwYS qOCP RnEy Fjuf" -X POST "https://hub.negociovivo.com/wp-json/nv/v1/reaplicar-overlay/16"
curl.exe -sS -u "info@negociovivo.com:TdPq gf8H fwYS qOCP RnEy Fjuf" -X POST "https://hub.negociovivo.com/wp-json/nv/v1/reaplicar-overlay/21"
```

### Paso 3 — Test real con la generación nueva

Calendario editorial → generar 1 publicación de prueba para Clínica March con copy que mencione "Rochar" o "te escucha". Cuando salga, verificar:

```
curl.exe -sS -u "info@negociovivo.com:TdPq gf8H fwYS qOCP RnEy Fjuf" "https://hub.negociovivo.com/wp-json/nv/v1/test-imagen-publicacion/{ID_NUEVO}"
```

Buscar en la respuesta:
- `_nv_image_endpoint_used` = `"edits"` ← **DEBE ser esto**
- `_nv_image_refs_detection` con un `person_keyword:rochar` o similar

Si endpoint_used = `"edits"` → plugin pasó refs a OpenAI → la cara debería parecerse a Rochar.
Si endpoint_used = `"generations"` → la detección falló → revisar qué keywords del copy.

## Honestidad

Este cambio replica exactamente lo que el botón Claude externo ya hacía manualmente, automatizado en el calendario. No introduce comportamiento "nuevo arbitrario", introduce automatización de un comportamiento ya existente y validado.

La cara de Rochar saldrá **parecida**, no idéntica píxel a píxel. gpt-image-2 con `/edits` reproduce rasgos consistentes (cara, edad, complexión, barba) pero hay variación entre generaciones. Misma garantía que tenías cuando usabas el botón Claude.

Si tras instalar y probar la imagen sigue saliendo poco fiel, la siguiente palanca es entrenar un LoRA específico de Rochar (servicio externo, ~30-50€ una vez). Pero antes de ir ahí, probemos esta versión que es la que replica tu workflow histórico.
