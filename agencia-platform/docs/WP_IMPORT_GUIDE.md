# Importar todo desde el WordPress de hub.negociovivo.com

Mueve automáticamente API keys, clientes, negocios y datos de los 4 plugins NV
desde tu WordPress (`hub.negociovivo.com`) a esta plataforma (`hub.negociovivo.app`),
sin tocar nada manualmente.

## Paso a paso (10 minutos)

### 1. Instala el plugin de exportación en WordPress

Es un plugin **temporal** que solo expone tus datos de los plugins NV a Hub.
Cuando termines la migración, lo desactivas y borras.

1. Entra en https://hub.negociovivo.app/admin/wp-import (siendo admin del workspace).
2. Pulsa el enlace **"agencia-exporter.zip"** → descarga el ZIP.
3. Ve a https://hub.negociovivo.com/wp-admin → **Plugins** → **Añadir nuevo** → **Subir plugin**.
4. Selecciona el ZIP → **Instalar ahora** → **Activar plugin**.

### 2. Genera una Application Password para el importador

1. https://hub.negociovivo.com/wp-admin → **Tu perfil** (esquina superior derecha).
2. Baja a **Application Passwords**.
3. Escribe nombre: `agencia-hub-import` → **Add New Application Password**.
4. WP te muestra una contraseña con formato `xxxx xxxx xxxx xxxx xxxx xxxx`. **Cópiala** (es la última vez que la verás).

### 3. Conecta y verifica

Vuelve a https://hub.negociovivo.app/admin/wp-import y rellena:
- **URL WordPress**: `https://hub.negociovivo.com`
- **Usuario admin de WP**: tu nombre de usuario admin (lo que pones para entrar a wp-admin)
- **Application Password**: lo que copiaste en el paso 2

Pulsa **Verificar conexión**. Debe salir un cuadro verde mostrando qué plugins ha detectado.

### 4. Importa

1. Marca las plataformas que quieras traer (todas por defecto).
2. Pulsa **Importar todo**.
3. ~30 segundos después verás el reporte:
   - **API keys cifradas guardadas**: 3-6 (OpenAI, Anthropic, Google Places, Evolution, Metricool…)
   - **Clientes de Reseñas IA importados**: el número que tenías en WP
   - **Negocios de Voice Reviews importados**: idem
   - **Publicaciones NV Dashboard (en cola)**: aparcadas en `workspace.settings` cifradas, listas para cuando migremos el schema completo del NV Dashboard
   - **Filas NV Leads (en cola)**: igual

### 5. Verifica que llegó todo

- https://hub.negociovivo.app/admin/reviews → deberías ver tus clientes.
- https://hub.negociovivo.app/admin/voice-reviews → tus negocios.
- https://hub.negociovivo.app/admin/ai → API key de Anthropic configurada.
- En `/admin/reviews` botón **"OpenAI configurada"** debe estar en verde.

### 6. Limpieza en WordPress

- **Desactiva** y **borra** el plugin "Agencia Hub Exporter" en wp-admin → Plugins.
- **Revoca** la Application Password en wp-admin → Tu perfil → Application Passwords → Revocar.

¡Ya está! No vas a tener que volver a configurar ninguna API key.

---

## Qué se importa

| Plugin WP | Qué viene | Dónde aparece |
|---|---|---|
| Generador Reseñas IA | OpenAI key + lista de clientes + histórico | `/admin/reviews` |
| Voice Reviews | OpenAI key + Anthropic key + lista de negocios + intro/disclaimer/URLs | `/admin/voice-reviews` |
| NV Dashboard | Anthropic + OpenAI + Metricool token + Drive refs + publicaciones | Keys activas en `/admin/ai` y `/admin/reviews`. Publicaciones aparcadas hasta migración del módulo |
| NV Leads Pro | Google Places + Evolution API URL+key + 11 tablas | Keys cifradas en workspace. Datos aparcados hasta migración del módulo |

## Si algo falla

- **"WP devolvió 403"**: el plugin no está activo en WP o el usuario WP no es admin.
- **"WP devolvió 401"**: la Application Password está mal copiada (debe llevar los espacios entre bloques tal cual).
- **"WP devolvió 404"**: la URL está mal o falta el plugin.
- **Otro error**: copia el mensaje y compártemelo.

## Re-importar

Si re-importas, los clientes y negocios se hacen **upsert por slug** — no se duplican y se actualizan con los datos más recientes de WP. El historial solo se importa si el destino está vacío para ese cliente.

## Para los datos "en cola" (NV Dashboard / NV Leads)

Cuando llegue el PR que migra esos plugins por completo (un módulo Editorial en
Hub para NV Dashboard, un módulo Leads para NV Leads Pro), un script de
post-migración procesará los datos aparcados en `workspace.settings.pendingImport.*`.
Hasta entonces, los datos están a salvo cifrados pero no visibles en la UI.
