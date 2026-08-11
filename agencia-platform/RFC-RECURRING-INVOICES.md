# RFC — Facturas recurrentes (módulo independiente)

Estado: **borrador para revisión** · Rama `feature/recurring-invoices-rfc` · Base: producción verde `a106fe5c`
Ámbito: sección "Facturas recurrentes" en `/facturacion`, importación de las recurrentes desde
Holded, y opción de **pausar todas** temporalmente durante la transición a facturar solo con el Hub.

> Anclado en el código real (auditoría de 3 subsistemas) y en la documentación pública de Holded.
> Referencias `archivo:línea` sobre el árbol `a106fe5c`.

---

## 0. TL;DR + decisión Holded (con evidencia)

1. **Holded NO tiene API pública de recurrentes ni de pausa.** Su API pública documenta solo
   documentos ordinarios (`invoice, estimate, salesreceipt, creditnote, waybill, purchase…`); no hay
   endpoint de plantillas recurrentes/suscripciones ni de pausar/desactivar. La recurrencia y la pausa
   son **funciones solo de la UI de Holded**. Evidencia: (a) el código solo toca 7 endpoints
   `/invoicing/v1/` (`lib/integrations/holded.ts`), ninguno recurrente; (b) la referencia oficial
   (`developers.holded.com`) no lista docType recurrente ni endpoint de pausa (corroborado por el
   help center y 4 guías de integración). **No usaremos endpoints privados, scraping ni automatización
   de la web de Holded.**
2. **Ya existe un motor recurrente NATIVO en el Hub** — pero sobrecargando la tabla `Invoice`
   (`Invoice.recurring=true` = "plantilla"): mezcla plantillas con facturas emitidas, justo lo que hay
   que separar. (`lib/invoicing/recurring.ts`, `schema.prisma:424-427`, cron `in-app-scheduler.ts:58-65`).
3. **Estrategia confirmada:** modelo dedicado `RecurringInvoiceTemplate` + **importación CSV/JSON**
   (export oficial de Holded) + **motor nativo del Hub en shadow**. La pausa masiva es **real para
   plantillas del Hub** (flag en BD) pero **asistida para Holded** (no hay API → checklist + marcar
   "pausada en Holded" solo tras reconciliación; jamás fingir).

---

## 1. Estado actual (auditoría)

### 1.1 Modelo de facturación (`prisma/schema.prisma`)
- `Invoice` (L374-453): `status`/`type` String (no enum); importes en **céntimos enteros**
  (`subtotalCents…totalCents`, L408-412); `series`/`number` (null hasta emitir); `issuerSnapshot`/
  `clientSnapshot` (fiscal congelado); `recurring`/`recurrenceConfig`/`recurringSourceId` (L424-427);
  soft-delete; `@@unique([workspaceId, number])`. **SEPA vive en `Client`, no en `Invoice`.**
- `InvoiceIssuer` (L268-299): emisor con `taxId`, `iban`, datos Facturae.
- `InvoiceCounter` (L359-372): numeración `@@unique([workspaceId, series, year])` — **por
  workspace+serie+año, NO por emisor**.
- `Client` (L482-615): contacto + bloque fiscal (`legalName`, `taxId`, `fiscalAddress`…) + bloque SEPA
  opt-in (`sepaEnabled` default false, `sepaIbanMasked` — nunca IBAN completo).

### 1.2 Rutas / numeración / creación
- `app/api/v1/invoices` (GET/POST/[id]) y `app/api/v1/invoice-issuers`: `withApi({scope:"*",rate:"admin"})`
  + `requireAdmin` (`lib/api/admin.ts`); **tenant `workspaceId` en toda consulta**.
- **El GET de facturas NO excluye plantillas** (`recurring:true` vuelve en la misma lista).
- Numeración atómica: `assignInvoiceNumber` (`lib/invoicing/numbering.ts:10-36`) en `$transaction`;
  correlativa por serie+año (requisito legal ES). Solo se asigna al salir de DRAFT y `!recurring`
  (`persist.ts:107-116`).
- Totales: `computeTotals` (`core.ts:50-83`) todo en céntimos enteros; validación fiscal
  `isValidIban`/`isValidSpanishTaxId`/`issuerValidationError` (`core.ts`).

### 1.3 UI (`app/facturacion`)
- Todo admin-only (redirect si `role!=="ADMIN"`). `components/FacturacionClient.tsx` con pestañas
  **Facturas | Gastos | Importar facturas | Conciliación** (L291-306). `FacturasClient.tsx` lista
  facturas **y plantillas en la misma tabla** (icono `Repeat`), con inputs de recurrencia inline
  (L595-600).

### 1.4 Holded (integración real)
- `lib/integrations/holded.ts`: base `https://api.holded.com/api`, auth header `key`, key cifrada
  AES-256-GCM en `Workspace.settings.integrations.holded.apiKey` (server-side, **nunca al cliente**).
- 7 endpoints: list/get invoice, list/get contact, list estimate (GET); create invoice, create
  estimate (POST). `holded_create_invoice/_quote` en `DANGEROUS_TOOLS` (gate enforce). **Ningún
  endpoint recurrente/pausa.**
- `holded-auto-sync.ts`: read-only Holded→Hub (facturas emitidas), vía cron SEPA.

### 1.5 Cron
- `lib/cron/in-app-scheduler.ts` (in-process, tick 5 min) llama `runRecurringInvoices()` (L58-65).
  **La generación NO es transaccional con el avance de `nextRunAt`** → riesgo de duplicado si crashea
  entre crear la factura y avanzar (`recurring.ts:45-79`). A endurecer.
- Patrón HTTP cron autenticado disponible: `cronAuthOk` (`lib/cron-auth.ts`).

---

## 2. Modelo `RecurringInvoiceTemplate` (aditivo, tenant-scoped)

```prisma
model RecurringInvoiceTemplate {
  id            String    @id @default(cuid())
  workspaceId   String
  issuerId      String?
  clientId      String?
  // Datos fiscales congelados (como Invoice.*Snapshot) para independencia del cliente.
  issuerSnapshot Json?
  clientSnapshot Json?
  // Líneas idénticas a Invoice.lines: [{description, quantity, unitPriceCents, taxRate, discountPct}]
  lines         Json
  currency      String    @default("EUR")
  // Totales cacheados en céntimos (recalculables con computeTotals).
  subtotalCents Int       @default(0)
  taxCents      Int       @default(0)
  totalCents    Int       @default(0)
  // Periodicidad / calendario.
  intervalMonths Int      @default(1)   // 1,3,12…
  dayOfMonth    Int?                     // 1-28 (fin de mes seguro); null = día de inicio
  anchorDate    DateTime                 // fecha base de la serie
  startDate     DateTime
  endDate       DateTime?
  nextIssueAt   DateTime?                // próxima ocurrencia (motor)
  timezone      String    @default("Europe/Madrid")
  // Estado del ciclo de vida (String, patrón del repo).
  status        String    @default("draft") // active | paused | draft | archived
  series        String?                  // serie legal (FAC…)
  paymentMethod String    @default("TRANSFER")
  sepa          Boolean   @default(false)
  // Procedencia + trazabilidad de import.
  source        String    @default("HUB")  // HUB | HOLDED_IMPORT | CSV_IMPORT
  externalId    String?                    // id en el sistema de origen (dedupe)
  originalSnapshot Json?                    // fila cruda de origen (auditoría)
  checksum      String?                    // hash del contenido normalizado (dedupe/idempotencia)
  syncStatus    String    @default("ok")   // ok | error | pending
  syncError     String?
  // Pausa remota (Holded) — solo informativo, verificado a mano (no hay API).
  pausedInHolded     Boolean  @default(false)
  pausedInHoldedAt   DateTime?
  createdById   String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  // Idempotencia de import: una plantilla por (workspace, source, externalId).
  @@unique([workspaceId, source, externalId])
  @@index([workspaceId, status])
  @@index([workspaceId, nextIssueAt])
}
```

Notas: importes en céntimos `Int` (consistente con `Invoice`); fechas con `timezone` explícita
(Europe/Madrid) para fin de mes/año correctos; `checksum` = hash normalizado de emisor+cliente+
líneas+periodicidad para **dedupe e idempotencia** de reimport. No mezcla con `Invoice` (tabla propia).

---

## 3. Importador seguro (Slice A: preview idempotente)

- **Sin adaptador recurrente de Holded** (no existe). Dos vías:
  1. **CSV/JSON** (export oficial de Holded o plantilla propia) con **asistente de mapeo** de columnas,
     validación previa (fiscal, importes, periodicidad), **preview** con errores **por fila**, y
     **dedupe por `externalId`+`checksum`**.
  2. *(Opcional, slice posterior)* **Reconstrucción read-only desde Holded**: `holded_list_invoices`
     (GET) agrupando facturas generadas por contacto+importe+cadencia → *sugerencia heurística* de
     plantillas (nunca autouso; requiere confirmación humana). Probe read-only con la key server-side
     existente, sin exponerla.
- **Idempotencia:** reimportar el mismo CSV no duplica (upsert por `@@unique([workspaceId, source,
  externalId])`; si cambia el contenido, cambia el `checksum` y se marca "modificada" para revisión).
- **Nunca** crea/emite/envía facturas durante la importación. Todo entra como `status:"draft"`.
- **CSV malicioso:** saneado anti *formula injection* (celdas que empiezan por `= + - @` se neutralizan),
  límites de tamaño/filas, validación de tipos. Parseo sin `eval`.

**Slice A entrega:** parser+validador puro, endpoint `POST /api/v1/facturacion/recurring-templates/import/preview`
(admin, dry-run, **no escribe**), y `POST …/import/commit` idempotente (escribe solo `draft`).

---

## 4. UI "Facturas recurrentes" (Slice A: read-only)

- **5ª pestaña** en `FacturacionClient.tsx` ("Facturas recurrentes") → nuevo componente, **separada**
  de la tabla de facturas emitidas. En Slice A: **read-only** (lista + detalle + wizard de import con
  preview). Resumen mensual/anual, activas/pausadas/errores, próxima emisión, búsqueda/filtros.
- Se **retiran** los inputs de recurrencia inline de `FacturasClient` (L595-600) y el `GET
  /api/v1/invoices` pasa a **excluir plantillas** (slice de separación), para no mezclar. (En Slice A
  se añade la pestaña sin romper lo existente; la exclusión y migración de las `Invoice.recurring`
  actuales va en un slice acotado con backfill.)

---

## 5. Motor nativo en SHADOW (slice posterior)

- Reutiliza `assignInvoiceNumber`, `computeTotals`, `snapshotIssuer/Client` (`persist.ts`).
- **Shadow primero:** calcula próximas ocurrencias y genera **previews/drafts idempotentes**; **no
  emite/envía/cobra** hasta flag + política aprobada (A4).
- **Anti-doble-factura:** clave de idempotencia por `(templateId, occurrenceDate)`; generación
  **transaccional** (crear factura + avanzar `nextIssueAt` en una `$transaction`) — corrige el hueco
  actual (`recurring.ts`). Locks por plantilla.
- **Fechas:** timezone fija (Europe/Madrid), meses cortos (día 1-28 seguro), años bisiestos,
  **prorrateo explícito** (nunca implícito) y fin de mes correcto.
- **Series legales y validación fiscal** antes de emitir (reutiliza `issuerValidationError` + valida
  el cliente, hoy no validado).

## 6. Pausa masiva

- **Plantillas del Hub:** pausa REAL (flag `status:"paused"`) — dry-run/preview → **confirmación fuerte
  escribiendo una frase** → operación por lotes con rate limit, checkpoint, reintentos, auditoría,
  resultado por plantilla y reanudación. **A4 sensitive-gate.**
- **Holded:** **NO hay API de pausa → NO se finge.** Se muestra **procedimiento asistido / checklist de
  export** y se permite marcar `pausedInHolded=true` **solo tras reconciliación/verificación** manual.
  **Nunca** se cambia estado remoto en Holded (ni en tests).

## 7. Plan de transición (dual-run)

1. Import (CSV) → plantillas `draft`.
2. **Dual-run shadow**: el motor Hub genera previews en paralelo mientras Holded sigue emitiendo.
3. **Comparación de 2 ciclos** Holded↔Hub (diff por plantilla): importes, fechas, series.
4. **Freeze Holded** (checklist asistido; marcar `pausedInHolded`).
5. **Activación Hub** (flag) — **prohibido Hub `active` mientras Holded siga `active`** sin
   reconocimiento explícito del riesgo de duplicados (doble confirmación).
6. Reconciliación + rollback documentado.

## 8. Seguridad

- **Admin-only** para import/pausa/config fiscal (patrón `requireAdmin`).
- **API key de Holded nunca al cliente**; cifrada en secret store (ya es así). Probes read-only sin
  exponerla.
- **Minimización de PII**; **tenant `workspaceId` en TODA consulta** (el linter auto-enrola el modelo
  nuevo).
- **A4 sensitive-gate** para pausa masiva / emisión / envío / cobro. SEPA/IBAN nunca en claro.

## 9. Slices

- **Slice A (esta entrega tras el RFC):** modelo `RecurringInvoiceTemplate` (migración **revisada, no
  aplicada**) + importador preview/commit idempotente (CSV/JSON, saneado) + UI read-only (pestaña +
  wizard preview). Tests + revisión. Sin tocar el motor ni `Invoice`.
- **Slice B:** separación (excluir plantillas de `/invoices`, retirar inputs inline) + backfill de las
  `Invoice.recurring` actuales al nuevo modelo (idempotente, reversible).
- **Slice C:** motor nativo en shadow (previews idempotentes, transaccional, fechas/prorrateo).
- **Slice D:** pausa masiva Hub (A4, dry-run→frase→lotes) + checklist asistido Holded.
- **Slice E:** activación (flags), dual-run, reconciliación, rollback.

## 10. Riesgos

- **Doble facturación** (Holded+Hub a la vez) → dual-run shadow + prohibición de doble-active sin
  confirmación + reconciliación.
- **Numeración legal** compartida por workspace (no por emisor) → documentar; considerar serie por
  emisor antes de emitir de verdad.
- **Import sucio** (CSV malicioso, importes mal) → saneado anti-inyección, validación por fila, preview.
- **Holded sin API de pausa** → nunca fingir; checklist + verificación manual.
- **db push / enums** → String + tabla aditiva.
</content>
