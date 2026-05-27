# v1.0.65 — Texto cortado fix DEFINITIVO + curva copy_length agresiva

## Bug 1 — Texto cortado seguía pasando (post 122 INOPLASTIA / IRUGIA / RESERVACONSULTA)

### Diagnóstico real (esta vez completo)

El v1.0.64 intentó arreglar el corte ampliando `max_lines` a 2 y bajando
hasta 12px. **No bastaba**. Análisis del post 122:

```
headline_lines:
  [0] "RINOPLASTIA"      size=lg  weight=bold
  [1] "SIN CIRUGÍA"      size=xl  weight=bold  color=accent
  [2] "TU NUEVO PERFIL"  size=sm
dato: "Resultados visibles en una sesión"
cta:  "Reserva consulta"
```

Renderizado real (capturado de hub):
- "**INOPLASTIA**" (R cortada por la izquierda)
- "**SIN**" + "**CIRUGIA**" (la I final cortada)
- "**RESERVACONSULTA**" (S y A finales cortadas)

### Causa raíz

`wrap_text_for_imagettf` parte texto SOLO por espacios. Si una palabra
única ("RINOPLASTIA") es más ancha que `max_width`, devuelve UNA línea
con esa palabra entera. `fit_text_size` chequeaba **count(lines) ≤ max_lines**
pero NUNCA chequeaba el **ancho real** de cada línea.

Resultado: el algoritmo aceptaba un tamaño donde "RINOPLASTIA" tenía
1100px de ancho en un frame de 901px, y se renderizaba con `tx` calculado
correctamente pero excedía el lienzo por la derecha (text-align right
metía la palabra fuera por la izquierda).

### Fix v1.0.65 — `fit_text_size` con check de ancho real

Nuevo algoritmo en 4 pases:

1. **Pase normal** (size_max → size_min, paso 2): wrap + count ≤ max_lines
   + **TODAS las líneas dentro de max_width**
2. **Pase agresivo** (size_min-2 → 12px): mismo criterio, baja por debajo
   del mínimo si hace falta
3. **Pase aceptando más líneas**: si en 2 líneas no entra a ningún tamaño,
   acepta 3+ líneas con tal de que **TODAS** caben en max_width
4. **Recurso final**: si una palabra a 12px sigue sin caber, parte por
   caracteres (Unicode-safe)

Test verificado con los 5 casos del post 122 — TODOS dentro del frame:
- RINOPLASTIA xl bold → 103px en 1 línea, 893px (cabe en 901)
- SIN CIRUGÍA xl bold → 2 líneas (`SIN` + `CIRUGÍA`), 897px máx
- RESERVACONSULTA con letter-spacing → 887px (cabe)

### Bug 2 — CTA con letter-spacing se desbordaba

"Reserva consulta" → `mb_strtoupper` → `RESERVA CONSULTA` → letter-spacing
con `implode(' ', preg_split)` → `R E S E R V A   C O N S U L T A`.
35+ caracteres a tamaño grande que no cabían en el frame.

**Fix**: ahora el letter-spacing solo se aplica si la versión espaciada
**realmente cabe** en max_width al tamaño mínimo. Si no cabe, fallback a
mayúsculas plano "RESERVA CONSULTA". Además ahora renderiza TODAS las
líneas del CTA (antes solo la primera).

## Mejora 2 — Curva copy_length más agresiva

David puso slider al 25% y aún recibía 110+ palabras (esperaba ~50-70).
La curva v1.0.64 era demasiado conservadora.

### Curva v1.0.65 (más agresiva en el extremo bajo)

| Slider | Palabras | Estilo |
|--------|----------|--------|
| 0      | 40-70    | Ultra-corto: 1 párrafo, IG nativo |
| 15     | 50-80    | Ultra-corto |
| 25     | 60-100   | Muy corto |
| 50     | 100-180  | Corto-medio (default) |
| 75     | 200-300  | Medio-largo |
| 100    | 350-450  | Storytelling completo |

### System prompt REFORZADO

Antes la AI ignoraba el rango. Ahora el prompt incluye:
- "REGLA CRÍTICA NO NEGOCIABLE"
- "NO te pases del máximo"
- "NO te quedes corto del mínimo"
- "CUENTA TUS PALABRAS antes de devolver el JSON"
- Estilo específico para 0-25 ("ULTRA-DIRECTO. 1-2 párrafos máximo. Si dudas si añadir un párrafo más, NO LO AÑADAS.")

### Recomendaciones por cliente

- **Clínica March / Aquaking**: 15-30
- **Praxis zum Schloss**: 20-35
- **Negocio Vivo B2B**: 50 default
- **RSAdvocats** (legal): 60-75

## Cómo verificar

### Paso 1 — Instalar
Plugins → Subir → `nv-dashboard-v1_0_65.zip` → Reemplazar → Activar.

### Paso 2 — Borrar el post 122 y regenerar
Modal "Generar mes" → CEO 100% + slider longitud al **20** → 1 publicación.

### Paso 3 — Verificar
- **Imagen**: ningún texto debe salirse del frame. Si la AI propone
  "RINOPLASTIA" en xl bold, ahora se renderiza más pequeño (~103px en
  lugar de 161px) o se parte en 2 líneas, pero SIEMPRE dentro del frame.
- **Copy**: debe rondar 50-80 palabras (no 110+).
- **CTA**: si es "Reserva consulta", saldrá "RESERVA CONSULTA" plano si
  el espaciado no cabe (frame protegido).

## Diff técnico

`includes/class-rest-api.php`:
- `fit_text_size`: closure `fits()` con check ancho real, 4 pases (pase 3
  acepta más líneas, pase 4 parte por caracteres)
- CTA bloque: detección dinámica spacing + render todas las líneas
- `generar_mes_ai`: nueva curva copy_length 4 tramos
- system prompt copy_length: reforzado con "NO NEGOCIABLE" + cuenta antes
  de enviar

`admin/views/editorial.php`:
- Texto descriptivo del slider actualizado a la nueva curva
- 6 etiquetas (Ultra-corto / Muy corto / Corto / Medio / Largo / Muy largo)

`nv-dashboard.php`: bump 1.0.64 → 1.0.65

Total: ~80 líneas modificadas. Backward compat al 100% (default copy_length=50
sigue dando comportamiento similar al actual, default fit_text_size ahora
ES MÁS PERMISIVO con líneas pero MÁS ESTRICTO con anchos).
