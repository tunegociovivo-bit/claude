# Bubui — Subida a la App Store (iOS)

Estado: **proyecto listo técnicamente**. El único bloqueo es la **cuenta Apple
Developer** (alta Individual en curso, ~24–48 h). En cuanto esté activa, los
pasos de abajo dejan el build subido y en revisión en minutos.

App: **Bubui** · bundle id `com.negociovivo.bubui` · Expo SDK 51 · EAS
projectId `d8f1d22c-36b4-416e-9c91-1a681b4c37d5` · owner Expo `bipiapp`.

---

## 0. Requisito bloqueante — Apple Developer Program (Individual)

1. En el iPhone/Mac/web con el **Apple ID de la empresa**: https://developer.apple.com/programs/enroll/
2. Tipo **Individual** (más rápido; el "vendedor" en la ficha será el nombre de
   la persona del Apple ID). Pago 99 $/año.
3. Apple verifica (de unas horas a ~48 h). Cuando recibas el correo de
   bienvenida y puedas entrar en **App Store Connect**, sigue.

> Si algún cliente/socio ya tiene cuenta Apple Developer, añadirte a su equipo
> (rol Admin/App Manager) es aún más rápido y te saltas el alta.

---

## 1. Credenciales (una sola vez, cuando la cuenta esté activa)

### a) Expo token (ya disponible)
- `export EXPO_TOKEN=...` (cuenta `bipiapp`). No se commitea.

### b) App Store Connect API Key (.p8) — para firmar y subir sin 2FA
1. App Store Connect → **Users and Access → Integrations → App Store Connect API**.
2. **Generate API Key**, rol **App Manager** (o Admin).
3. Descarga el `AuthKey_XXXXXX.p8` (¡solo se descarga UNA vez!).
4. Apunta **Key ID** y **Issuer ID** (arriba de la tabla).
5. Guarda el .p8 en sitio seguro (NO en git). En este entorno: `/tmp/asc_key.p8`.

---

## 2. Validación previa (NO necesita cuenta Apple) — ya se puede hacer

Build de **simulador** en EAS para confirmar que iOS compila limpio:

```bash
cd apps/bubui-mobile
export EXPO_TOKEN=...
npx eas-cli build --platform ios --profile ios-simulator --non-interactive
```

Si termina en verde, la app iOS compila. (El icono App Store sin alfa lo
genera Expo en el build de producción; el simulador no lo valida.)

---

## 3. Build de producción + subida (cuando la cuenta esté activa)

```bash
cd apps/bubui-mobile
export EXPO_TOKEN=...

# Compila el .ipa firmado (EAS gestiona cert + perfil usando la ASC API Key).
npx eas-cli build --platform ios --profile production --non-interactive

# Sube el build a App Store Connect (crea el registro de app si no existe).
npx eas-cli submit --platform ios --profile production \
  --asc-api-key-path /tmp/asc_key.p8 \
  --asc-api-key-id <KEY_ID> \
  --asc-api-key-issuer-id <ISSUER_ID>
```

`eas build` pedirá las credenciales Apple la primera vez: con `EXPO_APPLE_*`
o la ASC API Key, EAS crea solo el Distribution Certificate y el Provisioning
Profile (App Store). Con la ASC API Key no hay 2FA.

---

## 4. Ficha en App Store Connect (manual, web) — preparar EN PARALELO

Esto NO lo hace EAS; se rellena en appstoreconnect.apple.com. Ten listo:

- [ ] **Nombre** "Bubui" + **subtítulo** (≤30 car.) + **descripción** + **keywords** (≤100 car.)
- [ ] **Categoría** (p.ej. Estilo de vida / Compras) primaria + secundaria
- [ ] **Capturas iPhone 6.7"** (obligatorias): **1290 × 2796 px**, 3–10, vertical.
      (Opcional 6.5": 1242 × 2688.) Sin barra de estado falsa ni mockups con manos.
- [ ] **Icono** 1024×1024 **sin alfa/transparencia** (lo genera Expo; verificar en el build).
- [ ] **URL de política de privacidad** (OBLIGATORIA — la app usa cámara y ubicación).
- [ ] **Cuestionario de privacidad** (App Privacy): declarar **Ubicación** (precisa y
      en segundo plano) y **Cámara**, para qué se usan y si se vinculan al usuario.
- [ ] **Clasificación por edad** (cuestionario).
- [ ] **Precio**: Gratis (suponemos).
- [ ] **Export compliance**: ya resuelto en config (`usesNonExemptEncryption:false`).
- [ ] **Datos de acceso para revisión**: si Bubui requiere login, crea una
      **cuenta demo** y ponla en "App Review Information" (sin esto, rechazo casi seguro).

### ⚠️ Riesgo de revisión: ubicación en segundo plano
La app pide **ubicación en background** (`UIBackgroundModes: location`,
`NSLocationAlwaysAndWhenInUse`). Apple lo revisa con lupa. Para evitar rechazo:
- En "App Review Information → Notes", explica claramente el caso de uso
  (avisar de descuentos al pasar cerca de un negocio) y que el usuario lo
  consiente con un beneficio claro.
- Asegúrate de que la app muestra una explicación clara antes de pedir el
  permiso "Siempre".

---

## 5. Enviar a revisión
En App Store Connect, selecciona el build subido (tarda unos minutos en
"procesarse" tras `eas submit`), completa la ficha y pulsa **Submit for Review**.
Revisión de Apple: típicamente **24–48 h** (a veces menos).

---

## Notas de configuración ya aplicadas (este commit)
- `eas.json`: perfil `ios-simulator` (validación) + bloque `ios` en `production`.
- `app.json`: `ios.config.usesNonExemptEncryption = false` (salta la pregunta de cifrado).
- Permisos iOS (cámara/ubicación) con textos de uso ya presentes.
- App Links `applinks:hub.negociovivo.app` configurado.
