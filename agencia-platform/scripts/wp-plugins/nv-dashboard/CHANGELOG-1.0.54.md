# v1.0.54 — Fix tildes + diagnóstico de pre-requisitos para reels

## Lo reportado por David

> "Cuando hay palabras con tildes falla y genera un texto raro."

## Diagnóstico

El bug NO está en `imagettftext` ni en la fuente Poppins-Bold.ttf — un test
aislado en sandbox renderiza tildes y ñ correctamente. El bug está en algún
punto del pipeline donde el texto pierde la codificación UTF-8: típicamente
mojibake (doble codificación UTF-8 → Latin1 → UTF-8) o HTML entities que
algún sanitizer dejó pasar.

## Fix v1.0.54

Función defensiva `normalize_utf8_for_render()` que cubre los 3 casos típicos:

1. **HTML entities** (`&aacute;`, `&#225;`) → decoded con `html_entity_decode`
2. **Mojibake clásico** (`MÃ¡S ESPACIO`) → detectado por patrones (`Ã¡`, `Ã©`,
   `Ã±`, `Ã³`, `Ãº`, etc.) y des-codificado una pasada Latin1 → UTF-8
3. **Bytes UTF-8 inválidos** → limpiados con `mb_convert_encoding('UTF-8','UTF-8')`

Aplicado en TODOS los puntos de entrada al render:
- `draw_text_with_thin_stroke` (renderer principal del clean overlay)
- `apply_clean_text_overlay` (cada headline_line antes de bbox + render)
- `apply_frame_layout` (logo del cliente + cada cápsula del frame)

El fix es **idempotente**: aplicar dos veces a un texto correcto no lo daña.

Verificación local con 7 casos de input distinto, todos pasan a UTF-8 válido.

## Diagnóstico de pre-requisitos para pipeline de reels (Fase 0)

Como David quiere arrancar el pipeline completo de reels (Seedance + ElevenLabs +
ffmpeg, Opción 2 de las 3 que le presenté), antes de empezar la integración hay
que verificar que el hosting tiene todo lo necesario. Si falta algo crítico
(ffmpeg, exec functions), la única salida es externalizar el render a Railway.

**Endpoint nuevo:** `GET /wp-json/nv/v1/reel-prereq-check`

Verifica:
- ffmpeg / ffprobe (CLI accesible desde PHP, versión, codecs libx264/aac/mp3)
- exec / shell_exec / proc_open (deshabilitados por `disable_functions`?)
- memory_limit (≥512M recomendado) y max_execution_time
- Espacio en disco en uploads (≥5GB libres recomendado)
- Permisos de escritura
- GD freetype, mbstring, curl, json
- Estado de WP_CRON
- API keys configuradas (Anthropic, OpenAI)

**UI nueva:** botón "🔍 Verificar pre-requisitos" en NV Dashboard → Estado del
plugin (al final de la página). Devuelve un veredicto global (`ok`/`critical`)
y un dump completo de los checks para diagnóstico.

## Pasos para David

1. Plugins → Desactivar/Borrar/Subir `nv-dashboard-v1_0_54.zip` → Activar.

2. **Verificar fix de tildes:** abre cualquier post con copy que contenga
   tildes/ñ → pulsa "🔄 Re-aplicar texto". El texto del overlay debería
   salir correcto. Si te queda alguno raro, mándame screenshot del caso
   concreto y afinamos.

3. **Verificar pre-requisitos del hosting:** WP Admin → NV Dashboard →
   📋 Estado del plugin → scroll abajo → pulsa "🔍 Verificar pre-requisitos".
   Cópiame y pégame el JSON resultante. Según lo que devuelva decidimos:
   - **Si verdict = "ok"**: arranco la Fase 1 del pipeline server-side
     (ffmpeg corre en tu hosting de WordPress, todo en una pieza)
   - **Si verdict = "critical"**: arranco la Fase 1 con render externalizado
     a Railway (extiendo tu nv-audit-api con un endpoint /reels). El plugin
     orquesta y consume el resultado.
