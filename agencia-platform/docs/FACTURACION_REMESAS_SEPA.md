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

## Investigación de integración con Santander (estado: NOT_CONFIGURED)
Conclusión tras revisar los canales oficiales: **no existe una API pública self-service
para ENVIAR remesas de adeudos SEPA** (cobros por acreedor) en Santander España.
- **PSD2/XS2A** (vía Redsys) cubre información de cuentas e **iniciación de pagos**
  (transferencias), **no** el envío de remesas de adeudos de un acreedor.
- El envío real de adeudos se hace por: (a) **fichero Norma 19 / `pain.008`** (formato
  AEB) subido **a mano** en el portal *Santander Empresas*, o (b) **EBICS / host-to-host
  de Santander CIB**, que **requiere contrato comercial y credenciales** provistas por el
  banco (no auto-servicio).
- **No** se usa scraping, ni lectura de contraseñas/cookies/OTP, ni se automatiza el
  portal. Nada de eso está implementado ni se hará por esas vías.

**Ruta recomendada (futura, fuera de este PR):** que el paso "preparar" **genere el
fichero `pain.008` (Norma 19)** con los mandatos/creditor-id — un fichero estándar que
**no necesita credenciales bancarias** — para subirlo manualmente en Santander Empresas;
o, si se firma un acuerdo EBICS/host-to-host, implementar ahí el envío real. Hasta
entonces el adapter permanece `NOT_CONFIGURED` y **aprobar no firma ni cobra**.

Fuentes: portal desarrolladores `developers-sandbox.bancosantander.es`, API market
`apimarket.santandercib.com`, PSD2/XS2A Redsys `market.apis-i.redsys.es/psd2/xs2a/nodos/santander`.

## Limitaciones (a propósito)
- **No** hay integración real con Santander: preparar/firmar/cobrar **no** está
  implementado (adapter `NOT_CONFIGURED`). Aprobar es un paso previo e independiente.
- La `chargeDate` (fecha de cobro inmediata) se fijará **al preparar** la remesa
  en el futuro, no al aprobar.
- `SIGNED` requiere actualización manual/conciliación (no automática).

---

# Fase 2 — Agente bancario LOCAL (Windows/Chrome) conectado al HUB

La fase 2 automatiza el paso "preparar" mediante un **agente local** que corre en
el PC del usuario y conduce **su propio Chrome** para preparar la remesa en
Santander Empresas dejándola **PENDIENTE DE FIRMA**. El agente vive en `agent/`.

## Principios de seguridad (invariantes)
- El agente **nunca firma, confirma en firme ni cobra** (ni en pruebas).
- El HUB y el agente **nunca** manejan usuario/contraseña/cookies/OTP: **el
  usuario** inicia sesión y firma.
- Aprobación de **un solo uso** ligada exactamente a factura, cliente, importe y
  fecha (`RemittanceJob.idempotencyKey = sepa-job:<requestId>`, `@unique`).
- **Claim atómico con lease** (5 min) → imposible doble ejecución. Cron re-encola
  leases caducados; agota reintentos (`maxAttempts`) → `FAILED`.
- **Kill switch por workspace** (`settings.facturacion.sepaAgentEnabled`, OFF por
  defecto): con el switch apagado, `claim` no entrega trabajos.
- Ante login/OTP/CAPTCHA/cambio de DOM/discrepancia → **pausa** (`NEEDS_USER`).
- Verificación **visible** del estado "pendiente de firma" antes de cerrar OK
  (`completeJob` exige `verifiedPendingSignature=true`; hay doble barrera
  cliente+servidor).
- **Allowlist** del dominio oficial de Santander; logs **saneados**.

## Modelo de datos (aditivo)
- `BankAgent` — agente enrolado: `tokenHash @unique` (solo hash), `status`
  (ACTIVE/REVOKED), `version`, `platform`, `lastHeartbeatAt` (online si latió
  < 90 s), `revokedAt`.
- `RemittanceJob` — trabajo bancario: estados
  `PENDING → CLAIMED → RUNNING → (NEEDS_USER) → PREPARED_PENDING_SIGNATURE`
  o `FAILED/CANCELLED`; lleva solo datos **autorizados** (sin secretos):
  `invoiceNumber, clientName, amountCents, currency, mandateRef, ibanMasked`,
  más `leaseUntil`, `attempts/maxAttempts`, `idempotencyKey @unique`.
- `RemittanceJobEvent` — log **saneado** de transiciones (para auditoría/UI).

## API
Agente (Bearer token de agente, sin sesión):
- `POST /api/v1/facturacion/agent/heartbeat` — latido (version/platform).
- `POST /api/v1/facturacion/agent/claim` — reclama el siguiente trabajo (o null).
- `POST /api/v1/facturacion/agent/jobs/:id/progress` — `RUNNING` / `NEEDS_USER`.
- `POST /api/v1/facturacion/agent/jobs/:id/complete` — `PREPARED_PENDING_SIGNATURE`
  (exige `verifiedPendingSignature=true`) o `FAILED`.

Admin (sesión + rol admin + CSRF mismo-origen):
- `GET/POST /api/v1/facturacion/agents` — listar / enrolar (token una vez).
- `POST /api/v1/facturacion/agents/:id/revoke` — revocar.
- `GET/PATCH /api/v1/facturacion/agents/killswitch` — kill switch.
- `GET /api/v1/facturacion/jobs` — listar trabajos.
- `POST /api/v1/facturacion/jobs/:id/{retry,cancel}` — reintentar / cancelar
  (cancelar bloqueado si ya está `PREPARED_PENDING_SIGNATURE`).
- `GET /api/v1/facturacion/jobs/:id/events` — log saneado.

## UI
`/facturacion/remesas` → pestaña **Agente bancario**: kill switch, enrolar/revocar
agentes con estado online/offline, cola de trabajos con reintentar/cancelar y log
saneado por trabajo.

## Correos (saneados, sin datos bancarios)
A `info@negociovivo.com` (o `SEPA_APPROVAL_EMAIL`): al **crear** el trabajo tras
aprobar, al **pausar** por intervención (`NEEDS_USER`) y al quedar **pendiente de
firma**. Best-effort; respetan `isEmailEnabled()`.

## El agente local (`agent/`)
Node + `playwright-core` que se conecta por **CDP** al Chrome visible del usuario.
Ver `agent/README.md` (runbook completo: instalar, enrolar, mapear el portal con
grabación guiada, probar en `mock`, operar en `live`, recuperación).
- Adaptador Santander **separado** de la lógica: máquina de estados + selectores
  externos (`selectors.json`, generados con `npm run record`, **no** incluidos).
- Modo `mock` (por defecto) para dry-run y tests; modo `live` para operar.
- Config por env / `agent.config.json` protegido; **sin** credenciales de banco.

## pain.008 (fallback)
`lib/facturacion/sepa/pain008.ts` genera un fichero Norma 19 (`pain.008.001.02`)
como **red de seguridad** para subida manual. **No sustituye** la preparación en
navegador. Requiere IBAN completos pasados en la llamada (el HUB **no** los
persiste; solo guarda el enmascarado).

## Pruebas
- `npx tsx scripts/test-sepa-agent.ts` — generador pain.008 (estructura, sumas,
  validaciones, escapado).
- `agent/`: `npx tsx test/run.ts` — máquina de estados, anomalías → pausa,
  barrera anti-firma, saneado de logs.

## Estado operativo
- HUB desplegable (esquema aditivo). Kill switch **OFF**: aunque haya agentes
  online, no se entregan trabajos hasta activarlo.
- El agente **no** se ha ejecutado contra el Santander real: requiere una sesión
  guiada del usuario para **mapear y validar** los selectores del portal antes de
  operar en `live`. Hasta entonces, `mock` cubre el flujo de extremo a extremo
  sin tocar el banco.
