/**
 * Plugin puente para las webs WordPress de los clientes (se descarga desde el Publicador SEO).
 * Aplica meta title/description/keyword en Yoast o Rank Math e imprime el schema JSON-LD.
 */
export const NV_SEO_BRIDGE_PHP = `<?php
/**
 * Plugin Name: NV SEO Bridge
 * Description: Conecta esta web con el Hub Negocio Vivo con un código (Ajustes → NV SEO Bridge), aplica meta title/description/keyword en Yoast SEO o Rank Math e imprime el schema JSON-LD de los posts publicados desde el Hub.
 * Version: 2.0.0
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
        add_action('admin_menu', [__CLASS__, 'menu']);
        add_action('admin_post_nvseo_pair', [__CLASS__, 'handle_pair']);
        add_action('admin_notices', [__CLASS__, 'notice']);
        add_action('init', [__CLASS__, 'register_meta']);
        add_action('rest_api_init', [__CLASS__, 'routes']);
        add_action('rest_after_insert_post', [__CLASS__, 'sync_seo_plugins'], 20, 1);
        add_action('wp_head', [__CLASS__, 'head'], 2);
        add_filter('pre_get_document_title', [__CLASS__, 'title'], 20);
    }

    /* ---------- Conexión con el Hub (un solo código) ---------- */

    public static function menu() {
        add_options_page('NV SEO Bridge', 'NV SEO Bridge', 'manage_options', 'nv-seo-bridge', [__CLASS__, 'page']);
    }

    public static function notice() {
        if (!current_user_can('manage_options') || get_option('nvseo_paired_at')) return;
        $screen = function_exists('get_current_screen') ? get_current_screen() : null;
        if ($screen && $screen->id === 'settings_page_nv-seo-bridge') return;
        echo '<div class="notice notice-info"><p><b>NV SEO Bridge:</b> esta web aún no está conectada con el Hub Negocio Vivo. <a href="' . esc_url(admin_url('options-general.php?page=nv-seo-bridge')) . '">Conectar ahora</a>.</p></div>';
    }

    public static function page() {
        if (!current_user_can('manage_options')) return;
        $paired = get_option('nvseo_paired_at');
        $hub = get_option('nvseo_hub_url');
        $msg = isset($_GET['nvseo_msg']) ? sanitize_text_field(wp_unslash($_GET['nvseo_msg'])) : '';
        $ok = isset($_GET['nvseo_ok']) && $_GET['nvseo_ok'] === '1';
        echo '<div class="wrap"><h1>NV SEO Bridge</h1>';
        if ($msg) echo '<div class="notice ' . ($ok ? 'notice-success' : 'notice-error') . '"><p>' . esc_html($msg) . '</p></div>';
        if ($paired) {
            echo '<p style="font-size:15px">✅ <b>Conectada con el Hub Negocio Vivo</b> desde el ' . esc_html(date_i18n('d/m/Y H:i', (int) $paired)) . ($hub ? ' (' . esc_html($hub) . ')' : '') . '.</p>';
            echo '<p>Si necesitas volver a conectar (por ejemplo, tras cambiar de usuario), genera un código nuevo en el Hub y pégalo aquí.</p>';
        } else {
            echo '<p style="font-size:15px">Para conectar esta web con el Hub Negocio Vivo: en el Hub, abre el cliente → pestaña <b>Conexión WordPress</b> → <b>Copiar código de conexión</b>, y pégalo aquí.</p>';
        }
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
        wp_nonce_field('nvseo_pair');
        echo '<input type="hidden" name="action" value="nvseo_pair">';
        echo '<p><input type="text" name="code" class="regular-text code" style="width:100%;max-width:720px;font-family:monospace" placeholder="NVP1.…" autocomplete="off" required></p>';
        submit_button($paired ? 'Volver a conectar' : 'Conectar con el Hub');
        echo '</form>';
        echo '<p class="description">El plugin crea una contraseña de aplicación para tu usuario (' . esc_html(wp_get_current_user()->user_login) . ') y se la envía al Hub de forma segura. No hay que configurar nada más.</p>';
        echo '</div>';
    }

    public static function handle_pair() {
        if (!current_user_can('manage_options')) wp_die('Sin permisos');
        check_admin_referer('nvseo_pair');
        $back = admin_url('options-general.php?page=nv-seo-bridge');
        $code = isset($_POST['code']) ? trim(wp_unslash($_POST['code'])) : '';
        $parsed = self::parse_code($code);
        if (!$parsed) {
            wp_safe_redirect(add_query_arg(['nvseo_ok' => '0', 'nvseo_msg' => rawurlencode('El código no es válido. Cópialo entero desde el Hub (empieza por NVP1.).')], $back));
            exit;
        }
        list($hub, $site_id, $token) = $parsed;
        $user = wp_get_current_user();
        if (!user_can($user, 'publish_posts') || !user_can($user, 'upload_files')) {
            wp_safe_redirect(add_query_arg(['nvseo_ok' => '0', 'nvseo_msg' => rawurlencode('Tu usuario necesita poder publicar entradas y subir archivos (rol Editor o Administrador).')], $back));
            exit;
        }
        // Reutilizamos el nombre: si ya existía una clave del Hub, la sustituimos.
        foreach (WP_Application_Passwords::get_user_application_passwords($user->ID) as $ap) {
            if (isset($ap['name']) && $ap['name'] === 'Hub Negocio Vivo') WP_Application_Passwords::delete_application_password($user->ID, $ap['uuid']);
        }
        $created = WP_Application_Passwords::create_new_application_password($user->ID, ['name' => 'Hub Negocio Vivo']);
        if (is_wp_error($created)) {
            wp_safe_redirect(add_query_arg(['nvseo_ok' => '0', 'nvseo_msg' => rawurlencode('WordPress no permite crear contraseñas de aplicación: ' . $created->get_error_message())], $back));
            exit;
        }
        $plain = $created[0];
        $resp = wp_remote_post(rtrim($hub, '/') . '/api/public/seo-blog/pair', [
            'timeout' => 60,
            'headers' => ['Content-Type' => 'application/json'],
            'body' => wp_json_encode([
                'siteId' => $site_id,
                'token' => $token,
                'siteUrl' => home_url('/'),
                'user' => $user->user_login,
                'appPassword' => $plain,
                'wpVersion' => get_bloginfo('version'),
                'bridge' => '2.0.0',
            ]),
        ]);
        if (is_wp_error($resp)) {
            wp_safe_redirect(add_query_arg(['nvseo_ok' => '0', 'nvseo_msg' => rawurlencode('No se pudo contactar con el Hub: ' . $resp->get_error_message())], $back));
            exit;
        }
        $data = json_decode((string) wp_remote_retrieve_body($resp), true);
        if (is_array($data) && !empty($data['ok'])) {
            update_option('nvseo_paired_at', time());
            update_option('nvseo_hub_url', $hub);
            wp_safe_redirect(add_query_arg(['nvseo_ok' => '1', 'nvseo_msg' => rawurlencode($data['message'] ?? 'Conectado con el Hub Negocio Vivo.')], $back));
        } else {
            $err = is_array($data) && !empty($data['error']) ? $data['error'] : ('Respuesta inesperada del Hub (HTTP ' . wp_remote_retrieve_response_code($resp) . ').');
            wp_safe_redirect(add_query_arg(['nvseo_ok' => '0', 'nvseo_msg' => rawurlencode($err)], $back));
        }
        exit;
    }

    /** Código NVP1.<base64url("hubUrl|siteId|token")> */
    private static function parse_code($code) {
        if (strpos($code, 'NVP1.') !== 0) return null;
        $b64 = strtr(substr($code, 5), '-_', '+/');
        $raw = base64_decode($b64 . str_repeat('=', (4 - strlen($b64) % 4) % 4), true);
        if (!$raw) return null;
        $parts = explode('|', $raw);
        if (count($parts) !== 3 || !preg_match('#^https?://#i', $parts[0]) || $parts[1] === '' || $parts[2] === '') return null;
        return $parts;
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
                return ['ok' => true, 'version' => '2.0.0', 'yoast' => self::yoast(), 'rankmath' => self::rankmath()];
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
            'bridge' => '2.0.0',
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
