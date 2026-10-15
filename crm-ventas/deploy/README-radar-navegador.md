# El navegador del Radar de subastas — qué usar

El Radar entra en los portales de subastas con un navegador Chrome. El CRM se
despliega con nixpacks y **no lleva Chrome dentro**, así que hay que darle uno.
Dos caminos; el primero es el recomendado y el que está activo por defecto.

## Opción A (recomendada, ya configurada) — Browserless.io

El Hub ya usa la nube de Browserless.io para su scraping. El Radar reutiliza esa
misma cuenta: no hay que montar ningún servicio nuevo.

**Qué hacer:** copia la variable `BROWSERLESS_API_KEY` del proyecto del Hub
(Railway → *lively-renewal* → Variables) al proyecto del CRM
(Railway → *rare-generosity* → Variables) y despliega. Nada más.

- Host por defecto: `chrome.browserless.io`. Si la cuenta es v2 regional, fija
  `BROWSERLESS_WS_HOST` (p. ej. `production-sfo.browserless.io`).
- A tener en cuenta: el plan gratis son 1.000 unidades/mes; una revisión diaria
  de 12 portales con paginación las agota pronto → para uso real de Carshop,
  plan de pago de Browserless. Además sale por IP de centro de datos: los
  portales con anti-bot (BCA, Auto1, Ayvens…) pueden pedir captcha; el Radar los
  marca como «necesita tu ayuda». Si pasa en varios, añade un proxy residencial
  en `RADAR_PROXY_URL`.

## Opción B (plan B) — Chromium dentro del contenedor del CRM

Más barato (sin Browserless) pero acopla los cuelgues del navegador al CRM y
engorda el contenedor. Está preparado en `deploy/Dockerfile.chromium`, **sin
activar**.

**Cómo activarlo:**

1. En el servicio del CRM en Railway (raíz = `crm-ventas/`), cambia el builder a
   **Dockerfile** y apunta la ruta a `deploy/Dockerfile.chromium`
   (Settings → Build → Dockerfile Path). Alternativa: mover/renombrar el archivo
   a `crm-ventas/Dockerfile` (Railway lo detecta solo, pero entonces deja de
   usar nixpacks para este servicio).
2. Quita (o deja vacía) `BROWSERLESS_API_KEY` en el CRM para que el Radar use el
   Chromium local. El Dockerfile ya define `RADAR_CHROMIUM_PATH=/usr/bin/chromium`.
3. Despliega **en un servicio de staging primero**: este Dockerfile no se ha
   probado contra el build real de Railway.

El código del Radar no cambia entre A y B: `lib/radar/browser.ts` usa
`BROWSERLESS_API_KEY`/`RADAR_BROWSER_WS_URL` si están, y si no, el
`RADAR_CHROMIUM_PATH` local.

## Recomendación

Empieza con **A (Browserless)**: es inmediato y reversible. Si el volumen o los
bloqueos lo piden, pasa a proxy residencial (sigue en A) y, solo si quieres
quitarte Browserless del todo, a **B**.
