const { withAndroidManifest, withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * DESACTIVA Android Auto Backup / transferencia dispositivo-a-dispositivo (D2D).
 *
 * Motivo (incidencia del reto): Auto Backup restaura SharedPreferences y el
 * almacén de AsyncStorage tras REINSTALAR. Eso devolvía la sesión anterior (la
 * app entraba en Feed en vez de Onboarding) y el flag del Install Referrer
 * (saltándose la lectura del referrer NUEVO → el reto se perdía). Una
 * instalación limpia DEBE ser limpia.
 *
 * `android:allowBackup=false` (también en app.json) cubre backup en la nube y D2D
 * en Android ≤11 y el backup en la nube en 12+. Para Android 12+ añadimos además
 * `dataExtractionRules` excluyendo todo del backup en la nube Y de la
 * transferencia D2D, por si el fabricante prioriza esas reglas.
 */
const RULES_RES = "nv_data_extraction_rules";
const FULL_RES = "nv_backup_rules";

const DATA_EXTRACTION_RULES = `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup>
    <exclude domain="sharedpref" />
    <exclude domain="database" />
    <exclude domain="file" />
    <exclude domain="external" />
  </cloud-backup>
  <device-transfer>
    <exclude domain="sharedpref" />
    <exclude domain="database" />
    <exclude domain="file" />
    <exclude domain="external" />
  </device-transfer>
</data-extraction-rules>
`;

const FULL_BACKUP_CONTENT = `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
  <exclude domain="sharedpref" />
  <exclude domain="database" />
  <exclude domain="file" />
  <exclude domain="external" />
</full-backup-content>
`;

module.exports = function withDisableAndroidBackup(config) {
  // 1) Atributos en el <application> del AndroidManifest.
  config = withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (app && app.$) {
      app.$["android:allowBackup"] = "false";
      app.$["android:dataExtractionRules"] = `@xml/${RULES_RES}`;
      app.$["android:fullBackupContent"] = `@xml/${FULL_RES}`;
    }
    return cfg;
  });

  // 2) Recursos XML referenciados.
  config = withDangerousMod(config, [
    "android",
    (cfg) => {
      const xmlDir = path.join(cfg.modRequest.platformProjectRoot, "app", "src", "main", "res", "xml");
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.writeFileSync(path.join(xmlDir, `${RULES_RES}.xml`), DATA_EXTRACTION_RULES, "utf8");
      fs.writeFileSync(path.join(xmlDir, `${FULL_RES}.xml`), FULL_BACKUP_CONTENT, "utf8");
      return cfg;
    }
  ]);

  return config;
};
