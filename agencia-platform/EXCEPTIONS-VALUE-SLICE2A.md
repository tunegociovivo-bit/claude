# Slice 2a — Bandeja de excepciones con valor

Rama `feature/exceptions-ux-value`, sobre la release desplegada `fd952aa8`. PR draft.
**Sin deploy, sin migraciones, sin acciones externas.** Aditivo y detrás del mismo
kill-switch (`NEXT_PUBLIC_EXCEPTIONS_UI` / `localStorage['exceptions-ui']=off`).

## Problema (producción)

La bandeja se inundaba con cientos de tareas vencidas hace 1400–1500 días, todas "A0 /
SONIA no hará nada". Causa raíz (auditada): los colectores de tareas/facturas filtraban
solo `dueDate < now` **sin suelo de antigüedad ni ventana de recencia** (que sí aplicaban a
drafts/runs); `daysLate > 7 → high` marcaba grave todo lo antiguo; y el orden + `take:300`
eran "más antiguo primero" → lo reciente/accionable quedaba enterrado.

## Qué cambia

- **Ventana de recencia** (`ACTIVE_WINDOW_DAYS=90`, configurable por query `activeWindowDays`)
  también en tareas/facturas. La vista principal muestra solo trabajo **actual**; lo más
  antiguo va a un **histórico agrupado** (no se pierde).
- **Severidad por impacto, no por edad:**
  - Tareas: por **recencia** (recién vencida = urgente/recuperable; antiquísima = baja). Si
    es de un cliente, sube un tramo.
  - Facturas: por **mora × importe** (banda cualitativa, nunca € exacto). La deuda grande y
    con mora es lo más grave.
- **Orden por prioridad** (`scoreItem`): severidad domina, recencia hace que lo
  accionable-ahora encabece, la fuente desempata. Fin del sesgo "más antiguo primero".
- **Clustering del histórico** por (origen, tipo, cliente) con conteo, etiqueta y drill-down
  (`view=archive`). En la vista activa se resume con un banner ("N tareas vencidas hace >90
  días") + "Ver histórico".
- **Inicio ejecutivo** (pestañas): **Prioridades**, **Hoy**, **Cobros y SLA**, **Clientes en
  riesgo** (agregado por cliente), **Hecho por SONIA** (runs `SUCCEEDED` recientes = evidencia
  de valor), **Histórico**.
- **"Qué hará SONIA" real:** las tareas dejan de decir "nada" — proponen un siguiente paso
  concreto (reprogramar/recordar/limpieza en lote), como borrador para tu OK. Nunca "nada"
  salvo prohibición de política.

## Rendimiento / seguridad

- La vista activa usa `orderBy dueDate desc` + cap → conserva lo reciente, no lo ancestral.
  El histórico se **cuenta** (2 `count` baratos), no se carga, salvo que abras `view=archive`
  (paginado). Evita re-inundar.
- Se añade `client { name }` a los `select` (nombre = campo PUBLIC del serializer). **No se
  exponen importes €** — solo banda `bajo/medio/alto`, y solo a quien ya puede ver facturación
  (`includeBilling` = admin, como antes).
- Tenant: todas las consultas siguen scoping por `workspaceId`. `lint:tenant` verde.

## Pruebas

- `lib/exceptions/__tests__/engine.test.ts` (actualizado a severidad por impacto).
- `lib/exceptions/__tests__/priority.test.ts` (**nuevo**): score/orden por recencia,
  partición actual/histórico, clustering, secciones ejecutivas, `fromDoneRuns`, y una
  **regresión del flood real** (500 tareas antiquísimas + 3 recientes → las recientes
  encabezan, las 500 quedan en 1 cluster; sin PII).
- `app/api/v1/exceptions/__tests__/route.test.ts` (tenant en toda consulta, billing solo
  admin, filtros).

## Pendiente (siguientes slices)

- **2b**: persistencia server-side idempotente y auditada de acciones (archivar/ignorar/
  reprogramar/limpieza en lote) — hoy el ocultar sigue en localStorage.
- **2c**: "Qué hará SONIA" pasa de plantilla determinista a borrador real cuando el motor de
  autonomía A0–A4 esté cableado.
</content>
