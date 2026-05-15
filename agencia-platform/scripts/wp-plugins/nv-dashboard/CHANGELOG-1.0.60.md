# v1.0.60 — Fix: ref_relevance ahora se devuelve en el flujo "Generar mes"

## El bug que arregla

David generó 6 publicaciones en el modal "Generar mes" con CEO al 100%.
Resultado: en NINGUNA salió Rochar. Diagnóstico:

```
pct_targets_genmes:  {"persona_destacada":100}   ← ✅ slider guardado
ref_relevance:       (vacío)                      ← ❌ AI no devuelve
forced_types:        (vacío)                      ← ❌ no se calcula
```

**Causa raíz**: el código tiene DOS system prompts distintos:
- `publicaciones_multi_cliente()`: pide y recibe `ref_relevance` ✅
- `generar_mes_ai()`: NO pedía `ref_relevance` ❌

En v1.0.59 modifiqué solo el primero. El modal "Generar mes" usa el
segundo. Por eso la AI nunca devolvía la puntuación de relevancia y el
algoritmo de umbrales no podía activarse.

Para los posts 54 y 55 SÍ se pasaron refs por `/edits`, pero solo porque
el copy contenía "médico" (heurístico v1.0.57). Para los otros 3 (56-58)
no había keywords y se fueron por `/generations` puro.

## Lo que cambia v1.0.60

### 1. `ref_relevance` añadido al template JSON de `generar_mes_ai`

Ahora el JSON que la AI debe devolver incluye:
```json
"ref_relevance": {
  "persona_destacada": 0-100,
  "equipo": 0-100,
  "instalaciones": 0-100,
  "pacientes_usuarios": 0-100,
  "productos": 0-100
}
```

Con explicación obligatoria embebida sobre cómo puntuar.

### 2. Regla "PERSONA EN ESCENA" añadida a `generar_mes_ai`

El prompt v1.0.58 mejoraba `publicaciones_multi_cliente`. Ahora el
mismo razonamiento se aplica también al flujo del calendario: si el copy
menciona persona específica o usa lenguaje de atención directa, la
escena DEBE incluir esa persona, no sustituirla por modelos genéricos
o manos abstractas.

### 3. `percent_targets` se comunica al system prompt

Si el operador marcó sliders (ej: CEO 100%), ahora la AI lo sabe antes
de escribir copy. Esto no fuerza nada (el cálculo de umbrales se hace
después en Phase 2), pero ayuda a que la AI:
- Puntúe `ref_relevance` con criterio
- Genere copys donde MAYORITARIAMENTE el CEO tenga sentido en escena
- Mantenga variedad sin forzar todos los posts al mismo molde

### 4. `image_prompt` referencia explícitamente la regla 8

El campo `image_prompt` ahora termina con:
> "RECUERDA REGLA 8: si el copy menciona persona específica del
> cliente, ESA persona DEBE ser el sujeto principal del prompt"

para que la AI no se olvide al final del JSON.

## Cómo verificar que funciona

### Paso 1 — Instalar
Plugins → Subir → `nv-dashboard-v1_0_60.zip` → Reemplazar → Activar.

### Paso 2 — Test con CEO 100%
Modal "Generar mes" → marcar **CEO al 100%** → generar 1-2 posts.

### Paso 3 — Verificar
```
curl.exe -sS -u "info@negociovivo.com:TdPq gf8H fwYS qOCP RnEy Fjuf" \
  "https://hub.negociovivo.com/wp-json/nv/v1/test-imagen-publicacion/{ID_NUEVO}"
```

Debe aparecer (que en v1.0.59 estaba vacío):
- `ref_relevance: {"persona_destacada":85,...}` ← AI lo puntúa ahora
- `image_forced_types: ["persona_destacada"]` ← sistema lo calcula
- `image_endpoint_used: "edits"` ← OpenAI con refs
- `image_refs_used: [36,37,38]` ← solo refs CEO si están categorizadas

Y la imagen debe mostrar a Rochar reconocible.

## Diff técnico

`includes/class-rest-api.php` (~50 líneas añadidas en una zona):
- Línea 1444: nueva sección "DISTRIBUCIÓN OBJETIVO" en user_prompt cuando hay percent_targets
- Línea 1480: nueva regla 8 "PERSONA EN ESCENA" en REGLAS DE PRODUCCIÓN
- Línea 1496: image_prompt hace referencia a regla 8
- Línea 1505: ref_relevance añadido al template JSON con explicación

Total tocado: ~50 líneas en el system prompt de `generar_mes_ai`.
Cero cambios en código fuera del prompt.
