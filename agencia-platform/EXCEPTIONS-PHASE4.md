# FASE 4a — Bandeja de excepciones unificada + Autonomía SONIA A0–A4 (motor/política/API)

Rama `feature/hub-10x-phase-4a-exceptions-autonomy`, **apilada sobre Fase 1**
(`8c2dde56`) para reutilizar el sensitive-tool gate. PR draft separado. **No
merge, no deploy.** Backup intacto (`f836844`). **Sin acciones externas reales**
en este slice. UI = Fase 4b.

## 1. Bandeja de excepciones unificada

`lib/exceptions/engine.ts` (puro) + `lib/exceptions/inbox.ts` (aggregator) +
`GET /api/v1/exceptions`.

- **Fuentes** (collectors puros, testeados): borradores de SONIA pendientes
  (`AiDraft PENDING`), automatizaciones fallidas (`AiDraft FAILED`, `AiAgentRun
  FAILED`), SONIA necesita ayuda / SLA (`AiAgentRun REQUIRES_HUMAN`, >2 días →
  `sla_breached`), facturas problemáticas (`Invoice` vencida ISSUED con saldo) y
  tareas bloqueadas (`Task` vencida sin cerrar). *(Lead-inbox y cron mudo quedan
  como collectors adicionales del mismo patrón, extensibles.)*
- **Ítem normalizado:** id, **dedupeKey**, source, kind, **severity**
  (low→critical), title, detail, **ownerUserId**, **clientId**, createdAt,
  **ageMs** (antigüedad), **link** accionable, y la explicación **why / soniaWillDo
  / needsFromMe** ("por qué está aquí / qué hará SONIA / qué necesita de mí").
- **Deduplicación:** por `dedupeKey`, conservando el de mayor severidad.
- **Orden:** severidad desc, luego más antiguo primero. **Filtros:** source/kind/
  severity/clientId. **Resumen** por severidad para badges.
- **Tenant:** cada consulta va scoped por `workspaceId`. **Privacidad:** los
  ítems **no exponen importes €** (la factura vencida lleva antigüedad, no
  cantidad) → seguro para `clients:read`.
- **Kill-switch:** `HUB_EXCEPTIONS=off` → 404 (fallback: la UI actual no depende).

## 2. Autonomía A0–A4 (por acción, explicable)

`lib/ai/autonomy/policy.ts`.

- **Niveles por ACCIÓN, no por agente global:** A0 observar · A1 recomendar · A2
  preparar borrador · A3 ejecutar reversible con límites · A4 ejecutar sensible
  solo bajo política + aprobación previa.
- **El modelo NUNCA se autoeleva:** `resolveAutonomy` calcula el nivel EFECTIVO
  desde la política + la clasificación de riesgo del **servidor**. Una pista
  `risk:"none"` sobre una tool sensible sigue siendo `sensitive` → A4.

## 3. Política determinista server-side (reutiliza el gate de Fase 1)

- **Riesgo `sensitive`** = lo que marca `toolDanger` del gate de Fase 1
  (dinero/mensajería/Make mutante) — **sin duplicar** la lista.
- **Checks deterministas:** allowlist de acciones (fuera → máx A1), techo por
  riesgo, **límite monetario** y de **volumen** (por encima → aprobación),
  tenant/rol, **idempotencia** (clave determinista), **razones auditables**, y
  **kill-switch** (todo a A0).
- **Configurable y saneada:** `mergeAutonomyPolicy` clampa NaN/negativos a
  default y **`sensitive` nunca se relaja** (siempre A4), aunque lo pida settings.

## 4. Ninguna acción externa real — adaptadores dry-run/shadow

`lib/ai/autonomy/adapters.ts` — `dryRun(action)` devuelve QUÉ HARÍA y si la
política lo bloquea, **sin ejecutar nada** (`executed:false`). WhatsApp/email/
reembolsos/gasto/Make DELETE siguen bloqueados; la ejecución real seguirá siendo
solo por las vías existentes (AiDraft + aprobación). Sin migraciones, sin flags
activados.

## Benchmarks (consolidación)

- **1 llamada** `GET /api/v1/exceptions` (4 consultas en paralelo, scoped)
  sustituye a revisar manualmente ≥4 pantallas separadas (borradores IA, runs,
  facturas, tareas) para saber "qué requiere mi intervención".
- **Deduplicación** colapsa incidencias repetidas de la misma causa (p.ej. run +
  draft de la misma tarea) a un solo ítem priorizado → menos ruido.

## Pruebas

- Autonomía: **escalada imposible** (modelo no autoeleva), allowlist, kill-switch,
  límites monetarios/volumen, idempotencia determinista, merge saneado.
- Dry-run: nunca ejecuta; sensibles bloqueadas; external marcado.
- Motor: collectors por fuente, dedupe, orden, filtros, resumen, datos parciales.
- Ruta: kill-switch 404, **tenant en las 4 consultas**, composición/orden, sin €.

## Riesgos / rollback

Endpoint aditivo tras kill-switch; motor y política son **solo lectura /
dry-run** (cero efectos). Rollback global = revertir la rama; base intacta en
`8c2dde56` / `f836844`.

## Pendiente (Fase 4b y siguientes)

- **UI** aditiva de la bandeja (filtros, explicación por ítem, acción "aprobar/
  resolver") con fallback/kill-switch.
- Collectors adicionales (lead-inbox sin resolver, cron mudo).
- Cableado de la política A0–A4 al runner de SONIA (hoy el gate de Fase 1 ya
  bloquea; A0–A4 refina la explicación y los límites) — **con aprobación y sin
  ejecutar acciones externas hasta decidirlo**.
