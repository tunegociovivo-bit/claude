const { withAndroidManifest, withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const dataRules = `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules><cloud-backup><exclude domain="sharedpref"/><exclude domain="database"/><exclude domain="file"/><exclude domain="external"/></cloud-backup><device-transfer><exclude domain="sharedpref"/><exclude domain="database"/><exclude domain="file"/><exclude domain="external"/></device-transfer></data-extraction-rules>`;
const fullRules = `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content><exclude domain="sharedpref"/><exclude domain="database"/><exclude domain="file"/><exclude domain="external"/></full-backup-content>`;

module.exports = function withDisableAndroidBackup(config) {
  config = withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (app?.$) {
      app.$["android:allowBackup"] = "false";
      app.$["android:dataExtractionRules"] = "@xml/nv_data_extraction_rules";
      app.$["android:fullBackupContent"] = "@xml/nv_backup_rules";
    }
    return cfg;
  });
  return withDangerousMod(config, ["android", (cfg) => {
    const dir = path.join(cfg.modRequest.platformProjectRoot, "app", "src", "main", "res", "xml");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "nv_data_extraction_rules.xml"), dataRules, "utf8");
    fs.writeFileSync(path.join(dir, "nv_backup_rules.xml"), fullRules, "utf8");
    return cfg;
  }]);
};
