# NV Dashboard 1.0.76 — Redirección configurable tras login

## Contexto

David tiene Site Kit "Sign in with Google" funcionando en
`hub.negociovivo.com` pero quería que tras iniciar sesión con el botón
de Google le llevara directamente al NV Dashboard, no al escritorio
genérico de WordPress (`/wp-admin/`). Esto es especialmente útil en
móvil: tap en "Iniciar sesión con Google" → directo al dashboard sin
escalas.

Site Kit Sign in with Google **no expone una opción nativa** para esto:
sigue el comportamiento estándar de WordPress (filter `login_redirect`
de core). La forma limpia y desacoplada de un plugin concreto es usar
ese filter — funciona con Site Kit, con login estándar
usuario/contraseña, y con cualquier plugin de auth futuro que respete
las APIs de core (que son todos los bien implementados).

## Lo que añade v1.0.76

### Nueva clase `includes/class-login-redirect.php`

Hookea el filter `login_redirect` con prioridad 100 (después de
cualquier otro filter, para no pisar destinos legítimos puestos por
terceros). Lógica:

1. Si la auth falló (`WP_Error`) → no toca nada.
2. Si el usuario no tiene capability `edit_posts` → no toca nada.
   Pensado para el caso futuro en que David abra el sitio a
   Suscriptores (clientes con cuenta limitada); éstos seguirán su
   flujo normal.
3. Si el flujo de login trae un `redirect_to` explícito en query
   string (típico cuando WP te manda al login porque intentaste
   entrar a una página concreta sin sesión) → respeta ese destino.
4. Solo cuando el destino default sería el escritorio genérico
   (`/wp-admin/`) → reescribe a la URL configurada en Settings.

Acepta tanto **URL absoluta** (`https://...`) como **ruta relativa**
empezando por `/` (`/wp-admin/admin.php?page=nv-dashboard`); las
relativas se resuelven contra `home_url()`.

### Nueva opción `nv_dashboard_login_redirect_url`

Guardada vía `update_option`. Se sanitiza con `esc_url_raw` permitiendo
solo http/https. Si se guarda string vacío se borra la opción
(comportamiento WP default).

### Nueva tarjeta en Settings → "🚪 Redirección tras login"

Campo de texto con:
- Placeholder que ya sugiere `admin.php?page=nv-dashboard`.
- Tres botones de acceso rápido: **📊 Vista General NV**, **📅 Editorial**,
  **↺ Default WP** (este último limpia el campo).
- Caja `<details>` colapsable explicando cómo funciona el hook y a
  quién afecta, para que el comportamiento no sea opaco.

### Carga automática

Cargada desde `nv-dashboard.php` justo después de las demás clases
(`require_once .../class-login-redirect.php`).

## Cobertura

Los 4 caminos del filter están probados offline antes de empaquetar:

| Caso | Comportamiento |
|---|---|
| Opción vacía | Pasa-through, comportamiento WP default |
| Admin + destino default WP | Reescribe a la URL configurada |
| Suscriptor sin `edit_posts` | No reescribe, flujo normal |
| Admin + `redirect_to` explícito | Respeta el destino del flujo |
| Auth error (WP_Error) | No toca nada |
| URL absoluta a dominio externo | Se respeta (no se reescribe) |

## Archivos modificados

- `nv-dashboard.php` — versión 1.0.75 → 1.0.76, carga de la nueva clase.
- `includes/class-login-redirect.php` (NUEVO).
- `includes/class-admin-pages.php` — handler de save de la nueva opción.
- `admin/views/settings.php` — variable + tarjeta visual con botones
  de acceso rápido.

## Cómo usar

1. Instalar/actualizar el plugin a 1.0.76.
2. NV Dashboard → Configuración → bajar a la tarjeta "🚪 Redirección
   tras login" → pulsar **📊 Vista General NV** (rellena la URL
   automáticamente) → Guardar.
3. Cerrar sesión y volver a entrar con el botón Sign in with Google →
   debe aterrizar directamente en la Vista General del NV Dashboard.

Para volver al comportamiento por defecto de WP en cualquier momento:
botón **↺ Default WP** y Guardar.
