# Guía de despliegue de Evolution API

Esta guía te lleva desde cero hasta tener Evolution API funcionando y conectado a tu número de WhatsApp, listo para que el plugin envíe mensajes automatizados.

Tres caminos según tus preferencias:

1. **Railway** (más fácil, sin servidor propio) — ~7 €/mes
2. **VPS con Docker** (más control, más barato a partir de cierto uso) — desde 4 €/mes
3. **Hosting compartido** — NO recomendado, Evolution necesita un proceso persistente

Mi recomendación: empieza por Railway, y si te interesa optimizar costes con el tiempo, migra a un VPS.

---

## Opción 1: Despliegue en Railway (recomendado para empezar)

### Paso 1 — Crear cuenta y proyecto

1. Entra en https://railway.app y crea cuenta (puedes usar GitHub).
2. Pulsa **New Project → Deploy from GitHub repo**.
3. Si Evolution API no aparece, usa la opción **Deploy from Docker Image** y pega: `atendai/evolution-api:latest` (o `evolutionapi/evolution-api:latest` si esa no funciona).

### Paso 2 — Añadir base de datos PostgreSQL

Evolution v2.x necesita PostgreSQL.

1. Dentro del proyecto pulsa **+ New → Database → PostgreSQL**.
2. Railway añadirá automáticamente las variables `DATABASE_URL` y `PGHOST/PGUSER/PGPASSWORD/PGDATABASE`.

### Paso 3 — Añadir Redis

1. **+ New → Database → Redis**.
2. Esto añade `REDIS_URL`.

### Paso 4 — Configurar variables de entorno de Evolution

En el servicio de Evolution, ve a **Variables** y añade:

```
SERVER_TYPE=http
SERVER_PORT=8080

AUTHENTICATION_API_KEY=NV-CAMBIAR-ESTO-POR-UN-STRING-LARGO-Y-ALEATORIO
AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=true

DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=${{ Postgres.DATABASE_URL }}
DATABASE_CONNECTION_CLIENT_NAME=evolution_exchange
DATABASE_SAVE_DATA_INSTANCE=true
DATABASE_SAVE_DATA_NEW_MESSAGE=true
DATABASE_SAVE_MESSAGE_UPDATE=true
DATABASE_SAVE_DATA_CONTACTS=true

CACHE_REDIS_ENABLED=true
CACHE_REDIS_URI=${{ Redis.REDIS_URL }}
CACHE_REDIS_PREFIX_KEY=evolution_v2

LOG_LEVEL=ERROR
LOG_COLOR=true
LOG_BAILEYS=error

DEL_INSTANCE=false

CONFIG_SESSION_PHONE_CLIENT=NegocioVivo
CONFIG_SESSION_PHONE_NAME=Chrome

QRCODE_LIMIT=10
QRCODE_COLOR=#198754
```

⚠️ **Cambia `AUTHENTICATION_API_KEY` por una cadena larga aleatoria.** Esta es tu "contraseña maestra" para llamar a la API. Guárdala bien.

### Paso 5 — Generar dominio público

En **Settings → Networking → Generate Domain**. Railway te da una URL tipo `https://evolution-production-xxxx.up.railway.app`. Guárdala — será tu `EVOLUTION_API_URL`.

### Paso 6 — Crear una instancia y conectar tu número

Desde tu propio ordenador, abre una terminal y ejecuta:

```bash
curl -X POST 'https://TU-URL-DE-RAILWAY/instance/create' \
  -H 'apikey: TU-AUTHENTICATION-API-KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "instanceName": "negociovivo",
    "qrcode": true,
    "integration": "WHATSAPP-BAILEYS"
  }'
```

Te devolverá un JSON con un campo `qrcode.base64` (un string largo) y `qrcode.code`.

**Cómo escanear el QR:**

Opción A — copia el contenido de `qrcode.base64` (empieza por `data:image/png;base64,...`), pégalo en la barra del navegador y pulsa Enter. Verás el QR.

Opción B — más fácil, abre en el navegador: `https://TU-URL-DE-RAILWAY/manager` (Evolution v2 incluye un panel web). Inicia sesión con tu API key. Verás la instancia "negociovivo" y un QR para escanear.

**Con tu móvil:** abre WhatsApp → menú (⋮) → **Dispositivos vinculados** → **Vincular un dispositivo** → escanea el QR.

A los 2-3 segundos verás que la instancia pasa a estado `open` (conectada).

### Paso 7 — Configurar el plugin

En WordPress, ve a **NV Leads → Ajustes** y rellena:

- **URL base de Evolution API**: `https://TU-URL-DE-RAILWAY` (sin barra final).
- **API key global**: el valor que pusiste en `AUTHENTICATION_API_KEY`.
- **Nombre de la instancia**: `negociovivo`.

Pulsa **Probar conexión Evolution**. Debería mostrarte un mensaje verde con el estado `open`.

---

## Opción 2: Despliegue en VPS con Docker

### Paso 1 — Pedir un VPS

Mínimo: 1 vCPU, 1 GB RAM, 20 GB SSD. Lo encuentras en Hetzner (~4 €/mes), DigitalOcean (~6 €), Contabo, OVH, Vultr, etc. Pide Ubuntu 22.04.

### Paso 2 — Instalar Docker

```bash
ssh root@TU-IP
curl -fsSL https://get.docker.com | sh
apt-get install -y docker-compose
```

### Paso 3 — Crear el docker-compose

```bash
mkdir -p /opt/evolution && cd /opt/evolution
nano docker-compose.yml
```

Pega:

```yaml
version: '3.9'

services:
  evolution:
    image: atendai/evolution-api:latest
    container_name: evolution
    restart: always
    ports:
      - "8080:8080"
    environment:
      SERVER_TYPE: http
      SERVER_PORT: 8080
      AUTHENTICATION_API_KEY: CAMBIA-ESTO-POR-UN-STRING-LARGO
      AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES: "true"
      DATABASE_PROVIDER: postgresql
      DATABASE_CONNECTION_URI: postgresql://evolution:evolutionpass@postgres:5432/evolution
      DATABASE_CONNECTION_CLIENT_NAME: evolution_exchange
      DATABASE_SAVE_DATA_INSTANCE: "true"
      DATABASE_SAVE_DATA_NEW_MESSAGE: "true"
      CACHE_REDIS_ENABLED: "true"
      CACHE_REDIS_URI: redis://redis:6379/0
      CACHE_REDIS_PREFIX_KEY: evolution_v2
      LOG_LEVEL: ERROR
      DEL_INSTANCE: "false"
      CONFIG_SESSION_PHONE_CLIENT: NegocioVivo
      CONFIG_SESSION_PHONE_NAME: Chrome
      QRCODE_LIMIT: 10
    depends_on:
      - postgres
      - redis
    volumes:
      - evolution_instances:/evolution/instances

  postgres:
    image: postgres:15
    container_name: evolution-postgres
    restart: always
    environment:
      POSTGRES_DB: evolution
      POSTGRES_USER: evolution
      POSTGRES_PASSWORD: evolutionpass
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7
    container_name: evolution-redis
    restart: always
    volumes:
      - redis_data:/data

volumes:
  evolution_instances:
  postgres_data:
  redis_data:
```

### Paso 4 — Arrancar

```bash
docker-compose up -d
docker ps   # verifica que evolution, postgres y redis están "Up"
```

### Paso 5 — Poner un HTTPS por delante con Caddy (recomendado)

Sin HTTPS, las llamadas desde WordPress no son seguras. La forma más rápida:

```bash
docker run -d --name caddy --restart always \
  -p 80:80 -p 443:443 \
  -v caddy_data:/data \
  -v $(pwd)/Caddyfile:/etc/caddy/Caddyfile \
  --link evolution:evolution \
  caddy
```

Antes crea `/opt/evolution/Caddyfile`:

```
wa-api.tudominio.com {
    reverse_proxy evolution:8080
}
```

Necesitas haber apuntado el subdominio `wa-api.tudominio.com` con un A record a la IP del VPS.

### Paso 6 — Crear la instancia y configurar el plugin

Igual que en Railway, paso 6 y 7, pero usando `https://wa-api.tudominio.com` como URL base.

---

## Configurar el webhook (respuestas entrantes)

A partir de v1.2 el plugin puede recibir las respuestas de tus leads automáticamente, clasificarlas con IA y detener las secuencias de follow-up al recibir un "no me interesa".

1. Ve a **NV Leads → Ajustes**, sección "Webhook (respuestas entrantes)". Copia la URL que aparece (algo como `https://tu-wp.com/wp-json/nvl/v1/webhook/abc123...`).
2. Hay dos formas de pegarla en Evolution:
   - **Auto**: pulsa "Configurar webhook automáticamente en Evolution" desde el plugin. Listo.
   - **Manual**: en el panel de Evolution (Manager) → tu instancia → Webhook → pega la URL y marca el evento `MESSAGES_UPSERT`.
3. Para probar: envíate un mensaje desde otro número a tu número de WhatsApp del bot. En 5-10 segundos lo verás en **NV Leads → Bandeja**.

## Verificación y primer envío

1. En **NV Leads → Ajustes**, pulsa **Probar conexión Evolution**. Debes ver `"state":"open"`.
2. Lanza una búsqueda corta (una provincia pequeña, por ejemplo "Cuenca").
3. Cuando termine, abre el detalle de un lead **con teléfono**.
4. Pulsa **⚡ Encolar para envío automático**.
5. Ve a **NV Leads → Cola de envío**. Verás el mensaje en cola con su hora programada.
6. Espera al cron (cada minuto) o pulsa "Enviar ahora" en la cola para forzar el envío inmediato.

Si el primer envío sale `sent`, ¡estás listo!

---

## Buenas prácticas para evitar baneo

1. **Calienta el número**: si es nuevo en WhatsApp, no envíes 80 mensajes el primer día. Empieza con 10–15 los primeros 3–4 días, y sube progresivamente.
2. **Conversa primero**: añade tu número a algunos contactos conocidos y mantén conversaciones reales durante 2-3 días antes de empezar prospección. Esto le da "edad" y reputación al número.
3. **No envíes el mismo texto a 100 personas**: activa las variaciones automáticas en Ajustes.
4. **Respeta la ventana horaria**: nada de mensajes a las 3 de la madrugada.
5. **Evita enlaces sospechosos**: si añades una URL, que sea de tu dominio principal, no de acortadores como bit.ly.
6. **Borra al instante a quien te diga "no me escribas más"**: márcalo como Descartado en el plugin para que no le vuelvas a contactar nunca, y respeta el tiempo de respuesta (no esperes a "que se le pase").
7. **Ten un número de respaldo**: si te banean el principal, no pierdes la operación.

## Problemas comunes

**"Error: HTTP 401"** al probar conexión Evolution → la API key no coincide con la que pusiste en `AUTHENTICATION_API_KEY`. Cópiala bien (sin espacios al final).

**"Error: HTTP 404"** → el nombre de la instancia no existe en Evolution. Crea la instancia primero (paso 6).

**La instancia está en estado `close` o `connecting`** → no has escaneado el QR, o lo escaneaste y desde el móvil cerraste sesión. Vuelve al panel `/manager` y escanea de nuevo.

**Mensajes fallidos con "número no existe en WhatsApp"** → el lead no tiene WhatsApp. Márcalo como Descartado.

**Mensajes fallidos masivamente con `403` o "banned"** → tu número ha sido restringido por WhatsApp. Conéctate al móvil con ese número y comprueba si has recibido aviso. Cambia a otro número de respaldo y reduce los volúmenes.
