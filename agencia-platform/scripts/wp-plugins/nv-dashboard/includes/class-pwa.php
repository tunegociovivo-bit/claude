<?php
/**
 * NV Dashboard — PWA "Add to Home Screen".
 *
 * v1.0.77: David quiere poder añadir hub.negociovivo.com/wp-admin/ a la
 * pantalla de inicio de su móvil como si fuera una app nativa. Al tocar
 * el icono debe abrirse en modo standalone (sin barra del navegador) y
 * llevar directo al NV Dashboard.
 *
 * Esto es un caso textbook de PWA:
 *  - Manifest.json con display="standalone" y start_url adecuado.
 *  - Meta tags <apple-mobile-web-app-*> para iOS Safari.
 *  - <link rel="manifest"> para Chrome/Android.
 *  - Iconos en tamaños múltiples (180 iOS, 192 Android, 512 splash, 512 maskable).
 *
 * NO se incluye Service Worker porque (1) Chrome y Safari aceptan PWAs sin
 * SW desde 2022 si el manifest está bien, (2) un SW mal hecho puede cachear
 * versiones viejas del admin y romper cosas serias, y (3) para wp-admin no
 * aporta — necesitas conectividad sí o sí.
 *
 * Estrategia de icono:
 *  1. Si el sitio tiene Site Icon configurado en Apariencia → Personalizar
 *     → Identidad del sitio, se usa ese (David puede subir el suyo).
 *  2. Si no, se usa el fallback embebido (assets/pwa/icon-*.png) con la
 *     identidad NV (fondo negro, dorado #D2A039, monograma "NV").
 *
 * Strategy de start_url:
 *  1. Si David configuró login_redirect_url en v1.0.76, se usa esa (suele
 *     ser admin.php?page=nv-dashboard).
 *  2. Si no, /wp-admin/ (WP redirigirá a login si no hay sesión).
 */

if (!defined('ABSPATH')) exit;

class NV_PWA {

    const REST_NAMESPACE = 'nv/v1';
    const REST_ROUTE     = '/pwa-manifest.json';

    const APP_NAME_DEFAULT       = 'NV Dashboard';
    const APP_SHORT_NAME_DEFAULT = 'NV';
    const THEME_COLOR_DEFAULT    = '#0a0a0c';   // negro NV
    const BG_COLOR_DEFAULT       = '#0a0a0c';

    public static function init() {
        // Endpoint público que sirve el manifest dinámico
        add_action('rest_api_init', [__CLASS__, 'register_routes']);

        // Inyectar meta tags en todas las pantallas relevantes
        add_action('wp_head',    [__CLASS__, 'print_head_tags'], 5);
        add_action('admin_head', [__CLASS__, 'print_head_tags'], 5);
        add_action('login_head', [__CLASS__, 'print_head_tags'], 5);
    }

    // ────────────────────────────────────────────────────────────────────
    // Manifest endpoint
    // ────────────────────────────────────────────────────────────────────

    public static function register_routes() {
        register_rest_route(self::REST_NAMESPACE, self::REST_ROUTE, [
            'methods'             => 'GET',
            'callback'            => [__CLASS__, 'serve_manifest'],
            'permission_callback' => '__return_true',  // público por diseño (el browser lo fetchea)
        ]);
    }

    public static function serve_manifest() {
        $app_name   = self::get_app_name();
        $short_name = self::get_app_short_name();
        $theme      = self::get_theme_color();
        $bg         = self::get_bg_color();
        $start_url  = self::get_start_url();
        $scope      = self::get_scope();

        $manifest = [
            'name'             => $app_name,
            'short_name'       => $short_name,
            'description'      => 'Panel de gestión de Negocio Vivo',
            'start_url'        => $start_url,
            'scope'            => $scope,
            'display'          => 'standalone',
            'orientation'      => 'portrait',
            'theme_color'      => $theme,
            'background_color' => $bg,
            'lang'             => 'es-ES',
            'icons'            => self::get_icons_array(),
        ];

        // Respuesta JSON con el MIME type correcto y CORS abierto (lo fetchea
        // el navegador con scope cross-origin a veces; manifest debe ser leíble)
        $response = new WP_REST_Response($manifest, 200);
        $response->header('Content-Type', 'application/manifest+json');
        $response->header('Cache-Control', 'public, max-age=300');
        return $response;
    }

    // ────────────────────────────────────────────────────────────────────
    // Head tags
    // ────────────────────────────────────────────────────────────────────

    public static function print_head_tags() {
        $manifest_url = esc_url(rest_url(self::REST_NAMESPACE . self::REST_ROUTE));
        $apple_icon   = esc_url(self::get_apple_touch_icon_url());
        $theme        = esc_attr(self::get_theme_color());
        $app_title    = esc_attr(self::get_app_short_name());

        echo "\n<!-- NV Dashboard PWA (v1.0.77) -->\n";
        echo '<link rel="manifest" href="' . $manifest_url . '">' . "\n";
        echo '<link rel="apple-touch-icon" sizes="180x180" href="' . $apple_icon . '">' . "\n";
        echo '<meta name="apple-mobile-web-app-capable" content="yes">' . "\n";
        echo '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">' . "\n";
        echo '<meta name="apple-mobile-web-app-title" content="' . $app_title . '">' . "\n";
        echo '<meta name="mobile-web-app-capable" content="yes">' . "\n";
        echo '<meta name="theme-color" content="' . $theme . '">' . "\n";
        echo "<!-- /NV Dashboard PWA -->\n\n";
    }

    // ────────────────────────────────────────────────────────────────────
    // Helpers de configuración (con fallbacks y overrides desde Settings)
    // ────────────────────────────────────────────────────────────────────

    public static function get_app_name() {
        $override = trim((string) get_option('nv_dashboard_pwa_app_name', ''));
        return $override !== '' ? $override : self::APP_NAME_DEFAULT;
    }

    public static function get_app_short_name() {
        $override = trim((string) get_option('nv_dashboard_pwa_short_name', ''));
        return $override !== '' ? $override : self::APP_SHORT_NAME_DEFAULT;
    }

    public static function get_theme_color() {
        $override = trim((string) get_option('nv_dashboard_pwa_theme_color', ''));
        if ($override !== '' && preg_match('/^#[0-9A-Fa-f]{6}$/', $override)) {
            return strtoupper($override);
        }
        return self::THEME_COLOR_DEFAULT;
    }

    public static function get_bg_color() {
        return self::get_theme_color(); // mantener bg = theme por consistencia
    }

    /**
     * start_url: dónde aterriza el usuario al tocar el icono en su móvil.
     *
     * Prioridad:
     *  1. Override explícito (option nv_dashboard_pwa_start_url) si está set.
     *  2. login_redirect_url de v1.0.76, si configurado.
     *  3. /wp-admin/ (WP gestiona login si hace falta).
     */
    public static function get_start_url() {
        $override = trim((string) get_option('nv_dashboard_pwa_start_url', ''));
        if ($override !== '') {
            return self::normalize_url($override);
        }
        if (class_exists('NV_Login_Redirect')) {
            $from_redirect = NV_Login_Redirect::get_configured_url();
            if ($from_redirect !== '') return $from_redirect;
        }
        return admin_url('/');
    }

    /**
     * scope: qué URLs se consideran "dentro de la app".
     * Si pongo /wp-admin/, los links externos abren en navegador normal.
     * Si pongo /, toda la web es parte de la app.
     * Default: home_url() raíz, así si David toca un link al frontend
     * también se queda en standalone (más limpio para móvil).
     */
    public static function get_scope() {
        return home_url('/');
    }

    private static function normalize_url($raw) {
        if (preg_match('#^https?://#i', $raw)) return esc_url_raw($raw);
        if (strpos($raw, '/') === 0)            return esc_url_raw(home_url($raw));
        return esc_url_raw(home_url('/' . ltrim($raw, '/')));
    }

    // ────────────────────────────────────────────────────────────────────
    // Iconos: prefiere Site Icon de WP, fallback a embebidos
    // ────────────────────────────────────────────────────────────────────

    private static function plugin_icon_url($filename) {
        return NV_DASHBOARD_URL . 'assets/pwa/' . $filename;
    }

    public static function get_apple_touch_icon_url() {
        // Si hay site_icon de WP, usar tamaño 180. WP genera todos los
        // tamaños automáticamente cuando subes Site Icon en Customizer.
        if (function_exists('get_site_icon_url')) {
            $url = get_site_icon_url(180);
            if ($url) return $url;
        }
        return self::plugin_icon_url('apple-touch-icon-180.png');
    }

    public static function get_icons_array() {
        // Si hay Site Icon configurado en WP, usar sus tamaños generados
        // (WP los crea automáticamente: 270x270 splash, 192x192, 180x180, etc.)
        if (function_exists('has_site_icon') && has_site_icon()) {
            return [
                ['src' => get_site_icon_url(192), 'sizes' => '192x192', 'type' => 'image/png', 'purpose' => 'any'],
                ['src' => get_site_icon_url(270), 'sizes' => '270x270', 'type' => 'image/png', 'purpose' => 'any'],
                ['src' => get_site_icon_url(512), 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'any maskable'],
            ];
        }
        // Fallback: iconos NV embebidos en el plugin
        return [
            [
                'src'     => self::plugin_icon_url('icon-192.png'),
                'sizes'   => '192x192',
                'type'    => 'image/png',
                'purpose' => 'any',
            ],
            [
                'src'     => self::plugin_icon_url('icon-512.png'),
                'sizes'   => '512x512',
                'type'    => 'image/png',
                'purpose' => 'any',
            ],
            [
                'src'     => self::plugin_icon_url('icon-512-maskable.png'),
                'sizes'   => '512x512',
                'type'    => 'image/png',
                'purpose' => 'maskable',  // para Android adaptive icons
            ],
        ];
    }
}

NV_PWA::init();
