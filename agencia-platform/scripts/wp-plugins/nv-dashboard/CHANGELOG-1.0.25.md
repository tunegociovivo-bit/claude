# NV Dashboard v1.0.25

Generación automática de imágenes para el flujo multi-cliente, con dos
fixes para que los fallos de imagen ya no sean silenciosos.

## Lo nuevo

Cuando lanzas el flujo "🎯 Publicación multi-cliente", el plugin ahora
genera **también la imagen** para cada publicación creada, no solo el copy.

### Flujo completo

1. Tú escribes el tema: "Día de la madre — felicitación cálida y emotiva".
2. Marcas los clientes y le das a 🚀 Generar.
3. Para cada cliente:
   - Anthropic genera copy + hashtags + sugerencia visual.
   - Se crea el post (visible en el calendario de inmediato).
   - Server-side se llama a OpenAI gpt-image-2 con un prompt construido a
     partir de la sugerencia visual + brief de marca + tipo de post.
   - La imagen se sube a Media Library y se asocia como featured + nv_asset_url.
4. El modal muestra cada publicación con su miniatura cuando termina.

### Inputs nuevos en el modal

- **Checkbox "✨ Generar también la imagen"**: marcado por defecto. Si lo
  desmarcas, vuelves al flujo de v1.0.24 (solo copy + hashtags + sugerencia
  visual textual).
- **Selector de calidad**: low ($0.006) / medium ($0.05) / high ($0.21)
  por imagen. Default: medium. Aplica solo a gpt-image-2.

### Tamaños por tipo

- imagen / story / reel → 1024×1536 (vertical)
- carrusel → 1024×1024 (cuadrado)
- video → 1536×1024 (horizontal)

## Fixes vs prueba inicial

Tras tu prueba: las publicaciones se crearon sin imagen. La causa eran
dos fallos silenciosos en el endpoint:

### Fix 1: tolerar `first_comment` vacío

Si Anthropic devolvía la respuesta sin el campo `first_comment` (a veces
los modelos son perezosos con campos secundarios), la condición original

```php
if ($generate_image && $ai_data && !empty($ai_data['first_comment']))
```

saltaba la generación **en silencio, sin error visible**. El post se
creaba con copy y hashtags pero sin imagen y sin pista de por qué.

Ahora: el endpoint intenta generar imagen siempre que `generate_image`
esté activo y haya copy. Si no hay sugerencia visual explícita, el
prompt se construye usando los primeros 240 caracteres del copy como
descripción visual fallback.

### Fix 2: errores de imagen siempre visibles en el resultado

Antes algunos errores podían escaparse sin propagarse al UI. Ahora,
cuando la generación falla por la razón que sea (key OpenAI vacía,
timeout, error de la API, modelo Freepik sin soporte server-side, etc.)
el campo `image_error` viaja al modal de resultado y se muestra como
cuadro rojo discontinuo con el motivo concreto en cada publicación
afectada. No más fallos silenciosos.

## Modelos soportados

| Modelo configurado en cliente | Soporte v1.0.25 |
|---|---|
| gpt-image-2 (OpenAI) | ✅ Completo, sync |
| seedream-v4-5-edit (Freepik) | ✅ async via Freepik API |
| mystic-2-5 (Freepik) | ✅ async via Freepik API |
| gpt-1-5-high (Freepik) | ✅ async via Freepik API |
| nano-banana-pro (Freepik) | ✅ async via Freepik API |

## Sin refs Drive en este flow

La generación multi-cliente usa `operation=generate` (text-to-image),
**no usa refs Drive**. Razón: descargar refs server-side por cada cliente
añadiría 30+ segundos por imagen.

Si una imagen no convence porque queremos la cara real del CEO o un
producto concreto, abre la publicación → widget Claude → "🎨 Generar
imágenes con Claude". Ese flujo sí usa refs Drive.

## Tiempo y coste estimados

- Por cliente: ~10s (copy) + ~25s (imagen gpt-image-2 medium) = ~35s
- Para 5 clientes: ~3 min · ~$0.30
- Para 10 clientes: ~6 min · ~$0.55

## Endpoint nuevo

`POST /wp-json/nv/v1/generar-imagen-publicacion/{id}` para regenerar la
imagen de una publicación concreta.

```json
{
  "quality": "medium",   // low | medium | high
  "force": true          // regenera aunque ya tenga imagen
}
```

## Verificación post-instalación

1. Activa v1.0.25.
2. NV Dashboard → Configuración → comprueba:
   - Anthropic API key (campo "Anthropic API")
   - **OpenAI API key** (campo "OpenAI API key" — para gpt-image-2)
3. Editorial → 🎯 Publicación multi-cliente.
4. Pon fecha, tema corto, marca **1 solo cliente** para probar.
5. Confirma que "✨ Generar también la imagen" está marcado y calidad
   = medium.
6. 🚀 Generar. Espera ~40 segundos.
7. El modal debe mostrar la publicación con miniatura.
8. Si la imagen falla, verás cuadro rojo con motivo concreto.

## Si sigue sin aparecer la imagen tras este v1.0.25

El cuadro rojo en cada publicación te dirá la razón. Las más probables:

- **"OpenAI API key no configurada"**: Configuración → pega la key.
- **"OpenAI error: invalid_api_key"**: la key está caducada/rotada.
- **"OpenAI error: rate_limit_exceeded"**: demasiadas en paralelo,
  reduce a 5 clientes por lote.
- **"max_execution_time exceeded"**: PHP corta. Sube
  `max_execution_time` en hosting o reduce clientes por lote.
