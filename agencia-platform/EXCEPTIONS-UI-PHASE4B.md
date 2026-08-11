# FASE 4b — UI de la bandeja de excepciones

Rama `feature/hub-10x-phase-4b-exceptions-ui`, **apilada sobre Fase 4a**
(`ce99cc40`). PR draft separado. **No merge, no deploy, sin activar flags/
migraciones, sin acciones externas reales.** Backup intacto (`f836844`).

## Qué se entrega

Pantalla `/excepciones` + `ExceptionsInbox` (cliente) que consume
`GET /api/v1/exceptions` (Fase 4a) — **aditiva**, no toca la UI existente.

- **Filtros:** severidad, origen y **búsqueda** (en cliente sobre lo cargado;
  orden estable del servidor preservado). Valores inválidos ya se ignoran en el
  endpoint (bandeja completa, no vacía).
- **`capped` explícito:** banner "mostrando una parte" cuando la respuesta trae
  `capped:true` → nunca un falso "todo en orden".
- **Filas accesibles** con: severidad, origen, **nivel A0–A4** + si requiere
  aprobación (derivado del `kind`, determinista — no inventado), antigüedad,
  responsable, y **"por qué está aquí / qué hará SONIA / qué necesita de ti"**.
- **Acciones SOLO locales y seguras:** abrir origen (enlace **interno validado**
  con `safeLink`; se descartan absolutas/protocolo/host), copiar contexto,
  **ocultar localmente** (localStorage, reversible con "ver ocultas"). **No**
  aprueba/resuelve en servidor (no existe aún modelo persistente e idempotente).
  Nada de WhatsApp/email/reembolsos/gasto/Make. **Nunca sugiere que una acción
  se ejecutó** (los niveles A0–A4 describen capacidad, no ejecución).
- **Estados:** loading / empty / error (con reintentar). **Kill-switch:**
  `NEXT_PUBLIC_EXCEPTIONS_UI=off` o `localStorage['exceptions-ui']=off` → el panel
  no se monta y el enlace del sidebar se oculta (fallback total: la UI actual
  intacta).
- **Navegación:** un enlace discreto "Excepciones" en el sidebar, gated por el
  mismo flag (reversible, no rompe el resto del menú).
- **Privacidad por rol:** el endpoint ya excluye facturación para no-admin y no
  expone importes €; la UI solo renderiza lo que recibe.

## Benchmark (payload)

- 100 excepciones ≈ **46,4 KB** (JSON, campos cortos). Bandeja acotada por el
  `limit`/`SOURCE_CAP` del endpoint. **Filtrar/buscar/ocultar NO re-consulta al
  servidor** (todo cliente sobre lo cargado) → interacción instantánea.

## Pruebas

- `lib/exceptions/ui.ts` (puro): mapeo A0–A4 por tipo, severidad, edad, `safeLink`
  (rechaza enlaces no internos), filtros/búsqueda, ocultar-local reversible.
- (El endpoint ya tiene tests de tenant, capped, billing-solo-admin, filtros.)

## Riesgos / rollback

Panel aditivo tras kill-switch; solo lectura + acciones locales (cero efectos de
servidor/externos). Rollback global = revertir la rama; base intacta en
`ce99cc40` / `f836844`.

## Pendiente

- Acción "aprobar/resolver" server-side: requiere un **modelo persistente e
  idempotente** de estado de excepción (no se implementa aquí; no se inventan
  estados).
- Collectors adicionales seguros (lead-inbox sin resolver, cron mudo) — slice
  siguiente, solo si los invariantes son fiables.
