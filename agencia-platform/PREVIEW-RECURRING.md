# Preview aislada — Facturas recurrentes (A+B+C+D+E0)

Artefacto de preview **listo para desplegar en un entorno AISLADO**. Rama
`preview/recurring-invoices-stack` = `a106fe5c` (producción) + PRs #303→#307.
**No desplegar en producción. No usar la BD de producción. No tocar Holded.**

## Estado

- SHA preview: **`076c2c74`** (E0 head; = A+B+C+D+E0 lineal sobre `a106fe5c`).
- Verificado: tsc · **399 tests** · tenant-guards (90) · build de producción OK.
- Sin secretos hardcodeados; **el código recurrente no tiene ninguna llamada
  externa/Holded** (aislamiento de sistemas externos garantizado por construcción).
- Rollback de la preview: rama `rollback/preview-recurring-invoices` (`076c2c74`).
  Producción intacta en `a106fe5c` (baseline de rollback global).

## Requisitos que ESTE entorno no puede garantizar (bloqueo)

Para una preview accesible por el usuario y aislada hacen falta, y **no están
disponibles aquí**:
1. **Postgres efímero/aislado** — no hay binario de servidor Postgres (solo el
   cliente `psql`) ni daemon de Docker; la app exige Postgres (`schema.prisma`:
   `provider = postgresql`, sin fallback SQLite).
2. **Servicio de hosting aislado** — Railway está configurado para desplegar SOLO
   la rama de producción `bdSLe`; `railway.json` no define preview environments y
   no hay acceso a la API de Railway para crear un servicio/BD separados.

Por eso **no se ha desplegado**: no se puede garantizar aislamiento de BD/servicio.

## Runbook para levantar la preview (cuando haya entorno aislado)

1. **Provisiona** un servicio de hosting NUEVO (Railway preview env / proyecto
   aparte, Fly, etc.) apuntando a la rama `preview/recurring-invoices-stack`, con
   su **propia BD Postgres efímera** (`DATABASE_URL` de la preview, NUNCA la de prod).
2. El arranque ejecuta `prisma db push` (aditivo) → crea las tablas nuevas:
   `RecurringInvoiceTemplate`, `RecurringInvoicePreview`, `RecurringPauseOperation`
   y la columna `statusBeforePause`. (Equivalen a los SQL revisados en
   `db/migrations/2026-08-11-recurring-*.sql`.) No hay cambios destructivos.
3. **Flags SOLO en la preview** (todos opt-in, off por defecto):
   ```
   HUB_RECURRING_INVOICES=on
   HUB_RECURRING_SEPARATE=on
   HUB_RECURRING_ENGINE=on
   HUB_RECURRING_PAUSE=on
   NEXT_PUBLIC_RECURRING_INVOICES=on
   NEXT_PUBLIC_RECURRING_ENGINE=on
   NEXT_PUBLIC_RECURRING_PAUSE=on
   ```
   NO configures ninguna API key de Holded en la preview (no se usa; el checklist
   no muta Holded aunque exista).
4. Crea un **usuario/workspace demo** (signup normal en la preview) y anota su
   `workspaceId`.
5. **Seed demo** (datos ficticios, sin PII), desde la preview:
   ```
   PREVIEW_SEED=on PREVIEW_SEED_CONFIRM=yes-ephemeral-db \
   PREVIEW_WORKSPACE_ID=<id> npx tsx scripts/preview-seed-recurring.ts
   ```
6. En `/facturacion` → pestaña **Facturas recurrentes** verás: plantillas
   active/paused/draft, **importar CSV (preview)**, **backfill dry-run**,
   **shadow previews**, **pausa dry-run + frase fuerte**, **checklist Holded**
   (asistido, no muta nada) y **readiness** (ready/review/no_data según el seed).

## Límites de seguridad (verificados)

- Ninguna acción alcanza sistemas externos (no hay código externo en el stack RI).
- No se emite/envía/cobra ninguna factura; la pausa masiva es reversible y exige
  frase de confirmación; Holded solo se marca "pausado" tras verificación manual.
- Migraciones aditivas; todo tras flags opt-in.
</content>
