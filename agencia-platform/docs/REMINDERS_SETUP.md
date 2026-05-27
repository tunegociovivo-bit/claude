# Recordatorios automáticos de fecha de entrega

La plataforma genera notificaciones diarias para los asignados de tareas
cuyo `dueDate` está dentro de las próximas 24 horas. Lo hace un cron
externo (GitHub Actions) que dispara un endpoint protegido en Railway.

## Setup (5 minutos)

### 1. Genera un token aleatorio

En cualquier terminal:

```bash
openssl rand -hex 32
```

Te devuelve algo tipo `a1b2c3...`. Cópialo.

### 2. Añade el token a Railway

Railway → servicio `claude` → **Variables** → **+ New Variable**:

| Variable | Valor |
|---|---|
| `INTERNAL_CRON_TOKEN` | (el token del paso 1) |

Railway redeploya solo.

### 3. Añade los secrets a GitHub

https://github.com/tunegociovivo-bit/claude/settings/secrets/actions → **New repository secret** (uno por uno):

| Nombre | Valor |
|---|---|
| `INTERNAL_CRON_TOKEN` | **El mismo valor** que pusiste en Railway |
| `HUB_BASE_URL` | `https://hub.negociovivo.app` (tu URL de producción) |

### 4. Verifica el workflow

El workflow vive en `.github/workflows/deadline-reminders.yml` y se ejecuta:
- **Automáticamente**: cada día a las 06:00 UTC (07:00 / 08:00 hora española)
- **Manualmente**: pestaña "Actions" → "Deadline reminders" → "Run workflow"

Dispárarlo manualmente la primera vez para verificar que funciona.

## Qué hace el cron

1. Hace `POST` a `/api/v1/internal/reminders` con el bearer token.
2. El endpoint busca todas las tareas con `dueDate` entre ahora y +24h que no estén en `DONE` o `CANCELLED`.
3. Por cada asignado de cada tarea, crea una notificación tipo `deadline` con texto: `Tu tarea "X" vence el DD MMM HH:MM`.
4. Es **idempotente**: si ya existe una notificación con el mismo cuerpo para ese usuario, no la duplica.

El usuario recibe la notificación en su campana del TopBar (badge rojo) y en `/admin/notificaciones`.

## Coste

GitHub Actions es **gratis** hasta 2.000 minutos/mes en repos privados (cuotas más altas en públicos). Cada ejecución de este cron tarda ~5 segundos, así que mensualmente consume ~2-3 minutos. Totalmente gratis.

## Si quieres recordatorios más agresivos

Edita la línea `cron:` en el YAML. Sintaxis estándar de cron:
- `"0 6 * * *"` → 06:00 UTC todos los días (actual)
- `"0 6,14 * * *"` → 06:00 y 14:00 UTC
- `"*/30 * * * *"` → cada 30 minutos (¡cuidado con saturar de notificaciones!)

## Próximos pasos (sin implementar todavía)

- **Web Push (notificación al móvil)**: añadir service worker + VAPID keys + UI para suscribirse. Cuando se cree una `Notification`, también dispara push. Diseñado pero pendiente.
- **Email para @menciones críticas**: cuando se mencione fuera de horario laboral, enviar email vía Resend/SendGrid.
