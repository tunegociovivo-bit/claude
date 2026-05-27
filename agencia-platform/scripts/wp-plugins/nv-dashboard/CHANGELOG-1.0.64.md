# v1.0.64 — Texto cortado fix + slider longitud copy

## Bug 1 — Texto cortado en headlines XL/LG (post 103 "RINOPLAST...")

### Diagnóstico

El post 103 "Rinoplastia de precisión" tenía estos `headline_lines`:
```json
[
  {"text": "RINOPLASTIA",  "size": "xl", "weight": "bold"},
  {"text": "DE",           "size": "sm"},
  {"text": "PRECISIÓN",    "size": "lg", "weight": "bold", "color": "accent"}
]
```

"RINOPLASTIA" (11 letras) en `xl` (≈10.5% altura → ~108px en 1024px) en
Bold supera el `max_w` (94% del ancho de imagen). El auto-fit intentaba
reducir tamaño hasta `size_min = 0.55 * size_max ≈ 60px` y permitía solo
**1 línea** (`max_lines=1` para xl/lg). Cuando ni a 60px cabía en 1 línea,
hacía wrap a 2 líneas pero el callsite renderizaba todas — pero el bloque
se descentraba porque `start_y` se calculaba antes con `$total_h` mal.

Resultado visual: "RINOPLAST" cortado por la izquierda.

### Fix

1. **`fit_text_size` con pase agresivo**: si en `size_min` el texto no cabe
   en `max_lines`, ahora seguimos bajando hasta 12px absoluto buscando que
   entre. Antes se rendía y devolvía `size_min` con overflow de líneas.
2. **`max_lines=2` para xl/lg** (antes era 1): permite que palabras únicas
   muy largas se partan en 2 líneas como último recurso. La AI sigue
   haciendo su propio split por importancia, esto solo se activa cuando una
   sola palabra del headline (no 2+) excede el ancho.

### Cobertura

Aplica al patrón visual `clean` (que es el que usa Clínica March). El
patrón `frame` no tenía este bug porque ya hacía auto-fit hasta 50% del
size_max y aceptaba más wrap.

## Mejora — Slider de longitud del copy

### Antes

La AI generaba copys de longitud impredecible. En el post de Rinoplastia
salieron ~280 palabras con 4 secciones — demasiado largo para Instagram,
adecuado solo para Facebook. No había control.

### Ahora

Slider en el modal "Generar mes" con 5 niveles:
- **0-20** → Muy corto (~80-120 palabras): 2-3 párrafos directos
- **21-40** → Corto (~120-200 palabras): Instagram-first
- **41-60** → Medio (~200-300 palabras): equilibrado, default
- **61-80** → Largo (~300-400 palabras): storytelling Facebook
- **81-100** → Muy largo (~400-450 palabras): explicación completa

El system prompt recibe la instrucción específica con rangos de palabras
Y el ESTILO esperado (densidad de párrafos, uso de listas, tono).

### Recomendación

- **Clínica March**: 30-40 (Instagram-first, mensaje médico claro)
- **RSAdvocats**: 60-70 (legal, hay que explicar)
- **Negocio Vivo B2B**: 50 (default)
- **Aquaking**: 20-30 (B2C, decisión rápida)

## Cómo verificar

### Paso 1 — Instalar
Plugins → Subir → `nv-dashboard-v1_0_64.zip` → Reemplazar → Activar.

### Paso 2 — Regenerar el post 103 (o cualquier nuevo con palabra larga)
Modal "Generar mes" → CEO al 100% + slider longitud al **30** → 1 publicación.

Si la AI vuelve a proponer un headline tipo "RINOPLASTIA" en xl bold,
ahora ya no se cortará — o bien encajará a tamaño reducido o se partirá
en 2 líneas (sin perder ninguna letra).

### Paso 3 — Verificar copys más cortos
El copy debería rondar 120-200 palabras (vs los 280 que generó antes).

## Archivos modificados

- `includes/class-rest-api.php`:
  - `fit_text_size`: pase agresivo hasta 12px absoluto
  - bucle `apply_clean_text_overlay`: max_lines=2 para xl/lg
  - `generar_mes_ai`: lectura `copy_length` + curva de palabras + bloque
    LONGITUD DEL COPY en system prompt

- `admin/views/editorial.php`:
  - Slider longitud copy en modal Generar mes con preview "Corto/Medio/Largo"

- `admin/js/dashboard.js`:
  - Lee slider, envía `copy_length` en el body de `generar-mes-ai`

- `nv-dashboard.php`: bump 1.0.63 → 1.0.64

Total: ~70 líneas, backward compatible (si no se envía `copy_length`,
default = 50 = medio = comportamiento actual).
