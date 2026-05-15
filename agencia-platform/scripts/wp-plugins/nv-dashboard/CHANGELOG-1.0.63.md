# v1.0.63 — Multi-fuente por cliente (combinación Regular + Bold)

## Lo que pediste

Las publicaciones originales de Clínica March combinan **Montserrat-Regular**
para las líneas finas con **Montserrat-Bold** para las palabras hero
(p. ej. "**ROCHAR**"). Esta combinación es lo que da el aspecto editorial
de las refs originales.

Hasta v1.0.62, el plugin solo permitía subir UNA fuente por cliente.
El bold se simulaba con `imagettftext` ofset 1px (faux-bold), que no es
una bold real — la diferencia visual entre las dos pesos se notaba poco.

## Lo que hace v1.0.63

### Storage nuevo: `nv_font_attachments` (array tipado)

```json
[
  {"id": 123, "weight": "regular"},
  {"id": 124, "weight": "bold"}
]
```

Backward compatible: si el cliente tenía `nv_font_attachment_id` legacy
(singular), se sigue leyendo como una fuente regular. Al guardar el form
nuevo, se borra el legacy y se persiste el array.

### UI ficha del cliente

Donde antes había **un único campo** "Fuente personalizada" con un solo
botón, ahora hay una **lista dinámica** con:
- Cada fuente subida visible con su nombre
- Dropdown por fuente: `Regular / Thin` o `Bold`
- Botón ❌ Quitar por fuente
- Botón "🔤 Añadir fuente (TTF/OTF)" que abre el media picker

Heurística automática al añadir: si el nombre del archivo contiene "Bold"
(case-insensitive), se asigna `weight=bold`. Si ya existe una regular,
la siguiente se sugiere como bold. Siempre puedes cambiar manualmente.

### Rendering inteligente

Cuando la AI propone `headline_lines` con jerarquía:

```json
[
  {"text": "EN",       "size": "sm", "weight": "regular"},
  {"text": "CLÍNICA",  "size": "xl", "weight": "bold"},
  {"text": "MARCH",    "size": "xl", "weight": "bold", "color": "accent"},
  {"text": "CUIDAMOS DE TI", "size": "md", "weight": "regular"}
]
```

El plugin elige la fuente real por línea:
- `weight: regular` → `Montserrat-Regular`
- `weight: bold` → `Montserrat-Bold`

### Faux-bold inteligente

Si subes ambas fuentes (regular + bold real) → el plugin usa la Bold real
**sin** aplicar el offset 1px de faux-bold. La typografía sale limpia.

Si solo subes una fuente → el plugin sigue aplicando faux-bold como antes
(comportamiento idéntico a v1.0.62, no rompe nada).

## Cómo usarlo

### Paso 1 — Instalar
Plugins → Subir → `nv-dashboard-v1_0_63.zip` → Reemplazar → Activar.

### Paso 2 — Subir las dos fuentes en Clínica March

`Editar Clínica March` → 🎨 Branding → "Fuentes personalizadas":

1. Click "🔤 Añadir fuente" → selecciona `Montserrat-Regular.ttf` (o
   `Montserrat-VariableFont_wght.ttf` si usas la variable). El dropdown
   se autoselecciona como **Regular / Thin**.
2. Click "🔤 Añadir fuente" → selecciona `Montserrat-Bold.ttf`. El
   dropdown se autoselecciona como **Bold**.
3. Guardar.

### Paso 3 — Generar publicación de prueba

Modal "Generar mes" → 1 publicación → cuando se aplique el overlay, las
líneas con `weight: bold` saldrán en Bold real, las otras en Regular.

## Sobre fuentes Variable (Montserrat-VariableFont_wght.ttf)

Las fuentes variable contienen TODOS los pesos en un solo archivo, pero
**PHP-GD no soporta seleccionar el axis variable** (solo lee la weight
default del archivo, normalmente regular). Por eso recomiendo:

- **Mejor opción**: subir las versiones static separadas
  (`Montserrat-Regular.ttf` + `Montserrat-Bold.ttf`)
- **Funciona pero limitada**: la VariableFont sale como regular en TODOS
  los pesos solicitados, perdiendo la diferenciación

Las versiones static están en la carpeta `static/` que viene en el ZIP
oficial de Montserrat de Google Fonts.

## Diff técnico

- `includes/class-cliente-meta.php`: 3 helpers nuevos (`get_fonts_typed`,
  `get_font_path_by_weight`, retrocompat de `get_font_path`), UI ficha
  cliente reescrita (lista dinámica con JS), save handler nuevo con
  parser JSON + compat legacy.
- `includes/class-rest-api.php`: `apply_overlays_to_attachment` carga
  `font_regular` y `font_bold`, `composite_overlays_on_image` los
  propaga, `apply_clean_text_overlay` y `apply_frame_layout` eligen font
  por weight en cada línea + faux-bold inteligente.
- `nv-dashboard.php`: bump 1.0.62 → 1.0.63.

Total: ~21 líneas marcadas v1.0.63 entre los 2 archivos. Cambio
backward-compatible al 100%: clientes con la fuente legacy siguen
funcionando idénticamente.

## Lo que NO cambia

- Los meta de los posts (`_nv_image_prompt`, etc.) siguen iguales
- El system prompt de Anthropic no cambia (ya pedía `weight` en
  `headline_lines`)
- Los flujos de generación (4 rutas) siguen igual
- Si solo hay 1 fuente subida, comportamiento idéntico a v1.0.62
