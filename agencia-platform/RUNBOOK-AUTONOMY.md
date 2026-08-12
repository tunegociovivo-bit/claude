# Runbook — Despliegue progresivo y reversible del motor de autonomía de Sonia (PR #308)

> **Estado del código:** listo y verde (tsc + 437 tests + tenant-guards 91 + build). **SHADOW por defecto.** Ninguna acción externa real ocurre hasta que se activen flags.
>
> **Quién ejecuta qué:** el agente NO tiene acceso a la infraestructura (ni `DATABASE_URL`, ni claves de proveedor, ni CLI de Railway/Hetzner, ni a tus pestañas de navegador autenticadas). **Todos los pasos de infraestructura de este runbook los ejecutas TÚ** en tus sesiones autenticadas (Railway UI/Console, Hetzner). Nunca pegues secretos en chat ni en logs.

## 0. Topología confirmada
- **Producción:** Railway, proyecto `lively-renewal`, entorno `production`, servicio `claude`, Postgres online.
- **Rama desplegada por Railway:** `claude/wordpress-ai-review-plugin-bdSLe` (auto-deploy).
- **Secretos ya en Railway:** `DATABASE_URL`, `ANTHROPIC_API_KEY`. **Falta:** `OPENAI_API_KEY` (está en la bóveda `/admin/secretos`). Gemini/Perplexity NO tienen clave → quedan `unhealthy` (no bloquean el failover Anthropic/OpenAI).
- **Rollback exacto pre-autonomía:** rama `rollback/pre-autonomy-6fe0422d` (= `6fe0422d`, el HEAD de producción antes de esta pila). Ya empujada.

## 1. Backup de DB (ANTES de tocar nada) — lo ejecutas tú
La migración es **puramente aditiva** (tablas/columnas nuevas vacías), así que el riesgo de pérdida de datos es ~nulo y el rollback de esquema es "DROP de tablas vacías". Aun así, backup primero:
1. En Railway → servicio Postgres → **Console** (o Connect), con `DATABASE_URL` **inyectada por la propia UI** (no la copies ni la imprimas):
   ```
   pg_dump --no-owner --no-privileges -Fc "$DATABASE_URL" -f /tmp/pre-autonomy-$(date +%F).dump
   sha256sum /tmp/pre-autonomy-*.dump   # guarda el checksum
   ```
2. Cifra y súbelo al servidor Hetzner **solo si confirmas destino + espacio + cifrado + checksum**:
   ```
   gpg --symmetric --cipher-algo AES256 /tmp/pre-autonomy-*.dump   # pide passphrase; NO la pongas en el comando
   # scp/rsync del .gpg al almacenamiento Hetzner; verifica sha256 en destino
   ```
   Si no puedes garantizar destino/espacio/cifrado/checksum, **detente**: sin backup verificado no continúes a producción.

## 2. Aplicar la migración aditiva ANTES de flags
La DDL la aplica el arranque del contenedor vía `prisma db push` (Dockerfile). Como es aditiva, se crea sin lock. Orden **obligatorio**: migración (deploy de código) **primero**, flags **después** (si enciendes `AI_RUN_ORCHESTRATOR` antes de que existan las tablas, las rutas devuelven 500).
1. **Fast-forward de la rama de Railway** al código revisado (lo puede hacer el agente por git, o tú por UI):
   `git push origin feature/ai-autonomy-engine:claude/wordpress-ai-review-plugin-bdSLe` (fast-forward; NO force).
   > El agente puede ejecutar este push cuando tú lo autorices explícitamente; hoy **no** lo ha hecho.
2. Railway despliega. **Todos los flags OFF por defecto** → el motor queda inerte: rutas nuevas 404, hook del runner no-op, nada consulta las tablas nuevas salvo su creación.
3. **Verifica** en Railway: Deployment `SUCCESS`, `/api/v1/health` 200, Logs sin errores de `prisma db push`. Confirma que las tablas `AiOrchestration/AiRunStep/AiApproval/AiApprovalEvent` existen.

Rollback de este paso: re-desplegar `rollback/pre-autonomy-6fe0422d` (fast-forward-with-lease); las tablas vacías pueden quedar o dropearse (`db/migrations/2026-08-11-ai-orchestrator.sql`, sección Revertir).

## 3. Activar SHADOW y validar en producción (sin efectos)
En Railway → servicio `claude` → **Variables** (valores nunca en chat):
- `AI_RUN_ORCHESTRATOR=on`  → habilita el panel/endpoints (sigue TODO en shadow: `mode:"shadow"`, `executed:false`).
- `HUB_AUTONOMY_SHADOW=on`  → el runner registra la decisión A0–A4 que TOMARÍA (solo log), sin cambiar comportamiento.
- Deja `AI_MULTIMODEL` **off** por ahora.

Validación shadow (sin efectos externos):
- `POST /api/v1/ai/orchestrations/simulate` (admin) con un escenario → traza persistida, `executed:false`.
- Revisa Logs: `[autonomy-shadow]` muestra decisiones con `executed:false`.
- Confirma que ninguna factura/mensaje/pago se emite (no hay ruta que lo haga en shadow).

## 4. Configurar OPENAI_API_KEY (solo cuando el código esté revisado y quieras multi-modelo)
En Railway → Variables → añade `OPENAI_API_KEY` **copiándola directamente desde la bóveda `/admin/secretos` en la UI**, sin mostrarla ni pegarla en chat/logs. Anthropic ya está. Gemini/Perplexity se quedan sin clave → `unhealthy` → el routing los salta (no bloquean el failover). No hace falta nada más para ellos.

## 5. Canary real MUY limitado (A0/A1, sin efectos) — solo con evidencia verde del paso 3
> El canary "real" hace llamadas de **modelo** reales (datos redactados salen al proveedor); **NO** ejecuta efectos A2+ (mensajes/publicaciones/borrados/compras/pagos/fiscal/emisión/envío/cobro), que siguen en `approval_required` fail-closed.
- Activa `AI_MULTIMODEL=on` y (cuando exista el entrypoint del scheduler, ver §6) arranca el worker con presupuestos **muy bajos**: `maxAttempts` bajo, `maxCostUsd`/`maxTokens`/`maxWallMs` mínimos, límite a tareas A0/A1 de bajo riesgo, sin herramientas de efecto.
- Vigila: coste real por orquestación, trips del breaker, escaladas, latencia, 429. Amplía **solo** si hay verde sostenido.
- Mantén A2+ y cualquier acción sensible en `approval_required`: solo procede con una fila `AiApproval` **específica, con TTL, cap no nulo y scope concreto** (endpoint `POST /api/v1/ai/approvals`, auditada en `AiApprovalEvent`).

## 6. Pieza pendiente antes del canary: entrypoint del scheduler
El **núcleo** del worker está implementado y probado (`lib/ai/orchestrator/worker.ts`: `claimDue`/lease/`stepOrchestration`/`resume*`) y el runtime de seguridad (`runtime.ts`: `withDeadline`, `serializedProbe` con lock por proveedor, `chooseProvider`). **Falta** el cableado del *entrypoint* que los invoca periódicamente y el `runStep` que une controller+adapters+deadline en un paso real — se valida con la BD ya desplegada (paso 2). Hasta que exista y esté validado, **el canary real permanece apagado**; shadow (§3) es totalmente funcional sin él.

## Kill-switch / rollback en cualquier momento
- **Parada suave:** pon `AI_RUN_ORCHESTRATOR=off` (y `AI_MULTIMODEL=off`). Rutas 404, hook no-op, worker no toma trabajo. Sin migración de datos.
- **Rollback de código:** re-desplegar `rollback/pre-autonomy-6fe0422d`.
- **Kill-switch en el loop:** `stepOrchestration` transiciona a `cancelled` si el kill-switch está activo (parada segura sin ejecutar).

## Bloqueos honestos (a fecha de hoy)
1. El agente **no puede** ejecutar §1–§4 (backup, migración/deploy, variables): requieren tus sesiones autenticadas de Railway/Hetzner, inaccesibles desde su entorno. Las ejecutas tú con este runbook.
2. `OPENAI_API_KEY` aún no está en Railway (paso §4). Gemini/Perplexity sin clave por diseño.
3. El entrypoint del scheduler (§6) es la última integración; sin BD desplegada no puede validarse end-to-end.
