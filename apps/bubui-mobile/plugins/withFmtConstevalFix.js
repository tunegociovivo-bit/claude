const fs = require("fs");
const path = require("path");
const { withDangerousMod } = require("expo/config-plugins");

/**
 * Fix de compilación iOS: la librería nativa `fmt` (la arrastra React
 * Native vía RCT-Folly) falla con Clang/Xcode recientes con errores tipo
 * "call to consteval function 'fmt::basic_format_string<...>' is not a
 * constant expression".
 *
 * Definir FMT_USE_CONSTEVAL=0 desactiva los caminos `consteval` de fmt
 * (los chequeos de formato pasan a runtime, sin cambio funcional) y hace
 * que compile con cualquier versión de Xcode. Lo inyectamos en el
 * post_install del Podfile para que aplique a TODOS los pods que
 * compilan cabeceras de fmt (fmt, RCT-Folly, ReactCommon…).
 */
const MARKER = "FMT_USE_CONSTEVAL=0";

const SNIPPET = `
    # Fix fmt/consteval con Xcode recientes (inyectado por withFmtConstevalFix)
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        defs = config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] || ['$(inherited)']
        defs = [defs] if defs.is_a?(String)
        defs << '${MARKER}' unless defs.include?('${MARKER}')
        config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] = defs
      end
    end
`;

module.exports = function withFmtConstevalFix(config) {
  return withDangerousMod(config, [
    "ios",
    (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, "Podfile");
      let contents = fs.readFileSync(podfile, "utf8");
      if (!contents.includes(MARKER)) {
        // Insertamos justo al abrir el post_install existente del template.
        const anchor = /post_install do \|installer\|\n/;
        if (!anchor.test(contents)) {
          throw new Error(
            "[withFmtConstevalFix] No se encontró el bloque post_install en el Podfile — revisa el template."
          );
        }
        contents = contents.replace(anchor, (m) => m + SNIPPET);
        fs.writeFileSync(podfile, contents);
        // eslint-disable-next-line no-console
        console.log("[withFmtConstevalFix] FMT_USE_CONSTEVAL=0 inyectado en el Podfile.");
      }
      return cfg;
    },
  ]);
};
