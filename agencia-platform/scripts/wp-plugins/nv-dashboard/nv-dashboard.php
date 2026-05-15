<?php
/**
 * Plugin Name: NV Dashboard
 * Plugin URI: https://negociovivo.com
 * Description: Dashboard editorial unificado para gestionar el calendario de publicaciones de los clientes de Negocio Vivo. Permite revisar, aprobar y exportar a Metricool en 1 clic.
 * Version: 1.0.77
 * Author: Negocio Vivo
 * Author URI: https://negociovivo.com
 * License: GPL-2.0+
 * Text Domain: nv-dashboard
 */

// Bloquear acceso directo
if (!defined('ABSPATH')) {
    exit;
}

// Constantes del plugin
define('NV_DASHBOARD_VERSION', '1.0.77');
define('NV_DASHBOARD_PATH', plugin_dir_path(__FILE__));
define('NV_DASHBOARD_URL', plugin_dir_url(__FILE__));

/**
 * Helper: obtener el secret del webhook (almacenado en wp_options).
 * Si no existe, lo genera automáticamente.
 *
 * @since 1.0.6
 */
function nv_dashboard_get_webhook_secret() {
    $secret = get_option('nv_dashboard_webhook_secret');
    if (empty($secret)) {
        $secret = wp_generate_password(40, false, false);
        update_option('nv_dashboard_webhook_secret', $secret);
    }
    return $secret;
}

/**
 * Helper: regenerar el secret del webhook (invalida los anteriores).
 *
 * @since 1.0.6
 */
function nv_dashboard_regenerate_webhook_secret() {
    $new_secret = wp_generate_password(40, false, false);
    update_option('nv_dashboard_webhook_secret', $new_secret);
    return $new_secret;
}

/**
 * Helper: obtener el API token del plugin (Bearer auth).
 * Si no existe, lo genera automáticamente.
 *
 * @since 1.0.20
 */
function nv_dashboard_get_api_token() {
    $token = get_option('nv_dashboard_api_token');
    if (empty($token)) {
        $token = 'nvtok_' . wp_generate_password(48, false, false);
        update_option('nv_dashboard_api_token', $token);
    }
    return $token;
}

/**
 * Helper: regenerar el API token del plugin (invalida el anterior).
 *
 * @since 1.0.20
 */
function nv_dashboard_regenerate_api_token() {
    $new_token = 'nvtok_' . wp_generate_password(48, false, false);
    update_option('nv_dashboard_api_token', $new_token);
    return $new_token;
}

/**
 * Verificar dependencias al activar
 */
register_activation_hook(__FILE__, 'nv_dashboard_activate');
function nv_dashboard_activate() {
    // Verificar ACF
    if (!class_exists('ACF') && !function_exists('get_field')) {
        deactivate_plugins(plugin_basename(__FILE__));
        wp_die(
            'NV Dashboard requiere el plugin <strong>Advanced Custom Fields (ACF)</strong>.<br><br>' .
            'Por favor instálalo desde Plugins > Añadir nuevo, búscalo como "Advanced Custom Fields", actívalo y vuelve a activar NV Dashboard.<br><br>' .
            '<a href="' . admin_url('plugins.php') . '">← Volver a Plugins</a>',
            'Falta dependencia ACF',
            ['back_link' => true]
        );
    }
    
    // Crear opciones por defecto
    add_option('nv_dashboard_drive_folder_id', '');
    add_option('nv_dashboard_metricool_brand_name', 'Negocio Vivo');
    add_option('nv_dashboard_make_webhook_url', '');
    add_option('nv_dashboard_notification_email', get_option('admin_email'));
    
    // Generar secret del webhook si no existe (v1.0.6)
    nv_dashboard_get_webhook_secret();

    // v1.0.20: Generar API token del plugin si no existe
    nv_dashboard_get_api_token();
    
    // v1.0.11: pre-rellenar URLs avatar tmpfiles si no hay nada
    $existing = get_option('nv_dashboard_avatares_urls', '');
    if (empty($existing)) {
        $default_avatares = implode("\n", [
            'https://tmpfiles.org/dl/35314025/david_face_new_1.jpg',
            'https://tmpfiles.org/dl/35314027/david_face_new_3.jpg',
            'https://tmpfiles.org/dl/35314028/david_face_new_4.jpg',
            'https://tmpfiles.org/dl/35314030/david_face_new_5.jpg',
            'https://tmpfiles.org/dl/35314031/david_face_new_6.jpg',
            'https://tmpfiles.org/dl/35314033/david_face_new_7.jpg',
            'https://tmpfiles.org/dl/35314034/david_face_new_8.jpg',
            'https://tmpfiles.org/dl/35314037/david_face_new_9.jpg',
            'https://tmpfiles.org/dl/35314055/david_face_new_2.jpg',
            'https://tmpfiles.org/dl/35314059/david_face_new_10.jpg',
        ]);
        update_option('nv_dashboard_avatares_urls', $default_avatares);
    }
    
    // v1.0.17: pre-rellenar IDs Drive REFS NV por cliente si no hay nada
    // v1.0.18: usar underscores en slugs (formato WP nativo de los términos);
    // el lookup en cliente_config normaliza guion/underscore por si acaso.
    $refs_existing = get_option('nv_dashboard_refs_drive_folders', '');
    if (empty($refs_existing)) {
        $default_refs = [
            'root_folder_id' => '1Z2Hr5Ec-11RCKX00vtKrnPAt8RzgkrCx',
            'clientes' => [
                'clinica_march' => [
                    'root_id' => '1noErP4aDPoTqdvgL-HwKh8zz6EGfkEJw',
                    'subfolders' => [
                        'Rochar Villameriel (CEO)' => '1A02Oopb09zhjWYzfhosCETQ0mVpD7qmn',
                        'Pacientes' => '1E0wXucIAIZunaR7fRj4NvMQqbrD749VU',
                        'Trabajadores' => '1gHHEUk78o4JH-l-Sx5ywm-qTx2PFhuNU',
                        'Instalaciones clínica' => '1LBltmDapOXg4ax38O-3fTGKbbIKLk8SX',
                    ],
                ],
                'negocio_vivo' => [
                    'root_id' => '1RXtAnNe6K_cdE9-8rWqG5R_YKt_u2y6j',
                    'subfolders' => [
                        'David Rios (blazer outfit + caras)' => '1IlXnEr7bqWcG8liSie_gGWS5X0Y0z2LU',
                    ],
                ],
                'aquaking' => [
                    'root_id' => '1hBfWOP7UUcGdaSBMSVbLVMU9EuGsbXFG',
                    'subfolders' => [],
                ],
            ],
        ];
        update_option('nv_dashboard_refs_drive_folders', wp_json_encode($default_refs));
    } else {
        // v1.0.18: migración — si había keys con guion (v1.0.17), las rescribimos con underscore
        $existing_data = json_decode($refs_existing, true);
        if (is_array($existing_data) && isset($existing_data['clientes']) && is_array($existing_data['clientes'])) {
            $migrated_clientes = [];
            $changed = false;
            foreach ($existing_data['clientes'] as $key => $value) {
                $key_underscore = str_replace('-', '_', $key);
                if ($key !== $key_underscore && !isset($existing_data['clientes'][$key_underscore])) {
                    $migrated_clientes[$key_underscore] = $value;
                    $changed = true;
                } else {
                    $migrated_clientes[$key] = $value;
                }
            }
            if ($changed) {
                $existing_data['clientes'] = $migrated_clientes;
                update_option('nv_dashboard_refs_drive_folders', wp_json_encode($existing_data));
            }
        }
    }
    
    // Flush rewrite rules para custom post type Y URL pública
    nv_dashboard_register_post_type();
    
    // Registrar la rewrite rule pública (sin cargar la clase entera, basta esta línea)
    add_rewrite_rule('^nv-dashboard/?$', 'index.php?nv_dashboard_public=1', 'top');

    // v1.0.47: marcar versión instalada (para detector de cambio de versión)
    update_option('nv_dashboard_installed_version', NV_DASHBOARD_VERSION);
    
    flush_rewrite_rules();
}

register_deactivation_hook(__FILE__, function() {
    flush_rewrite_rules();
});

/**
 * v1.0.47 — Detector de cambio de versión.
 *
 * Cuando se actualiza el plugin sin desactivar/reactivar (caso típico al subir
 * un ZIP nuevo encima del existente), las rutas REST nuevas no se registran
 * porque WordPress cachea el rewrite hasta que se ejecuta flush_rewrite_rules().
 *
 * Esta función se ejecuta en cada `init` y compara la versión del código con
 * la versión guardada en options. Si difieren, fuerza un flush diferido (en
 * el siguiente request, no en este, para no penalizar el actual).
 */
add_action('init', 'nv_dashboard_version_change_detector', 99);
function nv_dashboard_version_change_detector() {
    $stored_version = get_option('nv_dashboard_installed_version', '0.0.0');
    if (version_compare($stored_version, NV_DASHBOARD_VERSION, '!=')) {
        // Versión cambió → marcar para flush en próximo request
        update_option('nv_dashboard_installed_version', NV_DASHBOARD_VERSION);
        update_option('nv_dashboard_needs_flush', '1');
        // Log para diagnóstico
        error_log('[NV Dashboard] Version change detected: ' . $stored_version . ' → ' . NV_DASHBOARD_VERSION . '. Will flush on next request.');
    }
    // Si hay flag de flush pendiente, ejecutar
    if (get_option('nv_dashboard_needs_flush') === '1') {
        delete_option('nv_dashboard_needs_flush');
        flush_rewrite_rules(false);
        error_log('[NV Dashboard] Permalinks flushed automatically after version change.');
    }
}

/**
 * Cargar componentes del plugin
 */
add_action('plugins_loaded', 'nv_dashboard_load');
function nv_dashboard_load() {
    // Verificar ACF en runtime
    if (!class_exists('ACF') && !function_exists('get_field')) {
        add_action('admin_notices', function() {
            echo '<div class="notice notice-error"><p><strong>NV Dashboard:</strong> Falta el plugin Advanced Custom Fields (ACF). El dashboard no funcionará hasta que lo instales y actives.</p></div>';
        });
        return;
    }

    // v1.0.20: asegurar que el API token existe (fallback para upgrades que no
    // disparan el activation hook).
    nv_dashboard_get_api_token();
    
    // Cargar archivos del plugin
    require_once NV_DASHBOARD_PATH . 'includes/class-cpt-publicacion.php';
    require_once NV_DASHBOARD_PATH . 'includes/class-acf-fields.php';
    require_once NV_DASHBOARD_PATH . 'includes/class-cliente-meta.php';   // v1.0.21
    require_once NV_DASHBOARD_PATH . 'includes/class-admin-pages.php';
    require_once NV_DASHBOARD_PATH . 'includes/class-rest-api.php';
    require_once NV_DASHBOARD_PATH . 'includes/class-csv-generator.php';
    require_once NV_DASHBOARD_PATH . 'includes/class-claude-widget.php';
    require_once NV_DASHBOARD_PATH . 'includes/class-public-dashboard.php';
    require_once NV_DASHBOARD_PATH . 'includes/class-shortcode.php';
    require_once NV_DASHBOARD_PATH . 'includes/class-login-redirect.php';  // v1.0.76
    require_once NV_DASHBOARD_PATH . 'includes/class-pwa.php';             // v1.0.77
    
    // Inicializar componentes
    NV_CPT_Publicacion::init();
    NV_ACF_Fields::init();
    NV_Cliente_Meta::init();   // v1.0.21
    NV_Admin_Pages::init();
    NV_Rest_API::init();
    NV_Claude_Widget::init();
    NV_Public_Dashboard::init();
    NV_Shortcode::init();
}

/**
 * Helper: registrar CPT (también se usa al activar)
 */
function nv_dashboard_register_post_type() {
    register_post_type('nv_publicacion', [
        'labels' => [
            'name' => 'Publicaciones',
            'singular_name' => 'Publicación',
            'menu_name' => 'Editorial',
            'add_new' => 'Añadir publicación',
            'add_new_item' => 'Nueva publicación',
            'edit_item' => 'Editar publicación',
            'view_item' => 'Ver publicación',
            'all_items' => 'Todas las publicaciones',
        ],
        'public' => false,
        'show_ui' => true,
        'show_in_menu' => false, // se gestiona desde nuestro menú custom
        'show_in_rest' => true,
        'supports' => ['title', 'editor', 'thumbnail'],
        'capability_type' => 'post',
        'map_meta_cap' => true,
    ]);
    
    // Taxonomía Cliente
    register_taxonomy('nv_cliente', 'nv_publicacion', [
        'labels' => [
            'name' => 'Clientes',
            'singular_name' => 'Cliente',
        ],
        'public' => false,
        'show_ui' => true,
        'show_in_rest' => true,
        'hierarchical' => false,
    ]);
}

/**
 * Cargar assets del admin
 */
add_action('admin_enqueue_scripts', 'nv_dashboard_admin_assets');
function nv_dashboard_admin_assets($hook) {
    // Solo cargar en páginas del plugin
    if (strpos($hook, 'nv-dashboard') === false && strpos($hook, 'nv_publicacion') === false) {
        return;
    }
    
    // FullCalendar (CDN)
    wp_enqueue_script(
        'fullcalendar',
        'https://cdn.jsdelivr.net/npm/fullcalendar@6.1.10/index.global.min.js',
        [],
        '6.1.10',
        true
    );
    
    // CSS y JS del plugin
    wp_enqueue_style(
        'nv-dashboard-css',
        NV_DASHBOARD_URL . 'admin/css/dashboard.css',
        [],
        NV_DASHBOARD_VERSION
    );
    
    wp_enqueue_script(
        'nv-dashboard-js',
        NV_DASHBOARD_URL . 'admin/js/dashboard.js',
        ['jquery', 'fullcalendar'],
        NV_DASHBOARD_VERSION,
        true
    );

    // v1.0.39: módulo papelera drag-drop + sistema de toasts (segundo plano)
    wp_enqueue_script(
        'nv-dashboard-trash-toasts',
        NV_DASHBOARD_URL . 'admin/js/trash-and-toasts.js',
        ['nv-dashboard-js', 'jquery'],
        NV_DASHBOARD_VERSION,
        true
    );
    
    // Pasar variables a JS
    $nv_clientes_data = [];
    $nv_terms = get_terms(['taxonomy' => 'nv_cliente', 'hide_empty' => false]);
    if (!is_wp_error($nv_terms)) {
        foreach ($nv_terms as $t) {
            $nv_clientes_data[] = [
                'term_id' => (int) $t->term_id,
                'slug'    => (string) $t->slug,
                'name'    => (string) $t->name,
            ];
        }
    }

    wp_localize_script('nv-dashboard-js', 'nvDashboard', [
        'restUrl' => rest_url('nv/v1/'),
        'restNonce' => wp_create_nonce('wp_rest'),
        'adminUrl' => admin_url(),
        'siteUrl' => home_url('/'),
        // v1.0.20: API token para "Generar imágenes con Claude" → proxy auth
        'apiToken' => function_exists('nv_dashboard_get_api_token') ? nv_dashboard_get_api_token() : '',
        // v1.0.53: mapping slug→term_id para análisis de competencia
        'clientes' => $nv_clientes_data,
    ]);
}

/**
 * v1.0.61: Permitir subir fuentes (TTF/OTF/WOFF/WOFF2) a la mediateca de WP.
 *
 * WordPress bloquea estos formatos por seguridad por defecto. Como el plugin
 * permite configurar una fuente custom por cliente (Editorial → editar cliente
 * → 🎨 Branding → fuente), necesitamos habilitar la subida.
 *
 * Solo aplica a usuarios que pueden gestionar categorías (admin/editor) — esto
 * evita que un suscriptor abra una superficie de ataque adicional.
 *
 * También se añade un filtro `wp_check_filetype_and_ext` por compatibilidad con
 * hostings que validan estrictamente el MIME real del archivo y rechazan TTF
 * incluso con la extensión correcta.
 */
add_filter('upload_mimes', 'nv_dashboard_allow_font_uploads');
function nv_dashboard_allow_font_uploads($mimes) {
    if (!current_user_can('manage_categories')) return $mimes;
    $mimes['ttf']   = 'font/ttf';
    $mimes['otf']   = 'font/otf';
    $mimes['woff']  = 'font/woff';
    $mimes['woff2'] = 'font/woff2';
    return $mimes;
}

add_filter('wp_check_filetype_and_ext', 'nv_dashboard_fix_font_mime', 10, 4);
function nv_dashboard_fix_font_mime($data, $file, $filename, $mimes) {
    if (!empty($data['ext']) && !empty($data['type'])) return $data;
    if (!current_user_can('manage_categories')) return $data;
    $ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
    $font_map = [
        'ttf'   => 'font/ttf',
        'otf'   => 'font/otf',
        'woff'  => 'font/woff',
        'woff2' => 'font/woff2',
    ];
    if (isset($font_map[$ext])) {
        $data['ext']  = $ext;
        $data['type'] = $font_map[$ext];
    }
    return $data;
}
