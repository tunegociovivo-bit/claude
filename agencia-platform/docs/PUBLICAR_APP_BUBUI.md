# Publicar la app móvil Bubui (retos) — pasos manuales

Instrucciones para compilar y publicar una nueva versión de la app Bubui
(`com.negociovivo.bubui`). Puedes pasárselas tal cual a la extensión de Chrome
de Claude. **Requisito:** estar logueado en GitHub, Google Play Console, App
Store Connect y Railway en ese navegador.

- **Repo:** `tunegociovivo-bit/claude`
- **Rama por defecto:** `claude/wordpress-ai-review-plugin-bdSLe`

---

## Tarea 1 — Lanzar el build de Android (GitHub)
1. Abre `https://github.com/tunegociovivo-bit/claude/actions/workflows/bubui-android-build.yml`
2. Pulsa **"Run workflow"** (arriba a la derecha).
3. Deja la rama `claude/wordpress-ai-review-plugin-bdSLe` y pulsa **"Run workflow"** (verde).
4. Espera a que termine en **verde** (10–30 min). El AAB queda en:
   `https://github.com/tunegociovivo-bit/claude/releases/latest/download/bubui.aab`

## Tarea 2 — Lanzar el build de iOS (GitHub)
1. Abre `https://github.com/tunegociovivo-bit/claude/actions/workflows/bubui-ios-build.yml`
2. Pulsa **"Run workflow"**.
3. Deja la rama; en **"Qué compilar"** elige **`testflight`** y en **"Subir a TestFlight tras compilar"** marca **`true`**. Pulsa **"Run workflow"**.
4. Espera a que termine en verde. Se sube solo a **TestFlight**.

## Tarea 3 — Publicar en Google Play
1. Descarga el AAB: `https://github.com/tunegociovivo-bit/claude/releases/latest/download/bubui.aab`
2. Entra en **Google Play Console** → app **Bubui** (`com.negociovivo.bubui`).
3. **Producción** (o **Testing → Internal testing**) → **Crear nueva versión**.
4. Sube `bubui.aab`, escribe las **notas de la versión** (ej: "Aceptar retos desde la app") → **Siguiente/Guardar**.
5. **Revisar versión → Iniciar lanzamiento a Producción**. *(Si hay algo dudoso que confirmar, detente y pregunta.)*

## Tarea 4 — Publicar en App Store (iOS)
1. Entra en **App Store Connect** → **Apps → Bubui**.
2. En **TestFlight**, confirma que aparece la build nueva (procesada).
3. Pestaña de **App Store** → **+ Versión** (o "Preparar para enviar").
4. Selecciona la build procesada, escribe **"novedades de esta versión"** y pulsa **"Enviar para revisión"**. *(Revisión de Apple: 1–3 días.)*

## Tarea 5 — URL del App Store en Railway (cuando el iOS esté PUBLICADO)
1. Copia la URL pública de la app en la App Store (`https://apps.apple.com/app/idXXXXXXXX`).
2. **Railway** → proyecto del Hub → servicio de la web → **Variables**.
3. Añade **`NEXT_PUBLIC_BUBUI_IOS_URL`** con ese valor y **Deploy/Redeploy**.

---

## Notas para la extensión de Chrome
- **Tareas 1 y 2:** seguras y automáticas (solo pulsar "Run workflow").
- **Tareas 3 y 4** tocan tiendas: si aparece cualquier decisión de contenido
  (notas, capturas, precios, cumplimiento) que no esté clara, **detente y pregunta**.
- No cambies nada más del repo ni de las consolas.

## Importante (estado actual)
El reto **ya solo se puede aceptar desde la app instalada** (Fase 2 aplicada).
Hasta que la nueva app esté **publicada en las dos tiendas**, quien no la tenga
no podrá completar un reto. Si necesitas que los retos se acepten mientras tanto,
pídele a Claude **revertir la Fase 2** temporalmente.
