# Remesas de adeudos SEPA — aprobación

Módulo de **aprobación** de remesas de adeudos SEPA dentro de `/facturacion`.
Aplica **solo** a la empresa emisora **Negocio Vivo S.C.A.** (se excluyen Pronsia,
LemonRoi y Rixus).

> **Aprobar NO firma ni ejecuta el cobro.** Solo deja la solicitud lista para
> preparar/reemitir en el banco y, finalmente, pendiente de firma. No se realiza
> ninguna operación real en Santander en esta implementación ni se simula éxito.

## Flujo

1. Se detecta una **factura candidata** (ver reglas) → se crea una **solicitud
   idempotente** (una por `companyId + invoiceId`).
2. Se envía un **email** a `info@negociovivo.com` con un **enlace seguro** a
   `/facturacion/aprobaciones/[token]`.
3. La página exige **usuario autenticado y ADMIN** (el enlace por sí solo no da
   acceso), muestra el resumen y ofrece **Aprobar / Rechazar** con confirmación
   adicional.
4. La decisión se registra (auditoría) y la solicitud pasa a `APPROVED`/`REJECTED`.

### Reglas de candidatura (todas obligatorias)
- Emisora = **Negocio Vivo S.C.A.**
- Estado **ISSUED** (emitida/aprobada); no borrador, no anulada, no pagada.
- Importe **positivo**; no cobrada (`paidAt` nulo).
- **Cliente identificado**.
- Número **no empieza por `R-`** y no es rectificativa.
- **Sin remesa previa**.
- Cliente **habilitado para SEPA** (`sepaEnabled`, opt-in; **desactivado por
  defecto** — ~90% cobran por adeudo pero se exige habilitación expresa).

### Estados
`PENDING_APPROVAL → APPROVED → PREPARING → PENDING_SIGNATURE → SIGNED`
(+ `REJECTED`, `EXPIRED`, `FAILED`). `SIGNED` solo por conciliación/actualización
manual futura.

## Seguridad
- **Token** aleatorio de 256 bits; en BD se guarda **solo su hash SHA-256**.
- **Un solo uso** (`tokenUsedAt`) + **caducidad 24 h** + comparación en tiempo
  constante.
- Transición **atómica** (UPDATE con guarda por estado) → imposible doble aprobación.
- **CSRF** por comprobación de origen en los endpoints que cambian estado.
- **Nunca** se guardan ni muestran credenciales bancarias: el IBAN se persiste
  **solo enmascarado** (`ES91 **** … 1332`).

## Variables de entorno
| Variable | Obligatoria | Descripción |
|---|---|---|
| `INTERNAL_CRON_TOKEN` | sí (cron) | Bearer para `POST /api/v1/internal/facturacion-cron`. Ya usado por otros crons. |
| `RESEND_API_KEY` | recomendada | Envío del email de aprobación (reutiliza el correo existente). Sin ella no se envía; la solicitud se crea igual. |
| `SEPA_APPROVAL_EMAIL` | no | Destinatario del email. Por defecto `info@negociovivo.com`. |
| `SEPA_AUTO_SCAN` | no | `true` → el cron detecta candidatas y crea solicitudes (con email) automáticamente. Por defecto **desactivado**: la creación se hace a mano desde el botón «Buscar candidatas». |
| `NEXT_PUBLIC_APP_URL` / `NEXTAUTH_URL` | recomendada | Base del enlace del email y allowlist de origen (CSRF). |
| `SANTANDER_API_BASE_URL` + `SANTANDER_API_KEY` | no | Si **ambas** están, el provider pasa a `CONFIGURED`; si faltan, `NOT_CONFIGURED` (estado actual). **No hay operación real implementada**: el adapter lanza `ProviderNotConfiguredError`. |

## Endpoints
- `GET  /api/v1/facturacion/remesas` — listado paginado (ADMIN).
- `GET  /api/v1/facturacion/remesas/candidates` — candidatas (paginado, ADMIN).
- `POST /api/v1/facturacion/remesas/scan` — crea solicitudes de candidatas (ADMIN, CSRF).
- `GET  /api/v1/facturacion/remesas/by-token/[token]` — resumen por token (ADMIN).
- `POST /api/v1/facturacion/remesas/by-token/[token]/decision` — aprobar/rechazar (ADMIN, CSRF, un solo uso).
- `GET/PATCH /api/v1/facturacion/clients-sepa[/[id]]` — config SEPA por cliente (ADMIN, CSRF).
- `POST /api/v1/internal/facturacion-cron` — cron (Bearer): caduca enlaces vencidos y, si `SEPA_AUTO_SCAN=true`, detecta candidatas.

## Tests
Lógica crítica (candidatura, token de un uso, IBAN, provider):
```
npx tsx scripts/test-sepa-remittance.ts
```

## Migración
Cambios de esquema **aditivos** (campos SEPA en `Client`, modelos
`SepaRemittanceRequest` y `SepaRemittanceEvent`, enum `SepaRemittanceStatus`).
Se aplican con el flujo del proyecto: `prisma db push` (al arrancar) tras
`prisma generate`. No borra ni modifica datos existentes.

## Limitaciones (a propósito)
- **No** hay integración real con Santander: preparar/firmar/cobrar **no** está
  implementado (adapter `NOT_CONFIGURED`). Aprobar es un paso previo e independiente.
- La `chargeDate` (fecha de cobro inmediata) se fijará **al preparar** la remesa
  en el futuro, no al aprobar.
- `SIGNED` requiere actualización manual/conciliación (no automática).
