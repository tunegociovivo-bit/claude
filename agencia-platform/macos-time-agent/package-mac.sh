#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
OUTPUT="${1:?Indica la ruta del paquete de salida}"
STAGING="$(mktemp -d "$PWD/dist/package-root.XXXXXX")"
mkdir -p "$STAGING/Applications"
ditto "dist/Negocio Vivo Control Horario.app" "$STAGING/Applications/Negocio Vivo Control Horario.app"
COMPONENTS="$STAGING.plist"
pkgbuild --analyze --root "$STAGING" "$COMPONENTS"
# Always install in /Applications, even when another copy exists in Downloads or the build folder.
/usr/libexec/PlistBuddy -c 'Set :0:BundleIsRelocatable false' "$COMPONENTS"
ARGS=(--root "$STAGING" --component-plist "$COMPONENTS" --identifier app.negociovivo.time-agent.mac --version 1.0.3 --install-location /)
if [[ -n "${INSTALLER_IDENTITY:-}" ]]; then ARGS+=(--sign "$INSTALLER_IDENTITY"); fi
pkgbuild "${ARGS[@]}" "$OUTPUT"
