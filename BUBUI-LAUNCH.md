# 🚀 Bubui — Guía de lanzamiento

Checklist y notas para sacar la app **Bubui** a Google Play y App Store.
App móvil: `apps/bubui-mobile` (Expo/React Native). Backend: `agencia-platform`
(Next.js, endpoints en `app/api/bubui/*`).

> Marca cada casilla `[x]` a medida que lo completes.

---

## 1. Android (Google Play)

El `.aab`/`.apk` se compila **gratis en GitHub Actions** (no usa EAS).

- **Cómo compilar**: pestaña **Actions → "Build Bubui (Android APK + AAB)" → Run workflow**.
- **versionCode**: lo calcula el workflow automáticamente = `1000 + nº de run`
  (build #15 → versionCode **1015**). Siempre creciente.
- **Descargas con enlace fijo** (de la última Release):
  - APK (instalar en el móvil): `releases/latest/download/bubui.apk`
  - AAB (subir a Play): `releases/latest/download/bubui.aab`

### Pendiente
- [ ] **Quitar el bundle 1013** de la versión de prueba cerrada en Play Console
      (deja solo el 1014/1015). Eso elimina los 3 errores: el 1013 aún llevaba
      `ACCESS_BACKGROUND_LOCATION` + `FOREGROUND_SERVICE` (geofencing).
- [ ] **Lanzar build 1015** (incluye fixes de ubicación + seguridad) y subirlo
      a la prueba cerrada.
- [ ] Avisar a los testers de que actualicen a la última versión.

### Notas
- El **geofencing está desactivado** (`GEOFENCING_ENABLED = false` en
  `src/lib/geofence.ts`) y los permisos de ubicación en segundo plano se
  bloquean en `app.json` (`blockedPermissions`). Reactivar requiere declarar
  esos permisos en Play (+ vídeo de demostración).
- La advertencia de "archivo de desofuscación (R8/ProGuard)" es **ignorable**.

---

## 2. iOS (App Store / TestFlight)

iOS **no se puede compilar en Linux**: se usa **EAS Build (nube de Expo)**.
No hace falta Mac. Workflow: **Actions → "Build Bubui (iOS → TestFlight)"**.

El workflow tiene dos modos (input `target`):
- `testflight` → build firmado + (opcional) subida a TestFlight.
- `simulator` → build para simulador (solo `EXPO_TOKEN`), para sacar capturas
  con [Appetize.io](https://appetize.io) en el navegador.

### Secretos de GitHub necesarios
(*Settings → Secrets and variables → Actions*)

| Secreto | De dónde sale |
|---|---|
| `EXPO_TOKEN` | expo.dev → avatar → Access Tokens → Create token |
| `ASC_API_KEY_P8` | Contenido del `.p8` de la App Store Connect API Key |
| `ASC_API_KEY_ID` | "Key ID" de esa API Key |
| `ASC_API_KEY_ISSUER_ID` | "Issuer ID" de App Store Connect |
| `APPLE_TEAM_ID` | Apple Developer → Membership → Team ID |
| `APPLE_TEAM_TYPE` *(opcional)* | `COMPANY_OR_ORGANIZATION` \| `INDIVIDUAL` \| `IN_HOUSE` |

> La **App Store Connect API Key** se crea en: App Store Connect → Users and
> Access → Integrations → App Store Connect API → Team Keys → (＋).
> ⚠️ **Rol = Admin** (no "App Manager"): hace falta Admin para que EAS pueda
> **crear** el certificado de distribución y el perfil de aprovisionamiento de
> forma no interactiva. Con "App Manager" falla con
> `Distribution Certificate is not validated for non-interactive builds`.

### Datos ya configurados en `apps/bubui-mobile/eas.json`
- `submit.production.ios.ascAppId` = `6776224976`
- `submit.production.ios.appleTeamId` = `9J97GC5NCG`

### Pendiente
- [ ] Recrear la **API Key con rol Admin** y actualizar `ASC_API_KEY_P8` +
      `ASC_API_KEY_ID` en los secretos.
- [ ] Lanzar workflow iOS en modo `testflight` (primero con `submit=false` para
      validar que compila; luego `submit=true`).
- [ ] Esperar ~30-60 min a que Apple procese el build en TestFlight.
- [ ] Añadir testers (TestFlight). Internos = inmediato; externos = mini-revisión
      de Apple.

### Para el lanzamiento PÚBLICO (no para TestFlight)
- [ ] Capturas de iPhone 6.5"/6.7" → build `simulator` + Appetize.io.
- [ ] Ficha App Store: descripción, palabras clave, etc. (textos preparados en
      el historial del chat).
- [ ] **Política de privacidad (URL)** — obligatoria.
- [ ] **App Privacy (etiquetas)**: declarar Ubicación (en uso) + Cámara.

---

## 3. Variables de entorno del backend (Railway)

| Variable | Valor | Para qué |
|---|---|---|
| `BUBUI_REQUIRE_CUSTOMER_TOKEN` | `true` | ⚠️ **Ver abajo.** Exige token de CLIENTE siempre (modo estricto). |
| `BUBUI_REQUIRE_BUSINESS_TOKEN` | `true` | ⚠️ **Ver abajo.** Exige token de NEGOCIO siempre (modo estricto). |
| `DATABASE_URL` | *(ya configurada)* | Postgres |
| Twilio (`TWILIO_*`) | *(ya configuradas)* | Verificación SMS/OTP |

### ⚠️ Paso de seguridad pendiente (importante)
Se añadió **autenticación por token real** a dos áreas que estaban abiertas:
- **Cliente**: antes cualquiera podía leer datos de otro usuario pasando su
  `customerId`. Ya envían token la **app móvil** (build 1015+) y la **PWA web**.
- **Negocio**: antes el token del panel solo comprobaba el prefijo `businessId`
  (falsificable, y el `businessId` va en el QR). Ahora valida un secreto real.

Ambas están en **modo "lazy"** para no romper nada durante la transición: los
clientes/negocios sin token aún pasan; los que entran con la versión nueva
quedan protegidos.

**Para cerrar los agujeros del todo (modo estricto):**
1. **Cliente** — cuando todos los testers tengan el **build 1015** y los
   usuarios de la PWA hayan recargado, pon en Railway:
   ```
   BUBUI_REQUIRE_CUSTOMER_TOKEN=true
   ```
2. **Negocio** — cuando los dueños hayan **vuelto a iniciar sesión** en el panel
   (eso renueva su token), pon:
   ```
   BUBUI_REQUIRE_BUSINESS_TOKEN=true
   ```
Son solo variables de entorno; no hay que tocar código. Si se activan antes de
tiempo, quien no haya renovado token recibirá 401 y tendrá que re-loguear.

- [ ] Activar `BUBUI_REQUIRE_CUSTOMER_TOKEN=true` tras actualizar testers + PWA.
- [ ] Activar `BUBUI_REQUIRE_BUSINESS_TOKEN=true` tras re-login de los negocios.

---

## 4. Cuenta de bug arreglado — ubicación de usuarios

La ubicación del usuario en el panel admin **se quedaba congelada** en la del
registro. Causa: solo se guardaba al pedir ofertas y el permiso solo se
consultaba (no se re-pedía). Arreglado: `Feed`/`Descubre` vuelven a pedir el
permiso si quedó "sin decidir", y la ubicación se refresca también desde
`Scan` y `Descubre` (no solo `Feed`). **Requiere build 1015** para llegar a los
testers.

---

## Resumen de "qué falta" (orden sugerido)

1. [ ] Play: quitar bundle 1013 → desaparecen los 3 errores.
2. [ ] Lanzar build Android **1015** y subirlo a la prueba cerrada.
3. [ ] iOS: API Key **Admin** + secretos → lanzar build `testflight`.
4. [ ] Cuando los testers tengan 1015 → `BUBUI_REQUIRE_CUSTOMER_TOKEN=true`.
5. [ ] (Lanzamiento público) capturas + ficha + política de privacidad.
