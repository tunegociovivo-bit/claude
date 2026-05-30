# Bubui mobile (Expo)

App nativa iOS + Android del cliente **Bubui**. Identidad visual v2 (rosa ·
negro · blanco, wordmark con punto, tipografía Poppins). Consume el backend
del Hub (`hub.negociovivo.app`) — todos los endpoints `/api/bubui/...` ya
existen. Piloto en Benalmádena · Una app de Negocio Vivo.

## 📲 Verla en tu móvil HOY (la forma más rápida)

```bash
cd apps/bubui-mobile
npm install
npx expo start            # muestra un QR en la terminal
```

1. Instala **Expo Go** desde la App Store / Google Play.
2. Escanea el QR de la terminal:
   - **Android**: con la propia app Expo Go.
   - **iOS**: con la cámara del iPhone (abre Expo Go).
3. La app se abre en tu móvil al instante. Cada cambio recarga en caliente.

> Si el móvil no está en la misma WiFi que el ordenador, usa
> `npx expo start --tunnel` (instala `@expo/ngrok` si lo pide).

## 📦 Generar un APK instalable (sin Expo Go, sin cable)

Requiere una cuenta gratuita de Expo (https://expo.dev).

```bash
npm install -g eas-cli
eas login
eas init                  # vincula el proyecto (genera projectId)
eas build -p android --profile preview
```

Al terminar (en la nube, ~10-15 min) te da un **enlace de descarga**:
ábrelo en el móvil Android e instala el `.apk` directamente. El perfil
`preview` ya está configurado en `eas.json` para generar APK.

Para iOS necesitas cuenta Apple Developer (99 USD/año):
`eas build -p ios --profile preview`.

## Setup avanzado (build nativo local)

```bash
npx expo prebuild        # genera /android y /ios (solo primera vez)
npx expo run:android     # requiere Android Studio
npx expo run:ios         # requiere Xcode (solo Mac)
```

> `/android` y `/ios` están en `.gitignore` — son artefactos generados por
> `prebuild`. La fuente de verdad de la configuración nativa es `app.json`
> (nombre, `versionCode`, permisos, deep links, icono).

## Configuración del backend

El URL del backend está en `app.json` (`extra.apiBaseUrl`). Cambia a
`http://localhost:3000` para apuntar a tu dev local, o deja
`https://hub.negociovivo.app` para producción. El cliente HTTP vive en
`src/lib/api.ts`.

## Publicar en stores

1. Crea cuenta Apple Developer (99 USD/año) + Google Play Developer (25 USD una vez).
2. `npm install -g eas-cli` y `eas login`.
3. `eas build:configure` (primera vez).
4. `eas build -p android` → genera APK/AAB.
5. `eas build -p ios` → genera IPA (requiere cuenta Apple).
6. `eas submit -p android` y `eas submit -p ios` para subirlos.

> Sube el `versionCode` (en `app.json` → `android.versionCode`) en cada
> build que vaya a Play para que no rechace el artefacto por duplicado.

## Deep links / Universal Links

`app.json` incluye el intent filter Android para
`hub.negociovivo.app/bubui/scan/*` y el esquema `bubui://` — los QRs
impresos abren la app nativa si está instalada, o la web si no. El routing
de navegación está en `App.tsx` (`linking`).

Para iOS, configura los Universal Links en la cuenta Apple Developer
añadiendo `apple-app-site-association` en el dominio.

## Pantallas

- `Splash` → wordmark + loader inicial; espera a que carguen las fuentes
  Poppins para evitar el parpadeo (FOIT).
- `Onboarding` → slides de intro + alta de cliente por teléfono (OTP) con
  nombre/email, e inicio de sesión sin re-registro para quien ya tiene
  cuenta.
- `Feed` → ahorro acumulado, botón animado de **Escanear QR**, banner
  promocional (gestionado desde admin o el por defecto) y cupones activos
  como tarjetas con tag −X% y caducidad.
- `Descubre` → buscador + filtros por categoría, negocios cercanos con
  logo, badge "🏆 Top" y favoritos locales. _(pestaña condicionada: aparece
  al superar un mínimo de comercios)._
- `Negocio` → detalle del comercio (logo/marca, categoría, distancia,
  descuento, dirección). Acciones: **escanear aquí**, **cómo llegar**
  (abre la app de mapas), **compartir** (deep link) y **ficha completa**
  (web). Se abre al tocar una tarjeta en Feed o Descubre.
- `Mapa` → mapa de comercios embebido (WebView). _(pestaña condicionada)._
- `Scan` → cámara con marco rosa, linterna y cierre; introducir importe y
  resultado del descuento. Anti-doble-escaneo.
- `Afiliados` → programa "Amigos" / referidos (WebView con la sesión del
  cliente).
- `Cuenta` → perfil, ahorro y compras, accesos a "únete con tu negocio" y
  cierre de sesión.

Identidad visual y tokens en `src/lib/theme.ts`,
`src/components/Wordmark.tsx` y `src/lib/fonts.ts` (Poppins aplicado por
defecto a todos los `Text`). Navegación inferior en
`src/components/BottomNav.tsx`.

## Push notifications

Implementadas con `expo-notifications`: el token se registra contra el
backend tras el onboarding / al entrar al Feed (`src/lib/push.ts` →
`api.registerPushToken`). El admin del Hub envía a varios canales con
conteo por canal.

## Próximos hitos

- Geofencing en background con `expo-location` + `expo-task-manager`
  (avisar de cupones al pasar cerca). Requiere permisos `ACCESS_BACKGROUND_LOCATION`
  y revisión de políticas de Play Store.
- Tema oscuro / claro (refactor transversal de `theme.ts` + las pantallas).
- Foto/portada del negocio además del logo (cuando el backend la exponga).
