# Push notifications (Web Push) — setup

Notificaciones nativas en navegador y **móvil** (Android Chrome/Firefox,
iOS Safari 16.4+ instalado como PWA, Windows, macOS, Linux).
Cuando alguien te menciona en un comentario o tienes una tarea próxima a
vencer, te aparece la notificación incluso con la pestaña cerrada.

## Setup (5 minutos, una sola vez)

### 1. Generar las VAPID keys

En cualquier terminal con el repo clonado:

```bash
cd agencia-platform
npx web-push generate-vapid-keys
```

Devuelve algo así:

```
=======================================
Public Key:
BL...87 caracteres base64url...

Private Key:
Lk...43 caracteres...
=======================================
```

Copia ambas — **la privada NO se comparte ni se commitea**.

### 2. Añadir las variables a Railway

Railway → servicio `claude` → **Variables** → añade estas 3:

| Variable | Valor |
|---|---|
| `VAPID_PUBLIC_KEY` | (la pública del paso 1) |
| `VAPID_PRIVATE_KEY` | (la privada del paso 1) |
| `VAPID_CONTACT_EMAIL` | tu email — ej. `tunombre@negociovivo.com` |

Railway redeploya solo (~1 min).

### 3. Activar push en tu navegador

1. Abre https://hub.negociovivo.app/admin/notificaciones
2. Verás un botón verde **"Activar notificaciones en este dispositivo"**.
   (Si dice "Push no disponible (sin configurar)", revisa el paso 2.)
3. Pulsa → el navegador te pide permiso → acepta.
4. El botón cambia a verde "Push activado".

Para activar en el **móvil**:
- **Android Chrome**: abre la URL en Chrome → menú → "Añadir a pantalla de inicio" → abre desde el icono → activa push como en el paso 3.
- **iOS Safari (16.4+)**: la URL → Compartir → "Añadir a pantalla de inicio" → **abre desde el icono** (no desde Safari) → activa push como en el paso 3.
- En cada dispositivo distinto tienes que pulsar el botón una vez. La BD guarda una `PushSubscription` por dispositivo.

## Qué eventos disparan push

Hoy:
- **@menciones en comentarios de tareas** → push tipo "Te han mencionado".
- **Recordatorios pre-deadline** (cron diario) → push tipo "Vence pronto".

Próximamente (en backlog):
- Asignación de tarea (cuando alguien te asigna una tarea).
- Cambio de estado de tarea que te pertenece.
- Comentario en tarea que tú creaste.

## Coste

Web Push **es gratis**. Los pushes se mandan vía:
- FCM (Google) para Chrome/Android — sin coste hasta cuotas industriales
- APNs (Apple) para Safari — sin coste
- Servicios Mozilla/Microsoft para Firefox/Edge

Los servicios de push aceptan ~tens de miles de notifs gratis al día, lo cual cubre cualquier agencia.

## Diagnóstico

Si las notificaciones no llegan:

1. **Verifica las variables**: `Settings → Variables` de Railway debe tener las 3 VAPID_*
2. **Mira logs de Railway**: cuando se manda un push, en logs ves `[push] mention/deadline ...`. Si ves errores 410/404, son suscripciones caducadas (el sistema las limpia solo).
3. **Reset de suscripción**: en `/admin/notificaciones`, desactiva → vuelve a activar. A veces la suscripción del navegador caduca y hay que renovarla.
4. **iOS específico**: las notificaciones solo funcionan en **PWA instalada en pantalla de inicio**, no en Safari normal.

## Variables de entorno resumen

```
VAPID_PUBLIC_KEY=BL...
VAPID_PRIVATE_KEY=Lk...
VAPID_CONTACT_EMAIL=tunombre@negociovivo.com
```

Sin estas variables, el botón muestra "Push no disponible" y los endpoints devuelven 503. Todo el resto de la plataforma sigue funcionando.
