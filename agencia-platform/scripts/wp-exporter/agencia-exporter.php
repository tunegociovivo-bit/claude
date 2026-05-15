<?php
/**
 * Plugin Name: Agencia Hub Exporter
 * Description: Exporta configuración y datos de los plugins NV (Reseñas IA, Voice Reviews, NV Dashboard, NV Leads) hacia hub.negociovivo.app. Instalar una vez, importar, desactivar.
 * Version: 1.0.0
 * Author: Agencia Hub
 */

if (!defined('ABSPATH')) exit;

const AGENCIA_EXPORT_NS = 'agencia-export/v1';

/**
 * Permission callback: requiere capability manage_options y por tanto un
 * usuario con sesión válida o Application Password con scope adecuado.
 */
function agencia_exporter_permission() {
    if (!current_user_can('manage_options')) {
        return new WP_Error(
            'rest_forbidden',
            'Necesitas permisos de administrador para exportar.',
            ['status' => 403]
        );
    }
    return true;
}

add_action('rest_api_init', function () {
    register_rest_route(AGENCIA_EXPORT_NS, '/ping', [
        'methods'             => 'GET',
        'permission_callback' => 'agencia_exporter_permission',
        'callback'            => function () {
            return [
                'ok'        => true,
                'wp_site'   => get_site_url(),
                'wp_admin'  => wp_get_current_user()->user_email,
                'plugin_v'  => '1.0.0',
                'plugins'   => agencia_exporter_detect_plugins(),
            ];
        },
    ]);

    register_rest_route(AGENCIA_EXPORT_NS, '/dump', [
        'methods'             => 'GET',
        'permission_callback' => 'agencia_exporter_permission',
        'callback'            => 'agencia_exporter_dump_all',
    ]);
});

function agencia_exporter_detect_plugins(): array {
    return [
        'generador_resenas' => (bool) get_option('resenas_ia_api_key', false) || is_array(get_option('resenas_ia_clientes')),
        'voice_reviews'     => post_type_exists('voice_review_business') || (bool) get_option('vr_settings'),
        'nv_dashboard'      => (bool) get_option('nv_dashboard_anthropic_api_key') || post_type_exists('nv_publicacion'),
        'nv_leads_pro'      => (bool) get_option('nvl_google_api_key') || (function_exists('NVL_Plugin') /* nunca */) || agencia_exporter_table_exists('nvl_leads'),
    ];
}

function agencia_exporter_table_exists($name): bool {
    global $wpdb;
    $full = $wpdb->prefix . $name;
    return (bool) $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $full));
}

function agencia_exporter_dump_all(WP_REST_Request $req) {
    $include = $req->get_param('include');
    $sections = $include ? explode(',', $include) : [
        'generador_resenas',
        'voice_reviews',
        'nv_dashboard',
        'nv_leads_pro',
    ];

    $out = ['site' => get_site_url(), 'exported_at' => current_time('mysql')];

    if (in_array('generador_resenas', $sections, true)) {
        $clientes = get_option('resenas_ia_clientes', []);
        if (!is_array($clientes)) $clientes = [];
        $history = [];
        foreach (array_keys($clientes) as $slug) {
            $hist = get_option('hist_ia_' . $slug, []);
            if (is_array($hist) && !empty($hist)) {
                $history[$slug] = array_slice($hist, 0, 5);
            }
        }
        $out['generador_resenas'] = [
            'api_key'   => (string) get_option('resenas_ia_api_key', ''),
            'clientes'  => $clientes,
            'history'   => $history,
        ];
    }

    if (in_array('voice_reviews', $sections, true)) {
        $settings = get_option('vr_settings', []);
        if (!is_array($settings)) $settings = [];

        $businesses = [];
        if (post_type_exists('voice_review_business')) {
            $posts = get_posts([
                'post_type'      => 'voice_review_business',
                'posts_per_page' => -1,
                'post_status'    => ['publish', 'draft', 'pending'],
            ]);
            foreach ($posts as $p) {
                $businesses[] = [
                    'id'             => $p->ID,
                    'slug'           => $p->post_name,
                    'name'           => $p->post_title,
                    'status'         => $p->post_status,
                    'name_meta'      => (string) get_post_meta($p->ID, '_vr_name', true),
                    'location'       => (string) get_post_meta($p->ID, '_vr_location', true),
                    'google_url'     => (string) get_post_meta($p->ID, '_vr_google_url', true),
                    'trustpilot_url' => (string) get_post_meta($p->ID, '_vr_trustpilot_url', true),
                    'intro_text'     => (string) get_post_meta($p->ID, '_vr_intro_text', true),
                    'disclaimer'     => (string) get_post_meta($p->ID, '_vr_disclaimer_text', true),
                    'custom_prompt'  => (string) get_post_meta($p->ID, '_vr_custom_prompt', true),
                    'max_seconds'    => (int) get_post_meta($p->ID, '_vr_max_seconds', true),
                    'short_url'      => (string) get_post_meta($p->ID, '_vr_short_url', true),
                ];
            }
        }
        $out['voice_reviews'] = [
            'settings'   => $settings,
            // Las constantes wp-config son posibles fallback; las miramos
            'env'        => [
                'anthropic'  => defined('VR_ANTHROPIC_API_KEY') ? VR_ANTHROPIC_API_KEY : '',
                'openai'     => defined('VR_OPENAI_API_KEY') ? VR_OPENAI_API_KEY : '',
            ],
            'businesses' => $businesses,
        ];
    }

    if (in_array('nv_dashboard', $sections, true)) {
        $publications = [];
        if (post_type_exists('nv_publicacion')) {
            $posts = get_posts([
                'post_type'      => 'nv_publicacion',
                'posts_per_page' => -1,
                'post_status'    => 'any',
            ]);
            foreach ($posts as $p) {
                $meta_raw = get_post_meta($p->ID);
                $meta = [];
                foreach ($meta_raw as $k => $vals) {
                    // unserialize single ACF/meta values
                    $val = is_array($vals) && count($vals) === 1 ? maybe_unserialize($vals[0]) : array_map('maybe_unserialize', $vals);
                    $meta[$k] = $val;
                }
                $publications[] = [
                    'id'        => $p->ID,
                    'title'     => $p->post_title,
                    'slug'      => $p->post_name,
                    'status'    => $p->post_status,
                    'date'      => $p->post_date,
                    'modified'  => $p->post_modified,
                    'content'   => $p->post_content,
                    'excerpt'   => $p->post_excerpt,
                    'thumbnail' => get_the_post_thumbnail_url($p->ID, 'full') ?: null,
                    'meta'      => $meta,
                    'clientes'  => wp_get_post_terms($p->ID, 'nv_cliente', ['fields' => 'all']),
                ];
            }
        }
        $out['nv_dashboard'] = [
            'options' => [
                'webhook_secret'      => (string) get_option('nv_dashboard_webhook_secret', ''),
                'api_token'           => (string) get_option('nv_dashboard_api_token', ''),
                'anthropic_api_key'   => (string) get_option('nv_dashboard_anthropic_api_key', ''),
                'openai_api_key'      => (string) get_option('nv_dashboard_openai_api_key', ''),
                'metricool_brand'     => (string) get_option('nv_dashboard_metricool_brand_name', ''),
                'metricool_token'     => (string) get_option('nv_dashboard_metricool_user_token', ''),
                'metricool_blog_id'   => (string) get_option('nv_dashboard_metricool_blog_id', ''),
                'refs_drive_folders'  => maybe_unserialize(get_option('nv_dashboard_refs_drive_folders', '')),
                'avatares_urls'       => maybe_unserialize(get_option('nv_dashboard_avatares_urls', '')),
                'version'             => (string) get_option('nv_dashboard_version', ''),
            ],
            'clientes_taxonomy' => post_type_exists('nv_publicacion')
                ? get_terms(['taxonomy' => 'nv_cliente', 'hide_empty' => false])
                : [],
            'publications'      => $publications,
            // Si hay opciones por cliente, dump simplificado:
            'cliente_configs'   => agencia_exporter_dump_options_with_prefix('nv_dashboard_cliente_config_'),
        ];
    }

    if (in_array('nv_leads_pro', $sections, true)) {
        global $wpdb;
        $tables_to_dump = [
            'nvl_searches', 'nvl_leads', 'nvl_competitors', 'nvl_messages',
            'nvl_templates', 'nvl_sequences', 'nvl_sequence_steps',
            'nvl_lead_sequences', 'nvl_inbox', 'nvl_exclusions', 'nvl_optouts',
        ];
        $tables = [];
        foreach ($tables_to_dump as $t) {
            $full = $wpdb->prefix . $t;
            if (!$wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $full))) {
                $tables[$t] = null;
                continue;
            }
            $rows = $wpdb->get_results("SELECT * FROM $full LIMIT 5000", ARRAY_A);
            $tables[$t] = $rows;
        }
        $out['nv_leads_pro'] = [
            'options' => [
                'google_api_key'      => (string) get_option('nvl_google_api_key', ''),
                'evolution_api_url'   => (string) get_option('nvl_evolution_api_url', ''),
                'evolution_api_key'   => (string) get_option('nvl_evolution_api_key', ''),
                'db_version'          => (string) get_option('nvl_db_version', ''),
            ],
            'tables' => $tables,
        ];
    }

    return $out;
}

function agencia_exporter_dump_options_with_prefix($prefix): array {
    global $wpdb;
    $rows = $wpdb->get_results(
        $wpdb->prepare("SELECT option_name, option_value FROM {$wpdb->options} WHERE option_name LIKE %s",
            $wpdb->esc_like($prefix) . '%'),
        ARRAY_A
    );
    $out = [];
    foreach ($rows as $r) {
        $out[$r['option_name']] = maybe_unserialize($r['option_value']);
    }
    return $out;
}
