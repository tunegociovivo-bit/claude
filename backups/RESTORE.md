# Restauración del Hub (recuperación al 100%)

Este repositorio incluye `.github/workflows/backup-completo.yml`, que cada día:

- **Base de datos**: `pg_dump` completo de PostgreSQL (las 110 tablas, esquema +
  datos) → guardado en Backblaze B2 con rotación (`db/daily`, `db/weekly`,
  `db/monthly`).
- **Adjuntos**: réplica de todo el bucket R2 → B2 en `files/current`, con los
  ficheros borrados/sobrescritos archivados en `files/archive/<fecha>`.

Una restauración completa son 4 piezas. Estas son las instrucciones.

---

## 0. Requisitos

```bash
# pg 17 + rclone
sudo apt-get install -y postgresql-client-17
curl -fsSL https://rclone.org/install.sh | sudo bash
```

Configura rclone con un remoto `b2:` (S3-compatible) usando las mismas
credenciales que los secrets `B2_*` del workflow.

---

## 1. Código

El código vive en este repositorio Git (rama del Hub). Para recuperarlo:

```bash
git clone <repo>
git checkout <rama-del-hub>
npm install
```

---

## 2. Base de datos (pg_restore)

```bash
# Descarga el último volcado
rclone lsf b2:<BUCKET>/db/daily/        # ver disponibles
rclone copy b2:<BUCKET>/db/daily/agencia-db-AAAA-MM-DD_HHMM.dump .

# Restaura sobre una BD nueva y vacía (recomendado)
createdb agencia_restore
pg_restore --no-owner --no-privileges --clean --if-exists \
  -d "postgresql://USER:PASS@HOST:PORT/agencia_restore" \
  agencia-db-AAAA-MM-DD_HHMM.dump
```

> `--clean --if-exists` permite restaurar también sobre una BD existente
> (borra y recrea objetos). Para producción, restaura primero en una BD de
> prueba y verifica antes de apuntar el Hub.

Apunta `DATABASE_URL` del Hub a la base restaurada.

---

## 3. Adjuntos (binarios)

Devuelve los ficheros al bucket R2 de producción (o a uno nuevo):

```bash
rclone sync b2:<BUCKET>/files/current r2:<R2_BUCKET>
```

Las claves S3 (`s3Key`) en la tabla `File` de la BD apuntan a estas mismas
rutas, así que tras restaurar BD + ficheros los adjuntos vuelven a resolver.

Para recuperar un fichero borrado por error, búscalo en
`b2:<BUCKET>/files/archive/<fecha>/`.

---

## 4. Secretos / variables de entorno

**No** se guardan en ningún backup (por seguridad). Mantén una copia en un
gestor de contraseñas. Como mínimo el Hub necesita:

- `DATABASE_URL`
- `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY_ID`,
  `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_BUCKET`, `STORAGE_PUBLIC_URL`
- `NEXTAUTH_SECRET`, `INTERNAL_CRON_TOKEN`
- Claves de integraciones (OpenAI, Google, Meta, Asana, ElevenLabs…)

---

## Secrets que debe tener el repositorio (Settings → Secrets → Actions)

| Secret | Qué es |
|---|---|
| `DATABASE_URL` | Cadena de conexión PostgreSQL (URL pública de Railway) |
| `R2_ENDPOINT` | Endpoint S3 de Cloudflare R2 (`https://<acc>.r2.cloudflarestorage.com`) |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Credenciales R2 (las `STORAGE_*` del Hub) |
| `R2_BUCKET` | Nombre del bucket R2 de producción |
| `B2_ENDPOINT` | Endpoint S3 de Backblaze (`https://s3.<region>.backblazeb2.com`) |
| `B2_ACCESS_KEY_ID` / `B2_SECRET_ACCESS_KEY` | keyID y applicationKey de B2 |
| `B2_BUCKET` | Bucket de destino en B2 |

## Activar el backup automático

Los workflows `schedule` solo se ejecutan desde la **rama por defecto** del
repo. Para que el backup diario corra solo, este archivo debe estar en esa rama.
Mientras tanto, lánzalo a mano en **Actions → Backup completo → Run workflow**.
