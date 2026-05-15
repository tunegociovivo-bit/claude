# NV Dashboard 1.0.75 — Imágenes de referencia visual del cliente en el prompt de vídeo

## El bug que motiva esta versión (12/05/2026)

Reel de Mar Costa del Sol post 415. El cliente tenía cargadas 6 imágenes
de referencia visual en la ficha (1 foto de **Pilar Oliva** marcada como
`persona_destacada` + 5 plantillas marcadas como `productos`). El copy
del reel mencionaba a Pilar como la consultora protagonista.

A pesar de que v1.0.74 ya pasaba colores, fuentes, brief, web y style
guide al Claude externo, **NO le pasaba las imágenes de referencia ni el
roster del equipo**. El chat externo respondió literalmente:

> He pivotado el guion a figuras humanas de espaldas/anónimas porque
> (a) no tengo refs de Pilar en el chat ni en la subcarpeta del cliente
> en Drive (solo veo "[productos] Plantillas")…

El problema es estructural: el bloque "REFS VISUALES DEL CLIENTE" de
v1.0.73/74 solo apuntaba a **carpetas de Drive** (`refs_drive`), pero las
refs cargadas por David directamente en la ficha del cliente vía
WordPress Media Library (`nv_reference_images` term meta) no se exponían
en absoluto al prompt.

## Lo que añade v1.0.75

### Backend — `includes/class-rest-api.php`

`GET /wp-json/nv/v1/cliente-config/{slug}` ahora devuelve un campo
adicional `reference_images` con el listado completo de refs visuales WP
del cliente:

```json
"reference_images": {
  "total_count": 6,
  "counts_by_type": { "persona_destacada": 1, "productos": 5 },
  "team_roster": [
    { "name": "Pilar Oliva", "type": "persona_destacada", "photo_count": 1 }
  ],
  "items": [
    {
      "id": 101,
      "url": "https://hub.../pilar-oliva.jpg",
      "thumb": "https://hub.../pilar-oliva-150x150.jpg",
      "type": "persona_destacada",
      "person_name": "Pilar Oliva"
    },
    { "id": 102, "url": "...", "type": "productos", "person_name": "" },
    …
  ]
}
```

El campo `team_roster` agrupa por persona usando el helper
`NV_Cliente_Meta::get_team_roster()` ya existente (v1.0.68). Permite al
chat externo saber, de un vistazo, quiénes son las personas identificadas
del cliente y cuántas fotos hay de cada una — exactamente lo que necesita
para mantener identidad facial coherente entre tomas.

Todo el payload reaprovecha helpers que ya estaban en
`NV_Cliente_Meta` (`get_reference_images_data`,
`get_reference_images_counts_by_type`, `get_team_roster`). Cero lógica
duplicada.

### Frontend — `admin/js/claude-widget.js`

Nuevo bloque inyectado en el prompt de vídeo entre **🎨 BRANDING DEL
CLIENTE** y **📁 REFS VISUALES DEL CLIENTE (Drive)**:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🖼️ IMÁGENES DE REFERENCIA DEL CLIENTE (Media Library)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

6 imágenes cargadas en WP por el cliente, cada una con tipo asignado
y, cuando aplica, nombre de la persona.

Equipo identificado (usa estos nombres si el copy menciona a alguien
del cliente; "persona_destacada" suele ser el/la CEO):
  • Pilar Oliva  [persona_destacada, 1 foto]

Distribución por tipo: persona_destacada: 1, productos: 5

Imágenes (URLs públicas, fetch directo desde el sandbox):
  • [persona_destacada · Pilar Oliva] → https://hub.…/pilar-oliva.jpg
  • [productos] → https://hub.…/ref-financiacion.jpg
  …

Workflow obligatorio:
  1. Descarga las URLs al sandbox con curl/requests (son públicas).
  2. Pásalas como reference_images a Seedream V4.5 Edit (max 5/call).
  3. Si el copy menciona a una persona del cliente por nombre,
     SELECCIONA las refs cuyo person_name coincida — no inventes
     una cara nueva ni pivotes a figuras anónimas/de espaldas.
  4. Si el copy menciona a alguien que NO aparece en el roster,
     PARAR y avisar a David antes de seguir.
```

Cierra con un recordatorio de la **distinción crítica gen vs edit** del
doc maestro: editar una imagen aportada con consentimiento documentado
ES el flujo normal NV y está permitido. Esto neutraliza la salida
defensiva que tuvo el chat externo el 12/05/2026.

### Ramas de comportamiento

- `total_count > 0` → bloque completo (caso normal).
- `total_count === 0` → bloque corto "ninguna cargada" con instrucción
  de parar si el copy menciona persona concreta.
- `cfg.reference_images === null` (endpoint no devolvió el campo, ej.
  versión vieja del plugin) → el bloque entero se omite, sin romper.

## Tamaño del prompt

Con Mar Costa del Sol completo (branding + 6 refs visuales + Pilar
Oliva en el roster + refs Drive pending): **6.803 caracteres**. Sigue
por debajo del umbral de aviso del widget (7.500).

Si en el futuro un cliente tiene 30+ refs visuales el listado podría
acercarse al límite. Solución cuando llegue: filtrar por relevancia en
el frontend antes de imprimir (por ejemplo, top 8 por uso o por
person_name presente). De momento no aplica.

## Archivos modificados

- `includes/class-rest-api.php` — campo `reference_images` en
  `cliente_config()`.
- `admin/js/claude-widget.js` — bloque "🖼️ IMÁGENES DE REFERENCIA DEL
  CLIENTE" en buildMessage cuando `tipoRevision === 'video'`.
- `nv-dashboard.php` — versión 1.0.74 → 1.0.75.

## Cómo verificar

1. En NV Dashboard → Editorial → Clientes, edita un cliente. En la
   sección "📚 Imágenes de referencia visual" sube alguna foto y
   asígnale tipo `persona_destacada` + nombre (ej: "Pilar Oliva").
2. Edita una publicación reel de ese cliente.
3. "🤖 Pedir revisión a Claude" → tipo "🎬 Cambiar / editar vídeo" →
   escribe orden → "👁 Previsualizar mensaje".
4. Debe aparecer la sección "🖼️ IMÁGENES DE REFERENCIA DEL CLIENTE"
   con el roster, distribución por tipo y URLs públicas listadas.
