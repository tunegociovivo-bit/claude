# v1.0.62 — Fix: CEO 100% ahora significa CEO en TODOS los posts

## Los 2 bugs que arregla

David hizo el primer test real de v1.0.61 con 3 publicaciones para
agosto al 100% CEO. Resultado: **1 de 3 con Rochar** (33%). Diagnóstico:

```
Post 68 (ref_relevance CEO=95) → forced_types ✅ → ✅ Rochar real
Post 69 (ref_relevance CEO=30) → forced_types ✅ → ❌ "manos aplicando serum"
Post 70 (ref_relevance CEO=20) → forced_types ❌ → ❌ mujer genérica
```

### Bug A — Post 70 quedó FUERA aunque slider=100%

Mi umbral en v1.0.61 era `max(30, 100-pct)`. Para pct=100 daba threshold=30.
Como ref_relevance=20 < 30, el post se quedaba sin refs.

**Significado contradictorio**: pediste 100% pero el sistema decidía
"según relevancia AI". 100% debería ser literal, no preferencia.

**Fix v1.0.62**:
```php
$threshold = 100 - $pct;
if ($pct >= 100) {
    $threshold = 0;  // TODOS los posts pasan, incluso ref_relevance=0
} else {
    if ($threshold < 30) $threshold = 30;
    if ($threshold > 90) $threshold = 90;
}
```

Aplicado en los DOS callsites (publicaciones_multi_cliente y
generar_imagen_publicacion).

### Bug B — Post 69: refs pasadas pero la cara que sale no es Rochar

El post 69 SÍ activó forced_types y SÍ pasó refs por `/edits`, pero
el `image_prompt` de Phase 1 decía:

> "Macro close-up of gentle hands applying luminous serum or hydrating
> cream to a woman's cheek (face shown in profile, only visible left
> half, skin glowing and healthy)..."

Mi prefix "IMPORTANT: subject MUST be the person from refs" quedaba al
INICIO. El prompt detallado de "hands + woman + profile" lo sobrescribía.
gpt-image-2 obedecía la descripción más concreta y abundante.

**Fix v1.0.62 — Sandwich agresivo prefix + suffix**:

Antes era:
```
[prefix corto] + [image_prompt detallado de la AI]
```

Ahora es:
```
CRITICAL OVERRIDE — SUBJECT REQUIREMENT:
[descripción muy específica de Rochar: Mediterranean medical professional
40s-50s, short dark hair, gray-and-dark beard, white coat or navy blazer.
Face MUST appear clearly. Even if scene below mentions woman/hands/close-up
of body parts, THIS PERSON is the protagonist.]

SCENE DESCRIPTION:
[image_prompt original de la AI]

FINAL ENFORCEMENT — read this last:
[Si la escena describe otro sujeto (woman, hands, model, close-up of body
parts without face), REPLACE that subject with him. Visible from chest up
at minimum, face clearly identifiable.]
```

El prefix da contexto antes de leer la escena. La escena se mantiene
para preservar composición, paleta, iluminación. El suffix al final
fuerza el override sobre cualquier sujeto contradictorio.

gpt-image-2 procesa el prompt completo y la información reforzada en
ambos extremos suele ganar sobre detalles aislados en el medio.

## Cómo verificar

### Paso 1 — Instalar
Plugins → Subir → `nv-dashboard-v1_0_62.zip` → Reemplazar → Activar.

### Paso 2 — Test mismo lote, mismo cliente
Modal "Generar mes" → Clínica March → CEO 100% → 3 posts agosto (puedes
borrar los 68-70 antes para tener calendario limpio).

### Paso 3 — Verificar
```
curl.exe -sS -u "info@negociovivo.com:TdPq gf8H fwYS qOCP RnEy Fjuf" \
  "https://hub.negociovivo.com/wp-json/nv/v1/test-imagen-publicacion/{ID}"
```

En los 3 posts debe aparecer:
- `image_endpoint_used: "edits"` ← incluso con ref_relevance bajo
- `image_forced_types: ["persona_destacada"]` ← forzado en TODOS
- `image_refs_used: [36, 37, 38]` ← solo refs CEO categorizadas
- `image_prompt` debe empezar con "CRITICAL OVERRIDE — SUBJECT REQUIREMENT..."

Y las 3 imágenes deben mostrar a Rochar reconocible.

## Lo que NO arregla v1.0.62 (transparencia)

- **No garantiza fidelidad PERFECTA de la cara**. gpt-image-2 trabaja por
  similitud, no por copia exacta. Variaciones en pose, iluminación,
  ángulo son normales. La cara debe ser RECONOCIBLE como Rochar, no
  IDÉNTICA pixel a pixel. Si necesitas fidelidad pixel-perfect, el
  siguiente paso es entrenar un LoRA específico (~30-50€).

- **Si el copy es muy ajeno a "tener al CEO en escena"** (ej: producto
  específico, día festivo, dato puro de mercado), forzar al CEO puede
  producir composiciones forzadas. La regla "100% = todos" es literal,
  no juicio editorial — usarla con criterio.

- **No arregla el bug de la imagen fallida** que David mencionó del
  lote julio. Sin ID concreto del post fallido no se puede diagnosticar
  desde aquí.

## Diff técnico

`includes/class-rest-api.php`:
- L2609-2618: nuevo `if ($pct >= 100) $threshold = 0` en Phase 2 multi-cliente
- L3293-3340: type_subject_map reescrito + nuevo type_suffix_map
- L3911-3918: mismo fix umbral en endpoint individual

`nv-dashboard.php`:
- bump 1.0.61 → 1.0.62

Total: ~50 líneas modificadas, 100% en lógica de prompt + umbral.
Cero cambios en JS, UI, storage o estructura.
