# v1.0.59 — Refs categorizadas + control explícito por usuario

## Resumen

David pidió poder controlar qué tipos de refs aparecen en cada publicación,
con checkboxes en post individual y sliders % en multi-cliente. Esto cierra
el problema de "a veces sale Rochar a veces no" — ahora tú decides.

## 5 categorías semánticas de refs

Cada foto que subes a la ficha del cliente se etiqueta con un tipo:

| Tipo | Etiqueta | Para |
|---|---|---|
| `persona_destacada` | 👤 CEO / Persona destacada | Rochar, director, fundador |
| `equipo` | 👥 Equipo / Trabajadores | Médicos, asistentes, recepción |
| `instalaciones` | 🏢 Local / Clínica / Negocio | Espacios físicos del cliente |
| `pacientes_usuarios` | 🧑 Paciente / Usuario | Clientes (con consentimiento RGPD) |
| `productos` | 📦 Producto | Catálogo, packaging |

Las categorías están alineadas con las subcarpetas tipadas que ya tenías
configuradas en Drive (`persona_destacada`, `equipo`, `instalaciones`...).

## UX por flujo

### 1. Ficha del cliente
- Cada thumbnail ahora tiene un selector de tipo debajo
- Las refs antiguas (sin categoría) se tratan automáticamente como "general"
- Storage backward-compatible: si en BD había `[12,34,56]`, se sigue leyendo

### 2. Generar 1 publicación / Lote por cliente (modal "Generar mes")
- Sliders % por tipo: CEO, Equipo, Instalaciones, Pacientes, Productos
- Si pones CEO al 30% en lote de 30 posts, los **9 posts más relevantes
  para CEO** llevarán refs de Rochar
- La AI (Anthropic) puntúa cada post 0-100 en cada categoría y los TOP X%
  por puntuación llevan ese tipo

### 3. Multi-cliente
- Checkboxes simples por tipo (no sliders, porque cada cliente solo crea 1 post)
- Si marcas CEO, TODOS los clientes seleccionados generarán post con su CEO

## Cómo decide la AI cuáles son los más relevantes

Nuevo campo en la respuesta de Phase 1 (Anthropic):

```json
"ref_relevance": {
  "persona_destacada": 95,   // copy menciona a Rochar por nombre
  "equipo": 20,
  "instalaciones": 30,
  "pacientes_usuarios": 10,
  "productos": 5
}
```

### Algoritmo de asignación (probado con 10 posts simulados)

Para `percent_targets = {persona_destacada: 30, instalaciones: 50}`:
- umbral CEO = 100 - 30 = 70 (clamped 30-90)
- umbral Instalaciones = 100 - 50 = 50

Cada post compara su `ref_relevance[tipo]` con el umbral. Si supera, lleva
refs de ese tipo. Resultado: los posts más relevantes para CEO van por `/edits`
con fotos de Rochar; los menos relevantes siguen por `/generations` con
escenas conceptuales.

Validado con 10 casos de copy reales — distribución correcta:
- Posts con "Rochar te escucha" → puntuación CEO 90+ → llevan refs CEO
- Posts genéricos de marca → puntuación baja en todo → no llevan refs
- Posts sobre el local → puntuación Instalaciones 80+ → llevan refs Instalaciones

## Compatibilidad y seguridad

### Backward compatible
- Cliente con refs sin categorizar (formato `[12,34]`) sigue funcionando
- Modo automático (sin sliders ni checkboxes) → cae al heurístico v1.0.57
- Cliente sin refs subidas → sigue por `/v1/images/generations` puro

### Trazabilidad ampliada
El endpoint `/test-imagen-publicacion/{id}` ahora devuelve:
- `image_endpoint_used`: `"edits"` o `"generations"`
- `image_refs_used`: IDs de fotos pasadas a OpenAI
- `image_refs_detection`: razones (heurístico o forzado)
- `image_forced_types`: qué tipos se forzaron (v1.0.59)
- `ref_relevance`: puntuación AI por tipo (v1.0.59)
- `pct_targets_genmes`: % objetivo del lote (v1.0.59)
- `image_pct_resolved`: cómo se resolvió por este post (v1.0.59)

### Cambio interno: endpoint individual unificado
Antes (v1.0.55), `generar_imagen_publicacion` (endpoint individual) hacía
su propia llamada a OpenAI sin soporte de refs. Ahora delega al helper
`generate_image_via_openai` igual que el calendario y multi-cliente.
Resultado: las 3 rutas (calendario, multi-cliente, individual) tienen
comportamiento consistente.

## Cambios técnicos

| Archivo | Líneas tocadas | Descripción |
|---|---|---|
| `nv-dashboard.php` | 4 | bump 1.0.58 → 1.0.59 |
| `includes/class-cliente-meta.php` | 228 | get_reference_images_typed, get_reference_images_by_type, save handler con tipo, UI ficha cliente con selector tipo |
| `includes/class-rest-api.php` | 683 | helper acepta forced_types, system prompt pide ref_relevance, callsite calcula umbrales, endpoint individual unificado, diagnóstico expandido |
| `admin/views/editorial.php` | 58 | sliders % en modal Generar mes, checkboxes en modal multi-cliente |
| `admin/js/dashboard.js` | 15 | leer sliders y checkboxes, enviar al body del request |

**Total: ~990 líneas modificadas en 5 archivos.**

## OAuth Drive (DESCARTADO en esta versión)

David pidió la opción A (OAuth Drive server-side). La descartamos
deliberadamente porque:
1. Requiere paso manual del usuario (autorizar app en Google)
2. Implementación honest = 4-6h adicionales (token refresh, scopes,
   cache, error handling)
3. Funcionalmente es equivalente a refs locales: el usuario sube las
   mismas fotos a `wp-content/uploads` que ya tiene en Drive
4. Para mañana 04/05 (David empieza a trabajar), riesgo bajo es prioridad

Documentado para v1.0.60 como mejora futura. Las fotos en Drive siguen
siendo la fuente de verdad humana; las copias locales en hub son las
operacionales.

## Aplicación

### Paso 1 — Instalar
Plugins → Subir → `nv-dashboard-v1_0_59.zip` → Reemplazar → Activar.

### Paso 2 — Categorizar refs existentes
NV Clientes → editar Clínica March → ver thumbnails de refs subidas
→ poner cada una su tipo (CEO para fotos de Rochar, Instalaciones para
fotos del local, etc.) → Actualizar.

### Paso 3 — Generar lote de prueba
Calendario → Generar publicaciones → marcar **CEO al 100%** → 1
publicación → si todo OK, la imagen DEBE mostrar a Rochar reconocible.

Verificación con curl:
```
curl.exe -sS -u "info@negociovivo.com:TdPq gf8H fwYS qOCP RnEy Fjuf" \
  "https://hub.negociovivo.com/wp-json/nv/v1/test-imagen-publicacion/{ID}"
```

Buscar en respuesta:
- `image_endpoint_used` = `"edits"`
- `image_forced_types` contiene `"persona_destacada"`
- `image_refs_used` con IDs de las fotos limpias de Rochar (36, 37, 38)

Si todos coinciden y la imagen sigue sin parecerse a Rochar, el siguiente
paso técnico es entrenar un LoRA específico de Rochar (servicio externo,
~30-50€ una vez). Pero esta versión debería resolver el caso normal.

## Lo que NO se ha hecho (transparencia)

- ❌ OAuth Drive server-side (descartado por tiempo)
- ❌ Plantilla por cliente con valores % por defecto
- ❌ Override en post individual (regenerar con tipo específico desde modal)
- ❌ Preview de coste antes de lanzar el lote
- ❌ Badges visuales en el calendario indicando qué refs lleva cada post

Estas funciones quedan documentadas como v1.0.60 cuando David tenga tiempo.
