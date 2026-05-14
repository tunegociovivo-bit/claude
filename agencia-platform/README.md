# Agencia Hub — Plataforma interna

Prototipo visual de una plataforma tipo Notion + Asana, pensada para uso interno de una agencia de marketing. Esta versión es solo UI (sin backend ni base de datos): los datos son simulados desde `lib/mock-data.ts` para validar la navegación, los módulos y el estilo antes de implementar la lógica real.

## Módulos incluidos

- **Inicio** — Dashboard con KPIs, tareas próximas, eventos y equipo.
- **Tareas** — Vista Kanban + lista con filtros por proyecto, prioridades y avatares.
- **Clientes** — Listado tipo CRM con ficha individual de cada cuenta (proyectos, tareas, contacto, MRR).
- **Documentos** — Wiki con categorías y editor estilo bloques (Notion-like).
- **Calendario** — Vista mensual + agenda semanal con eventos por tipo (publicaciones, reuniones, deadlines, campañas).

## Stack

- Next.js 14 (App Router) + React 18 + TypeScript
- Tailwind CSS
- Lucide icons

## Cómo arrancar localmente

```bash
cd agencia-platform
npm install
npm run dev
```

Abrir http://localhost:3000.

## Estructura

```
agencia-platform/
├── app/
│   ├── page.tsx              # Dashboard
│   ├── tareas/page.tsx
│   ├── clientes/page.tsx
│   ├── clientes/[id]/page.tsx
│   ├── documentos/page.tsx
│   ├── documentos/[id]/page.tsx
│   └── calendario/page.tsx
├── components/
│   ├── Sidebar.tsx
│   ├── TopBar.tsx
│   ├── PageHeader.tsx
│   └── AvatarStack.tsx
└── lib/
    └── mock-data.ts          # Clientes, proyectos, tareas, docs, eventos
```

## Siguientes pasos (cuando aprobemos el prototipo)

1. **Backend y persistencia** — PostgreSQL + Prisma corriendo en el VPS.
2. **Autenticación** — NextAuth con login por email/contraseña o SSO de Google Workspace.
3. **Roles y permisos** — admin / miembro, restricción por proyecto.
4. **Editor real de documentos** — TipTap o BlockNote para bloques tipo Notion.
5. **Drag & drop en Kanban** — `@dnd-kit`.
6. **Adjuntos** — S3 compatible (MinIO autoalojado) para ficheros y briefings.
7. **Despliegue en VPS** — Dockerfile + docker-compose con Postgres + Caddy/Nginx + certificados Let's Encrypt.

## Despliegue en VPS (cuando esté listo)

Plan recomendado:

- Ubuntu 22.04 o 24.04, 2 vCPU / 4 GB RAM mínimo.
- Docker + Docker Compose.
- Servicios: `app` (Next.js), `db` (Postgres 16), `proxy` (Caddy con TLS automático).
- Backups: pg_dump diario a almacenamiento externo (Backblaze B2 o similar).

Se añadirá un `docker-compose.yml` en la siguiente fase.
