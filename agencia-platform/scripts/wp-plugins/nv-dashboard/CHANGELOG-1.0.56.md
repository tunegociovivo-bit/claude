# v1.0.56 — Fix bug Unicode `CLuoocdNICA`

## Lo que esta versión hace (y SOLO hace)

Aplica el fix mínimo necesario para resolver el bug de las imágenes con
`CLuoocdNICA` en el texto. Nada más. Sin cambios en generación de imagen,
sin nuevos menús, sin nuevos CPT, sin tocar overlays ni layout.

Toma como base el zip que David proporcionó (v1.0.55) y aplica únicamente:

### 1. Fix preventivo (líneas 1577 y 2435 de `class-rest-api.php`)

```php
// ANTES
update_post_meta($post_id, '_nv_headline_lines', wp_json_encode($headline_lines));

// AHORA
update_post_meta($post_id, '_nv_headline_lines', wp_json_encode($headline_lines, JSON_UNESCAPED_UNICODE));
```

`JSON_UNESCAPED_UNICODE` hace que en BD se guarde `[{"text":"CLÍNICA"}]` con
caracteres reales en UTF-8, sin escapes `\uXXXX`. Aunque WP haga unslash
internamente, no hay barras que perder.

### 2. Endpoint reparador de posts ya corruptos

`POST /wp-json/nv/v1/reparar-headline-unicode`

- Body vacío → revisa todos los posts del CPT y repara los corruptos.
- `{"post_id": N}` → repara solo ese post.
- Idempotente: posts correctos no se tocan.

Detecta el patrón "uXXXX sin barra precedente" en `_nv_headline_lines`,
añade la barra invertida que falta, decodifica, y vuelve a guardar con
`JSON_UNESCAPED_UNICODE`.

## Lo que NO toca esta versión

- ✅ `generate_image_via_openai` — INTACTA. Sigue yendo por `/v1/images/generations`
  con prompt puro (sin refs como input multipart). Esto es lo que el plugin
  histórico hacía y lo que David tenía funcionando en negociovivo.com.
- ✅ `apply_clean_text_overlay` y `apply_frame_layout` — INTACTAS.
- ✅ `nv_visual_pattern`, brand colors, fuente cliente, posición logo — INTACTOS.
- ✅ El sistema de refs visuales (`nv_reference_images`) — INTACTO. Las refs se
  siguen usando solo para Anthropic vision (Phase 1, generación de la guía de
  estilo cacheada), no como input directo a OpenAI.

## Aplicación (3 pasos, ~3 minutos)

### Paso 1 — Subir y activar

Hub admin → Plugins → Subir → seleccionar `nv-dashboard-v1_0_56.zip` →
Reemplazar versión actual → Activar.

Verifica en NV Dashboard → Estado del plugin que pone v1.0.56.

### Paso 2 — Reparar los posts ya corruptos

En PowerShell, una sola línea:

```
curl.exe -sS -u "info@negociovivo.com:TdPq gf8H fwYS qOCP RnEy Fjuf" -X POST "https://hub.negociovivo.com/wp-json/nv/v1/reparar-headline-unicode"
```

Devolverá el listado de posts reparados (probablemente 13, 16 y 21).

### Paso 3 — Re-pintar las imágenes

```
curl.exe -sS -u "info@negociovivo.com:TdPq gf8H fwYS qOCP RnEy Fjuf" -X POST "https://hub.negociovivo.com/wp-json/nv/v1/reaplicar-overlay/13"
curl.exe -sS -u "info@negociovivo.com:TdPq gf8H fwYS qOCP RnEy Fjuf" -X POST "https://hub.negociovivo.com/wp-json/nv/v1/reaplicar-overlay/16"
curl.exe -sS -u "info@negociovivo.com:TdPq gf8H fwYS qOCP RnEy Fjuf" -X POST "https://hub.negociovivo.com/wp-json/nv/v1/reaplicar-overlay/21"
```

Después abre las imágenes y deberían poner "CLÍNICA" correctamente.
Posts NUEVOS que generes a partir de aquí ya saldrán bien sin reparación.

## Lo que queda pendiente como cuestiones de configuración (no de código)

Tras la conversación, los problemas que veías de "no sale Rochar / tipografía
distinta / franja bajo el texto / texto pisa logo" son en su mayoría
configuración del cliente y/o de las refs subidas. Reviso una a una:

1. **Tipografía distinta a la plantilla MARCH**: el cliente Clínica March
   no tiene fuente subida en `nv_font_attachment_id`. Está usando Poppins-Bold
   por defecto. Si tienes el .ttf de la fuente real, súbela en NV Dashboard →
   Clientes → Editar Clínica March → "Fuente del cliente".

2. **Franja bajo el texto**: probablemente el cliente tiene
   `nv_visual_pattern = 'frame'`. El layout `frame` está diseñado a propósito
   con cápsulas opacas. Cambia a `clean` en la ficha del cliente si quieres
   texto flotante sin fondo.

3. **Texto pisa el logo**: bug real del layout que requiere fix en código,
   pero NO entra en esta versión. Lo aborda otra sesión cuando los puntos
   1-2 estén verificados desde la UI.

4. **No sale Rochar exacto**: las refs visuales actuales en hub son una sola
   imagen — la final con overlay sobre fondo. La AI cachea descripción del
   estilo (1010 chars) pero esa descripción no menciona a Rochar (no incluye
   rasgos de cara, edad, etc.). Subir 2-3 fotos LIMPIAS de Rochar (sin texto
   sobreimpreso) y pulsar "Generar/actualizar guía de estilo" generará una
   guía con su descripción, que gpt-image-2 reproduce con bastante
   consistencia (no idéntico, pero parecido).

## Honestidad

Esta versión es deliberadamente conservadora. En sesiones anteriores hice
cambios que no estaban justificados (refactor de `generate_image_via_openai`,
nuevo CPT redundante) basados en diagnósticos incompletos. Aquí solo aplico
lo que está demostrado por los datos en BD: el bug Unicode existe, este fix
lo soluciona, todo lo demás se queda como estaba en el plugin que David
proporcionó.

Si tras aplicar este zip y subir refs limpias de Rochar el resultado sigue
sin ser aceptable, lo discutimos con datos reales antes de tocar nada más.
