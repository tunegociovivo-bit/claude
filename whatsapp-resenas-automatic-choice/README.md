# WhatsApp Reseñas — Automatic Choice

Sistema para pedir reseñas a clientes vía WhatsApp con filtro inteligente:

- El cliente recibe un WhatsApp con un enlace personalizado.
- Al abrirlo ve **5 estrellas** (logo y nombre de Automatic Choice).
- Si pulsa **4 o 5 estrellas** → se le redirige a la **ficha de Google My Business** para que deje la reseña pública.
- Si pulsa **1, 2 o 3 estrellas** → se le lleva a un **formulario de queja** que se envía por email a la empresa, sin pasar por Google.

Así se filtran las reseñas negativas y se canalizan internamente para resolverlas.

---

## Estructura

```
whatsapp-resenas-automatic-choice/
├── .env.example          → Plantilla de configuración
├── enviar_whatsapp.php   → Script CLI para envío masivo
├── data/clientes.csv     → Lista de clientes (id, nombre, telefono)
├── public/
│   ├── index.php         → Landing con 5 estrellas
│   ├── queja.php         → Formulario para 1-3 estrellas
│   └── .htaccess
├── src/
│   ├── config.php        → Lector de .env
│   ├── token.php         → Firma HMAC de enlaces
│   ├── whatsapp.php      → Cliente WhatsApp Cloud API
│   └── mailer.php        → SMTP nativo
└── logs/                 → Logs de envíos, clicks y quejas
```

---

## Requisitos previos

1. **WhatsApp Business Cloud API** (Meta):
   - Cuenta de Meta Business y app con producto "WhatsApp".
   - Un número de WhatsApp Business verificado.
   - Token permanente y `PHONE_NUMBER_ID`.
   - **Plantilla aprobada** por Meta (los mensajes "fríos" requieren plantilla, no se permite texto libre).
2. **Hosting PHP 8.1+** con `curl` y `openssl` (compatible con el hosting actual de automaticchoice.es).
3. **Cuenta SMTP** para que el formulario de queja envíe email a la empresa.
4. **Place ID de Google** del local de Automatic Choice (para generar `GMB_REVIEW_URL`).

---

## Instalación

```bash
cp .env.example .env
# Editar .env con tus claves
chmod 600 .env
chmod 770 logs/
```

Sube **todo el repo** al servidor, pero **publica solo la carpeta `public/`** como `DocumentRoot` (o subdominio).
Si no puedes cambiar el `DocumentRoot`, mueve `public/index.php` y `public/queja.php` a la raíz pública y ajusta los `require_once` (cambiar `../src/` por `./src/`).

Sugerencia: usa un subdominio dedicado, por ejemplo `https://resenas.automaticchoice.es`.

---

## Plantilla de WhatsApp (Meta)

Crea en Business Manager una plantilla de marketing con:

- **Nombre:** `solicitud_resena`
- **Idioma:** `es`
- **Cuerpo (con variable):**
  ```
  Hola {{1}} 👋, gracias por confiar en Automatic Choice.
  ¿Te ha gustado nuestro servicio? Tu opinión nos ayuda mucho a mejorar.
  Puntúa tu experiencia con un solo clic.
  ```
- **Botón URL dinámico** apuntando a:
  ```
  https://resenas.automaticchoice.es/?t={{1}}
  ```
  (el `{{1}}` del botón es el token firmado que genera el script).

> Importante: en `WHATSAPP_TEMPLATE_NAME` del `.env` debe ir exactamente el nombre que pusiste en Meta.

---

## Cómo obtener el `GMB_REVIEW_URL`

Opción rápida:
1. En Google Maps busca "Automatic Choice".
2. Pulsa "Compartir" → "Insertar mapa", o usa la utilidad https://placeid.gmbapi.com/.
3. Construye la URL:
   ```
   https://search.google.com/local/writereview?placeid=TU_PLACE_ID
   ```

---

## Uso

### 1. Preparar lista de clientes

Edita `data/clientes.csv`:

```csv
id,nombre,telefono
1001,Juan Pérez,34666112233
1002,María López,34655998877
```

- `id`: cualquier identificador interno (no se muestra al cliente).
- `telefono`: formato internacional, sin `+` ni espacios.

### 2. Enviar mensajes

```bash
php enviar_whatsapp.php data/clientes.csv
```

Verás un resumen por consola y un log en `logs/envios.log`.

### 3. Programar envíos periódicos (opcional)

Cron en el servidor — por ejemplo, todos los lunes a las 10:00:

```cron
0 10 * * 1 cd /var/www/whatsapp-resenas-automatic-choice && /usr/bin/php enviar_whatsapp.php data/clientes_semana.csv >> logs/cron.log 2>&1
```

---

## Flujo completo

1. Script CLI genera para cada cliente un token firmado HMAC con `id` y `nombre`.
2. Envía la plantilla aprobada con ese token como sufijo de URL del botón.
3. El cliente pulsa → llega a `index.php` → ve 5 estrellas con su nombre.
4. Al hacer clic en una estrella:
   - `?s=4` o `?s=5` → `Location:` a `GMB_REVIEW_URL`.
   - `?s=1`, `?s=2`, `?s=3` → `queja.php` (formulario).
5. Al enviar el formulario, `mailer.php` lo manda por SMTP a `MAIL_TO`.
6. Todo queda registrado en `logs/clicks.log`, `logs/quejas.log` y `logs/envios.log`.

---

## Seguridad

- Los enlaces van firmados con `HMAC-SHA256` (`SECRET_KEY`): un cliente no puede cambiar el `id` o el nombre.
- Honeypot anti-bots en el formulario.
- `.env` no se publica y está protegido por `.htaccess`.
- Recomendado HTTPS (Let's Encrypt) en el subdominio.

---

## Cumplimiento

Antes de enviar, asegúrate de:
- Tener consentimiento RGPD del cliente para contacto comercial por WhatsApp.
- Que las plantillas de Meta estén aprobadas (sin esto los mensajes son rechazados).
- Que la práctica de "filtrar" reseñas no viole las políticas de Google. Esta herramienta no impide al cliente dejar una reseña negativa si así lo desea; simplemente le ofrece primero un canal directo con la empresa.
