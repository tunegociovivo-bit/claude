const { withAndroidManifest } = require("@expo/config-plugins");

module.exports = function withWhatsAppQueries(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    const queries = manifest.queries || [];
    const entry = queries[0] || {};
    const packages = new Set((entry.package || []).map((p) => p.$?.["android:name"]));
    packages.add("com.whatsapp");
    packages.add("com.whatsapp.w4b");
    entry.package = [...packages].filter(Boolean).map((name) => ({ $: { "android:name": name } }));
    manifest.queries = [entry, ...queries.slice(1)];
    return mod;
  });
};
