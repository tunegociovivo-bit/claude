# Runbook — WAHA / todos los números de WhatsApp caídos

Servidor: `negociovivo-wp` (Hetzner CPX22, 116.203.16.76, Nuremberg DC Park 1).
WAHA vive en `/opt/waha`: docker compose, imagen `devlikeapro/waha-plus:latest`,
motor NOWEB, sesiones persistidas en `/opt/waha/sessions`.

## Síntomas de este incidente

- Todos los números aparecen como Desconectado en Ajustes NV Leads Pro.
- El generador de QR se queda cargando para siempre.
- La sesión principal alterna STARTING y FAILED en bucle.
- El servidor y el contenedor están perfectamente vivos: `/ping` de WAHA
  responde al instante y la API contesta 401 rápido. Engaña mucho.

## Diagnóstico en 3 pasos

1. Estado de las sesiones, sin entrar al servidor, con la sesión del Hub
   abierta: `GET /api/v1/leads/channels-status`.
2. Si están todas caídas, entra al servidor y mira el log del contenedor:
   `docker logs --tail 50 waha`.
3. Busca el motivo del corte. Si aparece `Error: Connection Failure` lanzado
   dentro de `@adiwajshing/baileys` un segundo después del `connected to WA`,
   es el caso de abajo: WhatsApp está rechazando la versión de WAHA.

Descartes rápidos: si no hay `loggedOut` en el log no es baneo de los números;
si no hay `ECONNREFUSED` ni `ETIMEDOUT` no es red; y si la sesión `default`,
que va sin proxy propio, también falla, entonces no es cosa de DataImpulse.

## Arreglo (incidente del 2026-07-29)

Causa: la imagen de WAHA llevaba dos meses sin actualizar y WhatsApp cambió el
protocolo. Todas las sesiones morían en el handshake, así que ninguna llegaba a
SCAN_QR_CODE y por eso el generador de QR se quedaba colgado sin devolver nada.

En el servidor:

```sh
cd /opt/waha
tar czf sessions-antes-de-actualizar.tar.gz sessions
docker compose pull
docker compose up -d
```

Tarda menos de un minuto. Después, en Ajustes NV Leads Pro, pulsa Conectar en
cada número que no haya vuelto solo y escanea el QR con su móvil.

Aviso: la actualización puede invalidar credenciales de sesión. El 29/07/2026
dos números volvieron solos y cinco tuvieron que reescanear. De ahí el `tar`
previo, que permite volver atrás si la versión nueva sale peor.

## Prevención

- Actualizar WAHA cada dos o tres semanas en ventana consciente, con Sonia
  disponible por si toca reescanear. No dejar que la imagen envejezca meses.
- Antes de un pull futuro, etiquetar la imagen que se sabe buena:
  `docker tag <id> devlikeapro/waha-plus:ok-AAAAMMDD`.
- Vigilancia: el cron `/api/cron/leads-health` comprueba cada 10 min que la
  sesión principal responde WORKING y, si lleva más de 30 min caída, pausa la
  cola de envíos y avisa a los admins (panel, push y Telegram si está puesto).
  Lo dispara `.github/workflows/leads-health.yml`. Hasta el 29/07/2026 ese
  endpoint existía en la app pero nadie lo llamaba desde fuera, y por eso la
  caída pasó horas desapercibida.
- Pendiente de mejora: ese health-check solo mira la sesión principal. Si el
  principal está bien pero los demás números están caídos, no avisa.
- Cada número debe salir por su propia IP fija (DataImpulse en modo pegajoso,
  puertos 10000 y siguientes). El proxy global usa el 10007. El puerto 823 es
  rotatorio y cambia de IP en cada petición: no sirve para WhatsApp.

## Salida de emergencia

Si NOWEB se rompe y todavía no hay imagen nueva publicada, se puede cambiar
`WHATSAPP_DEFAULT_ENGINE` a WEBJS en `/opt/waha/docker-compose.yml`. Consume
mucho más porque levanta Chromium y obliga a reescanear todos los números,
pero permite seguir enviando mientras tanto.

## Nota de acceso

La consola VNC de Hetzner no envía los símbolos que necesitan mayúscula, así
que ahí no se pueden escribir tuberías, redirecciones ni dos puntos y depurar
se vuelve muy lento. Merece la pena habilitar SSH por Tailscale: ya hay un
contenedor de Tailscale corriendo en la máquina.
