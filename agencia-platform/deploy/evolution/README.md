# Evolution API (WhatsApp con notas de voz, gratis)

WAHA Core no envía audio/medios sin licencia Plus. Evolution API sí, gratis.
Este stack levanta Evolution API v2 + Postgres + Redis en tu VPS.

## ⚡ Camino recomendado (un solo comando)

En el VPS, con la carpeta copiada en `/opt/evolution`:

```bash
cd /opt/evolution

# Opción recomendada: HTTPS con subdominio (antes crea el DNS A y abre 80/443)
ufw allow 80/tcp && ufw allow 443/tcp
./install.sh evolution.negociovivo.app

# — o — opción rápida sin dominio (HTTP en el puerto 8080)
ufw allow 8080/tcp
./install.sh
```

El instalador genera las claves solo, levanta los contenedores y al final
imprime la **URL** y la **API key** que debes pegar en el Hub. Si prefieres
hacerlo a mano, sigue los pasos detallados de abajo.

---

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

## 4-bis. (Recomendado) HTTPS con subdominio y Caddy

En vez de exponer `http://IP:8080`, puedes servir Evolution en
`https://evolution.negociovivo.app` con certificado automático.

1. Crea un registro **DNS A**: `evolution.negociovivo.app → 116.203.16.76`.
2. En `.env` rellena `EVOLUTION_DOMAIN=evolution.negociovivo.app`.
3. Abre los puertos **80 y 443** (no hace falta el 8080):
   ```bash
   ufw allow 80/tcp && ufw allow 443/tcp
   ```
4. Levanta con el compose HTTPS:
   ```bash
   docker compose -f docker-compose.https.yml up -d
   docker compose -f docker-compose.https.yml logs -f caddy   # ver emisión del cert
   ```
5. Comprueba: `curl -s https://evolution.negociovivo.app/ | head`

En el Hub usa la **URL `https://evolution.negociovivo.app`** (sin `:8080`).

> Si arrancaste antes la versión sin HTTPS, párala primero:
> `docker compose down` (no borra datos) y luego usa el compose HTTPS.

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
