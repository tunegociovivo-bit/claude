# v1.0.68 — Identificación por persona + límite refs dinámico + roster real

## El bug crítico que arregla

David subió 11 refs a Clínica March bien categorizadas (3 CEO + 2 Equipo + 5 Local + 1 general). Generó "Conoce al equipo" → la imagen mostró **5 personas con bata pero ninguna era ni Rochar, ni la Dra Angie, ni la asistente real**. El plugin pasó las refs correctas, pero gpt-image-2 inventó al equipo.

## Diagnóstico de los 3 bugs estructurales

### Bug A — Cap de 4 refs hardcoded
```
forced_types: ["persona_destacada", "equipo", "instalaciones"]
refs_used: [37, 38, 36, 153]  ← solo 4 de las 10 disponibles
```

Plugin tenía un `array_slice($refs, 0, 4)` antiguo. Cuando se forzaban 3 tipos a la vez, perdía refs importantes (la 2ª foto del equipo + las 5 de instalaciones quedaban fuera).

### Bug B — La AI no sabe cuántas personas hay realmente
El `image_prompt` decía: `"team of 5-7 professionals"`. Pero realmente solo hay 3 personas reales (Rochar + Angie + asistente). gpt-image-2 obedecía el prompt e inventaba 4-5 caras adicionales para llegar a 5-7.

### Bug C — No hay forma de identificar quién es quién
Si subes 3 fotos de Angie y 1 de la asistente, el plugin las trata todas como "equipo" indiferenciado. La AI no sabe que son 2 personas distintas (cree que son 4 personas únicas). Cuando se piden 4 refs, gpt-image-2 mezcla las caras inventando un quinto personaje.

## Lo que cambia v1.0.68

### Fix A — Cap dinámico de refs

```php
$ref_cap = (3+ tipos forzados) ? 8 : ((2 tipos) ? 6 : 4);
```

- 1 tipo → cap 4 (suficiente, evita confusión modelo)
- 2 tipos → cap 6
- 3+ tipos → cap 8

gpt-image-2 acepta hasta 16 refs según API; 8 es un balance entre completitud y latencia.

### Fix B — Campo `person_name` opcional en cada ref

**UI nueva en la ficha del cliente**: cuando el tipo de una ref es `persona_destacada`, `equipo` o `pacientes_usuarios`, aparece un input de texto debajo del selector de tipo:

```
[thumbnail]
[👤 CEO / Persona destacada ▾]
[Nombre (ej: Dra Angie)        ]
```

Ahora puedes subir 3 fotos de la Dra Angie con nombre "Dra Angie Bech", 2 de la asistente con nombre "Asistente Carmen" y 4 de Rochar con nombre "Rochar". El plugin sabe que son **3 personas únicas**, no 9.

Storage: `[{id:36, type:"persona_destacada", person_name:"Rochar"}, {id:153, type:"equipo", person_name:"Dra Angie Bech"}, ...]`

Backward compat: refs sin `person_name` siguen funcionando como antes (genéricas).

### Fix C — Roster real inyectado al system prompt

Cuando hay refs con `person_name` configurado, el system prompt de "Generar mes" ahora incluye:

```
▼ ROSTER REAL DEL CLIENTE (CRÍTICO — REGLA NO NEGOCIABLE):
Las únicas personas REALES disponibles para aparecer en imágenes de este cliente son:
  · Rochar (CEO / Persona destacada, 4 fotos disponibles)
  · Dra Angie Bech (Equipo, 3 fotos disponibles)
  · Asistente Carmen (Equipo, 2 fotos disponibles)

INSTRUCCIONES OBLIGATORIAS para image_prompt:
  1. NUNCA digas "team of 5-7 professionals". Hay EXACTAMENTE 3 personas reales.
  2. Si copy es 'el equipo', describe escena con EXACTAMENTE 3 personas, no más.
  3. Refuerza con: 'group portrait of EXACTLY 3 people from the reference photos'.
  4. Si nombras a una persona, describe FÍSICAMENTE (mature woman blonde / etc.)
     porque gpt-image-2 NO entiende nombres pero SÍ descripciones físicas.
```

### Fix D — Sandwich prompt con conteo exacto

El prompt enviado a gpt-image-2 ahora incluye al final:

```
PERSON COUNT: The image must show EXACTLY 3 people from the reference photos —
not more, not less. If the scene description suggests more people (e.g. 'team
of 5-7 professionals'), IGNORE that and show exactly 3 people.
```

Esto fuerza al modelo a respetar el conteo real, no inventar miembros adicionales.

### Endpoint /diag-refs ampliado

Ahora devuelve también el roster con conteo de fotos por persona:

```bash
curl -sS -u "..." "https://hub.negociovivo.com/wp-json/nv/v1/diag-refs/clinica_march"
```

Devuelve:
```json
{
  "total_refs": 11,
  "counts_by_type": { "persona_destacada": 3, "equipo": 2, ... },
  "roster": [
    {"name": "Rochar", "type": "persona_destacada", "photo_count": 3},
    {"name": "Dra Angie Bech", "type": "equipo", "photo_count": 1},
    {"name": "Asistente Carmen", "type": "equipo", "photo_count": 1}
  ],
  "warnings": [...]
}
```

## Cómo usar (paso a paso para Clínica March)

### Paso 1 — Instalar
Plugins → Subir → `nv-dashboard-v1_0_68.zip` → Reemplazar.

### Paso 2 — Identificar a cada persona en las refs ya subidas
Editar Clínica March → Imágenes de referencia visual. Verás que ahora cada ref de tipo CEO/Equipo/Paciente tiene un input "Nombre" debajo. Rellena:

- **Las 3 fotos CEO de Rochar** → nombre "Rochar"
- **La foto de la Dra Angie Bech** (la mujer rubia con bata) → nombre "Dra Angie Bech"
- **La foto de la asistente** (mujer joven con bata) → nombre "Asistente" (o el nombre real si lo prefieres)

Guardar.

### Paso 3 — Verificar con curl
```bash
curl.exe -sS -u "info@negociovivo.com:TdPq gf8H fwYS qOCP RnEy Fjuf" \
  "https://hub.negociovivo.com/wp-json/nv/v1/diag-refs/clinica_march"
```

Debería mostrar `roster` con 3 personas únicas.

### Paso 4 — Regenerar el post 186 (o uno nuevo "Conoce al equipo")
Modal "Generar mes" → CEO 100% + Equipo 100% + Instalaciones 100% → 1 publicación.

Resultado esperado: imagen con EXACTAMENTE 3 personas (Rochar + Angie + asistente), reproduciendo sus caras de las refs, sin extras inventados.

## Diff técnico

### `includes/class-cliente-meta.php`
- `get_reference_images_typed`: parsea campo `person_name` del JSON (~5 líneas)
- `get_team_roster()` nuevo: helper que devuelve personas únicas por nombre+tipo (~30 líneas)
- `get_reference_images_data`: incluye person_name en el output
- UI render: input de texto bajo el selector de tipo, visible solo para tipos de persona
- JS: sync person_name al hidden, toggle visibilidad on type change, handler input
- Save handler: parsea y persiste person_name (sanitizado, max 60 chars)

### `includes/class-rest-api.php`
- `generate_image_via_openai`: cap dinámico de refs según número de tipos forzados
- Sandwich prompt: nuevo cálculo de `$person_count` por refs únicas + person_name; `count_clause` con "EXACTLY N people"
- `generar_mes_ai`: bloque ROSTER REAL inyectado al user_prompt cuando hay personas con nombre
- `/diag-refs`: incluye `roster` y campo `person_name` en `detalle`

`nv-dashboard.php`: bump 1.0.67 → 1.0.68

Total: ~150 líneas. Backward compat 100%: refs sin `person_name` siguen funcionando como antes.

## Notas honestas

- **gpt-image-2 sigue siendo gpt-image-2**: aunque le digas "EXACTAMENTE 3 personas", a veces genera 4 o 2. La regla mejora el comportamiento pero no es perfecta — si el primer intento falla, regenera.

- **El `person_name` no es un nombre que la AI "sepa"**: es solo un identificador para el plugin. La AI no le dirá a gpt-image-2 "dibuja a Angie Bech" — le dirá "mature blonde woman with white medical coat" basándose en cómo la AI interprete las refs. Eso es lo correcto: gpt-image-2 entiende descripciones físicas, no nombres.

- **Para que la cara de Angie sea reconocible**: necesitas al menos 2-3 fotos suyas en distintos ángulos. Una sola foto da resultados poco consistentes. Lo mismo para Rochar y la asistente.
