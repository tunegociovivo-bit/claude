# Incidencia reto BubUI (prueba real 9-ago-2026) — causa raíz y solución integral

Enlace probado: `https://bubui.app/reto/60df921bb7bdeb5d`
Reto real (verificado en producción): **Roman Trainer** (Málaga), 30% cliente / 15%
amigo, 5 amigos requeridos, no caducado, no reclamado.

## Traza extremo a extremo y DÓNDE se perdía el reto (con evidencia)

| Etapa | Estado antes | Evidencia |
|---|---|---|
| 1. Metadata WhatsApp | ❌ genérica | El HTML SSR de `/reto/<token>` solo emitía `<title>Bubui — …</title>` y `description` genérica; **cero `og:*`**. `page.tsx` era client-only sin `generateMetadata`. |
| 2. Botón/deep link | ✅ | `RetoClient` abre `bubui://reto/<token>` y ofrece Play con `referrer=reto_<token>`. |
| 3. URL Play + Install Referrer | ✅ (nativo) | `react-native-play-install-referrer@1.1.9` autolinkeado en Android (sourceDir + packageImportPath verificados). |
| 4. Captura nativa (fresh install) | ❌ frágil | `deal-pending.ts` marcaba `IR_DONE` **antes** del callback → un fallo transitorio perdía el token para siempre. Sin `waitForDealCapture` → carrera captura/alta. |
| 5. Selección de pantalla inicial | ❌ | Sin sesión → Onboarding, pero **sin conciencia del reto**: mostraba "Explorar sin cuenta" → Feed invitado con 0 cupones. |
| 6. Alta OTP | ⚠️ | Registro no obligatorio ni contextualizado con el reto. |
| 7. claimPendingDeal | ❌ carrera | Se llamaba sin esperar a la captura del Install Referrer → token aún no guardado → no reclamaba. |
| 8. Render final | ❌ | Sin claim, el reto nunca aparecía. |
| — Iconos menú inferior | ❌ | Ionicons embebido en el APK (`assets/fonts/Ionicons.ttf`, verificado tras prebuild) pero **nunca cargado en runtime** → glifos en blanco. |

## Por qué #283/#284 pasaron y la prueba real falló (req#6)

Los tests de #283/#284 cubrían **solo `referral-pending.ts`** (referidos). Ese
módulo SÍ recibió el endurecimiento (IR_DONE tras terminal, `waitForReferrerCapture`,
loader inyectable). El módulo del **reto (`deal-pending.ts`) NO tenía tests** y
seguía con el patrón antiguo y con carrera. Además, la metadata de WhatsApp, la
lógica de invitado del onboarding y la carga de la fuente de iconos **no tenían
ninguna prueba** (son integración real, no funciones aisladas mockeadas).

## Solución (archivos)

**Web (agencia-platform)**
- `lib/bubui/custom-deal.ts` (nuevo): `getCustomDealPublic` + `customDealShareCopy` (fuente única).
- `app/bubui/reto/[token]/page.tsx`: server component con `generateMetadata` (OG título/desc/imagen absolutas + canónica) verificable sin JS.
- `app/bubui/reto/[token]/opengraph-image.tsx` (nuevo): tarjeta 1200×630 del reto.
- `app/api/bubui/custom-deal/[token]/route.ts`: usa el helper compartido.
- `lib/bubui/deal-trace.ts` + `app/api/bubui/deal-trace/route.ts` (nuevos): observabilidad segura por token/etapa (sin IP/PII). GET solo admin.
- `prisma/schema.prisma`: modelo aditivo `BubuiDealTrace`.

**App (apps/bubui-mobile)**
- `src/lib/deal-pending.ts`: `IR_DONE` solo tras terminal, `waitForDealCapture`, loader inyectable, señal en todas las ramas, trazas.
- `src/screens/Onboarding.tsx`: si hay reto pendiente → salta el vídeo, va directo al registro, muestra banner del reto, **oculta "Explorar sin cuenta"**; `verify()`/`loginVerify()` esperan la captura antes de reclamar.
- `src/lib/fonts.ts`: carga `Ionicons.font` en runtime (además del plugin) — arregla los iconos.
- `App.tsx`: espera fuentes (con timeout de seguridad) antes de renderizar el menú.
- `src/lib/api.ts`: `getCustomDeal`, `traceDeal`.

## Pruebas y resultados (req#7, #9)

- App: `npx tsc --noEmit` → **0**. `npx vitest run` → **17/17** (incluye `deal-pending.test.ts` que reproduce el caso real: desinstalada→Play→arranque→alta→claim, referrer tardío, **regresión del bug IR_DONE**, deep link, reintentos).
- Web: `npx tsc --noEmit` → **0**. guardas multi-tenant → **OK**. `npx vitest run` → **18/18** (incluye metadata WhatsApp específica del reto + saneo de trazas).
- Bundle Android: `npx expo export --platform android` → **OK** (Hermes 3.15 MB); `Ionicons.ttf` (443 kB) incluido como asset → el fix de runtime resuelve.
- Prebuild Android: `expo prebuild` → `android/app/src/main/assets/fonts/Ionicons.ttf` embebido (443 kB).

## ¿Hace falta un nuevo AAB? — SÍ

Los arreglos de la app (iconos, captura del reto, onboarding) son **nativos/de
runtime** → requieren un **nuevo binario**. Antes de subir a Play, generar un
**APK interno** y probarlo físicamente:

```bash
# APK interno verificable (perfil preview de eas.json → buildType apk):
cd apps/bubui-mobile
eas build -p android --profile preview
```

> El APK no se pudo compilar en este entorno (no hay Android SDK/NDK; RN 0.79 los
> exige). Se validó el bundle JS (expo export) y el embebido de la fuente
> (prebuild). El build nativo es el paso de EAS de arriba.

Los arreglos **web** (metadata WhatsApp, endpoint de trazas) se activan con el
deploy del HUB (esquema aditivo `BubuiDealTrace`), sin tocar la app.

## Plan de prueba física (móvil limpio)

1. Desinstalar la app, borrar datos/cookies. Instalar el APK interno.
2. Compartir `https://bubui.app/reto/60df921bb7bdeb5d` por WhatsApp → **debe verse** tarjeta con "Roman Trainer" y "30%".
3. Desde un móvil limpio: abrir el enlace → Instalar en Play → abrir la app.
4. Debe ir **directo al registro** con el banner del reto (no invitado). Completar OTP.
5. Tras verificar, el reto debe **reclamarse y verse** en el Feed.
6. Menú inferior: iconos visibles (Inicio/Descubre/Mapa/Cuenta) y FAB de escanear con icono.
7. Diagnóstico si algo falla — línea de tiempo del token (admin):
   `GET https://bubui.app/api/bubui/deal-trace?token=60df921bb7bdeb5d`
   Debe mostrar: `web_page_view` → `app_capture_install_referrer` → `app_claim_attempt` → `app_claim_ok`. La etapa donde se corte indica el punto exacto.

## Escenarios de deep link (app ya instalada)
Abrir `bubui://reto/<token>` o `https://bubui.app/reto/<token>`: `deal-pending`
captura el token de la URL inicial y, con sesión, reclama al momento; sin sesión,
el onboarding fuerza el registro y reclama tras el OTP.
