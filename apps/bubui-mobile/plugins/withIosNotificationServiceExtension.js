/**
 * Config plugin: Notification Service Extension (NSE) de iOS para mostrar
 * imágenes grandes en los push.
 *
 * En iOS, un push remoto solo enseña la imagen si la app incluye una
 * Notification Service Extension que descargue el adjunto y lo añada antes de
 * que el sistema pinte la notificación. Este plugin crea ese target nativo
 * durante `expo prebuild` (lo aplica EAS en cada build), sin tocar nada a mano.
 *
 * Requisitos del REMITENTE (backend) para que la extensión se ejecute:
 *   - El payload APNs debe llevar `aps.mutable-content = 1` (en Expo Push:
 *     `mutableContent: true`; en FCM v1: `apns.payload.aps.mutable-content`).
 *   - La URL de la imagen debe viajar en una de las claves que lee
 *     NotificationService.swift: `fcm_options.image`, `image`, o dentro del
 *     JSON de `body` como `{ "image": "https://…" }`.
 *
 * Para imágenes grandes NO hace falta App Group ni entitlements: la extensión
 * solo descarga y adjunta. EAS genera las credenciales del nuevo bundle id
 * (`<appId>.BubuiNotificationService`) automáticamente en el primer build.
 *
 * La secuencia de manipulación del .pbxproj sigue el patrón probado de los
 * plugins de extensión de la comunidad (addTarget 'app_extension' ya embebe la
 * extensión en la app).
 */
const { withXcodeProject, withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const TARGET_NAME = "BubuiNotificationService";
const SWIFT_FILE = "NotificationService.swift";
const PLIST_FILE = `${TARGET_NAME}-Info.plist`;
const DEPLOYMENT_TARGET = "13.4";
// Apple Team ID de Negocio Vivo (coincide con eas.json submit.production).
const DEVELOPMENT_TEAM = "9J97GC5NCG";

const SWIFT_SOURCE = `import UserNotifications

/// Descarga la imagen del push y la adjunta a la notificación para que iOS
/// muestre la versión "rich" (imagen grande). Generado por el config plugin
/// withIosNotificationServiceExtension.
class NotificationService: UNNotificationServiceExtension {
  var contentHandler: ((UNNotificationContent) -> Void)?
  var bestAttempt: UNMutableNotificationContent?

  override func didReceive(_ request: UNNotificationRequest,
                           withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
    self.contentHandler = contentHandler
    bestAttempt = request.content.mutableCopy() as? UNMutableNotificationContent
    guard let bestAttempt = bestAttempt else { contentHandler(request.content); return }

    guard let urlString = NotificationService.imageURL(from: request.content.userInfo),
          let url = URL(string: urlString) else {
      contentHandler(bestAttempt); return
    }

    let task = URLSession.shared.downloadTask(with: url) { (tempURL, response, error) in
      defer { contentHandler(bestAttempt) }
      guard let tempURL = tempURL, error == nil else { return }
      // iOS necesita una extensión de archivo válida para reconocer el tipo.
      let ext = NotificationService.fileExtension(for: response, url: url)
      let dest = tempURL.deletingPathExtension().appendingPathExtension(ext)
      try? FileManager.default.moveItem(at: tempURL, to: dest)
      if let attachment = try? UNNotificationAttachment(identifier: "image", url: dest, options: nil) {
        bestAttempt.attachments = [attachment]
      }
    }
    task.resume()
  }

  override func serviceExtensionTimeWillExpire() {
    if let contentHandler = contentHandler, let bestAttempt = bestAttempt {
      contentHandler(bestAttempt)
    }
  }

  /// Busca la URL de la imagen en las claves habituales: FCM (\`fcm_options.image\`),
  /// top-level \`image\`, y nuestro formato propio (JSON dentro de \`body\`).
  static func imageURL(from userInfo: [AnyHashable: Any]) -> String? {
    if let fcm = userInfo["fcm_options"] as? [AnyHashable: Any],
       let img = fcm["image"] as? String, !img.isEmpty { return img }
    if let img = userInfo["image"] as? String, !img.isEmpty { return img }
    if let body = userInfo["body"] as? [String: Any],
       let img = body["image"] as? String, !img.isEmpty { return img }
    if let bodyStr = userInfo["body"] as? String,
       let data = bodyStr.data(using: .utf8),
       let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
       let img = obj["image"] as? String, !img.isEmpty { return img }
    return nil
  }

  static func fileExtension(for response: URLResponse?, url: URL) -> String {
    let pathExt = url.pathExtension
    if !pathExt.isEmpty { return pathExt }
    switch response?.mimeType {
    case "image/png": return "png"
    case "image/gif": return "gif"
    default: return "jpg"
    }
  }
}
`;

function plistSource() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>$(PRODUCT_NAME)</string>
  <key>CFBundleDisplayName</key>
  <string>Bubui</string>
  <key>CFBundleIdentifier</key>
  <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundlePackageType</key>
  <string>XPC!</string>
  <key>CFBundleShortVersionString</key>
  <string>$(MARKETING_VERSION)</string>
  <key>CFBundleVersion</key>
  <string>$(CURRENT_PROJECT_VERSION)</string>
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionPointIdentifier</key>
    <string>com.apple.usernotifications.service</string>
    <key>NSExtensionPrincipalClass</key>
    <string>$(PRODUCT_MODULE_NAME).NotificationService</string>
  </dict>
</dict>
</plist>
`;
}

/** Escribe los ficheros nativos de la extensión en ios/<TARGET>/. */
const withNSEFiles = (config) =>
  withDangerousMod(config, [
    "ios",
    async (config) => {
      const iosRoot = config.modRequest.platformProjectRoot;
      const targetDir = path.join(iosRoot, TARGET_NAME);
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(path.join(targetDir, SWIFT_FILE), SWIFT_SOURCE);
      fs.writeFileSync(path.join(targetDir, PLIST_FILE), plistSource());
      return config;
    }
  ]);

/** Crea el target de la extensión en el proyecto Xcode. */
const withNSETarget = (config) =>
  withXcodeProject(config, (config) => {
    const proj = config.modResults;
    const appBundleId = config.ios && config.ios.bundleIdentifier;
    const nseBundleId = `${appBundleId}.${TARGET_NAME}`;

    // Idempotencia: si ya existe (re-prebuild), no lo dupliques.
    if (proj.pbxTargetByName(TARGET_NAME)) {
      return config;
    }

    // Grupo con los ficheros de la extensión, colgado del grupo raíz.
    const group = proj.addPbxGroup([SWIFT_FILE, PLIST_FILE], TARGET_NAME, TARGET_NAME);
    const groups = proj.hash.project.objects["PBXGroup"];
    Object.keys(groups).forEach((key) => {
      if (
        typeof groups[key] === "object" &&
        groups[key].name === undefined &&
        groups[key].path === undefined
      ) {
        proj.addToPbxGroup(group.uuid, key);
      }
    });

    // node-xcode da error si estas colecciones no existen (proyecto con 1 target).
    const projObjects = proj.hash.project.objects;
    projObjects["PBXTargetDependency"] = projObjects["PBXTargetDependency"] || {};
    projObjects["PBXContainerItemProxy"] = projObjects["PBXContainerItemProxy"] || {};

    // addTarget('app_extension') crea el target y lo embebe en la app.
    const nseTarget = proj.addTarget(TARGET_NAME, "app_extension", TARGET_NAME, nseBundleId);

    proj.addBuildPhase([SWIFT_FILE], "PBXSourcesBuildPhase", "Sources", nseTarget.uuid);
    proj.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", nseTarget.uuid);
    proj.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", nseTarget.uuid);

    // Ajustes de compilación del target. La versión/build deben coincidir con
    // las de la app o App Store Connect rechaza la subida.
    const marketingVersion = config.version || "1.0.0";
    const projectVersion = (config.ios && config.ios.buildNumber) || "1";
    const configs = proj.pbxXCBuildConfigurationSection();
    for (const key in configs) {
      const bs = configs[key].buildSettings;
      if (bs && bs.PRODUCT_NAME === `"${TARGET_NAME}"`) {
        bs.IPHONEOS_DEPLOYMENT_TARGET = DEPLOYMENT_TARGET;
        bs.TARGETED_DEVICE_FAMILY = `"1,2"`;
        bs.SWIFT_VERSION = "5.0";
        bs.INFOPLIST_FILE = `${TARGET_NAME}/${PLIST_FILE}`;
        bs.CODE_SIGN_STYLE = "Automatic";
        bs.DEVELOPMENT_TEAM = DEVELOPMENT_TEAM;
        bs.MARKETING_VERSION = marketingVersion;
        bs.CURRENT_PROJECT_VERSION = projectVersion;
      }
    }
    proj.addTargetAttribute("DevelopmentTeam", DEVELOPMENT_TEAM, nseTarget);

    return config;
  });

module.exports = function withIosNotificationServiceExtension(config) {
  config = withNSEFiles(config);
  config = withNSETarget(config);
  return config;
};
