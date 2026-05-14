# Despliegue en Railway — paso a paso

Esta guía es para desplegar Agencia Hub **sin tocar la terminal**, sólo desde el navegador. Tiempo total: ~15 minutos.

---

## 1. Crear cuenta en Railway

1. Abre https://railway.com en el navegador.
2. Pulsa **"Login"** (esquina superior derecha) → **"Continue with GitHub"**.
3. Autoriza Railway en GitHub. Te lleva a tu dashboard vacío.

---

## 2. Crear el proyecto desde el repo

1. En el dashboard, pulsa **"+ New Project"** (botón morado, esquina superior derecha).
2. Elige **"Deploy from GitHub repo"**.
3. La primera vez te pedirá conectar tu cuenta de GitHub a Railway: pulsa **"Configure GitHub App"** y dale acceso a `tunegociovivo-bit/claude` (puedes elegir solo ese repo, no hace falta darle acceso a todos).
4. De vuelta en Railway, busca y elige `tunegociovivo-bit/claude`.
5. Railway empieza a clonar y analizar el repo. **No esperes a que termine** — vamos a configurarlo bien antes.

---

## 3. Apuntar a la subcarpeta correcta

El código de la plataforma vive en `agencia-platform/`, no en la raíz. Hay que decírselo a Railway:

1. En tu nuevo proyecto verás un servicio llamado `claude` (o similar). Pulsa encima.
2. Pulsa la pestaña **"Settings"**.
3. Baja a la sección **"Build"**.
4. En **"Root Directory"** escribe: `agencia-platform`
5. Verifica que **"Watch Paths"** esté en `agencia-platform/**` (Railway lo deduce solo).
6. Más abajo, en **"Branch"**, asegúrate de que sea `claude/internal-project-platform-ZezvX` (la rama de este PR; cuando hagamos merge a `main`, lo cambias a `main`).
7. Pulsa **"Update"** abajo a la derecha.

---

## 4. Añadir base de datos PostgreSQL

1. En la vista del proyecto (botón **"Project"** arriba a la izquierda para volver), pulsa **"+ New"** → **"Database"** → **"Add PostgreSQL"**.
2. Aparece un nuevo servicio llamado `Postgres`. **No tienes que configurar nada** — Railway expone automáticamente la variable `DATABASE_URL` al servicio de tu app.
3. Vuelve al servicio principal (`claude`), pestaña **"Variables"**.
4. Pulsa **"+ New Variable"** → **"Add Reference"** → elige `Postgres` → variable `DATABASE_URL`. Esto enlaza la BD con la app.

---

## 5. Añadir las variables de entorno necesarias

En la pestaña **"Variables"** del servicio `claude`, añade estas (botón **"+ New Variable"** → **"Add Variable"**):

| Variable | Valor | Notas |
|---|---|---|
| `NEXTAUTH_SECRET` | Genera uno largo y aleatorio (ver abajo) | **Obligatorio** — protege las sesiones |
| `NEXTAUTH_URL` | (lo añades en el paso 7, déjalo en blanco por ahora) | Dejar pendiente |
| `ANTHROPIC_API_KEY` | Tu key `sk-ant-...` | Opcional, sólo si quieres IA desde el inicio |
| `NODE_ENV` | `production` | Si no aparece automáticamente |

**Para generar `NEXTAUTH_SECRET`**, abre https://generate-secret.vercel.app/64 en el navegador y copia el valor. (O en consola: `openssl rand -base64 64`.)

---

## 6. Lanzar el primer deploy

1. Vuelve al servicio `claude`, pestaña **"Deployments"**.
2. Si ya hay uno corriendo, espera (~3-5 minutos en el primer build).
3. Si no, pulsa **"Deploy"** arriba a la derecha.
4. Verás el log de build en vivo. Lo que esperar:
   - `Building image with Dockerfile…`
   - `prisma generate && next build`
   - `Successfully built`
   - `Container started`
   - El primer arranque ejecuta `npm run db:bootstrap`, que aplica migraciones y siembra los datos demo.

Si algo sale mal, copia las últimas 30 líneas del log y pégame solo eso (sin variables de entorno).

---

## 7. Generar el dominio público y rellenar `NEXTAUTH_URL`

1. En el servicio `claude`, pestaña **"Settings"** → sección **"Networking"** → **"Generate Domain"**.
2. Railway te da una URL tipo `claude-production-xxxx.up.railway.app`. **Cópiala**.
3. Vuelve a la pestaña **"Variables"**, pulsa la variable `NEXTAUTH_URL` que dejaste en blanco, y pega la URL completa con `https://` delante.
   Ej: `https://claude-production-xxxx.up.railway.app`
4. Esto disparará un re-deploy automático (~1 min).

---

## 8. ¡Listo! Entrar y empezar

Abre la URL del paso 7 en el navegador. Verás la pantalla de login.

```
Email:     u1@agencia.local
Contraseña: agencia123
```

(Estos son los datos del seed inicial. Una vez dentro, ve a `/admin/api-keys` para crear tokens si necesitas la API REST, o a `/admin/ai` para configurar Claude.)

---

## 9. (Opcional) Dominio bonito

Si quieres `agencia.tudominio.com` en vez de la URL larga de Railway:

1. En **Settings → Networking → Custom Domain**, añade tu subdominio.
2. Railway te muestra un registro CNAME. Lo añades en el panel DNS de tu dominio (Cloudflare, Hetzner DNS, donde tengas el dominio).
3. Espera ~5 min a que propague el DNS y a que Railway emita el certificado TLS automáticamente.
4. Actualiza `NEXTAUTH_URL` en variables a `https://agencia.tudominio.com`.

---

## Costes en Railway

- **Hobby plan** ($5/mes con $5 de crédito incluido) — suficiente para uso interno de una agencia pequeña.
- Postgres + app pequeña suelen consumir entre $3 y $7/mes en uso normal.
- Puedes pausar el proyecto cuando no lo uses para no consumir crédito.

---

## Troubleshooting habitual

| Síntoma | Causa probable | Solución |
|---|---|---|
| Build falla con "Dockerfile not found" | Root Directory mal puesto | Settings → Build → Root Directory = `agencia-platform` |
| Build OK pero app crashea con "DATABASE_URL undefined" | Falta vincular Postgres | Variables → New → Add Reference → Postgres → DATABASE_URL |
| Redirect loop al hacer login | `NEXTAUTH_URL` no coincide con la URL real | Pon exactamente la URL que te dio Railway, con `https://` |
| Error 503 al usar features de IA | Falta API key de Anthropic | Variables → `ANTHROPIC_API_KEY` o configúrala desde `/admin/ai` |
| "MinIO/Redis/Meilisearch unreachable" en logs | Esos servicios no están en Railway | Inofensivo — la app degrada graciosamente. Para activar adjuntos/búsqueda, añade plugins de Redis/Meilisearch desde Railway (siguiente PR) |
