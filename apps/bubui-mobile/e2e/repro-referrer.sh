#!/usr/bin/env bash
# Reproducción REAL (no mocks) del flujo WhatsApp→Play→app en un emulador/dispositivo:
# instala el APK y SIMULA el Play Install Referrer con el mismo broadcast que
# usa Google Play (com.android.vending.INSTALL_REFERRER), luego lanza la app.
#
# Requisitos: Android SDK (adb) + un emulador/dispositivo con el APK a mano.
#
# Uso:
#   e2e/repro-referrer.sh <ruta-al-apk> <token>
#   # ej: e2e/repro-referrer.sh build/bubui.apk aaac414dd4505807
#
# Qué verifica (manual/visual, con ayuda de las trazas del HUB):
#   1) Instalación limpia.
#   2) El referrer entregado es reto_<token> (broadcast INSTALL_REFERRER).
#   3) Al abrir, la app debe ir al REGISTRO con el banner del reto (no invitado)
#      y los iconos del menú deben verse.
#   4) En el HUB, GET /api/bubui/deal-trace?token=<token> debe mostrar
#      app_capture_install_referrer → app_onboarding_shown → (tras alta) app_claim_ok.
#      Y el bucket 0000000000000000 debe mostrar app_started y app_iconfont_ok/fail.
set -euo pipefail

APK="${1:?ruta al APK}"
TOKEN="${2:?token del reto (hex)}"
PKG="com.negociovivo.bubui"
REFERRER="reto_${TOKEN}"

echo "== 1) Desinstalar (instalación limpia) =="
adb uninstall "$PKG" || true

echo "== 2) Instalar APK =="
adb install -r "$APK"

echo "== 3) Simular el Play Install Referrer (broadcast oficial) =="
# Google Play envía este broadcast a la app recién instalada con el referrer.
adb shell am broadcast -a com.android.vending.INSTALL_REFERRER \
  -n "${PKG}/com.uerceg.play_install_referrer.PlayInstallReferrerReceiver" \
  --es "referrer" "$REFERRER" || \
adb shell am broadcast -a com.android.vending.INSTALL_REFERRER \
  "$PKG" --es "referrer" "$REFERRER" || true
echo "   referrer entregado: $REFERRER"

echo "== 4) Lanzar la app =="
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null

echo "== 5) (Alternativa) probar el DEEP LINK con la app ya instalada =="
echo "   adb shell am start -a android.intent.action.VIEW -d \"https://bubui.app/reto/${TOKEN}\" ${PKG}"

cat <<NOTE

Verificación:
 - Pantalla: debe abrir el REGISTRO con el banner "…te propone un reto" y SIN
   "Explorar sin cuenta". Los iconos inferiores deben verse.
 - Trazas (admin del HUB):
     GET https://bubui.app/api/bubui/deal-trace?token=${TOKEN}
     GET https://bubui.app/api/bubui/deal-trace?token=0000000000000000   # ciclo de vida
   Debe verse app_started + app_iconfont_ok|fail y, para el token,
   app_capture_install_referrer → app_onboarding_shown → app_claim_ok.
 - Captura de pantalla:  adb exec-out screencap -p > reto.png
NOTE
