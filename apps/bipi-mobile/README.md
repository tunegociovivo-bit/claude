# Bipi mobile (Expo)

App nativa iOS + Android del cliente Bipi. Consume el backend del Hub
(`hub.negociovivo.app`) — todos los endpoints `/api/bipi/...` ya existen.

## Setup local

```bash
cd apps/bipi-mobile
npm install
npx expo prebuild        # genera /android y /ios (solo primera vez)
npx expo start           # abre Expo Dev Tools
```

Pulsa `i` (iOS simulator), `a` (Android emulator) o escanea el QR con la
app **Expo Go** desde tu móvil.

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

- `Splash` → loader inicial.
- `Onboarding` → email + nombre + permisos.
- `Feed` → cupones activos, escanear QR.
- `Scan` → cámara + introducir importe.

## Próximos hitos

- Push notifications (expo-notifications, registrado al onboarding).
- Geofencing background con expo-location.
- Tema oscuro / claro.
- Compartir cupón con amigo (deep link).
