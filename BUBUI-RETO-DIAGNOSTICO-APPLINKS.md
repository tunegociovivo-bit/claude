# Diagnóstico: reto no aparece tras instalar desde Play (Bubui 1043) + App Links

## Causa principal: Android Auto Backup restaura AsyncStorage al reinstalar
**Estado epistémico:** causa **demostrada EN CÓDIGO** y **fuertemente consistente
con lo observado en producción** (explica los dos síntomas a la vez). **NO** está
**confirmada como E2E de producción** hasta ejecutar la instalación real desde Play
con un binario que lleve estos cambios y ver las trazas/`dumpsys`.

- `apps/bubui-mobile` no desactivaba Android Auto Backup. Al reinstalar, Android
  **restaura el almacén de AsyncStorage** antes del primer arranque, devolviendo:
  1. La **sesión anterior** → `CheckSession()` la encuentra → `initial = "Feed"` →
     la app abre Feed en vez de Onboarding (parece invitado).
  2. El flag `bubui.installReferrerDealChecked=1` → `captureInstallReferrer` salía
     antes de leer el referrer **nuevo** → el reto se perdía.
- Por qué los parches previos no bastaban: corrían DESPUÉS del cortocircuito por el
  flag restaurado y de la decisión de ruta por la sesión restaurada.
- Correcciones (código, testeadas): eliminar el flag persistente en deal-pending
  **y** referral-pending (se relee el referrer cada arranque); `allowBackup=false`
  + `dataExtractionRules` (verificado en el AndroidManifest generado); bootstrap
  que espera el resultado terminal del referrer y prioriza el reto sobre una
  sesión restaurada.
- Confirmación pendiente (cuando haya APK con estos cambios):
  `adb shell dumpsys package com.negociovivo.bubui | grep -i allowBackup` → `false`;
  y reinstalar con `am broadcast … INSTALL_REFERRER --es referrer reto_<token>` →
  el reto aparece; trazas `app_capture_install_referrer` + `app_onboarding_shown`.

---

## (Secundario) App Links: DOS problemas distintos que se mezclaban

- **P1 (la incidencia):** instalación DIFERIDA (enlace WhatsApp → Play → instala → abre).
  Este flujo **NO usa App Links** (no hay app cuando se pulsa el enlace): depende
  **por completo del Play Install Referrer**. Si el referrer no entrega
  `reto_<token>`, la app no conoce el reto y entra como invitado.
- **P2 (el aviso de Play):** *"tus dominios web no están asociados a tu aplicación"*.
  Es **Android App Links** sin verificar. **Causa PROBADA:**
  `https://bubui.app/.well-known/assetlinks.json` devuelve **404 "Not configured"**
  (verificado con curl, apex y www). Sin ese fichero, la verificación falla.

P2 NO causa directamente P1, pero **rompe la vía de recuperación fiable** (volver a
pulsar el enlace tras instalar → abrir la app con el token).

## Evidencia recogida (sin acceso a producción privada)
- `curl https://bubui.app/.well-known/assetlinks.json` → **404 "Not configured"**.
  El route existe (`app/.well-known/assetlinks.json/route.ts`) pero responde 404 si
  no está la env `ANDROID_SHA256_FINGERPRINT`. → **no está configurada**.
- La app 1043 lleva los iconos SVG → el binario nuevo (con captura reactiva del
  referrer + trazas) está instalado. Aun así falla → **el referrer no está
  entregando el token** (o llega vacío/organic), no es que falte el código.
- URL de Play generada por la web:
  `https://play.google.com/store/apps/details?id=com.negociovivo.bubui&referrer=reto_<token>`
  (encodeURIComponent; sin caracteres especiales → el referrer viaja como `reto_<token>`).
- Deep link de respaldo: `bubui://reto/<token>` (esquema propio; NO necesita assetlinks).

## Etapas del flujo y SEÑAL que distingue cada una (trazas BubuiDealTrace)
| Etapa | Señal (traza) | Qué significa si aparece / falta |
|---|---|---|
| Web abierta | `web_page_view` (token) | El enlace se abrió/crawleó. |
| App arranca | `app_started` (bucket `0000000000000000`) | Corre el binario nuevo. Si falta → build viejo. |
| Referrer leído | `app_capture_install_referrer` (token) | ✅ el referrer trajo `reto_<token>`. |
| Referrer sin token | `app_ref_no_token` (bucket) | ⚠️ **causa P1 más probable**: Play atribuyó organic / el enlace no llevó referrer. |
| Módulo ausente | `app_ref_no_module` / `app_ref_no_api` (bucket) | El módulo nativo no está o no responde. |
| Iconos | `app_iconfont_ok/fail` (bucket) | (Ya resuelto con SVG; informativo.) |
| Onboarding con reto | `app_onboarding_shown` (token) | El onboarding detectó el reto → registro forzado. |
| Reclamo | `app_claim_ok` (token) | Reto reclamado. |

**Consulta (admin):** `GET /api/bubui/deal-trace?token=<token>` y `…?token=0000000000000000`.

## Hipótesis, ordenadas por probabilidad
1. **(MÁS PROBABLE) El Play Install Referrer no entrega `reto_<token>`** en instalaciones
   que vienen del navegador in-app de WhatsApp. El Install Referrer solo trae el valor
   si la instalación se atribuye a esa URL con `&referrer=`; con el navegador in-app y
   la atribución de Play, a menudo llega `utm_source=…&utm_medium=organic` o vacío.
   → traza `app_ref_no_token` (o ausencia de `app_capture_install_referrer`).
2. **App Links sin verificar (assetlinks 404)** → aunque el usuario reintente pulsando
   el enlace, `https://bubui.app/reto/<token>` abre el NAVEGADOR, no la app → no hay vía
   de recuperación determinista, y sale el aviso de Play. (PROBADO.)
3. **Timing** (referrer tardío) — ya mitigado con la captura reactiva del PR #292.

## Limitaciones REALES del deferred deep link (por qué el referrer es frágil)
- El Play Install Referrer NO garantiza entrega del valor de campaña; depende de la
  atribución de Play y del origen del click. Firebase Dynamic Links (la solución
  clásica) está **descontinuado (ago-2025)**. Sin un SDK de atribución (Branch/AppsFlyer),
  el único camino DETERMINISTA es que el usuario vuelva a abrir el enlace tras instalar
  (App Link o `bubui://`), lo que exige assetlinks.json correcto.

## Arquitectura definitiva (ambos flujos deterministas)
1. **Servir assetlinks.json con la huella de Play App Signing** (arregla P2 y la
   recuperación de P1):
   - En Play Console → *Integridad de la app → Certificado de la clave de firma de la app*
     → copia el **SHA-256**.
   - En Railway, env `ANDROID_SHA256_FINGERPRINT = "<APP_SIGNING_SHA256>,<UPLOAD_SHA256>"`
     (incluye también la de subida para que verifiquen los APK de prueba interna).
   - El route ahora acepta **varias** huellas (ver cambio + test). Verifica luego:
     `curl https://bubui.app/.well-known/assetlinks.json` → 200 con el JSON.
   - Resultado: pulsar el enlace del reto con la app instalada la abre DIRECTA;
     `deal-pending` captura el token por `getInitialURL`. Determinista.
2. **UX web tras instalar:** que la página del reto ofrezca de forma prominente
   *"Ya instalé la app → Abrir mi reto"* (dispara App Link / `bubui://reto/<token>`),
   convirtiendo la re-apertura en 1 toque.
3. **Install Referrer** se queda como vía de CERO toques (best-effort) + trazas para
   medir su tasa real de acierto. Si es baja, valorar Branch/AppsFlyer.
4. **Onboarding:** nunca invitado con reto pendiente (ya hecho, con detección reactiva).

## Prueba E2E real (web → Play → primera apertura), no mocks
`apps/bubui-mobile/e2e/repro-referrer.sh <apk> <token>`: instala el APK y simula el
broadcast oficial `com.android.vending.INSTALL_REFERRER --es referrer reto_<token>`,
lanza la app y guía la verificación por trazas. Para App Links, además:
```
adb shell pm verify-app-links --re-verify com.negociovivo.bubui
adb shell pm get-app-links com.negociovivo.bubui   # estado de verificación por dominio
adb shell am start -a android.intent.action.VIEW -d "https://bubui.app/reto/<token>"  # debe abrir la app
```

## Test antes/después incluido
`app/.well-known/__tests__/assetlinks.test.ts`: el assetlinks acepta varias huellas
(app-signing + subida) y emite el paquete correcto (antes solo aceptaba una).

## Qué necesito para CERRAR la causa de P1 (no lo invento)
1. **Trazas** de `GET /api/bubui/deal-trace?token=<token>` y `…?token=0000000000000000`.
2. La **SHA-256 de Play App Signing** (Play Console) para configurar assetlinks.

Sin acceso a la BD/EAS/SDK de producción no puedo leer trazas ni compilar el APK.
Con esos dos datos confirmo la etapa exacta y ajusto el diff.
