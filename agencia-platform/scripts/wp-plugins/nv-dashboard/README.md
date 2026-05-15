# NV Dashboard · Plugin WordPress

Sistema editorial unificado para Negocio Vivo. Gestiona los calendarios mensuales de cada cliente y exporta a Metricool con un solo clic.

## ✨ Funcionalidades

- 📅 **Calendario mensual interactivo** (FullCalendar) con thumbnails y código de color por tipo
- 📝 **Custom Post Type** "Publicación" con todos los campos editoriales
- 👥 **Multi-cliente** vía taxonomía (Negocio Vivo, Capilar March, RSAdvocats, etc.)
- ✅ **Aprobación masiva con 1 clic** que genera CSV oficial Metricool
- 🔗 **Webhook Make** que envía email automático con el CSV listo para Metricool
- 📡 **REST API** completa para integraciones
- 🎨 **Paleta NV** dorado (#D2A039) + negro (#0A0A0A)

---

## 📋 REQUISITOS

- WordPress 6.0+
- PHP 7.4+
- Plugin **Advanced Custom Fields (ACF)** versión gratuita instalada y activado
- Acceso al admin de WordPress (rol Editor o superior)

---

## 🚀 INSTALACIÓN (5 minutos)

### Paso 1: Verificar/instalar ACF

1. En tu WordPress: **Plugins → Añadir nuevo**
2. Busca "**Advanced Custom Fields**"
3. Si no está instalado, instálalo y actívalo (versión gratuita es suficiente)

### Paso 2: Subir el plugin NV Dashboard

**Opción A — Desde el admin (recomendado)**:
1. Comprime la carpeta `nv-dashboard/` en un ZIP
2. En tu WordPress: **Plugins → Añadir nuevo → Subir plugin**
3. Selecciona el ZIP, instala y activa

**Opción B — Por FTP/cPanel**:
1. Sube la carpeta `nv-dashboard/` a `/wp-content/plugins/` vía FTP o File Manager de cPanel
2. En tu WordPress: **Plugins → Plugins instalados**
3. Busca "NV Dashboard" y haz clic en **Activar**

### Paso 3: Crear los clientes

1. En el menú izquierdo: **NV Dashboard → 👥 Clientes**
2. Añade cada cliente como un término:
   - Negocio Vivo (slug: `negocio-vivo`)
   - Clínica Capilar March (slug: `clinica-capilar-march`)
   - RSAdvocats (slug: `rsadvocats`)
   - Praxis zum Schloss (slug: `praxis-zum-schloss`)
   - Clínica March (slug: `clinica-march`)

### Paso 4: Crear las primeras publicaciones

1. **NV Dashboard → 📝 Publicaciones → Añadir publicación**
2. Rellena título + todos los campos:
   - **Fecha y hora de publicación**
   - **Tipo** (Reel / Imagen / Carrusel / Story)
   - **Redes sociales** (marca las que aplican)
   - **Copy** completo con emojis
   - **Hashtags**
   - **URL del asset principal** (Drive público con `?usp=sharing`)
   - **URLs assets extras** (solo carruseles)
   - **Cliente** (panel lateral derecho)
3. Guarda como Borrador hasta tener todo el mes
4. Cuando esté lista, marca **"Aprobar para Metricool"** y guarda

### Paso 5: Configurar webhook Make

1. **NV Dashboard → ⚙️ Configuración**
2. Pega la URL del webhook Make (ver sección abajo)
3. Configura nombre de marca Metricool por defecto
4. Configura email de notificaciones
5. Guarda

### Paso 6: Aprobar y enviar el mes

1. **NV Dashboard → 📅 Editorial**
2. Selecciona el cliente del dropdown superior
3. Verifica el calendario mensual (todas las publicaciones aprobadas tienen marca verde)
4. Click en **"✅ Aprobar mes y generar CSV"**
5. Recibirás un email de Make con el link al CSV
6. Sube el CSV a Metricool: **Planning → Calendar → 3 puntos → Import CSV**

---

## 🔧 CONFIGURAR ESCENARIO MAKE

### Estructura del escenario

```
[Webhooks - Custom webhook]
    ↓ recibe POST con datos del mes
[HTTP - Get a file]
    ↓ descarga el CSV de WordPress
[Google Drive - Upload a file]
    ↓ guarda en carpeta cliente
[Gmail - Send an email]
    ↓ notifica a David con link CSV
```

### Pasos en Make

1. **Crear nuevo escenario** en Make
2. **Módulo 1: Webhooks**
   - Tipo: Custom webhook
   - Crea webhook → copia URL
   - Pega esa URL en NV Dashboard → ⚙️ Configuración → Webhook Make
   
3. **Módulo 2: HTTP - Get a file**
   - URL: `{{1.csv_url}}` (del webhook)
   - Method: GET
   
4. **Módulo 3: Google Drive - Upload a file**
   - Folder ID: tu carpeta `Negocio Vivo / Calendarios`
   - File: data del módulo 2
   - Filename: `metricool-{{1.cliente}}-{{1.mes}}.csv`
   
5. **Módulo 4: Gmail - Send an email**
   - To: `tunegociovivo@gmail.com`
   - Subject: `📊 Calendario {{1.cliente_nombre}} {{1.mes}} listo para Metricool`
   - Body:
   ```
   Hola David,
   
   Tu calendario editorial está listo para Metricool.
   
   📊 RESUMEN:
   - Cliente: {{1.cliente_nombre}}
   - Mes: {{1.mes}}
   - Publicaciones: {{1.count}}
   
   📥 CSV listo para subir:
   {{3.web_view_link}}
   
   🚀 INSTRUCCIONES:
   1. Descarga el CSV
   2. Entra en metricool.com → Planning → Calendar
   3. Click los 3 puntos arriba derecha → "Importar CSV"
   4. Sube el archivo
   5. Selecciona formato fecha "YYYY-MM-DD" y hora "HH:MM:SS"
   6. Confirma → Metricool autopublicará todo
   
   ¡Buen mes! 🎯
   ```
   
6. **Activar escenario**

---

## 📡 REST API ENDPOINTS

### `GET /wp-json/nv/v1/publicaciones`

Lista publicaciones con filtros opcionales.

**Query params**:
- `cliente`: slug del cliente (ej. `negocio-vivo`)
- `estado`: borrador / revision / aprobado / programado / publicado
- `from`: fecha inicio (YYYY-MM-DD)
- `to`: fecha fin (YYYY-MM-DD)
- `aprobadas`: `true` para solo las aprobadas

**Auth**: requiere usuario logueado con `edit_posts`

**Response**:
```json
[
  {
    "id": 123,
    "titulo": "Post 01 - 3 errores Meta Ads",
    "cliente": "negocio-vivo",
    "cliente_nombre": "Negocio Vivo",
    "fecha": "2026-05-04 19:00:00",
    "tipo": "reel",
    "redes": ["instagram", "facebook"],
    "estado": "aprobado",
    "copy": "3 errores que están...",
    "hashtags": "#MarketingDigital #MetaAds",
    "first_comment": "",
    "asset_url": "https://drive.google.com/...",
    "assets_extras": [],
    "aprobado": true,
    "metricool_id": null,
    "edit_url": "https://negociovivo.com/wp-admin/post.php?..."
  }
]
```

### `POST /wp-json/nv/v1/aprobar-mes`

Aprueba todas las publicaciones del mes y genera CSV Metricool.

**Body**:
```json
{
  "cliente": "negocio-vivo",
  "mes": "2026-05"
}
```

**Response**:
```json
{
  "success": true,
  "count": 14,
  "csv_url": "https://negociovivo.com/wp-content/uploads/nv-dashboard/metricool-negocio-vivo-2026-05.csv",
  "mes": "2026-05",
  "cliente": "negocio-vivo",
  "webhook_disparado": true
}
```

### `POST /wp-json/nv/v1/marcar-programado`

(Para Make → WP) Marca una publicación como programada.

**Headers**: `X-NV-Secret: {secret}`

**Body**:
```json
{
  "post_id": 123,
  "metricool_id": "abc123"
}
```

---

## 🔒 SEGURIDAD

1. **Cambia el webhook secret** en `nv-dashboard.php` línea 18:
   ```php
   define('NV_DASHBOARD_WEBHOOK_SECRET', 'TU_SECRET_AQUI');
   ```

2. **Restringe acceso al admin** con plugins como Wordfence

3. **Backup automático** del CSV en Drive (lo hace Make)

---

## 🐛 TROUBLESHOOTING

### "ACF no detectado"
Instala el plugin Advanced Custom Fields (versión gratuita) desde Plugins → Añadir nuevo.

### "El calendario no se ve"
Verifica en consola del navegador si FullCalendar carga. Si bloqueas CDNs, descarga FullCalendar manualmente y cambia la URL en `nv-dashboard.php`.

### "El CSV no se genera"
Verifica permisos de escritura en `/wp-content/uploads/nv-dashboard/`. Debe ser 755 o 775.

### "Make no recibe el webhook"
- Verifica la URL del webhook en NV Dashboard → Configuración
- Comprueba en Make → History si hay intentos fallidos
- Asegúrate que el escenario Make está activado

### "Las imágenes no aparecen en Metricool"
Las URLs de Drive deben:
- Ser públicas (Cualquiera con el enlace - Editor)
- Terminar en `?usp=sharing`
- Apuntar directamente al archivo

---

## 🛠️ ESTRUCTURA DEL PLUGIN

```
nv-dashboard/
├── nv-dashboard.php                    Archivo principal (header WP)
├── README.md                           Esta guía
├── includes/
│   ├── class-cpt-publicacion.php       Custom Post Type "Publicación"
│   ├── class-acf-fields.php            Campos ACF programáticos
│   ├── class-admin-pages.php           Menú y páginas admin
│   ├── class-rest-api.php              Endpoints REST
│   └── class-csv-generator.php         Generador CSV Metricool
└── admin/
    ├── views/
    │   ├── overview.php                Vista general (stats)
    │   ├── editorial.php               Calendario mensual
    │   └── settings.php                Configuración
    ├── css/
    │   └── dashboard.css               Estilos paleta NV
    └── js/
        └── dashboard.js                FullCalendar + aprobación
```

---

## 📝 ROADMAP

### v1.0 (actual)
- ✅ CPT, ACF, calendario, CSV, REST API, webhook Make

### v1.1 (próximo)
- [ ] Importar plantilla de mes desde otro mes anterior
- [ ] Vista galería con thumbnails grandes
- [ ] Comentarios internos por publicación

### v1.2
- [ ] Tab "Campañas Meta" vía Railway API
- [ ] Tab "Reportes" cuando subas a Metricool Advanced
- [ ] Notificaciones WhatsApp Business

### v2.0
- [ ] Vista pública compartida con cliente para aprobar
- [ ] Multi-rol (cliente solo ve su calendario)
- [ ] AI suggester de copy con Claude API

---

## 📞 SOPORTE

Plugin desarrollado para Negocio Vivo · Marbella  
Contacto: tunegociovivo@gmail.com  
Versión: 1.0.0 · Abril 2026
