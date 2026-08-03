const fs = require("fs");
const path = require("path");
const { withDangerousMod } = require("expo/config-plugins");

/**
 * Fix de compilación iOS con Xcode 26: la librería nativa `fmt` 11.0.2 (la
 * arrastra React Native vía RCT-Folly) falla con el Clang de Xcode 26 con
 * errores tipo "call to consteval function 'fmt::basic_format_string<...>'
 * is not a constant expression".
 *
 * POR QUÉ NO BASTA CON -DFMT_USE_CONSTEVAL=0 (el intento anterior): en fmt
 * 11.0.2 el bloque de detección de base.h define FMT_USE_CONSTEVAL
 * INCONDICIONALMENTE (no hay `#ifdef FMT_USE_CONSTEVAL` de guarda), así que
 * el `#define` del header pisa cualquier valor pasado por línea de comandos
 * y FMT_CONSTEVAL acaba siendo `consteval` igualmente.
 *
 * Solución definitiva: en el post_install del Podfile (tras descargarse los
 * pods) se PARCHEA el header de fmt para que FMT_CONSTEVAL quede vacío:
 *   `#  define FMT_CONSTEVAL consteval`  →  `#  define FMT_CONSTEVAL`
 * Los chequeos de formato pasan de compile-time a runtime (config soportada
 * por fmt, sin cambio funcional) y compila con cualquier Xcode.
 */
const MARKER = "withFmtConstevalFix";

const SNIPPET = `
    # Fix fmt/consteval con Xcode 26 (inyectado por withFmtConstevalFix):
    # fmt 11.0.2 define FMT_USE_CONSTEVAL incondicionalmente en base.h (no
    # respeta -DFMT_USE_CONSTEVAL=0), asi que se parchea el header descargado
    # para dejar FMT_CONSTEVAL vacio (chequeos de formato en runtime).
    Dir[File.join(installer.sandbox.root.to_s, 'fmt', 'include', 'fmt', '*.h')].each do |header|
      original = File.read(header)
      patched = original.gsub('#  define FMT_CONSTEVAL consteval', '#  define FMT_CONSTEVAL')
      if patched != original
        File.write(header, patched)
        Pod::UI.puts "[withFmtConstevalFix] consteval desactivado en \#{File.basename(header)}"
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
        // Insertamos justo al abrir el post_install existente del template
        // (en ese punto los pods ya están descargados en el sandbox).
        const anchor = /post_install do \|installer\|\n/;
        if (!anchor.test(contents)) {
          throw new Error(
            "[withFmtConstevalFix] No se encontró el bloque post_install en el Podfile — revisa el template."
          );
        }
        contents = contents.replace(anchor, (m) => m + SNIPPET);
        fs.writeFileSync(podfile, contents);
        // eslint-disable-next-line no-console
        console.log("[withFmtConstevalFix] Parche de fmt/consteval inyectado en el Podfile.");
      }
      return cfg;
    },
  ]);
};
