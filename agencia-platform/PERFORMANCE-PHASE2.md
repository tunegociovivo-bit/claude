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

## Pendiente (próximos slices, plan concreto)

- **Obj 1 (completar)** — paginación cursor/limit + count SQL en **tareas** y **conversaciones de leads**. La conversación agrupa en JS (`buildConversations`); requiere cuidado para no cambiar la semántica de `total`/`unread`. El endpoint de clientes ya expone el patrón cursor a copiar.
- **Obj 3** — combobox async accesible en TareasClient (recientes + búsqueda + paginación) consumiendo `/clients/search`. Sustituye los `<select>` nativos con cientos de opciones. UI grande → slice propio con test de accesibilidad (roles ARIA, teclado).
- **Obj 4** — virtualización de listas/tablas grandes (react-window o equivalente) donde más pesa (tablón de tareas, inbox), sin rediseño visual.
- **Obj 5** — endpoint agregado `sidebar-bootstrap` (1 llamada en vez de 6 `no-store`) + cache cliente con invalidación explícita al crear proyecto. Requiere componer 6 fuentes sin drift de forma → extraer helpers de los handlers actuales.
- **Obj 6 (cablear)** — reemplazar los 7+ `setInterval` de LeadsClient por `usePollingChannel` (la base ya está aquí y testeada).

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
