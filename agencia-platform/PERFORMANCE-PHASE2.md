# FASE 2 — Rendimiento y Navegación (HUB)

Rama `feature/hub-10x-phase-2-performance`, **apilada** sobre el HEAD validado de
Fase 1 (`8c2dde56`). PR draft separado. **No merge, no deploy.** Ningún índice se
aplica a producción automáticamente.

Este documento cubre lo entregado en este slice y el plan concreto de los
objetivos que quedan (para no tocar de forma arriesgada componentes de 3.5k–8.6k
líneas al final de una sesión larga).

---

## Entregado en este slice (seguro y testeado)

### Obj 2 — Buscador remoto de clientes (nuevo endpoint, aditivo)
`GET /api/v1/clients/search?q=&status=&limit=&cursor=&withCount=1`
- Devuelve **solo** `{id,name,status}` + `nextCursor` (+ `total` si `withCount=1`).
- Paginación por **cursor** (keyset sobre `id`, orden `name,id`) → coste O(limit), no O(total).
- **No toca** `/api/v1/clients` (compatibilidad total).
- Contrato puro testeado (`lib/db/client-search.ts`) + test de ruta con prisma/auth mockeados.
- Archivos: `lib/db/client-search.ts`, `app/api/v1/clients/search/route.ts` (+ tests).

### Obj 7 — Migración SQL de índices selectivos (GENERADA, **no aplicada**)
`db/migrations/2026-08-11-perf-indices.sql` — `CREATE INDEX CONCURRENTLY IF NOT EXISTS`:
- `LeadInboxMessage(workspaceId, receivedAt DESC)` — la lista de conversaciones ordena por `receivedAt` y **hoy no hay índice** en esa columna.
- `Client(workspaceId, status)` y `Client(workspaceId, name)` — filtro/orden del buscador (Client solo tenía `@@index([workspaceId])`, cardinalidad 1).
- `Task(workspaceId, updatedAt DESC) WHERE parentId IS NULL AND deletedAt IS NULL` — índice **parcial** que casa exactamente el fetch del tablón (`take 1500`).
- Incluye **EXPLAIN (ANALYZE, BUFFERS)** de verificación y **rollback** (`DROP INDEX CONCURRENTLY`).
- NO cableado al boot (`prisma db push` no ejecuta esta carpeta) → se aplica a mano, fuera de horas punta.

### Obj 8 — vitest en CI del PR
`.github/workflows/ci-agencia.yml` ahora ejecuta `npx vitest run` además de `tsc --noEmit` y las tenant-guards.

### Obj 9 — Benchmark verificable
`scripts/bench-client-payload.ts` (sintético, sin BD, sin PII):

| Clientes | `/api/v1/clients` (objeto completo) | `/clients/search` (1ª pág, 20 mín.) | Reducción |
|---|---|---|---|
| 500 | 353.693 bytes | 1.851 bytes | **191×** más ligero |
| 1000 | 707.694 bytes | 1.851 bytes | **382×** más ligero |

Además, el índice `LeadInboxMessage(workspaceId, receivedAt DESC)` convierte el
`Seq Scan + Sort` de la lista de conversaciones en un `Index Scan` sin sort
(verificable con el EXPLAIN del `.sql`).

### Obj 6 — Base del polling consolidado (sin reescribir LeadsClient)
- `lib/client/poller.ts` — `createPoller`: auto-reprogramado (siguiente tick al **terminar** el anterior → **sin solapamiento**), pausable. Puro y testeado (7 tests, timers falsos).
- `lib/client/usePollingChannel.ts` — hook React que **pausa con `document.hidden`** y reanuda disparando al volver.
- Adopción incremental: cada `setInterval(fn, ms)` de LeadsClient → `usePollingChannel(fn, ms, enabled)`.

---

## Slice UI entregado (obj 3, 4, 5, 6)

### Obj 3/4 — Combobox async accesible + virtualización (TareasClient)
- `components/tareas/ClientCombobox.tsx` sustituye el `<select>` nativo con cientos de `<option>` del filtro de clientes.
- ARIA combobox: `role=combobox` + `listbox`/`option`, `aria-expanded`, `aria-activedescendant`, teclado completo (↑/↓/Home/End/Enter/Esc/Tab), foco al abrir y retorno al cerrar.
- Búsqueda remota con **debounce** (`useClientSearch` → `/clients/search`), **recientes** en localStorage, **carga incremental** por cursor al hacer scroll, y **lista virtualizada** (solo filas visibles → DOM acotado).
- Lógica pura testeada (`lib/client/combobox-logic.ts`): dedupe, recientes, teclado, ventana virtual.
- **Requests/payload:** antes el `<select>` dependía de los ~500 clientes cargados en SSR (payload completo); ahora la primera apertura pide **20 filas mínimas (~1,8 KB)** y sólo carga más bajo demanda.

### Obj 5 — Sidebar: 1 carga agregada con fallback
- `GET /api/v1/sidebar-bootstrap` (compositor `lib/sidebar/bootstrap.ts`) devuelve en **1 respuesta** lo que antes eran **6 fetch `no-store`** (projects/clients/me/platforms/workspace/usage).
- El Sidebar lo usa como camino preferente y **cae a los 6 fetch** si falla → sin regresión. Invalidación explícita al cerrar el modal de proyecto (dep `newProjectOpen`).
- **Requests:** 6 → 1 por carga del Sidebar (−83 % de peticiones), reutilizando `effectiveFeatures`/`platformsVisibleTo` y el filtro de permisos de projects (testeado).

### Obj 6 — LeadsClient: polling consolidado y pausable
- `lib/client/poller.ts` + `usePollingChannel` cableados en LeadsClient: **5 `setInterval` de red solapables** (badge no-leídos 30s, panel 45s + tick 60s, items 60s, conversaciones 12s, hilo 8s) → canales **sin solapamiento** y **pausados al ocultar la pestaña** (reanudan disparando al volver).
- Mantiene la carga inicial y la recarga por filtros/selección. **Kill-switch:** `localStorage['disable-smart-polling']='1'` o `NEXT_PUBLIC_DISABLE_SMART_POLLING=1` desactiva la pausa por visibilidad.
- **Requests en segundo plano:** con la pestaña oculta pasan de ~5 pollers activos a **0** (antes seguían golpeando el backend indefinidamente).

## Slice de paginación + virtualización entregado (obj 1 y 4)

### Obj 1 — Paginación cursor + count SQL (tareas y conversaciones)
- **Clientes:** `/clients/search` (ya entregado, cursor por id).
- **Tareas:** `GET /api/v1/tasks/page` — cursor keyset `(updatedAt desc, id)`, SELECT mínimo, respeta `taskVisibilityWhere`, `count` opcional. Aditivo (no cambia `getTasksForUi`). Builder puro + ruta testeados.
- **Conversaciones (cursor SEGURO por conversación):** `GET /api/v1/leads/inbox/conversations/index`. Para NO caer en paginación engañosa, la agrupación se hace **en SQL** (`GROUP BY COALESCE(phoneNormalized,fromPhone)`), de modo que cada conversación es una fila atómica y nunca se parte entre páginas. **Invariantes** (en `lib/leads/conversation-index.ts`):
  - INV1 una conversación = una fila; nunca partida entre páginas.
  - INV2 `unread` = entrantes no leídos REALES de la conversación (COUNT FILTER, no acotado por ventana).
  - INV3 orden estable `last_at DESC, phone ASC` → cursor keyset determinista.
  - INV4 cursor = `(last_at, phone)`; página siguiente `last_at < c OR (last_at = c AND phone > c.phone)`.
  - INV5 `total` = nº de conversaciones; `totalUnread` = SUMA de unread (mismos filtros, sin cursor/limit).
  - **Alcance de filtros:** `account` + rango de fecha (puros sobre LeadInboxMessage). `blocked`/`q` NO se fingen aquí — la ruta completa existente los sigue sirviendo.
  - **Estado:** ruta ADITIVA, **no cableada a la UI**; requiere validar EXPLAIN con el índice `LeadInboxMessage(workspaceId,receivedAt)` (migración obj 7) antes de conectarla.

### Obj 4 — Virtualización de altura variable (primitiva)
- `lib/client/virtual-list.ts`: `buildOffsets` (prefix-sum) + `variableWindow` (búsqueda binaria → rango + padding) para listas de **filas de distinta altura** (tarjetas de tablón/inbox), con kill-switch (`NEXT_PUBLIC_DISABLE_VIRTUAL` / `localStorage 'disable-virtual'`). Testeada (offsets, binaria, ventanas, alturas variables, vacío).
- **Diferido con motivo (honesto):** el cableado en el **tablón Kanban (dnd-kit)** exige preservar drag/drop, selección, foco y medición de alturas → validación INTERACTIVA que no puede hacerse sin navegador; se entrega como slice propio sobre esta primitiva. El combobox ya va virtualizado (fila fija) y sirve de referencia.

### Benchmarks (requests/payload) — con matiz de coste HONESTO
- Conversaciones: la ruta actual carga 1000–5000 mensajes por request, agrupa en JS y devuelve **todo**; el índice devuelve **≤ limit+1 filas ya agrupadas** por página con `unread`/`total`/`totalUnread` correctos por SQL (payload por página mucho menor).
  - **IMPORTANTE (no engañoso):** la AGRUPACIÓN (`GROUP BY` sobre los mensajes del workspace) sigue siendo ~O(mensajes) por página, **incluso con** el índice `(workspaceId,receivedAt)` de la migración obj 7 — el índice reduce escaneo/orden pero NO evita el hash-aggregate completo. El coste O(limit) real por página exigiría una **tabla de summary por conversación mantenida** (last_at/unread incrementales); queda como evolución a escala. Por eso el endpoint está **gated en EXPLAIN y no cableado**.
  - El índice `LeadInboxMessage(workspaceId,receivedAt)` está en la migración **generada/no-aplicada** `db/migrations/2026-08-11-perf-indices.sql` (no en `schema.prisma`, para no auto-aplicarlo en el boot `db push`).
- Tareas: `getTasksForUi` trae hasta 1500 filas con include+firma de imágenes; `/tasks/page` devuelve `limit+1` filas mínimas por página (keyset real O(limit) por página).

## Pendiente real (siguiente slice)

- **Cablear** `/tasks/page` y `/conversations/index` a la UI (tras validar EXPLAIN del índice), migrando el tablón/inbox a scroll incremental.
- **Virtualizar el Kanban** dnd-kit sobre la primitiva `virtual-list` (con validación interactiva de drag/drop y medición de alturas).
- **Obj 6 (resto):** 1 poller acotado a un modal de ajustes (12s, sólo con el modal abierto): bajo impacto, migrable igual.

---

## Riesgos y rollback

- **Índices**: `CONCURRENTLY` no bloquea, `IF NOT EXISTS` es idempotente; rollback = `DROP INDEX CONCURRENTLY`. Riesgo bajo; el único coste es el tiempo de construcción del índice. No se aplican solos.
- **Endpoint nuevo**: aditivo; si algo fallara, basta con no consumirlo (los consumidores actuales siguen usando `/api/v1/clients`).
- **CI vitest**: si un test fuese flaky, el check `typecheck` (que ahora incluye vitest) se pondría rojo; el PR es draft, sin impacto en producción.
- **Poller/hook**: no cableados aún a ningún componente → cero riesgo en runtime hasta su adopción explícita.
- **Rollback global**: revertir la rama; nada de Fase 2 está desplegado. Base intacta en `8c2dde56` (Fase 1) y `f836844` (producción).

## Verificación ejecutada
- `npx vitest run` → 20 ficheros, 154 tests verdes (incluye los nuevos de Fase 2).
- `npx tsc --noEmit` → 0 errores.
- `node scripts/check-tenant-guards.mjs` → sin escrituras sin guard de workspace.
- `npx tsx scripts/bench-client-payload.ts` → tabla de arriba.
