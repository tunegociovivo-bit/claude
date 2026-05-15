# v1.0.50 — Brand colors aplicados en TODOS los flujos de imagen

## El problema (v1.0.49 y anteriores)

David configuraba los colores corporativos del cliente (ej: Guardamuebles Reva
con #C6C82F #505252 #FFFFFF) en Editorial → Clientes → editar → 🎨 Branding.
Al generar el calendario mensual, los títulos sobre las imágenes seguían
saliendo con blanco y gris claro, ignorando los colores configurados.

## Causa raíz

El plugin tenía 3 flujos de generación de imagen y solo 1 aplicaba overlays:

| Flujo                                       | ¿Aplica brand_colors? |
|---------------------------------------------|-----------------------|
| `/generar-imagen-publicacion/{id}` (regen)  | ✅ SÍ                 |
| `/publicaciones-multi-cliente` (Fase 1+2)   | ❌ NO                 |
| `/openai-image-proxy/{id}` (botón Claude)   | ❌ NO                 |

En los 2 flujos sin overlay, el texto que aparecía en la imagen era el que
gpt-image-2 decidía bakear directamente — generalmente blanco/gris por defecto
porque la AI no conocía los colores brand del cliente.

Además, el prompt para tipo `reel`/`story` decía explícitamente "Optional
minimal text overlay (max 4 words)", invitando a la AI a generar texto.

## Cambios v1.0.50

1. **Helper reutilizable `apply_overlays_to_attachment()`**: extraído del bloque
   inline que solo vivía en `generar_imagen_publicacion`. Ahora lo llaman los 3
   flujos de generación más el nuevo endpoint de re-aplicar.

2. **Multi-cliente (`generate_image_for_post`) ahora aplica overlays** tras la
   generación con gpt-image-2/Freepik. Los brand_colors del cliente finalmente
   se respetan.

3. **OpenAI image proxy también aplica overlays** cuando `upload_to_post=true`.

4. **Prompt endurecido en `build_image_prompt_for_multi_cliente`**: ahora prohíbe
   ABSOLUTAMENTE texto/letras/logos en TODOS los tipos (incluido reel/story).
   El texto se compone después en PHP/GD con la tipografía y colores correctos.

5. **Nuevo endpoint `POST /reaplicar-overlay/{id}`**: re-aplica el overlay sobre
   la imagen YA generada usando los brand_colors actuales del cliente. Útil para
   probar cambios de color sin gastar API de OpenAI ($0.03–$0.05 por intento).
   Funciona porque ahora guardamos un backup pre-overlay del attachment la
   primera vez que se aplica.

6. **Botón "🔄 Re-aplicar texto"** en el modal de previsualización de cualquier
   post que tenga imagen. Muestra los 3 colores que se han usado realmente
   (con swatches) y el `source` (`explicit`/`extracted`/`default`) para
   diagnóstico inmediato.

7. **Backup automático pre-overlay**: la primera vez que se aplica overlay a
   un attachment, copiamos el archivo a `<filename>__pre-overlay.<ext>` y
   guardamos la ruta en `_nv_attachment_pre_overlay`. Las re-aplicaciones
   parten de esa copia limpia (no se acumulan overlays).

8. **Diagnóstico**: nuevo post_meta `_nv_brand_colors_used` con el JSON exacto
   de los colores usados en la última composición. Útil para inspección.

## Cómo verificar tras instalar

1. Plugins → Desactivar NV Dashboard → Borrar → Subir `nv-dashboard-v1_0_50.zip`
   → Activar.
2. WP Admin → NV Dashboard → 📅 Editorial.
3. Click en cualquier publicación de Guardamuebles Reva que ya tenga imagen
   generada.
4. En el modal verás botón **🔄 Re-aplicar texto**. Al pulsarlo:
   - **Si la imagen es post-v1.0.50** (regenerada hoy con esta versión) → se
     re-aplica con los colores actuales del cliente y verás los swatches al lado.
   - **Si la imagen es pre-v1.0.50** → te dirá que regeneres una vez para que
     se guarde el backup pre-overlay.
5. Para confirmar el flujo multi-cliente: genera un mes nuevo de Guardamuebles
   Reva. Las imágenes saldrán SIN texto bakeado (gpt-image-2 ya no lo añade) y
   con texto compuesto por PHP en el verde corporativo + gris brand.

## Notas técnicas

- Los archivos `__pre-overlay.<ext>` se acumulan en `wp-content/uploads/`. No
  son visibles en Media Library (no tienen attachment). Si quieres limpiarlos
  manualmente, busca `*__pre-overlay.*` en el directorio de uploads del año/mes.
- El backup pre-overlay solo se crea para attachments que se procesen con
  v1.0.50+. Posts antiguos seguirán sin backup hasta que se regenere su imagen.
