/**
 * Plugin puente para las webs WordPress de los clientes (se descarga desde el Publicador SEO).
 * Aplica meta title/description/keyword en Yoast o Rank Math e imprime el schema JSON-LD.
 */
export const NV_SEO_BRIDGE_PHP = `<?php
/**
 * Plugin Name: NV SEO Bridge
 * Description: Puente entre NV Publicador (Hub Negocio Vivo) y esta web: aplica meta title, meta description y keyword en Yoast SEO / Rank Math, imprime el schema JSON-LD (Article + FAQPage) y garantiza que la autenticación por Application Password llega a WordPress aunque el hosting elimine la cabecera Authorization.
 * Version: 1.2.0
 * Author: Negocio Vivo
 * Requires PHP: 7.4
 */

if (!defined('ABSPATH')) exit;

/**
 * Algunos hostings (Apache en modo CGI/FastCGI, algunos proxies) eliminan la cabecera Authorization
 * antes de que llegue a PHP y WordPress responde «No estás conectado». El Hub envía además la cabecera
 * X-NV-Auth con las mismas credenciales; aquí la volvemos a poner donde WordPress la espera.
 */
if (empty($_SERVER['PHP_AUTH_USER'])) {
    $nv_auth = '';
    foreach (['HTTP_X_NV_AUTH', 'HTTP_AUTHORIZATION', 'REDIRECT_HTTP_AUTHORIZATION'] as $nv_k) {
        if (!empty($_SERVER[$nv_k])) { $nv_auth = $_SERVER[$nv_k]; break; }
    }
    if (!$nv_auth && function_exists('apache_request_headers')) {
        $nv_h = apache_request_headers();
        foreach (['X-NV-Auth', 'Authorization', 'x-nv-auth', 'authorization'] as $nv_k) {
            if (!empty($nv_h[$nv_k])) { $nv_auth = $nv_h[$nv_k]; break; }
        }
    }
    if ($nv_auth && stripos($nv_auth, 'basic ') === 0) {
        $nv_dec = base64_decode(trim(substr($nv_auth, 6)), true);
        if ($nv_dec !== false && strpos($nv_dec, ':') !== false) {
            list($nv_u, $nv_p) = explode(':', $nv_dec, 2);
            $_SERVER['PHP_AUTH_USER'] = $nv_u;
            $_SERVER['PHP_AUTH_PW'] = $nv_p;
        }
    }
    unset($nv_auth, $nv_k, $nv_h, $nv_dec, $nv_u, $nv_p);
}

final class NV_SEO_Bridge {

    const KEYS = ['nvseo_title', 'nvseo_description', 'nvseo_focus_kw', 'nvseo_schema'];

    public static function init() {
        add_action('init', [__CLASS__, 'register_meta']);
        add_action('rest_api_init', [__CLASS__, 'routes']);
        add_action('rest_after_insert_post', [__CLASS__, 'sync_seo_plugins'], 20, 1);
        add_action('wp_head', [__CLASS__, 'head'], 2);
        add_filter('pre_get_document_title', [__CLASS__, 'title'], 20);
    }

    public static function register_meta() {
        foreach (self::KEYS as $k) {
            register_post_meta('post', $k, [
                'type' => 'string',
                'single' => true,
                'show_in_rest' => true,
                'sanitize_callback' => $k === 'nvseo_schema' ? [__CLASS__, 'sanitize_json'] : 'sanitize_text_field',
                'auth_callback' => function () { return current_user_can('edit_posts'); },
            ]);
        }
    }

    public static function sanitize_json($v) {
        $d = json_decode((string) $v, true);
        return is_array($d) ? wp_json_encode($d, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : '';
    }

    public static function routes() {
        register_rest_route('nvseo/v1', '/status', [
            'methods' => 'GET',
            'permission_callback' => function () { return current_user_can('edit_posts'); },
            'callback' => function () {
                return ['ok' => true, 'version' => '1.2.0', 'yoast' => self::yoast(), 'rankmath' => self::rankmath()];
            },
        ]);
        // Diagnóstico de autenticación para el Hub: explica por qué no entra una Application Password (no revela secretos).
        register_rest_route('nvseo/v1', '/auth-check', [
            'methods' => 'GET',
            'permission_callback' => '__return_true',
            'callback' => [__CLASS__, 'auth_check'],
        ]);
    }

    public static function auth_check() {
        $seen = [];
        foreach (['HTTP_AUTHORIZATION', 'REDIRECT_HTTP_AUTHORIZATION', 'HTTP_X_NV_AUTH', 'PHP_AUTH_USER'] as $k) {
            if (!empty($_SERVER[$k])) $seen[] = $k;
        }
        $out = [
            'bridge' => '1.2.0',
            'headers_seen' => $seen,
            'php_auth_user' => !empty($_SERVER['PHP_AUTH_USER']),
            'app_passwords_available' => function_exists('wp_is_application_passwords_available') ? wp_is_application_passwords_available() : null,
            'is_ssl' => is_ssl(),
            'wp_version' => get_bloginfo('version'),
            'current_user' => get_current_user_id(),
            'result' => 'no_credentials',
        ];
        if (!empty($_SERVER['PHP_AUTH_USER'])) {
            $u = wp_unslash($_SERVER['PHP_AUTH_USER']);
            $p = wp_unslash($_SERVER['PHP_AUTH_PW'] ?? '');
            $user = get_user_by('login', $u);
            if (!$user && is_email($u)) $user = get_user_by('email', $u);
            if (!$user) {
                $out['result'] = 'invalid_username';
            } elseif (function_exists('wp_is_application_passwords_available_for_user') && !wp_is_application_passwords_available_for_user($user)) {
                $out['result'] = 'app_passwords_disabled_for_user';
            } else {
                $out['app_passwords_count'] = count(WP_Application_Passwords::get_user_application_passwords($user->ID));
                $r = wp_authenticate_application_password(null, $u, $p);
                if ($r instanceof WP_User) {
                    $out['result'] = 'ok';
                    $out['can_publish'] = user_can($user, 'publish_posts');
                } else {
                    $out['result'] = is_wp_error($r) ? $r->get_error_code() : 'incorrect_password';
                    global $wp_rest_application_password_status;
                    if (is_wp_error($wp_rest_application_password_status)) $out['result'] = $wp_rest_application_password_status->get_error_code();
                }
            }
        }
        return $out;
    }

    private static function yoast() { return defined('WPSEO_VERSION'); }
    private static function rankmath() { return class_exists('RankMath'); }

    /** Copia los campos NV a los campos nativos de Yoast / Rank Math. */
    public static function sync_seo_plugins($post) {
        $id = is_object($post) ? $post->ID : (int) $post;
        $t = get_post_meta($id, 'nvseo_title', true);
        $d = get_post_meta($id, 'nvseo_description', true);
        $k = get_post_meta($id, 'nvseo_focus_kw', true);
        if ($t === '' && $d === '' && $k === '') return;
        if (self::yoast()) {
            if ($t) update_post_meta($id, '_yoast_wpseo_title', $t);
            if ($d) update_post_meta($id, '_yoast_wpseo_metadesc', $d);
            if ($k) update_post_meta($id, '_yoast_wpseo_focuskw', $k);
        }
        if (self::rankmath()) {
            if ($t) update_post_meta($id, 'rank_math_title', $t);
            if ($d) update_post_meta($id, 'rank_math_description', $d);
            if ($k) update_post_meta($id, 'rank_math_focus_keyword', $k);
        }
    }

    /** Título del documento cuando no hay plugin SEO. */
    public static function title($title) {
        if (!is_singular('post') || self::yoast() || self::rankmath()) return $title;
        $t = get_post_meta(get_queried_object_id(), 'nvseo_title', true);
        return $t ?: $title;
    }

    public static function head() {
        if (!is_singular('post')) return;
        $id = get_queried_object_id();
        $has_seo_plugin = self::yoast() || self::rankmath();

        if (!$has_seo_plugin) {
            $d = get_post_meta($id, 'nvseo_description', true);
            if ($d) echo '<meta name="description" content="' . esc_attr($d) . "\\" />\\n";
        }

        $raw = get_post_meta($id, 'nvseo_schema', true);
        if ($raw) {
            $json = str_replace(
                ['%%permalink%%', '%%date_published%%', '%%date_modified%%'],
                [get_permalink($id), get_the_date('c', $id), get_the_modified_date('c', $id)],
                $raw
            );
            $schema = json_decode($json, true);
            if (is_array($schema) && !empty($schema['@graph'])) {
                // Yoast/Rank Math ya emiten Article: evitamos duplicarlo y solo añadimos FAQPage
                if ($has_seo_plugin) {
                    $schema['@graph'] = array_values(array_filter($schema['@graph'], function ($n) { return ($n['@type'] ?? '') !== 'BlogPosting'; }));
                }
                if ($schema['@graph']) {
                    echo '<script type="application/ld+json" class="nv-seo-bridge">' . wp_json_encode($schema, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "</script>\\n";
                }
            }
        }

        // Estilo mínimo para el índice y figuras generados por NV Publicador
        echo '<style id="nv-seo-bridge-css">.nvp-toc{background:#f7f7f5;border:1px solid #e6e6e0;border-radius:10px;padding:12px 18px;margin:20px 0}.nvp-toc summary{cursor:pointer}.nvp-toc ol{margin:8px 0 0 18px}.nvp-figure img{height:auto;border-radius:8px}.nvp-figure figcaption{font-size:.85em;opacity:.75;text-align:center}</style>' . "\\n";
    }
}

NV_SEO_Bridge::init();
`;
