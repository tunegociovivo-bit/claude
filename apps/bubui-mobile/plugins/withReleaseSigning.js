// Config plugin de Expo: inyecta la configuración de firma RELEASE en el
// android/app/build.gradle generado durante `expo prebuild`.
//
// Por qué hace falta: el workflow corre `expo prebuild --clean`, que BORRA y
// regenera la carpeta android/ (incluido build.gradle). La plantilla por
// defecto de Expo firma el buildType `release` con la clave de DEBUG, lo que
// produce APK/AAB con una firma inestable y distinta a la clave de subida.
//
// Este plugin se ejecuta DURANTE el prebuild (después de generar build.gradle),
// así que la firma correcta siempre queda aplicada, sobreviva o no al --clean.
// Lee el keystore vía variables de entorno (BUBUI_STORE_FILE/PASS, alias, etc.)
// que el workflow define a partir de los GitHub Secrets.

const { withAppBuildGradle } = require('@expo/config-plugins');

const RELEASE_SIGNING_BLOCK = `        release {
            storeFile file(System.getenv("BUBUI_STORE_FILE") ?: 'release.keystore')
            storePassword System.getenv("BUBUI_STORE_PASS") ?: ''
            keyAlias System.getenv("BUBUI_KEY_ALIAS") ?: 'bubui-release'
            keyPassword System.getenv("BUBUI_KEY_PASS") ?: ''
        }`;

function applyReleaseSigning(gradle) {
  // 1) Asegurar que existe un signingConfig `release` con nuestras env vars.
  //    Se inserta justo después de la apertura de `signingConfigs {`.
  if (!gradle.includes('BUBUI_STORE_FILE')) {
    gradle = gradle.replace(
      /signingConfigs\s*\{/,
      (match) => `${match}\n${RELEASE_SIGNING_BLOCK}\n`
    );
  }

  // 2) Hacer que el buildType `release` use signingConfigs.release (la plantilla
  //    de Expo lo deja apuntando a signingConfigs.debug). Solo se reemplaza la
  //    primera aparición dentro del bloque release.
  gradle = gradle.replace(
    /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?signingConfig\s+)signingConfigs\.debug/,
    '$1signingConfigs.release'
  );

  return gradle;
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== 'groovy') {
      throw new Error(
        'withReleaseSigning: solo soporta build.gradle en Groovy (no kts).'
      );
    }
    config.modResults.contents = applyReleaseSigning(config.modResults.contents);
    return config;
  });
};

// Exportado para poder probar la transformación de forma aislada.
module.exports.applyReleaseSigning = applyReleaseSigning;
