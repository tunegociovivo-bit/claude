# Storage de adjuntos — Cloudflare R2

La plataforma usa un cliente S3-compatible para subir adjuntos (fotos,
documentos, audios, etc.) en tareas, documentos, clientes y proyectos.
Sin las variables de entorno configuradas, los uploads muestran un aviso
amarillo y el resto de la app sigue funcionando.

## Por qué Cloudflare R2

- **10 GB gratis** y **0 € de egress fees** (S3 te cobra cada descarga).
- API S3-compatible (usamos `@aws-sdk/client-s3`, mismo código vale para AWS S3 o MinIO).
- Sin coste hasta que el negocio crezca; predecible después.

Si prefieres AWS S3 o MinIO, las mismas variables sirven cambiando el endpoint.

## Setup en Cloudflare R2 (10 minutos)

### 1. Crear el bucket

1. https://dash.cloudflare.com → crea cuenta gratis si no tienes.
2. Menú lateral → **R2 Object Storage** → **Activar R2** (te pide tarjeta para verificar, pero hasta 10 GB no se cobra).
3. **Create bucket** → nombre: `agencia-hub-files` (o el que prefieras) → región: **EEUR (Western Europe)** o **WEUR**.

### 2. Generar credenciales API

1. R2 → **Manage R2 API Tokens** (botón arriba a la derecha)
2. **Create API Token** → nombre `agencia-hub` → permisos **Object Read & Write** → bucket: el que creaste → TTL: forever
3. Copia los 3 valores: **Access Key ID**, **Secret Access Key**, **Account ID** (sale en la URL del dashboard o en el panel)

### 3. (Opcional pero recomendado) Dominio público

Para que las URLs de descarga no expiren y sean cacheadas por Cloudflare:

1. En tu bucket → **Settings** → **Public Access**
2. **Custom Domain** → `cdn.negociovivo.app` (subdominio dedicado para archivos)
3. Cloudflare te indica el CNAME para añadir en Dondominio: añádelo
4. Espera ~5 min a la propagación

### 4. Configurar variables en Railway

Railway → servicio `claude` → **Variables** → añade:

| Variable | Valor |
|---|---|
| `STORAGE_ENDPOINT` | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` |
| `STORAGE_REGION` | `auto` |
| `STORAGE_ACCESS_KEY_ID` | (del paso 2) |
| `STORAGE_SECRET_ACCESS_KEY` | (del paso 2) |
| `STORAGE_BUCKET` | `agencia-hub-files` (el nombre que pusiste) |
| `STORAGE_PUBLIC_URL` | `https://cdn.negociovivo.app` _(opcional, solo si hiciste el paso 3)_ |

Railway redeploya solo al detectar el cambio. Ya puedes adjuntar archivos.

## Cómo funciona el flujo de subida

1. El cliente pide a `/api/v1/files/upload-url` una URL firmada (POST con `{filename, contentType, sizeBytes, targetType, targetId}`).
2. El servidor genera la URL firmada de R2 (válida 5 min) y devuelve `{uploadUrl, s3Key}`.
3. El cliente hace `PUT` directo a esa URL con el binario. **El archivo no pasa por Railway** → no consume ancho de banda del app server.
4. Cuando termina, el cliente llama a `POST /api/v1/files` con la metadata (`{name, mimeType, sizeBytes, s3Key, targetType, targetId}`) para registrar el File en la BD.
5. Cualquier listado posterior (`GET /api/v1/files?targetType=TASK&targetId=…`) devuelve los archivos con `url` firmada (1h) o pública (si `STORAGE_PUBLIC_URL` está definido).

## Borrado

`DELETE /api/v1/files/[id]` elimina el objeto de R2 y la fila en la BD.
Solo lo permite quien lo subió o un admin del workspace.

## Límite y costes

- Tope por archivo: **50 MB** (configurable en `lib/storage/r2.ts`).
- Total: 10 GB gratis en R2. Llegando a esa cifra, el coste es **$0.015 / GB-mes** sin egress.
- Si haces 500 GB de subida o 1M de descargas mensuales, sigues por debajo de $1/mes.

## CORS

R2 acepta uploads desde tu dominio sin configuración adicional si los uploads usan URLs firmadas con `PUT`. Si ves errores CORS al subir, añade esta regla al bucket:

```json
[{
  "AllowedOrigins": ["https://hub.negociovivo.app"],
  "AllowedMethods": ["PUT", "GET"],
  "AllowedHeaders": ["*"],
  "ExposeHeaders": ["ETag"]
}]
```

Se añade desde R2 → tu bucket → **Settings** → **CORS Policy**.
