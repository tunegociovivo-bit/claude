# NV Dashboard v1.0.15

## Novedades

### 🖼️ Configuración de modelo de imagen IA por cliente

Ahora puedes elegir qué motor de IA debe usar Claude cuando pulses
**"Generar imágenes con Claude"**, y configurarlo distinto para cada cliente.

**Modelos soportados** (todos vía API):
- **Seedream V4.5 Edit** (Freepik) — default actual, óptimo con reference_images
- **GPT-Image-2** (OpenAI directo) — premium, mejor renderizado de texto, $0.006-$0.211/img
- **Mystic 2.5** (Freepik) — fotorrealista premium
- **GPT 1.5 High** (Freepik) — versión Freepik del modelo de OpenAI
- **Nano Banana Pro** (Freepik · Google Gemini 3) — competidor directo

**Settings nuevos** (en *NV Dashboard → Configuración*):
- Campo **OpenAI API key** (sólo necesaria si usas GPT-Image-2)
- **Modelo por defecto** (global, default = Seedream V4.5 Edit)
- **Override por cliente** — tabla con un selector por cada cliente registrado

**Endpoint REST nuevo**:
- `GET /wp-json/nv/v1/cliente-config/{slug}` — devuelve modelo + key OpenAI si aplica

**Comportamiento del botón "Generar imágenes con Claude"**:

1. El JS lee la config del cliente vía `cliente-config/{slug}`
2. Si el modelo requiere OpenAI key y no hay, redirige a Configuración
3. El prompt que se construye incluye:
   - Modelo configurado (con label, provider, endpoint, auth)
   - Si es GPT-Image-2: la API key + ejemplo de llamada lista para copiar
   - Instrucciones específicas del modelo (Seedream con refs, GPT-2 sin refs, etc.)

Así, Claude siempre sabe qué modelo usar para cada cliente sin que tengas
que recordarlo cada vez.

### Cambios técnicos

- `class-rest-api.php`: nueva ruta `/cliente-config/{slug}` + función `cliente_config()`
- `class-admin-pages.php`: nuevo bloque de save para opciones de imagen
- `admin/views/settings.php`: nuevo card "🖼️ Modelo de generación de imagen por cliente"
- `admin/js/dashboard.js`: `nvGenerarImagenesConClaude` ahora hace fetch del cliente-config y adapta el prompt
- Nuevas opciones en wp_options:
  - `nv_dashboard_openai_api_key` (string)
  - `nv_dashboard_modelo_imagen_default` (string)
  - `nv_dashboard_modelo_imagen_por_cliente` (JSON)
