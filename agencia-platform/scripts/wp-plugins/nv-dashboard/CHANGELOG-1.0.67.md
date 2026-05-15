# v1.0.67 — Refs por tipo respetadas + texto/cara no colisionan

## Bugs detectados en uso real

### Bug 1 — Pides "equipo", el plugin pasa fotos de Rochar

Post 172 ("Conoce al equipo que cuida de ti"): el operador puso 100%
en CEO+Equipo+Instalaciones. Diagnóstico:

```
forced_types: ["persona_destacada", "equipo", "instalaciones"]
refs_used: [8, 37, 38, 36]   ← TODAS son fotos de Rochar
```

¿Por qué? Las 4 refs subidas en Clínica March están todas categorizadas
como `persona_destacada`. NO hay refs categorizadas como `equipo` ni
como `instalaciones`. Cuando el plugin no encontraba refs del tipo
solicitado, usaba un fallback que mezclaba TODAS las refs disponibles
y las pasaba a OpenAI con un prompt que decía "5-6 medical professionals"
→ OpenAI inventó caras nuevas inspiradas en Rochar.

### Bug 2 — Texto tapa la cara

Post 175 ("Llega el verano"): la AI propuso `text_placement: top`,
pero gpt-image-2 puso a Rochar en la mitad superior (no respetó el
"empty negative space at top" del prompt). Resultado: el headline grande
encima de la cara, imagen inservible.

## Lo que cambia v1.0.67

### Fix 1 — Filtrado estricto de refs por tipo disponible

Antes: si el operador pedía `forced_types=['equipo']` y no había refs
de equipo, el plugin pasaba todas las refs disponibles igualmente.

Ahora: el plugin filtra `forced_types` descartando los tipos que no
tengan refs subidas. Comportamiento por tipo:
- **Tipo CON refs disponibles**: se usan SOLO esas refs (no se mezcla
  con otros tipos).
- **Tipo SIN refs**: se descarta del `forced_types`. El operador ve un
  warning en los meta del post (`WARNING_missing_refs_for_types:equipo`).
- **Ningún tipo tiene refs**: el plugin cae a `/v1/images/generations`
  puro y registra `FALLBACK_to_generations_no_refs_available`. Mejor
  inventar todo desde cero que mezclar Rochar como "equipo".

### Fix 2 — Regla anti-colisión texto/cara reforzada

System prompt de "Generar mes" reforzado con:

```
TEXT/FACE COLLISION (CRÍTICO):
· Si persona arriba/centro → text_placement DEBE ser "bottom"
· Si persona abajo → text_placement DEBE ser "top"
· NUNCA text_placement="top" si la persona ocupa mitad superior
· image_prompt debe describir POSICIÓN explícita:
  "subject positioned in the LOWER HALF of the frame,
   leaving UPPER 40% as solid empty negative space"
· Refuerzo: "DO NOT place subject's face in the upper third",
  "keep TOP 40% completely free of facial features"
```

Esto fuerza a la AI a estructurar el prompt de forma que gpt-image-2
genere realmente espacio libre arriba o abajo según el placement.

### Nuevo endpoint diagnóstico /diag-refs/{slug}

Para auditar qué tipos tiene cubiertos cada cliente:

```bash
curl.exe -sS -u "info@negociovivo.com:TdPq gf8H fwYS qOCP RnEy Fjuf" \
  "https://hub.negociovivo.com/wp-json/nv/v1/diag-refs/clinica_march"
```

Devuelve:
```json
{
  "total_refs": 4,
  "counts_by_type": {
    "persona_destacada": 4,
    "equipo": 0,
    "instalaciones": 0,
    ...
  },
  "warnings": [
    "Sin refs de Equipo — si fuerzas equipo en un lote, OpenAI inventará caras genéricas",
    "Sin refs de Instalaciones — si fuerzas instalaciones, OpenAI inventará un local genérico"
  ]
}
```

## Plan de acción para Clínica March

David necesita subir y categorizar:

1. **Equipo / Trabajadores**: fotos del staff de la clínica (asistentes,
   recepción, otros médicos del equipo) categorizadas como "👥 Equipo".
2. **Instalaciones**: fotos del local interior/exterior, sala de
   tratamiento, recepción, fachada categorizadas como "🏢 Local".

Mientras no las subas:
- Generar con CEO 100% solo: ✓ funciona perfecto (Rochar real).
- Generar con Equipo 100%: el plugin lo va a descartar y caer a
  /generations. La imagen no tendrá fotos reales de tu equipo, pero
  tampoco saldrá Rochar disfrazado de "equipo".

## Cómo verificar

### Paso 1 — Instalar
Plugins → Subir → `nv-dashboard-v1_0_67.zip` → Reemplazar → Activar.

### Paso 2 — Auditar refs
```bash
curl.exe -sS -u "info@negociovivo.com:TdPq gf8H fwYS qOCP RnEy Fjuf" \
  "https://hub.negociovivo.com/wp-json/nv/v1/diag-refs/clinica_march"
```

Verás `counts_by_type` con qué tipos tienes cubiertos.

### Paso 3 — Test colisión texto
Modal "Generar mes" → CEO 100% → 1 publicación.

Verifica con:
```bash
curl.exe -sS -u "..." \
  "https://hub.negociovivo.com/wp-json/nv/v1/test-imagen-publicacion/{ID}" \
  | grep image_prompt
```

El prompt debería contener frases como "LOWER HALF of the frame" o
"DO NOT place subject's face in the upper third". La imagen final debería
tener la cara de Rochar abajo y espacio libre arriba para el texto.

## Diff técnico

`includes/class-rest-api.php`:
- Endpoint nuevo `/diag-refs/{slug}` (~50 líneas al final del archivo)
- Lógica de filtrado refs por tipo: descarta tipos sin refs, fallback
  a /generations en lugar de mezclar (~30 líneas modificadas en
  `generate_image_via_openai`)
- Regla 8 PERSONA EN ESCENA del system prompt: añadida sub-regla
  TEXT/FACE COLLISION con instrucciones explícitas de posición y
  refuerzo en image_prompt (~10 líneas)

`nv-dashboard.php`: bump 1.0.66 → 1.0.67

Total: ~90 líneas. Backward compat 100% — el comportamiento solo cambia
cuando hay forced_types parciales o cuando se piden tipos sin refs
subidas (antes mezclaba mal, ahora avisa).
