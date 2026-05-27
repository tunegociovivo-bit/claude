# Agencia Hub — Plataforma interna

Plataforma tipo Notion + Asana para uso interno de una agencia de marketing. Construida con Next.js 14 (App Router) + Postgres + Prisma + NextAuth, con API REST propia y servidor MCP para integrar con cualquier asistente IA.

## Estado por fases

| Fase | Estado | Contenido |
|---|---|---|
| **1. Prototipo visual** | Completo | Dashboard, Tareas (Kanban), Clientes (CRM), Documentos (Wiki), Calendario — con datos simulados |
| **2. Cimiento real (esta fase)** | Completo | Esquema Prisma, NextAuth, API REST v1, servidor MCP, Docker Compose VPS, seed |
| **3. Editor avanzado** | Pendiente | Editor por bloques tipo Notion (TipTap), subpáginas, plantillas, menciones |
| **4. Databases multi-vista** | Pendiente | Bases tipo Notion (tabla/kanban/calendario/galería), filtros, relaciones, fórmulas |
| **5. Migración Asana** | Pendiente | Importador OAuth + sync continuo |

## Stack

- **Frontend**: Next.js 14 (App Router) + React 18 + TypeScript + Tailwind
- **BD**: PostgreSQL 16 + Prisma 5
- **Auth**: NextAuth.js (email/contraseña + Google opcional)
- **Ficheros**: MinIO (S3-compatible)
- **Cache/colas**: Redis
- **Búsqueda**: Meilisearch
- **Proxy/TLS**: Caddy 2
- **API**: REST v1 con OpenAPI + servidor MCP

## Arquitectura (resumen)

```
   Internet ── Caddy (443) ──┬── Next.js (3000)
                              ├── MinIO (9000)
                              └── …
   Next.js ──┬── Postgres
              ├── Redis
              ├── Meilisearch
              └── MinIO
```

Multi-tenant por `workspaceId` en cada recurso. Una sola instancia puede alojar varias agencias.

## Desarrollo local

```bash
cd agencia-platform
cp .env.example .env

# Arranca Postgres + servicios auxiliares
docker compose up -d postgres redis minio meilisearch

# Dependencias y BD
npm install
npx prisma migrate dev --name init
npm run db:seed

# Servidor de dev
npm run dev
# http://localhost:3000
# Login: u1@agencia.local / agencia123
```

## Despliegue en tu VPS

### 1. Provisiona el VPS (Ubuntu 22.04 / 24.04, mínimo 2 vCPU / 4 GB RAM)

```bash
ssh root@tu.vps
bash <(curl -s https://raw.githubusercontent.com/<tu-org>/<repo>/main/agencia-platform/deploy/install-vps.sh)
```

(O ejecuta `deploy/install-vps.sh` después de clonar el repo.)

### 2. Configura

```bash
git clone <url-repo> agencia-hub
cd agencia-hub/agencia-platform
cp .env.example .env
nano .env   # rellena dominios y secretos
```

Variables mínimas a cambiar:
- `NEXTAUTH_SECRET` — genera uno con `openssl rand -base64 32`
- `POSTGRES_PASSWORD` — contraseña fuerte
- `S3_SECRET_KEY` — contraseña fuerte
- `APP_DOMAIN` — tu dominio, ej. `agencia.tudominio.com`
- `FILES_DOMAIN` — subdominio para ficheros, ej. `files.agencia.tudominio.com`
- (Opcional) `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`

Apunta los dominios al IP del VPS antes de levantar Caddy (necesita acceso para Let's Encrypt).

### 3. Arranca

```bash
docker compose up -d --build
docker compose exec app npm run db:seed   # solo la primera vez
```

Caddy gestiona TLS automáticamente. Accede a `https://agencia.tudominio.com`.

### 4. Backups (recomendado)

Crea cron diario:
```cron
0 3 * * * docker exec agencia-platform-postgres-1 pg_dump -U agencia agencia | gzip > /backup/db-$(date +\%F).sql.gz
```
Y replica `/backup/` a Backblaze B2 o S3.

## API REST

Documentación OpenAPI: `GET /api/openapi.json`

### Autenticación

Todas las llamadas requieren `Authorization: Bearer <token>`.
Crea tu primera key desde `/admin/api-keys` cuando estés logueado.

### Endpoints principales

| Recurso | GET | POST | PATCH | DELETE |
|---|---|---|---|---|
| `/api/v1/clients` | listar | crear | — | — |
| `/api/v1/clients/{id}` | obtener | — | actualizar | borrar (soft) |
| `/api/v1/projects` | listar | crear | — | — |
| `/api/v1/tasks` | listar | crear | — | — |
| `/api/v1/tasks/{id}` | obtener | — | actualizar | borrar |
| `/api/v1/documents` | listar | crear | — | — |
| `/api/v1/events` | listar | crear | — | — |

### Ejemplo (curl)

```bash
curl -H "Authorization: Bearer ag_abc.xyz" \
     https://agencia.tudominio.com/api/v1/clients?status=ACTIVE
```

### Scopes disponibles

`clients:read`, `clients:write`, `projects:read`, `projects:write`, `tasks:read`, `tasks:write`, `docs:read`, `docs:write`, `events:read`, `events:write`, `admin`, `*` (todo).

### Webhooks

Próxima iteración. Cuando estén:
- Eventos: `task.created`, `task.updated`, `task.completed`, `client.created`, `document.updated`
- Firmados con HMAC-SHA256 usando el `secret` del webhook

## Servidor MCP

Endpoint: `POST /api/mcp` (auth: misma API key con scope `*`)

Permite que **Claude, ChatGPT u otro asistente IA** lea/escriba en tu plataforma directamente.

Tools expuestos:
- `list_clients`, `create_client`
- `list_projects`
- `list_tasks`, `create_task`, `update_task_status`
- `search_documents`
- `list_events`

### Conectarlo a Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "agencia-hub": {
      "url": "https://agencia.tudominio.com/api/mcp",
      "headers": { "Authorization": "Bearer ag_xxx.yyy" }
    }
  }
}
```

(Para clientes MCP que solo soportan stdio, hay que envolver el endpoint HTTP con un puente — se añadirá en PR #3.)

## Estructura del proyecto

```
agencia-platform/
├── app/
│   ├── (rutas del prototipo)         # Inicio, tareas, clientes, docs, calendario
│   ├── login/                        # nuevo: login
│   ├── admin/api-keys/               # nuevo: gestión de API keys
│   └── api/
│       ├── auth/[...nextauth]/       # NextAuth
│       ├── v1/                       # API REST pública
│       ├── mcp/                      # servidor MCP
│       └── openapi.json/             # spec OpenAPI
├── components/                       # UI compartida (Sidebar, TopBar…)
├── lib/
│   ├── auth.ts                       # config NextAuth
│   ├── db/prisma.ts                  # cliente Prisma
│   ├── db/queries.ts                 # acceso a datos con fallback mock
│   ├── api/                          # auth, handler, schemas, openapi
│   ├── mcp/tools.ts                  # tools MCP
│   └── mock-data.ts                  # datos de demo
├── prisma/schema.prisma              # modelo de BD (≈25 tablas)
├── scripts/seed.ts                   # seed con los datos mock
├── deploy/Caddyfile                  # config Caddy
├── deploy/install-vps.sh             # bootstrap VPS
├── Dockerfile
└── docker-compose.yml                # app + Postgres + MinIO + Redis + Meili + Caddy
```

## Roadmap PR a PR

- **PR #2 (este)** — Cimiento: BD, auth, API REST, MCP, Docker Compose, seed. Compatible con el prototipo (no rompe nada).
- **PR #3** — Editor de documentos por bloques (TipTap o BlockNote), subpáginas, plantillas, comentarios, búsqueda con Meilisearch.
- **PR #4** — Bases de datos tipo Notion: tabla/kanban/calendario/galería, filtros, relaciones, fórmulas. Refactor de "tareas" para usar este motor.
- **PR #5** — Importador Asana (OAuth + sync), portal cliente, tracker de tiempos.
- **PR #6+** — IA (resumen automático, auto-tag, redactor con Claude), webhooks, facturación, reporting.
