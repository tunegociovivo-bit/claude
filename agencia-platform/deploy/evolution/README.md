# Evolution API (WhatsApp con notas de voz, gratis)

WAHA Core no envía audio/medios sin licencia Plus. Evolution API sí, gratis.
Este stack levanta Evolution API v2 + Postgres + Redis en tu VPS.

## 1. Subir los ficheros al VPS

Copia esta carpeta (`deploy/evolution/`) al servidor, p.ej.:

```bash
scp -r deploy/evolution root@116.203.16.76:/opt/evolution
```

O créala a mano en `/opt/evolution` con el `docker-compose.yml` y el `.env`.

## 2. Configurar las claves

```bash
cd /opt/evolution
cp .env.example .env
nano .env
```

Genera valores seguros:

```bash
openssl rand -hex 24   # -> pégalo en EVOLUTION_API_KEY
openssl rand -hex 16   # -> pégalo en POSTGRES_PASSWORD
```

Y ajusta `SERVER_URL` a `http://116.203.16.76:8080` (o tu dominio).

## 3. Levantar

```bash
docker compose up -d
docker compose logs -f evolution-api   # comprobar que arranca sin errores
```

Comprobación rápida (debe responder JSON):

```bash
curl -s http://localhost:8080/ | head
```

## 4. Abrir el puerto en el firewall

```bash
ufw allow 8080/tcp        # si usas ufw
```

(Si hay otro firewall/proveedor cloud, abre el 8080 TCP entrante.)

> Recomendado para producción: poner Evolution detrás de HTTPS (Caddy/Nginx)
> con un subdominio, p.ej. `https://evolution.negociovivo.app`. Para empezar,
> `http://IP:8080` funciona.

## 5. Conectar desde el Hub

En `/admin/leads → Ajustes → WhatsApp`:

1. Proveedor: **Evolution API**.
2. **URL**: `http://116.203.16.76:8080` (lo de `SERVER_URL`).
3. **API key**: el valor de `EVOLUTION_API_KEY`.
4. **Instancia**: un nombre, p.ej. `sonia`.
5. **Guardar** → **Probar conexión** → **Reconectar** → escanea el **QR** con
   el teléfono de Sonia (WhatsApp → Dispositivos vinculados → Vincular).

El Hub crea la instancia automáticamente la primera vez que pulsas Reconectar.
Cuando quede en verde, Sonia enviará texto **y notas de voz** por Evolution.
