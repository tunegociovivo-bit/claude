# v1.0.51 — Colores brand respetados al píxel exacto

## El bug que arrastrabamos desde v1.0.34 (2 meses)

La función `brighten_if_dark()` en el renderer "auto-aclaraba" cualquier color
de marca cuya luminancia fuera < 0.45, mezclándolo al 55% con blanco. La
intención original era "asegurar legibilidad sobre fondos oscuros". El efecto
real: destrozaba colores brand intencionalmente oscuros.

Caso Guardamuebles Reva:
  · Color brand accent declarado: #505252 (gris corporativo, lum 0.32)
  · Color renderizado en imagen:  #B0B1B1 (gris claro casi blanco)
  · Comprobación matemática inversa:
      176 = R + (255-R) × 0.55  →  R original = 80
      177 = G + (255-G) × 0.55  →  G original = 82
      177 = B + (255-B) × 0.55  →  B original = 82
      → Coincide exactamente con #505252.

David diagnosticó el síntoma muestreando los píxeles del texto en una imagen
ya generada. Se confirmó al 100% que el fill renderizado salía exactamente
brighten_if_dark(#505252) en vez de #505252.

## Cambios v1.0.51

1. **`resolve_color()` — eliminado `brighten_if_dark`** de los tokens `accent`
   y `primary`. Devuelven el color brand TAL CUAL configurado por el cliente.

2. **`dato_destacado` y `cta_visible`** — también devuelven `accent` exacto
   (antes lo pasaban por `brighten_if_dark` igual que el headline).

3. **`draw_text_with_thin_stroke()` — stroke contrastante automático.**
   Calculamos la luminancia del fill y dibujamos un stroke fino del color
   opuesto (blanco si el fill es oscuro, oscuro #141414 si el fill es claro)
   con alpha 30%. Esto da legibilidad universal sin alterar el color del fill.
   Grosor 1px (textos < 70px) o 2px (textos ≥ 70px). 8 direcciones cardinales
   y diagonales para que el contorno sea uniforme.

4. **`brighten_if_dark()` queda como función deprecada** — ningún callsite
   la invoca, pero la dejo definida por si código externo la llama. Marcada
   con docblock `@deprecated v1.0.51`.

## Verificación local antes del release

Reproducción local del renderer con la imagen real de David:
  - Texto v1.0.51 muestreado píxel a píxel en centro de letras grandes
  - "RESPIRA" letra P → RGB(80, 82, 82) = #505252 ✓ EXACTO al brand
  - "PRIMARY" letra P → RGB(198, 200, 47) = #C6C82F ✓ EXACTO al brand

## Cómo verificar tras instalar

1. Plugins → Desactivar NV Dashboard → Borrar → Subir
   `nv-dashboard-v1_0_51.zip` → Activar.

2. WP Admin → NV Dashboard → 📅 Editorial.

3. Abre cualquier post de Guardamuebles Reva ya con imagen (los generados
   con v1.0.50 ya tienen backup pre-overlay, así que funcionará el botón).

4. Pulsa **🔄 Re-aplicar texto**. Verás el texto en gris brand `#505252`
   con stroke blanco fino, en vez del gris claro #B0B1B1 anterior.

5. Comprueba con cualquier otro cliente: Clínica March (#134053 azul
   petroleum), Aquaking (#1F4E91 navy), etc. Sus colores oscuros también
   se respetarán ahora — antes salían lavados.
