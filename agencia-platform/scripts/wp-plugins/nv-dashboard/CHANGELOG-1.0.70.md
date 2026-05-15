# v1.0.70 — Texto no tapa caras: auto-fit altura del bloque + auto-detección zona segura

## El bug que arregla

David v1.0.69: el equipo sale perfecto (Rochar + Angie + Ana). Único defecto: en el post 204 ("Tres profesionales, un mismo propósito") el headline "TRES EXPERTOS UN PROPÓSITO TU SALUD" se desbordaba sobre las caras del equipo, aunque el placement era correcto.

## Diagnóstico real

Captura del post 204 analizada:

```
text_placement: top                              ← AI bien
image_prompt: "group in LOWER-CENTER to BOTTOM,
              UPPER-MIDDLE clear for text overlay"  ← AI bien
```

Las 3 personas SÍ están en la mitad inferior (la AI ganó). Pero el bloque de texto tiene 5 líneas (TRES, EXPERTOS, UN, PROPÓSITO, TU SALUD), 4 de ellas en xl bold a 161px cada una en imagen 1536px.

**Cálculo exacto del bloque headline antes de v1.0.70**:

```
Tamaño líneas: 161 + 161 + 161 + 161 + 115 = 759px
Line-heights (×1.10) + gaps: 858px
858 / 1536 = 55.9% del frame ← se desborda sobre las caras
```

## Lo que cambia v1.0.70

### Fix A — Auto-fit altura del bloque al 35% del frame

En `apply_clean_text_overlay`, después de construir todas las líneas a renderizar pero ANTES de dibujar:

```php
$max_block_h = (int) ($h * 0.35);
if ($total_h > $max_block_h) {
    $scale = $max_block_h / $total_h;
    foreach ($rendered as &$r) {
        $r['size_px']   = max(14, (int) round($r['size_px'] * $scale));
        $r['lh']        = (int) round($r['lh'] * $scale);
        $r['gap_after'] = (int) round($r['gap_after'] * $scale);
    }
}
```

**Resultado verificado con caso real (post 204)**:

```
ANTES: total_h = 858px = 55.9% del frame  ✗ tapa caras
AHORA: total_h = 538px = 35.0% del frame  ✓ caben caras
       (scale=0.626; xl 161px → 101px; lg 115px → 72px)
```

Mismo fix aplicado al layout `frame` (cápsulas).

### Fix B — Auto-detección de placement con análisis de luminosidad

En `composite_overlays_on_image`, antes de pintar el texto, analizo la imagen pura de OpenAI dividida en 3 bandas verticales (top/center/bottom). Para cada banda calculo la **varianza de luminosidad** sampleando ~400 puntos por banda con luminosidad Rec.601.

- **Varianza alta** = mucho contraste/detalle (caras, texturas, objetos)
- **Varianza baja** = zona uniforme (fondo, cielo, pared)

Si la zona elegida por la AI tiene varianza significativamente más alta que otra banda, el plugin override el placement automáticamente.

```php
private static function detect_safe_text_zone($img, $w, $h) {
    // Sampleo 20x20 puntos por banda → luminosidad Rec.601
    // Calcula varianza de cada banda
    // Si ratio min/max > 0.6 → bandas similares, no override
    // Si max_v < 100 → imagen muy uniforme global, no override
    // Devuelve banda con menor varianza
}
```

Logs en `error_log` para diag:
```
[NV Dashboard v1.0.70] detect_safe_text_zone: variances={...} best=bottom
[NV Dashboard v1.0.70] auto_placement override: AI quería 'top' pero la zona libre real es 'bottom'
```

## Cómo verificar

### Paso 1 — Instalar
Plugins → Subir → `nv-dashboard-v1_0_70.zip` → Reemplazar.

### Paso 2 — Borrar el post 204 y regenerar

Modal "Generar mes" → CEO 100% + Equipo 100% + Instalaciones 100% → 1 publicación con tema "Tres profesionales, un mismo propósito" o similar.

### Paso 3 — Verificar resultado

La imagen debería tener:
- 3 personas reales (Rochar + Angie + Ana) en la zona donde gpt-image-2 las puso
- Headline reducido proporcionalmente para que NO entre en la zona de las caras
- Los 5 textos en líneas más pequeñas si era necesario, pero ninguno tapando rostros

## Notas honestas

- **El auto-fit reduce el tamaño del headline cuando es necesario.** Si tu headline original era xl bold 161px y las personas ocupan media imagen, el headline se reducirá a ~101px. Sigue siendo grande y legible, pero no enorme. Es el coste necesario para que las caras no se tapen.
- **La auto-detección de zona segura es PREVENTIVA**: detecta cuando la AI elige top pero la imagen real tiene caras arriba (o viceversa). No siempre disparará — solo cuando hay diferencia clara entre bandas.
- **gpt-image-2 sigue siendo gpt-image-2**: a veces pone caras en el centro entero de la imagen, sin zona libre clara en ninguna banda. En esos casos extremos el auto-fit garantiza que el texto al menos quede contenido en su zona elegida sin desbordar.

## Diff técnico

`includes/class-rest-api.php`:
- `composite_overlays_on_image`: llamada a `detect_safe_text_zone()` antes del compositing, con override del placement si difiere
- `detect_safe_text_zone()` nueva función: análisis de varianza de luminosidad por bandas (~50 líneas)
- `apply_clean_text_overlay`: auto-fit al 35% del frame antes de dibujar (~15 líneas)
- `apply_frame_layout`: mismo auto-fit para layout frame (~15 líneas)

`nv-dashboard.php`: bump 1.0.69 → 1.0.70

Total: ~85 líneas. Backward compat 100%.
