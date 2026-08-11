# FASE 1 — Seguridad y Reversibilidad (HUB NEGOCIOVIVO)

Base: rama `feature/hub-10x-phase-1-foundations`, partiendo de `f836844`
(commit desplegado en producción). **Ningún cambio se activa solo**: los que
alteran comportamiento van detrás de una variable de entorno con modo por
defecto conservador. Nada se ha desplegado ni fusionado.

Punto de restauración del estado actual: rama remota
`backup/hub-pre-10x-2026-08-11` → `f836844dc03c05ff0992f6be41cbc6351f02ac20`.

---

## Resumen de interruptores (env) y su valor por defecto

| Punto | Variable | Default | Efecto del default | Cómo ACTIVAR el endurecimiento | Cómo DESACTIVAR |
|---|---|---|---|---|---|
| 1 Admin gate | `HUB_ADMIN_ENFORCE` | `log` | No bloquea; solo registra accesos de no-admin a `/api/v1/admin/*` | `HUB_ADMIN_ENFORCE=enforce` | `=off` (o `=log`) |
| 2 Auth Bubui cliente | `BUBUI_CUSTOMER_AUTH_MODE` | `lazy` | Permite sin token (como hoy) | `=shadow` (medir) → `=strict` (401 sin token) | `=lazy` |
| 2 Auth Bubui negocio | `BUBUI_BUSINESS_AUTH_MODE` | `lazy` | Permite negocio sin apiToken | `=shadow` → `=strict` | `=lazy` |
| 3 Gate tools IA | `AI_TOOL_GATE` | `enforce` | **Bloquea** tools mutantes peligrosas (dinero/mensajería/Make mutante) | ya activo | `=log` (shadow) o `=off` |
| 3 Auto-aprobado autopilot | `AI_AUTOPILOT_AUTOAPPROVE` | (on) | Comportamiento actual del autopilot | — | `=off` (fuerza aprobación manual) |
| 3 Self-heal auto-merge | `SELF_HEAL_AUTO_MERGE` | (off) | **No** auto-mergea; abre PR para revisión | `=true` | quitar la env |
| 3 Self-heal merge sin CI | `SELF_HEAL_MERGE_WITHOUT_CI` | (off) | No mergea repos sin CI | `=true` (no recomendado) | quitar la env |
| 6 Clave de cifrado | `SECRETS_ENC_KEY` | (unset) | Deriva del `NEXTAUTH_SECRET` actual (compat) | poner `SECRETS_ENC_KEY` | quitar la env (vuelve a NEXTAUTH_SECRET) |
| 7 Cron secreto en URL | `CRON_ALLOW_QUERY_SECRET` | (off) | Ignora `?secret=`; solo cabeceras | `=true` (transición legacy) | quitar la env |

> Nota: los flags previos `BUBUI_REQUIRE_CUSTOMER_TOKEN=true` /
> `BUBUI_REQUIRE_BUSINESS_TOKEN=true` siguen significando `strict`.

---

## Punto 1 — Gate central de rol admin
- **Qué**: `withApi` exige rol ADMIN en toda ruta `/api/v1/admin/*` (por path) y en
  las que declaran `admin:true`. Cierra la escalada de un MIEMBRO a ~56 rutas admin.
  Las API keys siguen autorizadas (no rompe integraciones). El cron no pasa por aquí.
- **Archivos**: `lib/api/admin-gate.ts` (nuevo), `lib/api/handler.ts`,
  `app/api/v1/{api-keys,gmb/clients/[id]/create-scenario,sonia/preview-voice,ai-agent/runs/[id]/replay}/route.ts`
  (+`admin:true`), `app/api/v1/admin/wp-import/exporter-plugin/route.ts` (antes SIN auth → ahora `withApi`).
- **Rollout**: desplegar con `log` → revisar avisos `[admin-gate:log]` unos días
  → si nadie legítimo depende de ello, `HUB_ADMIN_ENFORCE=enforce`.
- **Rollback**: `HUB_ADMIN_ENFORCE=off`.

## Punto 2 — Auth Bubui fail-closed con transición
- **Qué**: sin token → decisión por modo. Se mantiene la validación estricta de
  quien SÍ presenta token. `shadow` mide el tráfico legacy sin bloquear.
- **Archivos**: `lib/bubui/auth-mode.ts` (nuevo), `lib/bubui/customer-auth.ts`,
  `lib/bubui/auth.ts`, `scripts/bubui-auth-audit.ts` (diagnóstico solo lectura).
- **Migración**: `npx tsx scripts/bubui-auth-audit.ts` → mide clientes/negocios
  activos SIN token (impacto de `strict`). Poner `shadow`, re-medir, y activar
  `strict` cuando "sin token Y ACTIVOS" ≈ 0. Los tokens se emiten solos al
  re-login del cliente/panel (no hay backfill destructivo: emitir tokens a sesiones
  vivas las echaría, por eso el script es solo lectura).
- **Rollback**: modo `lazy`.

## Punto 3 — Aprobación server-side obligatoria de tools IA
- **Qué**:
  - Gate en el choke point de dispatch (`runner.ts`): las tools mutantes peligrosas
    NO se ejecutan de forma autónoma. Cubiertas: WhatsApp (texto/voz), **email
    (Resend)**, Stripe (reembolso/cliente/suscripción), Holded (factura/presupuesto),
    **gasto publicitario Meta Ads y Google Ads** (crear campaña/anuncio/presupuesto,
    cambios masivos), y Make mutante (crear/activar/desactivar escenario y
    `make_raw_api` con método ≠ GET/HEAD/OPTIONS incl. DELETE). Las tools de
    PUBLICACIÓN de contenido (wp/gmb/sheets/woocommerce) NO se gatean a propósito
    (no son dinero/mensajería; se revisará en FASE 2). La clasificación de peligro es **del servidor** (`tool-gate.ts`), no
    del `riskLevel` que declara el modelo. En `enforce` devuelve `requires_human_approval`.
  - Self-heal: el auto-merge ya no depende del flag `safe` del modelo; requiere
    `SELF_HEAL_AUTO_MERGE=true` (default off → abre PR y para revisión). Se elimina
    el merge "sin CI tras 30s" salvo `SELF_HEAL_MERGE_WITHOUT_CI=true`.
  - Autopilot: kill-switch `AI_AUTOPILOT_AUTOAPPROVE=off`.
- **Archivos**: `lib/ai/nv-ia/tool-gate.ts` (nuevo), `lib/ai/nv-ia/runner.ts`,
  `lib/ai/nv-ia/tools.ts`, `lib/ai/self-heal/agent.ts`.
- **Pendiente FASE 2**: enrutar las tools bloqueadas al sistema de borradores
  `AiDraft` (aprobar/ejecutar desde el panel) en lugar de solo bloquear+avisar;
  añadir revert real del merge tras healthcheck fallido.
- **Rollback**: `AI_TOOL_GATE=off`.

## Punto 4 — Claim atómico de la cola WhatsApp
- **Qué**: la transición `queued→sending` es un único `updateMany` condicional;
  dos workers no pueden enviar el mismo mensaje. Sin flag (mejora pura, sin cambio
  de comportamiento observable salvo eliminar el doble envío).
- **Archivos**: `lib/leads/send-queue.ts`.
- **Rollback**: revertir el commit.

## Punto 5 — Healthcheck real
- **Qué**: `railway.json` apunta a `/api/v1/health` (ping BD) en vez de `/login`.
  Se activa en el próximo deploy (Railway).
- **Rollback**: revertir `railway.json`.

## Punto 6 — Clave de cifrado dedicada
- **Qué**: `SECRETS_ENC_KEY` preferida; sin ella se usa `NEXTAUTH_SECRET` (lo que
  cifró los datos actuales → cero rotura). Eliminado el fallback público. El
  descifrado prueba ambas claves (rotación sin pérdida). Validador al arrancar.
- **Archivos**: `lib/ai/crypto.ts`, `lib/security/secrets-config.ts` (nuevo),
  `instrumentation.ts` (aviso no-fatal).
- **Rollout recomendado**: poner `SECRETS_ENC_KEY = <valor actual de NEXTAUTH_SECRET>`
  (desacopla ambos sin recifrar). Después ya se puede rotar `NEXTAUTH_SECRET` (JWT)
  sin tocar el vault. Para usar una clave dedicada NUEVA: ponerla y ejecutar un
  re-cifrado (opcional; el descifrado tolerante lee lo antiguo mientras tanto).
- **Rollback**: quitar `SECRETS_ENC_KEY`.

## Punto 7 — Cron auth
- **Qué**: comparación en tiempo constante (`timingSafeEqual`); `?secret=` en la URL
  desactivado salvo `CRON_ALLOW_QUERY_SECRET=true`. Cabeceras `Authorization: Bearer`
  y `x-cron-secret` sin cambios.
- **Archivos**: `lib/cron-auth.ts`.
- **Transición**: si algún cron legacy aún usa `?secret=`, activar
  `CRON_ALLOW_QUERY_SECRET=true` (emite aviso de deprecación) y migrarlo a cabecera.
- **Rollback**: `CRON_ALLOW_QUERY_SECRET=true`.

---

## Verificación ejecutada en esta rama
- `npx vitest run` → 17 ficheros, 130 tests verdes (50 nuevos de FASE 1).
- `npx tsc --noEmit` → 0 errores (tras `npx prisma generate`).
- `node scripts/check-tenant-guards.mjs` → sin escrituras sin guard de workspace.

## Restaurar todo
```bash
git fetch origin backup/hub-pre-10x-2026-08-11
git switch --detach origin/backup/hub-pre-10x-2026-08-11   # estado de producción f836844
```
