# RFC — Autonomía operativa de SONIA + Bandeja de Excepciones con valor

Estado: **borrador para revisión** · Rama `feature/hub-autonomy-rfc` · Base: release desplegada `fd952aa8`
Ámbito: evolución de la Fase 4 (excepciones + autonomía A0–A4) hacia (a) una bandeja
que muestre trabajo **actual y accionable** y (b) un motor de ejecución **resiliente y
multi-modelo**. **No despliega nada**: define arquitectura y trocea la entrega.

> Este RFC está anclado en el código real (auditoría de 4 subsistemas). Todas las
> referencias `archivo:línea` son al árbol de `fd952aa8`.

---

## 0. TL;DR

1. **La bandeja se inunda por un bug de consulta, no de diseño de UI.** Los colectores
   de `task`/`invoice` filtran solo `dueDate < now` **sin suelo de antigüedad ni ventana
   `since`** (que sí aplican a `ai_draft`/`ai_run`). Además `daysLate > 7 → "high"` marca
   como graves todas las tareas antiguas, y el orden es *severidad desc, luego más
   antiguo primero* + `take:300` también más-antiguo-primero → lo reciente y accionable
   queda enterrado y se cae del corte de 100. (`lib/exceptions/inbox.ts:60-72`,
   `lib/exceptions/engine.ts:184,216`).
2. **A0–A4 no está cableado al runner.** `resolveAutonomy` solo lo usan los tests; el
   runtime únicamente aplica el *tool-gate* binario (`runner.ts:1585-1603`). `soniaWillDo`
   es `null` para tareas → de ahí el "SONIA no hará nada". `hasPriorApproval` es código
   muerto: no hay almacén de aprobaciones.
3. **El runner no tiene máquina de estados tipada** (5 valores de enum mutados en ~10
   sitios; traza en un `log Json` sin tipar), **ni fallback entre modelos** (routing una
   sola vez), **ni timeout de reloj**, y el presupuesto es solo de entrada.
4. **No hay abstracción de proveedor**: SDK de Anthropic llamado directamente; IDs de
   modelo hardcodeados en 6 sitios. Añadir Gemini/OpenAI/Perplexity al bucle es hoy
   imposible sin reescribirlo.
5. **No existen modelos Prisma** de excepción-estado, política de autonomía ni
   aprobaciones → los tres son *greenfield aditivo* (seguros con `db push`).

**Propuesta:** 3 slices incrementales detrás de flags, todo shadow/dry-run primero,
sin tocar `schema.prisma` de forma destructiva, preservando el tenant-guard.

---

## 1. Estado actual (resumen de auditoría)

### 1.1 Bandeja de excepciones (`lib/exceptions/*`)

- 4 colectores puros en `engine.ts`: `fromAiDrafts` (:48), `fromAiRuns` (:98),
  `fromInvoices` (:144), `fromTasks` (:174).
- **Colector de tareas** (`engine.ts:176`): una tarea es excepción sii `!completedAt &&
  dueDate && dueDate < now`. La consulta (`inbox.ts:67-72`) filtra
  `{ completedAt: null, parentId: null, deletedAt: null, dueDate: { lt: now } }`,
  `orderBy: dueDate asc`, `take: 300`. **Sin `createdAt >= since` ni suelo de antigüedad.**
  La ventana `since` (`inbox.ts:41`, `recentDays ?? 30`) **se aplica a drafts/runs pero
  no a tasks/invoices** → causa raíz del flood.
- **Severidad** por edad: tareas `daysLate > 7 ? "high" : "medium"` (`engine.ts:184`);
  facturas `>30 critical / >7 high` (`engine.ts:150`). **Sin peso por cliente, importe,
  SLA real ni responsable.**
- **Kind/autonomía**: tareas → `task_blocked` (`engine.ts:181`), `soniaWillDo:null`
  (:193); `autonomyForKind("task_blocked") → A0 "Sin acción autónoma"` (`ui.ts:29-31`).
- **Orden/cap**: `sortExceptions` = severidad desc, luego `b.ageMs - a.ageMs`
  (más antiguo primero) (`engine.ts:216`); `SOURCE_CAP=300`, `limit` default 100,
  `capped` = algún source llegó a 300 (`inbox.ts:32,40,75,88`).
- **Persistencia**: **ninguna**. `inbox.ts` es "solo lectura"; el *dismiss* vive en
  `localStorage["exceptions.dismissed.v1"]`, clave `id|severity` (`ui.ts:108-135`).
- **Datos por ítem** (`ExceptionItem`, `engine.ts:24-40`): sin *assignee*, sin nombre de
  cliente, sin importe, sin SLA. Solo `clientId` (invoice/task) y un `ownerUserId`
  engañoso (solo el revisor de un draft). Los `select` no hacen `include` de cliente.

### 1.2 Runner de ejecución (`lib/ai/nv-ia/*`)

- Modelo de estado = enum `AiAgentRunStatus { PENDING, RUNNING, SUCCEEDED, FAILED,
  REQUIRES_HUMAN }` (`schema.prisma:2291`) mutado ad-hoc; traza en `AiAgentRun.log Json`
  (`schema.prisma:2271`). Sin tabla de transiciones/intentos.
- Ciclo: `processOneRun` (`process-run.ts:38`) → claim optimista → `checkBudgetBeforeRun`
  → **circuit breaker** (≥5 runs/24h sin éxito → REQUIRES_HUMAN, `process-run.ts:88`) →
  `pickModelForTask` → `executeAgentRun` (`runner.ts:1302`, bucle `maxStepsPerRun=60`,
  one-shot, sin streaming) → post-proceso (`classifyError` `process-run.ts:821`:
  credential/transient/technical; requeue transitorio ≤10; promoción FAILED→REQUIRES_HUMAN
  para technical; self-heal o issue de GitHub).
- **Verificación**: `runReviewer` (`runner.ts:1875`) — 2ª llamada a Claude, sin tools,
  tope 2 reflexiones, **fail-open** (`runner.ts:1741`).
- **Reintentos**: `callAnthropicWithRetry` solo-modelo (4 intentos, backoff, solo 5xx/red;
  `runner.ts:2003`). **Sin fallback a otro modelo.** Presupuesto: solo de entrada
  (`budget.ts`, per-client → per-workspace `monthlyBudgetUsd`), **sin timeout de reloj**.
- **Escalada**: payload rico (`escalate_to_claude`: `blockingType`, `suggestedFix`,
  `whatICompletedAnyway` `tools.ts:2757`; issue `buildEscalationBody` con tools/errores/
  últimos pasos `escalate.ts:42`) — pero reconstruido del `log` sin tipar.

### 1.3 Autonomía / gate / self-heal

- `resolveAutonomy`/`effectiveRisk`/`ACTION_RISK`/`mergeAutonomyPolicy`
  (`lib/ai/autonomy/policy.ts`): decisión determinista server-side, `ceilingByRisk.sensitive`
  siempre `A4` (`policy.ts:93`). **No se invoca en el runner** — solo en tests/doc.
- Tool-gate (`tool-gate.ts`): `toolDanger`/`DANGEROUS_TOOLS`, `AI_TOOL_GATE` default
  `enforce`, único punto de enforcement (`runner.ts:1585-1603`).
- Self-heal (`self-heal/agent.ts`): plantilla reutilizable — bucle acotado (14 turnos),
  anti-bucle `hashError`/`isInAntiLoop` (≥3 intentos/24h del mismo `(taskId,errorHash)`),
  historial LRU 200 en `Workspace.settings`, gates de validación pre-ejecución, merge
  gated por CI. `SELF_HEAL_AUTO_MERGE` off.
- PII: `compliance.ts` es revisión LLM fail-open; `sanitize.ts` solo limpia surrogates;
  `redactCredentials` (value-based, secretos). **No hay minimizador de PII** para payloads
  salientes a proveedores.

### 1.4 Datos (Prisma)

- `Task` (L1672): `status` String libre, `completedAt`/`deletedAt`/`parentId`; **sin
  columna de owner** (join `TaskAssignee` L1807). `AiAgentRun` (L2252) `taskId` requerido,
  `model` String, tokens (sin € por run). `AiDraft` (L2598). **No existen** modelos de
  Autonomy/Approval/Exception. `AuditLog` (L2182) sin unique/idempotencia.
- `AiClientMemory.autoApproveDraftKinds String[]` (L2487) — único knob de autonomía
  persistido hoy.
- Migración = **`prisma db push --accept-data-loss=false`** en boot. Tablas/columnas
  aditivas y `@@index` sobre tablas nuevas (vacías) = seguros. Índices retro sobre tablas
  grandes = SQL manual `CONCURRENTLY`. Tenant-guard auto-enrola cualquier modelo con
  `workspaceId`. Tendencia del repo: `status` como String (no enum) por comodidad con
  `db push`.

---

## 2. Objetivos y no-objetivos

**Objetivos**
- O1. La bandeja por defecto muestra **trabajo actual y accionable**; el histórico
  (>90 días) se agrupa/archiva fuera de la vista principal.
- O2. Severidad por **impacto real** (cliente/importe/SLA/recencia), no por edad infinita.
- O3. **Acciones útiles reversibles** con persistencia **server-side idempotente y
  auditada** (archivar/ignorar con motivo+caducidad, reprogramar, asignar, limpieza en lote).
- O4. "Qué hará SONIA" propone un **siguiente paso real o un borrador**; nunca "nada"
  salvo prohibición de política.
- O5. Motor de ejecución **resiliente**: máquina de estados persistente con
  plan→ejecutar→verificar→diagnosticar→descomponer→estrategia/modelo alternativo→
  reintento con backoff+presupuesto→completar o escalar **materialmente**.
- O6. **Delegación multi-modelo** tras adaptadores server-side (OpenAI/Claude/Gemini/
  Perplexity, solo APIs oficiales), con registry, routing por capacidad, timeouts,
  circuit breakers, cuotas/coste, minimización de PII, auditoría. Sin API key → provider
  `unavailable` sin romper el flujo.
- O7. **Autonomía máxima segura**: A0–A3 sin intervención dentro de política y límites;
  A4 mantiene aprobación previa. Aprobada una política reutilizable, no re-preguntar dentro
  de sus límites.
- O8. Escalar solo si: faltan credenciales/datos no inferibles, conflicto de objetivos,
  presupuesto agotado tras estrategias distintas, o la política lo exige. La escalada trae
  diagnóstico + intentos + alternativas + **una decisión concreta**.

**No-objetivos (de esta fase)**
- No activar proveedores externos ni acciones externas en producción hasta tener variables
  + revisión de privacidad. Todo shadow/dry-run.
- No relajar `AI_TOOL_GATE`, admin gate ni `SELF_HEAL_AUTO_MERGE`.
- No `prisma migrate`; nada destructivo. No aplicar índices CONCURRENTLY sin revisión.
- No automatizar webs de terceros ni compartir credenciales del Hub.

---

## 3. Diseño — Slice 2a: Bandeja con valor (UX)

### 3.1 Cambios en los colectores (`engine.ts`/`inbox.ts`)

1. **Ventana de recencia por defecto en tareas/facturas.** Aplicar el mismo `since`
   ya calculado (`inbox.ts:41`) al colector de tareas e invoices como *suelo* configurable:
   - Vista principal ("Actual"): `dueDate >= now - ACTIVE_WINDOW_DAYS` (p.ej. 90) **o**
     `updatedAt >= since`. Los ítems más antiguos **no desaparecen**: se derivan a un
     *bucket* "Histórico" contabilizado aparte (ver §3.3 clustering).
   - Nueva firma: `buildInbox({ workspaceId, now, view: "active"|"all"|"archive",
     activeWindowDays, ... })`.
2. **Severidad por impacto, no por edad** (`severityFor(item)` nuevo, reemplaza los
   ternarios de edad):
   ```
   score = w_recency·recency + w_client·clientTier + w_amount·amountBand
           + w_sla·slaBreach + w_kind·kindWeight
   ```
   - `recency`: decae con la edad — una tarea vencida hace 3 días pesa **más** que una de
     1400 días (invierte el sesgo actual). Antigüedad extrema **baja** prioridad de la vista
     activa (es histórico), no la sube.
   - `clientTier`/`amountBand`: requiere ensanchar los `select` para `include` de
     `client` (nombre + señal de tier si existe) e importe de factura (solo para el
     cálculo server-side; el importe € **no se serializa** a no-admin, se mantiene la regla
     actual de `inbox.ts`). Bandas, no importes, cruzan a la UI.
   - `slaBreach`: para runs/drafts, antigüedad vs. objetivo; para facturas, tramos de mora.
   - Umbrales → `critical/high/medium/low` calibrados con datos representativos (§6).
3. **Orden**: severidad desc, luego **más reciente primero** dentro de banda (invertir
   `engine.ts:216`), para que lo accionable-ahora encabece.
4. **Cap honesto por vista**: la vista activa se acota a `limit` reales; el histórico se
   **resume** (conteos por cluster), nunca se pagina infinito. `capped` deja de dispararse
   por histórico.

### 3.2 "Qué hará SONIA" real (O4)

- Derivar `soniaWillDo` de la **política A0–A4** (Slice 2c la cablea) y del `kind`:
  - `task_blocked`: en vez de `null`, proponer el siguiente paso concreto según contexto
    ("Reprogramar a próxima semana", "Asignar a {sugerido}", "Crear subtareas", "Pedir
    a cliente el dato X") — plantillas deterministas por ahora, borrador real cuando el
    motor esté cableado.
  - `billing_problem` (A2): "Preparar recordatorio de cobro (borrador, requiere tu OK)".
  - `approval_pending` (A4): "Espera tu aprobación para {acción}".
  - Nunca "nada" salvo `killSwitch`/prohibición de política, y en ese caso el texto lo dice
    explícitamente ("Bloqueado por política: {motivo}").

### 3.3 Clustering de ruido (O1) + inicio ejecutivo

- **Clusters** por `(source, kind, clienteOpcional)` con `count`, rango de fechas y
  drill-down. Cientos de tareas históricas → 1 tarjeta "N tareas vencidas hace >90 días"
  con acción de lote (ver 2b: "convertir en lote de limpieza").
- **Inicio ejecutivo** (secciones, cada una es un filtro server-side sobre el agregado):
  1. **Hoy** — vence/creado hoy, accionable ya.
  2. **Bloqueos reales** — runs/drafts `REQUIRES_HUMAN`/`FAILED` recientes.
  3. **Clientes en riesgo** — señales por cliente (mora + SLA + tareas).
  4. **Cobros / SLA** — facturas ISSUED en mora reciente, con banda de importe.
  5. **Trabajo completado por SONIA** — runs `SUCCEEDED` recientes (evidencia de valor;
     fuente `AiAgentRun` status SUCCEEDED, hoy no mostrada).
- Top 5–10 prioridades globales calculadas por `score`, no lista infinita.

### 3.4 UI (`ExceptionsInbox.tsx`, `app/excepciones/page.tsx`)

- Mantener kill-switch `NEXT_PUBLIC_EXCEPTIONS_UI` + fallback total.
- Vistas: pestañas "Prioridades / Hoy / Cobros y SLA / Clientes / Histórico / Hecho por
  SONIA". Selección múltiple + barra de acciones (2b). Accesible (roles/labels ya
  presentes), compacta, con métricas honestas ("N de M", "histórico: N").
- Estados loading/empty/error intactos.

**Aceptación 2a**: con dataset representativo (§6), la vista por defecto muestra ≤10
prioridades **recientes y accionables**, cero tareas >90 días en la vista activa (van a
Histórico agrupado), ninguna marcada "high" solo por edad, y "Qué hará SONIA" nunca dice
"nada" salvo política. Sin cambios de servidor destructivos; sin PII nueva expuesta.

---

## 4. Diseño — Slice 2b: Persistencia de acciones (server-side, idempotente, auditada)

### 4.1 Modelo Prisma nuevo (aditivo)

```prisma
model ExceptionAction {
  id            String   @id @default(cuid())
  workspaceId   String
  // Identidad estable de la excepción objetivo. dedupeKey es cross-source
  // (engine.ts); guardamos ambos para poder re-materializar.
  exceptionId   String   // `${source}:${rowId}`
  dedupeKey     String
  source        String   // ai_draft|ai_run|invoice|task (String, no enum: db push)
  kind          String
  action        String   // archive|ignore|snooze|reschedule|assign|cleanup_batch
  reason        String?
  // Caducidad de la ocultación: al pasar expiresAt, la excepción re-aparece.
  expiresAt     DateTime?
  // Para reschedule/assign: destino propuesto (no ejecuta el cambio de dominio
  // aquí; eso es una acción de dominio auditada aparte).
  meta          Json?
  actorId       String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  workspace     Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  // Idempotencia: una acción "viva" por (workspace, exceptionId, action).
  @@unique([workspaceId, exceptionId, action])
  @@index([workspaceId, expiresAt])
  @@index([workspaceId, dedupeKey])
}
```

- **Idempotencia**: `upsert` por `@@unique([workspaceId, exceptionId, action])`. Reintentos
  del cliente no duplican. La clave incluye `action` para permitir "archivada" y
  "reprogramada" coexistiendo.
- **Escalado de severidad**: guardamos `dedupeKey` estable (persiste tras escalar) y el
  `severity` en `meta`. Política: **archive/ignore caducan** (re-aparece al escalar o al
  vencer `expiresAt`); "snooze" es un `expiresAt` corto. Esto conserva el buen
  comportamiento actual (ocultar la media no esconde la crítica) pero server-side.
- **Auditoría**: además del propio registro, escribir en `AuditLog`
  (`action:"exception.archived"`, `targetType:"exception"`, `targetId:exceptionId`,
  `meta`). `AuditLog` ya existe (L2182); no requiere unique.

### 4.2 Acciones de dominio reversibles (reschedule/assign)

- `reschedule` y `assign` **sí** cambian dominio (`Task.dueDate`, `TaskAssignee`). Se
  ejecutan por endpoints existentes con guard de workspace, y se **registran** en
  `AuditLog` con la inversa para compensación (`meta.previous`). No se inventa un ejecutor
  nuevo sin idempotencia: se reutiliza `Task.aiState` (L1715) como mapa de idempotencia
  ya existente.
- `cleanup_batch`: archiva en lote un cluster (histórico) en una transacción; una sola
  entrada `AuditLog` con `meta.count` + lista de ids (para des-hacer).

### 4.3 Endpoint

- `POST /api/v1/exceptions/actions` (nuevo), `withApi` + admin/permiso, valida
  `workspaceId` en el `where` (tenant-guard). `GET /api/v1/exceptions` filtra las acciones
  vivas (no vencidas) al materializar. **El dismiss de localStorage se conserva como
  fallback** si el flag server está off.
- Flag: `HUB_EXCEPTIONS_ACTIONS` (default off en este slice; la UI usa localStorage hasta
  activarlo). Migración **revisada, no aplicada** por defecto (tabla nueva vacía → `db push`
  la crea sin lock, pero se activa tras revisión de compatibilidad).

**Aceptación 2b**: acciones persisten entre sesiones/dispositivos; repetir la misma acción
es idempotente (no duplica); cada acción deja rastro en `AuditLog`; archivar caduca y
re-aparece al escalar; tenant-guard lint verde; sin PII en `meta`.

---

## 5. Diseño — Slice 2c: Motor de recuperación (máquina de estados)

### 5.1 Estados y persistencia

Sin romper el enum actual `AiAgentRunStatus` (compat), introducir una **fase interna
tipada** persistida en un modelo aditivo:

```prisma
model AiRunStep {
  id           String   @id @default(cuid())
  workspaceId  String
  runId        String   // AiAgentRun.id
  seq          Int
  phase        String   // plan|execute|verify|diagnose|decompose|retry|complete|escalate
  strategy     String?  // p.ej. "model:opus" | "decomposed" | "fallback:sonnet"
  model        String?
  ok           Boolean?
  costUsd      Decimal? @db.Decimal(10,4)
  tokensIn     Int?
  tokensOut    Int?
  error        String?  @db.Text
  evidence     Json?    // verificación: qué se comprobó y resultado
  createdAt    DateTime @default(now())

  workspace    Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  @@index([workspaceId, runId, seq])
}
```

Esto da a la escalada una fuente **tipada** de intentos (hoy re-parsea `log`), y alimenta
el panel por tarea (O8/§5.4). El `log Json` se mantiene por compat.

### 5.2 Controlador de recuperación

Envuelve `executeAgentRun` (`runner.ts:916`) con una máquina explícita:

```
plan → execute → verify → (ok? complete : diagnose)
diagnose → classify(error)              // reusa classifyError (process-run.ts:821)
         → chooseStrategy(policy, budget, attempts)
             · retry(sameModel, backoff)        // reusa callAnthropicWithRetry
             · fallback(otherAdapter)           // NUEVO (Slice 3 lo habilita)
             · decompose(create_subtask)        // programático, no solo prompt
         → loopGuard(hashError, attempts≤N)     // reusa hashError/isInAntiLoop
         → complete | escalate(materially)
```

- **Presupuestos configurables**: tiempo (nuevo *wall-clock* por run), tokens
  (`maxTokensPerRun` ya existe), coste (nuevo, sumando `AiRunStep.costUsd`). Al agotarse
  **tras estrategias distintas** → escalada, no antes.
- **Loop detector**: reutilizar `hashError`/`isInAntiLoop`/`appendAttempt` del self-heal
  (`agent.ts:111-180`) generalizados a `(runId, errorHash)`.
- **Verificación** como *gate* (no fail-open opcional): `runReviewer` promovido a paso
  `verify` cuyo veredicto se persiste en `AiRunStep.evidence`. Council (proponer/criticar
  con **otro** modelo) solo cuando `risk`/incertidumbre lo justifican (Slice 3).
- **Idempotencia/compensación**: consumir `idempotencyKeyFor` (`policy.ts:112`, hoy sin
  consumidor) para no re-ejecutar acciones ya hechas; registrar inversa para acciones
  reversibles (A3). A4 nunca auto-ejecuta.

### 5.3 Autonomía cableada (O7) + almacén de aprobaciones

```prisma
model AiApproval {
  id             String   @id @default(cuid())
  workspaceId    String
  scope          String   // idempotencyKey o patrón de acción aprobado
  action         String
  grantedById    String?
  maxAmountCents Int?
  maxVolume      Int?
  remaining      Int?     // usos restantes (null = ilimitado dentro de límites)
  expiresAt      DateTime?
  revokedAt      DateTime?
  createdAt      DateTime @default(now())

  workspace      Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  @@index([workspaceId, action, expiresAt])
}
```

- En el choke point del runner (`runner.ts:1585`), **además** del tool-gate, llamar
  `resolveAutonomy(descriptor, ctx, policy)` poblando `ActionContext` real (`amountCents`,
  `volume`, `clientId`) desde el input de la tool. `ctx.hasPriorApproval` se resuelve
  consultando `AiApproval` por `idempotencyKey`/scope no caducado ni revocado.
- A0–A3 dentro de política/límites: **ejecutan sin intervención**. A4 y superar
  `moneyLimit`/`volumeLimit`: requieren `AiApproval` vivo; si no, se escala.
- "Aprobar una política reutilizable" = crear un `AiApproval` con `remaining`/`expiresAt`.
  Mientras viva y dentro de límites, **no se re-pregunta**.
- Política persistida: seguir en `Workspace.settings` (patrón del repo) vía
  `mergeAutonomyPolicy`, con `killSwitch` respetado.

### 5.4 Panel por tarea + escalada material (O8)

- Panel (lectura de `AiRunStep`): objetivo, plan, progreso, modelos usados, coste,
  evidencia de verificación, próximos pasos, por qué se bloqueó. **Notificar por
  excepción**, no por cada paso.
- Contrato de escalada (extiende `escalate_to_claude`/`buildEscalationBody`): siempre
  incluye `diagnosis` + `attempts[]` (de `AiRunStep`) + `alternatives[]` + **una decisión
  concreta** solicitada. Prohibido el "no pude" genérico.

**Aceptación 2c**: en shadow/dry-run, un fallo transitorio reintenta y (si Slice 3 activo)
prueba modelo alternativo antes de escalar; el detector de bucles corta a N; el panel
muestra intentos/coste/evidencia; la escalada trae decisión concreta. `AI_TOOL_GATE`/admin
gate intactos; A4 nunca auto-ejecuta; presupuestos respetados.

---

## 6. Diseño — Slice 3: Registro de proveedores + adaptadores multi-modelo (flagged)

### 6.1 Interfaz

```ts
interface ModelAdapter {
  id: string;                       // "anthropic:opus-4-7", "openai:gpt-...", ...
  provider: "anthropic"|"openai"|"gemini"|"perplexity";
  capabilities: Capability[];       // tool_use, long_context, cheap, vision, web_search...
  region?: string;
  create(req: LlmRequest): Promise<LlmResponse>;  // one-shot; streaming opcional futuro
  health(): "available"|"unavailable"; // sin API key → unavailable, NO rompe el flujo
}
interface ProviderRegistry {
  route(need: CapabilityNeed, policy): ModelAdapter | null; // capacidad/privacidad/coste/latencia
  all(): ModelAdapter[];
}
```

- **Anthropic** se refactoriza detrás de un `AnthropicAdapter` que envuelve
  `callAnthropicWithRetry`/`getAnthropicForWorkspace` (comportamiento idéntico → sin
  regresión). **OpenAI/Gemini/Perplexity** se añaden como adaptadores nuevos, **solo APIs
  oficiales**, cada uno con timeout, circuit breaker, cuota/coste y `health()`.
- **Sin API key → `unavailable`**: el registry lo omite; el flujo usa el disponible o
  escala si ninguno cumple la capacidad. Nunca lanza por proveedor ausente.
- **Routing por capacidad/privacidad/coste/latencia** (no "todo a todos"). `pickModelForTask`
  (`model-router.ts:110`) pasa a devolver un `CapabilityNeed` → `registry.route`.
- **Council/fallback**: un modelo propone, **otro** critica/verifica solo cuando riesgo o
  incertidumbre lo justifican. Ningún modelo puede autoelevar permisos ni decidir ejecutar
  una acción sensible (eso lo decide `resolveAutonomy` server-side).
- **Unificar pricing**: `PRICING`/`MODEL_PRICING` (`budget.ts:23`, `usage.ts:16`) pasan a
  metadatos del registry (fin de los IDs duplicados en 6 sitios).

### 6.2 Privacidad / PII (bloqueante para activar externos)

- **Minimizador de PII** determinista aplicado al payload saliente **antes** de llamar a un
  proveedor externo (nombres, teléfonos, emails, DNI, direcciones). Reutiliza los
  detectores value-based de `adhoc-credentials.ts:194-253` para secretos y añade patrones
  PII. Redacción + minimización (enviar solo lo necesario).
- **Región y auditoría** por proveedor; registrar en `AuditLog` qué proveedor recibió qué
  clase de datos (no el contenido).
- **Gate de activación**: ningún proveedor externo se activa en prod hasta tener variables
  de entorno + **revisión de privacidad/coste** aprobada. Flags: `AI_PROVIDER_<X>_ENABLED`
  (default off), `AI_MULTIMODEL` (default off, shadow).

**Aceptación 3**: con flags off, comportamiento idéntico al actual (solo Anthropic). Con
shadow on, el registry enruta y registra decisiones **sin** llamadas externas reales salvo
Anthropic. Falta de key = `unavailable` sin romper. Revisión independiente de
seguridad/privacidad/coste/fallos-silenciosos verde antes de cualquier activación.

---

## 7. Migración y compatibilidad

- **Todo aditivo**: 3 modelos nuevos (`ExceptionAction`, `AiRunStep`, `AiApproval`), todos
  con `workspaceId` + relación `onDelete: Cascade` + `@@index([workspaceId, …])`. `db push
  --accept-data-loss=false` los crea en boot sin lock (tablas vacías). **Sin** enums nuevos
  (usar String con validación app-level, patrón del repo).
- **Sin tocar** `schema.prisma` de forma destructiva; sin renombrar columnas; el enum
  `AiAgentRunStatus` se mantiene.
- Índices sobre tablas **existentes** grandes (si hicieran falta para el nuevo scoring) van
  por la vía manual `CONCURRENTLY` (`db/migrations/*.sql`), **revisados, no auto-aplicados**.
- Tenant-guard: cada endpoint de escritura nuevo filtra `workspaceId` (o guard previo) →
  `npm run lint:tenant` debe seguir verde.

---

## 8. Flags (todas seguras por defecto)

| Flag | Default | Efecto |
|---|---|---|
| `NEXT_PUBLIC_EXCEPTIONS_UI` | on | kill-switch UI (existente) |
| `HUB_EXCEPTIONS` | on | API excepciones (existente) |
| `HUB_EXCEPTIONS_ACTIONS` | **off** | persistencia server de acciones (2b); off → localStorage |
| `HUB_AUTONOMY_ENFORCE` | **off** (shadow) | cablear `resolveAutonomy` al runner (2c); shadow registra sin bloquear |
| `AI_RUN_ORCHESTRATOR` | **off** | máquina de estados/recuperación (2c) |
| `AI_MULTIMODEL` | **off** | registry multi-modelo (3), shadow |
| `AI_PROVIDER_OPENAI/GEMINI/PERPLEXITY_ENABLED` | **off** | activar cada proveedor externo (3) |
| `AI_TOOL_GATE` | enforce | intacto |
| `SELF_HEAL_AUTO_MERGE` | off | intacto |

Regla: A0–A3 autónomos **solo** cuando `HUB_AUTONOMY_ENFORCE` deje de ser shadow y dentro
de política. A4 siempre requiere `AiApproval`. Nada externo real hasta gate de privacidad.

---

## 9. Plan de entrega (slices, ramas, PR draft)

1. **Slice 1 (este RFC)** — `feature/hub-autonomy-rfc`, PR draft. Sin código de runtime.
2. **Slice 2a** — `feature/exceptions-ux-value`: colectores (ventana/severidad/orden),
   clustering, inicio ejecutivo, "qué hará SONIA" determinista, UI. Tests con dataset
   representativo (sin PII). Revisión independiente (fallos silenciosos/cap/orden).
3. **Slice 2b** — `feature/exceptions-actions-store`: `ExceptionAction` + endpoint + audit,
   flag off. Revisión (idempotencia/tenant/PII).
4. **Slice 2c** — `feature/ai-recovery-engine`: `AiRunStep` + controlador de recuperación +
   `AiApproval` + cableado autonomía (shadow) + panel + contrato de escalada. Revisión
   (seguridad/bucles/presupuesto).
5. **Slice 3** — `feature/ai-multimodel`: registry + adaptadores + PII minimizer, todo
   flagged/shadow. Revisión seguridad/privacidad/coste.

Cada slice: `tsc` + tests + `lint:tenant` + build + CI verdes; revisión independiente;
**sin auto-deploy** — preview o aprobación explícita antes de producción. Collectors
adicionales (lead-inbox/cron) siguen **pausados**.

## 10. Riesgos y mitigaciones

- **Recalibrar severidad puede ocultar algo importante** → el histórico nunca se borra,
  se agrupa; métricas visibles ("histórico: N"); umbrales validados con datos reales.
- **Cablear autonomía al runner** → arranca en **shadow** (`HUB_AUTONOMY_ENFORCE=off`):
  registra la decisión que *tomaría* sin bloquear/ejecutar, se compara, luego se activa.
- **Proveedores externos = fuga de PII/coste** → minimizador PII + gate de privacidad +
  cuotas/circuit breakers + auditoría; activación solo tras revisión.
- **`db push` y enums** → usar String; solo tablas/columnas aditivas.
- **Regresión del runner** → `AnthropicAdapter` envuelve el camino actual sin cambiarlo;
  orquestador tras flag; enum de estado intacto.
</content>
