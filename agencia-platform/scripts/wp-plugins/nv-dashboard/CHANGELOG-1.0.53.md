# v1.0.53 — Slider de fidelidad a refs + Análisis de competencia con IA

## Lo que pediste

> "Quiero que al generar cualquier publicación (individual o todo el mes) tenga
> un botón para que la IA analice a la competencia del cliente y me proponga
> temas. Y un slider 0%–100% para controlar cuánto se respetan las imágenes
> de referencia subidas."
>
> Decisiones:
> 1. Análisis competencia: opción γ (combinada — usa competidores configurados
>    en el cliente o, si no hay, los busca en web).
> 2. Slider de fidelidad: persistente por cliente con default 50% y override
>    puntual en el modal.

## A — Slider de fidelidad a refs (0-100%)

Tres rangos de comportamiento:

- **0–29% (libertad total).** El prompt visual NO inyecta la guía de estilo
  derivada de las refs. La IA compone desde cero usando solo el copy y los
  brand_brief/colores. Útil para clientes nuevos o cuando quieres salir del
  patrón.
- **30–69% (inspiración suave, default).** La guía de estilo se inyecta como
  *"draw mood, palette and composition cues — do not copy literally"*. Es lo
  que hacía el plugin antes pero ahora con el porcentaje explícito.
- **70–100% (replicación estricta).** La guía se inyecta como *"strictly
  replicate this brand pattern (composition, color blocks, badge/strip
  placement, typography hierarchy)"*. Para clientes con plantilla muy
  definida que la IA debe seguir al pie de la letra.

**Persistencia:**
- Default por cliente en la ficha (Editorial → Clientes → editar → 🎨 Branding
  → "Fidelidad a refs visuales"). Se guarda en `term_meta nv_refs_fidelity`.
- Override puntual en los modales: cada modal de generación trae un slider
  con checkbox "usar default por cliente" marcado. Al desmarcarlo el slider
  se aplica solo a ese lanzamiento, sin tocar el default del cliente.

**Trazabilidad:** cada post guarda `_nv_image_refs_fidelity_used` y
`_nv_image_prompt_last` para auditar qué fidelidad y qué prompt se usaron.

**Aplicado en 3 endpoints:**
- `POST /publicaciones-multi-cliente` (campo `refs_fidelity` opcional)
- `POST /generar-imagen-publicacion/{id}` (campo `refs_fidelity` opcional)
- Multi-cliente fase 2 (regeneración por post)

## B — Análisis de competencia con IA

**Endpoint nuevo:** `POST /wp-json/nv/v1/analizar-competencia/{term_id}`

Modo combinado (γ):
- Si `nv_competidores` tiene entradas → la IA analiza esos específicamente
  con web_search activado.
- Si está vacío → la IA busca competidores del sector y geografía del cliente
  en web (asume Costa del Sol/Marbella si el brief no es claro), los analiza
  e infiere temas a partir de su contenido.

Devuelve JSON:
```json
{
  "cliente_name": "Guardamuebles Reva",
  "mode": "configured" | "web_discovery",
  "competidores_analizados": [...],
  "temas": [
    {
      "tema": "Cómo organizar tu garaje en 5 pasos",
      "justificacion": "Tu competidor X publica este tipo de guías y...",
      "fuente": "Mudanzas García",
      "tipo_sugerido": "carrusel"
    }
  ]
}
```

**Botones añadidos:**
- En modal multi-cliente: "🔍 Analizar competencia y elegir temas". Llama al
  endpoint para cada cliente seleccionado (max 3 paralelo), abre selector con
  checkboxes agrupados por cliente.
- En modal generar-mes: "🔍 Analizar competencia y elegir temas (rellena el
  mix automáticamente)". Usa el cliente filtrado actualmente.

**Modal de selección de temas** (nuevo):
- Lista temas con checkboxes, agrupados por cliente
- Cada tema muestra: título, justificación, tipo sugerido (imagen/reel/etc),
  fuente (qué competidor lo inspiró)
- Botones "Marcar todos" / "Desmarcar todos" / contador en vivo
- Al confirmar inserta los temas en el textarea de tema/brief con formato
  estructurado (agrupado por cliente si son varios)

## Campos nuevos en cliente

Editorial → Clientes → editar → 🎨 Branding:

1. **Patrón visual** (existía desde v1.0.52): clean | frame
2. **Fidelidad a refs visuales** (NUEVO): slider 0–100, default 50
3. **Competidores** (NUEVO): textarea, una URL/nombre por línea

## Cómo verificar tras instalar

1. Plugins → Desactivar/Borrar → Subir `nv-dashboard-v1_0_53.zip` → Activar.

2. **Configurar competidores:** Editorial → Clientes → editar Guardamuebles
   Reva → 🎨 Branding → en el textarea "Competidores" mete 2-3 URLs de
   competidores reales (ej: `https://mudanzascotrina.com`, `@gomeztrans`).
   Guardar.

3. **Probar análisis competencia:** abrir modal multi-cliente (click en una
   fecha vacía del calendario) → marcar Guardamuebles Reva → pulsar
   "🔍 Analizar competencia y elegir temas". Espera ~30-60 segundos. Se abre
   modal con la lista de temas. Marca 2-3 que te gusten → confirmar. Verás
   que el campo Tema/brief se rellena con esos temas.

4. **Probar slider de fidelidad:** en el mismo modal, mueve el slider a 90%
   y desmarca "usar default por cliente" → genera la publicación. La imagen
   debería seguir mucho más fielmente el patrón de las refs (franja diagonal
   verde + cápsulas).

5. **Probar fidelidad por defecto:** en la ficha del cliente, baja el slider
   a 20% y guarda. Genera otra publicación con el modal en "usar default" →
   debería componer desde cero, ignorando las refs.

## Lo que NO está en v1.0.53 (por decisión deliberada)

- **Auto-detección de layouts por Vision** (la opción C que empezamos a
  diseñar): aplazada porque el slider de fidelidad cubre la misma necesidad
  de forma más simple. Si subes el slider al 100%, la IA replica el patrón
  visual de las refs sin necesidad de un parser geométrico.

- Los layouts `clean` y `frame` (v1.0.52) se mantienen tal cual; siguen
  siendo elegibles en la ficha del cliente.
