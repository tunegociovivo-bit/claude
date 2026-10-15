# El navegador del Radar de subastas — qué usa

El Radar entra en los portales de subastas con un navegador Chrome. El CRM no
lleva Chrome dentro por defecto, así que hay que darle uno.

## Opción B (ACTIVA) — Chromium dentro del contenedor del CRM

Es la que está en marcha, porque no tiene cuota externa (no hay cuenta de
Browserless que mantener). Se activa con dos ficheros, ya en el repo:

- `crm-ventas/railway.json` → fija el builder a **DOCKERFILE** apuntando a
  `deploy/Dockerfile.chromium`. Railway lo lee solo en cada deploy (no hay que
  tocar ajustes a mano).
- `deploy/Dockerfile.chromium` → instala Chromium del sistema y sus librerías,
  define `RADAR_CHROMIUM_PATH=/usr/bin/chromium` y construye el CRM igual que
  antes. `lib/radar/browser.ts` lanza ese Chromium local.

A tener en cuenta:
- Chromium corre dentro del contenedor del CRM, así que usa su RAM/CPU mientras
  el Radar trabaja (el Radar abre un navegador por portal, de uno en uno). El
  plan del CRM tiene memoria de sobra.
- Sale por IP de centro de datos (igual que Browserless): los portales con
  anti-bot (BCA, Auto1, Ayvens…) pueden pedir captcha; el Radar los marca como
  «necesita tu ayuda». Si pasa en varios, se añade un proxy residencial en
  `RADAR_PROXY_URL` (ya soportado).
- Si el build con Docker fallara, Railway mantiene vivo el deploy anterior del
  CRM: producción no se cae.

Para volver atrás: borra `crm-ventas/railway.json` (vuelve al builder por
defecto) o cambia `builder` a `RAILPACK`.

## Opción A (alternativa) — Browserless.io

Nube de Chrome de pago por uso. Se usaría poniendo `BROWSERLESS_API_KEY` (y, si
la cuenta es v2 regional, `BROWSERLESS_WS_HOST`) en el entorno del CRM, o un
endpoint CDP explícito en `RADAR_BROWSER_WS_URL`. `lib/radar/browser.ts` da
prioridad a estas variables sobre el Chromium local, así que si algún día se
prefiere Browserless, basta con añadir la clave (sin tocar código ni el
Dockerfile). Pega: plan gratis corto (1.000 usos/mes) → cuota mensual para uso
real.

El código del Radar no cambia entre A y B: usa
`BROWSERLESS_API_KEY`/`RADAR_BROWSER_WS_URL` si están, y si no, el
`RADAR_CHROMIUM_PATH` local del contenedor.
