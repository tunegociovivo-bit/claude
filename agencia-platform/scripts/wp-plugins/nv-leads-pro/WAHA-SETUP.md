# WAHA — guía de despliegue (un solo comando)

WAHA es la API de WhatsApp que el plugin usa para enviar mensajes automatizados. Es estable, tiene panel web con QR garantizado, y se instala en menos de 5 minutos.

## Paso 1 — Conecta por SSH a tu VPS

Desde PowerShell en Windows:

```powershell
ssh root@TU-IP-DEL-VPS
```

## Paso 2 — Ejecuta este único bloque

Copia y pega todo el bloque de una vez. Tarda 2-3 minutos en bajar la imagen y arrancar:

```bash
# Si tenías Evolution antes, lo paramos
cd /opt/evolution 2>/dev/null && docker compose down -v 2>/dev/null; true
cd /opt && mkdir -p waha && cd waha

# Generar una API key aleatoria (apúntala al final)
WAHA_KEY=$(openssl rand -hex 24)
echo "$WAHA_KEY" > /opt/waha/API_KEY.txt

# URL del webhook donde el plugin recibirá las respuestas. Sustituye TU-DOMINIO-WP por tu sitio (sin barra final).
# Si tu WordPress está en https://hub.negociovivo.com:
WP_URL="https://hub.negociovivo.com"
WEBHOOK_TOKEN_HINT="MIRA-EN-NV-LEADS-AJUSTES-WEBHOOK"

# docker-compose con persistencia
cat > docker-compose.yml << EOF
services:
  waha:
    image: devlikeapro/waha:latest
    container_name: waha
    restart: always
    ports:
      - "3000:3000"
    environment:
      - WHATSAPP_API_KEY=$WAHA_KEY
      - WHATSAPP_DEFAULT_ENGINE=WEBJS
      - WAHA_PRINT_QR=false
      - WHATSAPP_SWAGGER_USERNAME=admin
      - WHATSAPP_SWAGGER_PASSWORD=$WAHA_KEY
      - WHATSAPP_RESTART_ALL_SESSIONS=true
      - WHATSAPP_START_SESSION=default
    volumes:
      - /opt/waha/sessions:/app/.sessions
      - /opt/waha/files:/app/.media
EOF

docker compose up -d
echo "Esperando 30s a que WAHA arranque..."
sleep 30

echo ""
echo "===== ESTADO ====="
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep waha
echo ""
echo "===== HTTP TEST ====="
curl -s -o /dev/null -w "HTTP %{http_code}\n" "http://localhost:3000/api/sessions" -H "X-Api-Key: $WAHA_KEY"
echo ""
echo "===== URL DEL DASHBOARD ====="
echo "  http://$(hostname -I | awk '{print $1}'):3000/dashboard"
echo ""
echo "===== TU API KEY (apuntala) ====="
echo "  $WAHA_KEY"
```

Verás al final:

- `STATUS`: `waha   Up X seconds   0.0.0.0:3000->3000/tcp`
- `HTTP 200` o `401` (cualquiera de los dos significa que WAHA responde).
- La URL del dashboard.
- La API key. **Apúntala**.

## Paso 3 — Abre el dashboard y vincula tu WhatsApp

1. Abre en el navegador: `http://TU-IP:3000/dashboard`
2. Si te pide autenticación: usuario `admin`, contraseña la misma API key.
3. Verás la sesión `default` con estado **SCAN_QR_CODE** y el QR en pantalla.
4. En tu móvil: WhatsApp → menú ⋮ → **Dispositivos vinculados** → **Vincular un dispositivo** → escanea.
5. Estado pasa a **WORKING**. Tu número está controlado por WAHA.

## Paso 4 — Conecta el plugin

En WordPress → **NV Leads → Ajustes → 📱 WhatsApp API (WAHA)**:

- **URL base de WAHA**: `http://TU-IP:3000` (sin barra final)
- **API key**: la del paso 2
- **Nombre de la sesión**: `default`

Pulsa **Guardar todos los ajustes**, recarga la página, y pulsa **Probar conexión WAHA**. Debe responder con `status: WORKING`.

## Paso 5 — Configura el webhook

En **NV Leads → Ajustes → 📨 Webhook**:

1. Copia la URL del webhook que aparece.
2. Pulsa **Configurar webhook automáticamente en WAHA**.

A partir de ahora, cuando alguien responda a un mensaje, llegará a la pestaña **NV Leads → Bandeja**.

## Paso 6 — Test final

1. Desde otro número, envía un WhatsApp al número que vinculaste con texto "test".
2. En WordPress → **NV Leads → Bandeja**, en 5-10 segundos verás el mensaje recibido y clasificado por la IA.

Listo. Ya puedes lanzar búsquedas y enrolar leads en secuencias automatizadas.

## Solución de problemas

**El dashboard no carga** → el puerto 3000 puede estar bloqueado por el firewall de Hetzner Cloud. Ve a https://console.hetzner.cloud → tu servidor → Firewalls → asegúrate de que TCP 3000 está abierto desde `0.0.0.0/0`.

**El QR no aparece en el dashboard** → recarga la página. Si sigue sin aparecer: `docker logs waha --tail 30` desde SSH para ver el error real.

**"Failed to send" al probar conexión desde el plugin** → comprueba que la URL no acaba en `/` y que la API key no tiene espacios al final.

**Quiero parar WAHA y volver a Evolution** → no recomendado, pero los datos de Evolution están en `/opt/evolution/docker-compose.yml.bak`. Levanta con `docker compose up -d` desde ahí.
