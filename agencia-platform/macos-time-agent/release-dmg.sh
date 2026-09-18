#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
: "${SIGNING_IDENTITY:?Se requiere Developer ID Application}"
: "${NOTARY_PROFILE:?Se requiere el perfil de notarización}"
[[ "$SIGNING_IDENTITY" == "Developer ID Application:"* ]] || { echo "Identidad no válida"; exit 1; }
bash build-mac.sh
APP="dist/Negocio Vivo Control Horario.app"
xcrun notarytool submit dist/Negocio.Vivo.Control.Horario.Mac.preview.zip --keychain-profile "$NOTARY_PROFILE" --wait
xcrun stapler staple "$APP"
spctl --assess --type execute --verbose "$APP"
STAGING="$(mktemp -d "$PWD/dist/dmg-content.XXXXXX")"
ditto "$APP" "$STAGING/Negocio Vivo Control Horario.app"
ln -s /Applications "$STAGING/Applications"
cp INSTALAR-MAC.txt "$STAGING/LEEME - Instalacion.txt"
DMG="dist/Negocio.Vivo.Control.Horario.Mac.1.0.0.dmg"
hdiutil create -volname "Negocio Vivo Control Horario" -srcfolder "$STAGING" -ov -format UDZO "$DMG"
codesign --force --sign "$SIGNING_IDENTITY" --timestamp "$DMG"
xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait
xcrun stapler staple "$DMG"
spctl --assess --type open --context context:primary-signature --verbose "$DMG"
shasum -a 256 "$DMG"
echo "DMG y aplicación firmados, notarizados y aprobados por Gatekeeper. No se han publicado."
