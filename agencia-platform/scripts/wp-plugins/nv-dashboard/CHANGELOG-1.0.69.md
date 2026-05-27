# v1.0.69 — Selección balanceada de refs (cubre TODAS las personas)

## El bug que arregla

David categorizó refs con person_name (Rochar, Dra Angie, Ana) en v1.0.68. Generó "Rochar responde: tu salud nos importa" → la imagen mostró **Rochar a la izquierda + Angie en el centro + un segundo Rochar a la derecha**. Ana NO apareció.

## Diagnóstico real (post 196)

```
refs_used: [37, 38, 36, 153, 154, 155, 156, 157]
            Rochar Rochar Rochar Angie Local Local Local Local
```

8 refs pasadas pero **Ana (id 160) NO se incluyó**. El algoritmo de selección antiguo cogía las refs en **orden de aparición** en el storage. Como hay 3 fotos de Rochar antes de las de equipo, y 5 de instalaciones, el cap=8 cortó antes de llegar a Ana.

Resultado: gpt-image-2 recibió 3 refs de Rochar, 1 de Angie, 4 de instalaciones — y al pedirse "team de 3 personas" rellenó la 3ª persona copiando Rochar (la cara con más refs disponibles).

## Lo que cambia v1.0.69

### Fix A — Algoritmo `pick_balanced_refs`

Selección por **rondas** en lugar de orden lineal:

- **Bucket** = combinación type + person_name (o solo type si no hay nombre)
- **Ronda 1**: 1 foto de cada bucket
- **Ronda 2**: 2ª foto de cada bucket que tenga más
- **Ronda N**: hasta llegar al cap

**Test verificado** con datos reales del cliente:

```
items: 3×Rochar + 1×Angie + 1×Ana + 5×instalaciones (sin nombre)
forced_types: [CEO, equipo, instalaciones], cap=8

ANTES (v1.0.68):
  37, 38, 36, 153, 154, 155, 156, 157
  → Rochar(3) + Angie(1) + Local(4)
  → Ana FUERA, gpt-image-2 inventa cara

AHORA (v1.0.69):
  37, 153, 154, 160, 38, 155, 36, 156
  → Rochar + Angie + Local + Ana + Rochar + Local + Rochar + Local
  → TODAS las 3 personas representadas en las 4 primeras refs
```

### Fix B — Regla "Nombres en copy → image_prompt"

System prompt ampliado con regla nueva:

> Si el copy menciona nombres del roster (ej. "mis colegas Dra. Angie y Ana"), el image_prompt DEBE describir a TODAS las personas mencionadas en escena con descripciones físicas distintivas. NO solo el CEO.
>
> Ejemplo correcto: "group portrait of 3 medical professionals: a mature man with short dark hair and trimmed beard wearing white coat (left), a mature blonde woman with white coat (center), a younger woman with dark hair and white uniform (right)"

Esto era exactamente el bug del post 196: el copy decía "Mis colegas Dra. Angie y Ana" pero el image_prompt decía "Portrait of mature man with beard (CEO Rochar)" — singular. La AI ignoraba a Angie y Ana en la descripción visual.

### Fix C — Sandwich con anti-duplicación explícita

Suffix gpt-image-2 ampliado:

> "Do NOT duplicate the same person — each person from the references must appear exactly once."

Refuerza al modelo a no usar 2 veces la misma cara cuando le faltan refs.

## Cómo verificar

### Paso 1 — Instalar
Plugins → Subir → `nv-dashboard-v1_0_69.zip` → Reemplazar.

### Paso 2 — Borrar el post 196 y regenerar

Modal "Generar mes" → CEO 100% + Equipo 100% + Instalaciones 100% → 1 publicación con tema "Rochar responde / equipo / colegas".

### Paso 3 — Verificar refs_used

```bash
curl.exe -sS -u "info@negociovivo.com:TdPq gf8H fwYS qOCP RnEy Fjuf" \
  "https://hub.negociovivo.com/wp-json/nv/v1/test-imagen-publicacion/{ID}"
```

Debe aparecer:
- `image_refs_used` con id=160 (Ana) presente entre las primeras 4
- `image_refs_detection` incluye `balanced_pick:8` (o el número real)
- `image_prompt` describe 3 personas distintas (no "mature man with beard" singular)

### Paso 4 — Resultado esperado

Imagen con 3 personas distinguibles: Rochar (hombre con barba, blazer azul), Angie (mujer rubia con bata blanca), Ana (mujer joven con uniforme blanco). Sin duplicados.

## Diff técnico

`includes/class-rest-api.php`:
- Helper nuevo `pick_balanced_refs()` (~50 líneas) — selección por rondas balanceadas
- Reemplazo del `array_slice` lineal por llamada al helper en `generate_image_via_openai`
- Cap movido al modo automático también (4 refs)
- System prompt `generar_mes_ai`: regla 2 ampliada con "NOMBRES EN COPY → IMAGEN" y ejemplo concreto, regla 4 con anti-duplicación, regla 5 nueva
- Sandwich suffix `equipo`: añadido "Do NOT duplicate the same person"

`nv-dashboard.php`: bump 1.0.68 → 1.0.69

Total: ~80 líneas. Backward compat 100%.

## Notas honestas

- gpt-image-2 sigue siendo gpt-image-2: aunque le digamos "no duplicar", a veces lo hace. La regla mejora pero no es 100% determinista. Si falla, regenera.
- Ana solo tiene 1 foto subida — para que su cara sea reconocible idealmente necesitarías 2-3 fotos en distintos ángulos. Lo mismo para Angie. Hoy con 1 foto cada una el modelo tiene poca info y puede haber variaciones.
- Si tras regenerar 2-3 veces sigue saliendo mal, la siguiente palanca técnica es entrenar un LoRA con cada cara (~30-50€/persona, servicio externo).
