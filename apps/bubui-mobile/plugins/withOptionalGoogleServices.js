const fs = require("fs");
const path = require("path");

/**
 * Activa Firebase / FCM (push en Android) SOLO si existe un google-services.json.
 *
 * Por qué así:
 *   - expo-notifications necesita google-services.json para que Android
 *     resuelva el Expo Push Token a un dispositivo real (sin él,
 *     getExpoPushTokenAsync falla y NO llegan los push).
 *   - Pero si declaramos `android.googleServicesFile` de forma fija en
 *     app.json, el `expo prebuild` FALLA cuando el archivo no está (p.ej.
 *     en local o en un build sin el secret configurado).
 *
 * Este plugin lo hace condicional: si encuentra el archivo, lo registra en
 * la config (Expo aplica entonces el plugin de Gradle de Google Services);
 * si no, deja el push de Android desactivado y el build sigue funcionando.
 *
 * El workflow de CI escribe `google-services.json` desde el secret
 * BUBUI_GOOGLE_SERVICES_JSON antes del prebuild. En local, basta con
 * colocar el archivo en apps/bubui-mobile/google-services.json.
 */
module.exports = function withOptionalGoogleServices(config) {
  const candidate =
    process.env.BUBUI_GOOGLE_SERVICES_FILE ||
    path.join(__dirname, "..", "google-services.json");

  if (fs.existsSync(candidate)) {
    config.android = config.android || {};
    config.android.googleServicesFile = candidate;
    // eslint-disable-next-line no-console
    console.log(
      "[withOptionalGoogleServices] google-services.json encontrado → push Android ACTIVADO:",
      candidate
    );
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      "[withOptionalGoogleServices] Sin google-services.json → push Android DESACTIVADO en este build. " +
        "Configura el secret BUBUI_GOOGLE_SERVICES_JSON para activarlo."
    );
  }

  return config;
};
