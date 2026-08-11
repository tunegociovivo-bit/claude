# FASE 3 — Cliente 360, Rentabilidad y Salud de cuenta

Rama `feature/hub-10x-phase-3-client360`, **apilada** sobre el head verde de Fase 2
(`676f03a5`). PR draft separado. **No merge, no deploy.** Backup intacto
(`backup/hub-pre-10x-2026-08-11` → `f836844`).

Este slice entrega el **núcleo de mayor valor** (API agregada + calculadores +
tests + migración no aplicada), **sin cablear la UI** (la pantalla de cliente
actual sigue intacta como fallback). El cableado visual va en un slice apilado
posterior.

## Qué se entrega

### 1. Cliente 360 agregado (API aditiva) — `GET /api/v1/clients/[id]/overview`
Una sola llamada devuelve: esenciales, proyectos activos, tareas (open/overdue/done + recientes), actividad (última + fuentes), responsables (managers de proyecto + AiOwnership), facturación/rentabilidad y salud. `lib/clients/overview.ts` compone todas las subconsultas **en paralelo**.
- **Tenant:** cada subconsulta lleva `workspaceId` (no hay filtro automático; testeado).
- **Rol/privacidad:** los **importes € (MRR + facturación) van gated a admin** (mismo patrón que la tarjeta MRR y el gestor de facturas). **`accesos` (credenciales del cliente) NUNCA se expone.** Fiscal (taxId, etc.) solo admin.
- **Kill-switch:** `HUB_CLIENT360=off` → la ruta responde 404 (la pantalla actual no depende de ella).

### 2. Rentabilidad — solo datos trazables (`lib/clients/profitability.ts`)
- **Ingresos:** facturado/pagado/pendiente/vencido de `Invoice` por cliente (estados ISSUED/PAID; DRAFT/CANCELLED excluidos) + **MRR recurrente aparte** (no se mezcla con lo puntual).
- **Costes: "sin datos".** El modelo NO tiene costes por cliente (los gastos van por empresa emisora, no por cliente) ni registro de horas → **margen NO calculable**, marcado explícitamente. **Nunca se inventan costes.**
- `dataQuality` expone hasInvoices/hasMrr/costsTraceable=false + notas.

### 3. Salud de cuenta / SLA — determinista y explicable (`lib/clients/health.ts`)
- Score parte de 100 y **cada factor resta puntos de forma transparente** (se devuelve la lista de factores con su aportación → nada opaco).
- Factores: facturas vencidas (acotado), actividad estancada (por umbral), tareas vencidas (acotado), cliente activo sin MRR, proyectos estancados. **Los datos ausentes NO penalizan** (se marcan como desconocidos).
- **Configurable:** pesos/umbrales desde `workspace.settings.clientHealth` sobre defaults seguros (`mergeHealthConfig`).
- Emite `alerts` (info/warn/critical) y `nextSteps` accionables. **Sin importes €** (compartible con no-admin).

### 4. Migración de índices (generada, NO aplicada)
`db/migrations/2026-08-11-client360-indices.sql` — `CREATE INDEX CONCURRENTLY IF NOT EXISTS` parciales para `Task(workspaceId,clientId)` y `CalendarEvent(workspaceId,clientId)` (los únicos que faltan; EditorialPost/Deliverable/Invoice ya tienen `clientId`). Con EXPLAIN + rollback. No cableada al boot.

### 5. Feature flag / fallback
`HUB_CLIENT360` (default activo; `off` → 404). La pantalla `app/clientes/[id]` actual permanece intacta y no consume aún el endpoint → fallback total.

## Benchmarks (requests)
- Pantalla actual `app/clientes/[id]/page.tsx`: carga 5 helpers SSR (`getClientsForUi`, `getProjectsForUi`, `getTasksForUi`, `getEventsForUi`, `getTeamForUi`) que traen **listas completas del workspace** y filtran en memoria por `clientId`. `/overview` hace consultas **acotadas por cliente** (counts + últimas) en **1 request agregada** → sin cascada y sin traer datos de otros clientes.
- Amortización: los importes € se calculan una vez en servidor (no round-trips extra), y los datos ausentes se resuelven sin consultas inútiles.

## Autorización / privacidad (resumen)
| Dato | clients:read (no-admin) | admin |
|---|---|---|
| esenciales (nombre, estado, servicios, contacto, notas, website) | ✅ | ✅ |
| MRR + facturación (€) | ❌ (billing.visible=false) | ✅ |
| fiscal (taxId, legalName, ciudad), sepa, stripe | ❌ | ✅ |
| `accesos` (credenciales) | ❌ nunca | ❌ nunca |
| salud/SLA (score, factores, alertas — sin €) | ✅ | ✅ |

## Pruebas
- Calculadores (rentabilidad/salud): trazable-only, "sin datos", determinismo, config, límites.
- Overview: **tenant** (workspaceId en toda subconsulta), **redacción** admin vs no-admin, `accesos` nunca, datos parciales/nulos, not-found.
- Ruta: kill-switch, 404, paso de rol/tenant/config.

## Riesgos / rollback
- Endpoint **aditivo** y detrás de kill-switch → cero impacto si se desactiva.
- Índices `CONCURRENTLY`/`IF NOT EXISTS`, rollback `DROP CONCURRENTLY`, **no aplicados solos**.
- Rollback global: revertir la rama; base intacta en `676f03a5` / `8c2dde56` / `f836844`.

## Pendiente (siguiente slice apilado)
- Cablear la pantalla `app/clientes/[id]` para consumir `/overview` (con fallback a la carga actual), añadiendo las tarjetas de rentabilidad/salud (a11y).
- Validar EXPLAIN de la migración y aplicarla.
- Panel de configuración de pesos/umbrales de salud (settings).
