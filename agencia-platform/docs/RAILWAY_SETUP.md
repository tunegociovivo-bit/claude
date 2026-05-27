# Configuración de Railway

Pasos a hacer en Railway tras los cambios recientes (editorial completo,
leads completo, error reporter, PWA, imágenes con IA).

## 1. Pre-Deploy Command

`Settings → Deploy → Pre-Deploy Command`:

```
npm run db:bootstrap
```

Esto ejecuta `prisma db push --accept-data-loss --skip-generate` y crea
las tablas nuevas (`ErrorReport`, `LeadMessage`, `ClientApprovalLink`,
`ClientApprovalDecision`) y columnas nuevas (`Lead` con 25+ campos,
`Client.brand*` editoriales, `EditorialPost.copyByNetwork` etc.).

## 2. Variables de entorno

### Existentes (verificar)

```
DATABASE_URL
NEXTAUTH_URL              = https://hub.negociovivo.app
NEXTAUTH_SECRET           (string aleatorio, no rotar — encripta otras keys)
```

### IA

```
ANTHROPIC_API_KEY         sk-ant-…   (también configurable en /admin/ai)
OPENAI_API_KEY            sk-…       (opcional, para gpt-image-1 / Whisper)
```

### Storage R2 (necesario para generar imágenes IA)

```
STORAGE_ENDPOINT          https://<account_id>.r2.cloudflarestorage.com
STORAGE_REGION            auto
STORAGE_ACCESS_KEY_ID     ...
STORAGE_SECRET_ACCESS_KEY ...
STORAGE_BUCKET            agencia-hub
STORAGE_PUBLIC_URL        https://cdn.tudominio.com    (opcional)
```

### Leads Pro

```
INTERNAL_CRON_TOKEN       string aleatorio ≥32 chars
```

Las API keys de Google Places y WAHA se configuran en
`/admin/leads → Ajustes` (cifradas en BD).

### Error report automático

```
GITHUB_TOKEN_FOR_ERRORS   github_pat_…  (fine-grained PAT con Issues:write)
GITHUB_REPO_FOR_ERRORS    tunegociovivo-bit/claude
CLAUDE_CODE_SESSION_URL   https://claude.ai/code/session_…  (opcional)
```

Sin estas vars, los errores se capturan en `/admin/errors` y se muestran
toasts; sólo no se abre issue auto en GitHub.

### Push notifications (existente)

```
VAPID_PUBLIC_KEY          generadas con `npx web-push generate-vapid-keys`
VAPID_PRIVATE_KEY
NEXT_PUBLIC_VAPID_PUBLIC_KEY   (= VAPID_PUBLIC_KEY)
```

## 3. Cron para leads (cada minuto)

Cron de GitHub Actions: `.github/workflows/leads-cron.yml`

```yaml
name: Leads cron
on:
  schedule:
    - cron: "* * * * *"
  workflow_dispatch:
jobs:
  tick:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -fsSL -X POST \
            -H "Authorization: Bearer ${{ secrets.INTERNAL_CRON_TOKEN }}" \
            https://hub.negociovivo.app/api/v1/internal/leads-cron
```

En el repo de GitHub → Settings → Secrets and variables → Actions:
- `INTERNAL_CRON_TOKEN` = mismo valor que en Railway.

## 4. Reglas WAHA webhook

Configurar en la instancia WAHA:

- Event: `message`
- URL: `https://hub.negociovivo.app/api/v1/leads/webhook/<webhookToken>`

El `webhookToken` se ve en `/admin/leads → Ajustes`.

## 5. Subir agencia-exporter.php nuevo

El exporter incluye ahora `cliente_meta` (config editorial completa).
Copiar `scripts/wp-exporter/agencia-exporter.php` al WordPress origen
y volver a darle "Importar desde WordPress" en `/admin/wp-import`.

## 6. Smoke tests post-deploy

1. Login en /login
2. /admin → ver todas las tarjetas
3. /admin/editorial → "Generar mes con IA" con un cliente
4. /admin/leads → crear búsqueda dummy y darle "Procesar batch"
5. /admin/errors → verificar que carga (debería estar vacía)
6. Hacer algo que falle a propósito (ej. usar la app sin saldo Anthropic) →
   verificar que aparece toast + entrada en /admin/errors
