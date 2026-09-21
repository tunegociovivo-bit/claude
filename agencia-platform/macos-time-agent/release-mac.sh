#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
: "${SIGNING_IDENTITY:?Se requiere el certificado Developer ID Application de Negocio Vivo}"
: "${INSTALLER_IDENTITY:?Se requiere el certificado Developer ID Installer de Negocio Vivo}"
: "${NOTARY_PROFILE:?Se requiere un perfil de notarización guardado en el Llavero}"
[[ "$SIGNING_IDENTITY" == "Developer ID Application:"* ]] || { echo "Identidad de aplicación no válida"; exit 1; }
[[ "$INSTALLER_IDENTITY" == "Developer ID Installer:"* ]] || { echo "Identidad de instalador no válida"; exit 1; }
bash build-mac.sh
APP="dist/Negocio Vivo Control Horario.app"
xcrun notarytool submit dist/Negocio.Vivo.Control.Horario.Mac.preview.zip --keychain-profile "$NOTARY_PROFILE" --wait
xcrun stapler staple "$APP"
spctl --assess --type execute --verbose "$APP"
PACKAGE="dist/Negocio.Vivo.Control.Horario.Mac.1.0.4.pkg"
bash package-mac.sh "$PACKAGE"
xcrun notarytool submit "$PACKAGE" --keychain-profile "$NOTARY_PROFILE" --wait
xcrun stapler staple "$PACKAGE"
spctl --assess --type install --verbose "$PACKAGE"
shasum -a 256 "$PACKAGE"
echo "Paquete firmado y notarizado listo. Este script no lo publica."
