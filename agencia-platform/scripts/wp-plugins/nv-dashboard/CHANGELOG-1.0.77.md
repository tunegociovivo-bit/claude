# NV Dashboard 1.0.77 — PWA "Add to Home Screen" para móvil

## El objetivo

David quería poder añadir `hub.negociovivo.com/wp-admin/` a la pantalla
de inicio de su móvil como si fuera una app nativa. Al tocar el icono:

1. El sitio debe abrirse en modo **standalone** (sin barra del navegador,
   fullscreen), igual que una app instalada.
2. Debe aterrizar directo en el NV Dashboard, no en el escritorio
   genérico de WP.
3. El icono debe tener identidad NV (negro + dorado).

## Lo que añade v1.0.77

### Nueva clase `includes/class-pwa.php` (`NV_PWA`)

Implementa una PWA mínima pero completa:

**1. Endpoint REST `GET /wp-json/nv/v1/pwa-manifest.json`**

Sirve un Web App Manifest dinámico (`Content-Type: application/manifest+json`)
con todos los campos que Chrome/Safari necesitan para considerar el sitio
"installable":

```json
{
  "name": "NV Dashboard",
  "short_name": "NV",
  "start_url": "https://hub.negociovivo.com/wp-admin/admin.php?page=nv-dashboard",
  "scope": "https://hub.negociovivo.com/",
  "display": "standalone",
  "orientation": "portrait",
  "theme_color": "#0A0A0C",
  "background_color": "#0A0A0C",
  "lang": "es-ES",
  "icons": [
    { "src": ".../icon-192.png",  "sizes": "192x192", "purpose": "any" },
    { "src": ".../icon-512.png",  "sizes": "512x512", "purpose": "any" },
    { "src": ".../icon-512-maskable.png", "sizes": "512x512", "purpose": "maskable" }
  ]
}
```

Es público por diseño (`permission_callback => '__return_true'`) — el
navegador lo fetchea cross-origin antes de pedir el "Install".

**2. Meta tags en `<head>` (Safari iOS + Chrome Android)**

Inyectados en `wp_head`, `admin_head` y `login_head` con prioridad 5:

```html
<link rel="manifest" href=".../pwa-manifest.json">
<link rel="apple-touch-icon" sizes="180x180" href=".../apple-touch-icon-180.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="NV">
<meta name="mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#0A0A0C">
```

**3. Estrategia de icono: prefiere Site Icon de WP, fallback NV**

- Si está configurado un Site Icon en Apariencia → Personalizar →
  Identidad del sitio, WordPress genera automáticamente todos los
  tamaños necesarios (180, 192, 270, 512) y la clase los usa.
- Si NO hay Site Icon, fallback a los iconos NV embebidos en
  `assets/pwa/`: fondo negro `#0A0A0C`, monograma "NV" en dorado
  `#D2A039`, esquinas redondeadas. Generados en 4 variantes:
  - `apple-touch-icon-180.png` (iOS nativo)
  - `icon-192.png` (Android estándar)
  - `icon-512.png` (splash screen + alta densidad)
  - `icon-512-maskable.png` (Android adaptive icons con safe zone)

**4. Estrategia de `start_url`: aprovecha v1.0.76**

Cadena de fallbacks ordenada:
1. Override explícito `nv_dashboard_pwa_start_url` si lo configuró.
2. `login_redirect_url` de v1.0.76 (suele ser `admin.php?page=nv-dashboard`).
3. `/wp-admin/` (WP gestiona login si no hay sesión, y con v1.0.76
   redirige al dashboard tras autenticarse).

Resultado: el tap en el icono del móvil → login con Google si hace
falta → NV Dashboard. Sin escalas.

**5. Sin Service Worker — decisión consciente**

Chrome y Safari aceptan "Add to Home Screen" sin Service Worker desde
2022, siempre que el manifest sea válido y los iconos estén bien
servidos. No incluyo SW porque:
- Un SW mal configurado puede cachear versiones obsoletas del admin
  y romper cosas (POST, nonces, capabilities).
- Para `wp-admin` no aporta — necesitas conectividad sí o sí.
- Cualquier bug del SW sería complicado de depurar a distancia.

### Nueva tarjeta en Settings → "📱 App móvil (PWA)"

Vista organizada con:
- Instrucciones explícitas de cómo añadir a inicio en iOS Safari y
  Android Chrome.
- Campos editables: nombre completo (hasta 60 chars), nombre corto
  (hasta 12, el que aparece bajo el icono), color de tema (color
  picker nativo).
- Preview del icono actual (Site Icon si existe, fallback NV si no)
  con link directo al Customizer para subir uno personalizado.
- Caja `<details>` con cómo verificar que funciona (link directo al
  endpoint manifest + instrucciones de DevTools).

### Carga automática

Cargada desde `nv-dashboard.php` justo después de la clase de redirect
de v1.0.76:

```php
require_once NV_DASHBOARD_PATH . 'includes/class-login-redirect.php';  // v1.0.76
require_once NV_DASHBOARD_PATH . 'includes/class-pwa.php';             // v1.0.77
```

## Archivos nuevos

- `includes/class-pwa.php`
- `assets/pwa/icon-192.png`
- `assets/pwa/icon-512.png`
- `assets/pwa/icon-512-maskable.png`
- `assets/pwa/apple-touch-icon-180.png`

## Archivos modificados

- `nv-dashboard.php` — versión 1.0.76 → 1.0.77, carga de la nueva clase.
- `includes/class-admin-pages.php` — handler de save de 3 opciones PWA.
- `admin/views/settings.php` — variables + tarjeta completa.

## Cómo verificar tras instalar

1. **Endpoint manifest**: abrir `https://hub.negociovivo.com/wp-json/nv/v1/pwa-manifest.json`
   en cualquier navegador → debe devolver JSON con `display: "standalone"`.
2. **DevTools desktop**: abrir cualquier página del admin → F12 →
   Application → Manifest. Debe detectar el manifest, parsearlo sin
   warnings, y mostrar el icono. La sección "Installability" debe decir
   "Page is installable" (o similar).
3. **iOS Safari**: abrir `hub.negociovivo.com/wp-admin/` → botón
   Compartir → "Añadir a pantalla de inicio" → aparece el icono NV →
   tap → se abre sin barra del navegador → aterriza en el NV Dashboard.
4. **Android Chrome**: misma URL → menú ⋮ → "Instalar app" (o
   "Añadir a pantalla de inicio") → tap → se abre standalone.

## Personalización del icono

David puede sustituir el icono NV por defecto subiendo su logo
cuadrado en Apariencia → Personalizar → Identidad del sitio → Icono
del sitio. WP genera automáticamente todos los tamaños y la clase
los usa sin que haya que tocar nada más.
