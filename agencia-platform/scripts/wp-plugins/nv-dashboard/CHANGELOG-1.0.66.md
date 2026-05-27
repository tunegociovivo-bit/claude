# v1.0.66 — Control explícito de elementos visuales en la imagen

## El bug que arregla

David generó posts en el modal "Generar mes" y siempre salían con:
- Headline grande (TU TRATAMIENTO ES ÚNICO CLÍNICA MARCH)
- **Dato destacado** debajo (Consulta personalizada sin coste inicial)
- **CTA grande** abajo (AGENDA YA)

Resultado: imágenes sobrecargadas. Con headlines de 3 líneas xl/lg + dato + CTA, el texto ocupaba más del 50% de la composición.

## Causa raíz

El modal "Generar mes" NO tenía controles para los flags de overlay. El backend en `generar_mes_ai` los auto-activaba así:

```php
'add_data' => !empty($dato_destacado),  // ← TRUE siempre
'add_cta'  => !empty($cta_visible),     // ← TRUE siempre
```

Y como Anthropic SIEMPRE devuelve `dato_destacado` y `cta_visible` (porque son campos del JSON template), siempre se renderizaban.

El modal **multi-cliente** sí tenía esos toggles desde hace tiempo (con default OFF para dato/cta) — pero el modal "Generar mes" no los heredó. Bug de paridad entre los dos modales.

## Lo que cambia v1.0.66

### Nuevo bloque en el modal "Generar mes"

Después del slider de longitud del copy, ahora aparece:

```
🎨 Elementos visuales en la imagen
☑ 🏷️ Logo corporativo (esquina inferior)
☑ 📝 Titular grande (TU TRATAMIENTO ES ÚNICO)
☐ 📊 Dato destacado (línea pequeña debajo del titular)
☐ 🚀 CTA visible (AGENDA YA, RESERVA CITA, etc.)
```

**Defaults**: logo + titular activados, dato + CTA desactivados (imagen limpia editorial).

### Backend respeta los flags literalmente

Antes: `add_data = true` si Anthropic devolvió contenido (siempre).
Ahora: `add_data = $overlay_opts['add_data'] && !empty($dato_destacado)` — solo si el operador lo activó Y la AI generó contenido.

Misma lógica para los 4 flags. Se persisten en `_nv_img_opts` del post para que Phase 2 (composite) los respete.

## Casos de uso recomendados

| Tipo de imagen | Logo | Titular | Dato | CTA |
|---|---|---|---|---|
| **Editorial limpia** (default, recomendado para Clínica March) | ✓ | ✓ | ✗ | ✗ |
| Post informativo con cifra clave | ✓ | ✓ | ✓ | ✗ |
| Flyer comercial con oferta | ✓ | ✓ | ✓ | ✓ |
| Imagen pura sin texto | ✓ | ✗ | ✗ | ✗ |
| Solo CTA (anuncio directo) | ✓ | ✗ | ✗ | ✓ |

## Posts viejos (122, 127, etc.)

Los posts ya creados antes de v1.0.66 tienen `_nv_img_opts` con dato/cta activos. Si quieres limpiarlos sin regenerar la imagen, hay dos opciones:

**Opción A** — Borrar y regenerar desde el modal con checkboxes nuevos.

**Opción B** — Llamar al endpoint `reaplicar-overlay` con flags explícitos:
```bash
curl.exe -sS -X POST -u "info@negociovivo.com:TdPq gf8H fwYS qOCP RnEy Fjuf" \
  -H "Content-Type: application/json" \
  -d '{"add_logo":true,"add_text":true,"add_data":false,"add_cta":false}' \
  "https://hub.negociovivo.com/wp-json/nv/v1/reaplicar-overlay/127"
```

(En la próxima versión añadiré un botón en la UI para esto, "🧹 Limpiar overlays".)

## Cómo verificar

### Paso 1 — Instalar
Plugins → Subir → `nv-dashboard-v1_0_66.zip` → Reemplazar → Activar.

### Paso 2 — Test
Modal "Generar mes" → verás el nuevo bloque morado **🎨 Elementos visuales en la imagen** con 4 checkboxes (logo+titular activos, dato+CTA inactivos por defecto).

Genera 1 publicación dejando los defaults. Resultado esperado: imagen con solo el headline grande + logo en la esquina, sin el dato pequeño ni el CTA debajo. Mucho más limpia.

### Paso 3 — Si quieres incluir CTA
Marca el checkbox 🚀 CTA visible antes de generar. Ahora se incluirá.

## Archivos modificados

- `admin/views/editorial.php`: nuevo bloque morado con 4 checkboxes después del slider de longitud
- `admin/js/dashboard.js`: leer checkboxes y enviar `overlay_opts` en el body
- `includes/class-rest-api.php`:
  - leer `overlay_opts` del request
  - construir `$img_opts` respetando explícitamente esos flags
  - los flags se persisten en `_nv_img_opts` del post → Phase 2 (composite) los respeta automáticamente

`nv-dashboard.php`: bump 1.0.65 → 1.0.66

Total: ~50 líneas modificadas. Backward compat: si no se envían `overlay_opts` (clientes API antiguos, multi-cliente), defaults idénticos a antes.
