# Slice 2b — Persistencia server-side de acciones sobre excepciones

Rama `feature/exceptions-actions-store`, apilada sobre Slice 2a. PR draft.
**Sin deploy. Detrás del flag `HUB_EXCEPTIONS_ACTIONS` (off por defecto).**
Migración aditiva **revisada, no aplicada a mano** (la tabla nueva la crea `db push`).

## Qué entrega

Sustituye el "ocultar" que solo vivía en `localStorage` por una persistencia
**server-side, idempotente y auditada**, sincronizada entre sesiones/dispositivos.

- **Modelo `ExceptionAction`** (aditivo): `workspaceId` (tenant), `exceptionId`
  (`${source}:${rowId}`), `dedupeKey`, `source`, `kind`, `action`, `reason`,
  `expiresAt` (caducidad), `severity`, `meta`, `actorId`, `revokedAt`. Único por
  `@@unique([workspaceId, exceptionId, action])` → **idempotente**.
- **Endpoint `POST /api/v1/exceptions/actions`** (`clients:write`, rate admin):
  - Crear/refrescar (upsert idempotente) — `archive | ignore | snooze | reschedule
    | assign | cleanup_batch`.
  - Revertir: `{ revoke: true, exceptionId, action }` → `revokedAt` (mostrar de nuevo).
  - **Toda escritura** filtra por `workspaceId` (tenant) y deja rastro en
    **`AuditLog`** (`exception.<action>` / `.revoked`).
- **Materialización de la bandeja** (`GET /api/v1/exceptions`, cuando el flag está
  on): oculta lo archivado/ignorado/pospuesto **vivo** (no revocado, no caducado).
  `includeHidden=1` las devuelve marcadas para poder **mostrarlas** (reversible).
- **Re-aparición al escalar:** la ocultación es por `id|severidad`. Si la incidencia
  escala (media→crítica), la clave cambia y **vuelve a aparecer** (misma política
  que el dismiss local previo, ahora server-side).
- **UI**: la misma acción "Ocultar/Mostrar" usa el servidor cuando el flag está on
  (con caída a `localStorage` si está off). "Ver ocultas" re-consulta con
  `includeHidden`. Kill-switch y fallback intactos.

## Seguridad / privacidad / tenant

- **Tenant:** `ExceptionAction` lleva `workspaceId` → el linter de tenant lo
  auto-enrola (88 modelos) y el endpoint filtra `workspaceId` en `upsert`/
  `updateMany` (verde). El `GET` de la bandeja consulta acciones scoped por workspace.
- **PII:** el cliente solo manda ids/fechas/motivo; `meta`/`AuditLog` no reciben
  importes € ni PII. Test lo verifica.
- **Idempotencia:** repetir la misma acción no duplica (upsert por clave única);
  revocar es idempotente (`updateMany` sobre las vivas).

## Migración

`db/migrations/2026-08-11-exception-actions.sql` — DDL exacto (CREATE TABLE +
índices + FK). **Aditivo**, sin CONCURRENTLY (tabla nueva vacía). Revisar antes de
activar el flag. `db push` la crea en boot sin lock.

## Pruebas

- `lib/exceptions/__tests__/actions.test.ts` — validación, vigencia
  (caducidad/revocación), filtrado por `id|severidad`, re-aparición al escalar.
- `app/api/v1/exceptions/actions/__tests__/route.test.ts` — flag off→404, tenant en
  toda escritura, idempotencia (upsert por clave única), auditoría, revocación,
  payload inválido→400, sin PII en el meta auditado.

## Pendiente (2b+)

- UI de **selección múltiple** + barra de acciones (archivar/ignorar con motivo y
  caducidad, **reprogramar/asignar** —cambios de dominio con compensación—, y
  **convertir cluster histórico en lote de limpieza**). El backend ya admite estas
  `action`; falta el control de UI. Se aborda en el siguiente incremento junto con
  el cableado de `reschedule`/`assign` a las mutaciones de dominio auditadas.
</content>
