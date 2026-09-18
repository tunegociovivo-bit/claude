#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
[[ "$(uname -s)" == "Darwin" ]] || { echo "Este paquete se compila en macOS con Xcode."; exit 1; }
swift test
swift build -c release --arch arm64 --arch x86_64
BIN_DIR="$(swift build -c release --arch arm64 --arch x86_64 --show-bin-path)"
APP="dist/Negocio Vivo Control Horario.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" dist/AppIcon.iconset
cp "$BIN_DIR/NegocioVivoTimeAgent" "$APP/Contents/MacOS/NegocioVivoTimeAgent"
cp Info.plist "$APP/Contents/Info.plist"
for size in 16 32 128 256 512; do
    sips -z "$size" "$size" assets/logo.png --out "dist/AppIcon.iconset/icon_${size}x${size}.png" >/dev/null
    double=$((size * 2))
    sips -z "$double" "$double" assets/logo.png --out "dist/AppIcon.iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns dist/AppIcon.iconset -o "$APP/Contents/Resources/AppIcon.icns"
# Local ad-hoc signature is only for testing. Distribution requires Developer ID and notarization.
codesign --force --options runtime --sign "${SIGNING_IDENTITY:--}" "$APP"
codesign --verify --deep --strict "$APP"
lipo -info "$APP/Contents/MacOS/NegocioVivoTimeAgent"
ditto -c -k --keepParent "$APP" dist/Negocio.Vivo.Control.Horario.Mac.preview.zip
echo "Compilación de prueba creada. NO está publicada ni notarizada."
