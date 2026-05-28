# Bipi mobile (Expo)

App nativa iOS + Android del cliente Bipi. Diseño v2 (rosa · negro ·
blanco, wordmark con punto). Consume el backend del Hub
(`hub.negociovivo.app`) — todos los endpoints `/api/bipi/...` ya existen.

## 📲 Verla en tu móvil HOY (la forma más rápida)

```bash
cd apps/bipi-mobile
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
ábrelo en el móvil Android y instala el `.apk` directamente. El perfil
`preview` ya está configurado en `eas.json` para generar APK.

Para iOS necesitas cuenta Apple Developer (99 USD/año):
`eas build -p ios --profile preview`.

## Setup avanzado (build nativo local)

```bash
npx expo prebuild        # genera /android y /ios (solo primera vez)
npx expo run:android     # requiere Android Studio
npx expo run:ios         # requiere Xcode (solo Mac)
```

## Configuración del backend

El URL del backend está en `app.json` (`extra.apiBaseUrl`). Cambia a
`http://localhost:3000` para apuntar a tu dev local, o deja
`https://hub.negociovivo.app` para producción.

## Publicar en stores

1. Crea cuenta Apple Developer (99 USD/año) + Google Play Developer (25 USD una vez).
2. `npm install -g eas-cli` y `eas login`.
3. `eas build:configure` (primera vez).
4. `eas build -p android` → genera APK/AAB.
5. `eas build -p ios` → genera IPA (requiere cuenta Apple).
6. `eas submit -p android` y `eas submit -p ios` para subirlos.

## Universal Links

`app.json` ya incluye el intent filter Android para
`hub.negociovivo.app/bipi/scan/*` — los QRs impresos abren la app nativa
si está instalada, o la web si no.

Para iOS, configura los Universal Links en la cuenta Apple Developer
añadiendo `apple-app-site-association` en el dominio.

## Pantallas

- `Splash` → wordmark + loader inicial.
- `Onboarding` → 3 slides intro (descuentos / sin trucos / apoya local) + alta email/nombre + permisos.
- `Feed` → cupones activos como photo-cards con tag -X%, ahorro acumulado, escanear QR.
- `Scan` → cámara con marco rosa + introducir importe + resultado.

Identidad visual en `src/lib/theme.ts` y `src/components/Wordmark.tsx`.

## Próximos hitos

- Push notifications (expo-notifications, registrado al onboarding).
- Geofencing background con expo-location.
- Tema oscuro / claro.
- Compartir cupón con amigo (deep link).
