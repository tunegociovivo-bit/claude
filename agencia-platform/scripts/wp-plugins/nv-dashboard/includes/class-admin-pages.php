<?php
/**
 * Páginas del Dashboard NV en el admin de WordPress
 */

if (!defined('ABSPATH')) exit;

class NV_Admin_Pages {
    
    public static function init() {
        add_action('admin_menu', [__CLASS__, 'register_menus']);
    }
    
    public static function register_menus() {
        // Menú principal
        add_menu_page(
            'NV Dashboard',
            'NV Dashboard',
            'edit_posts',
            'nv-dashboard',
            [__CLASS__, 'render_overview'],
            'dashicons-chart-area',
            3
        );
        
        // Submenús (v1.0.48: 7º parámetro de add_submenu_page debe omitirse o ser numérico — pasar null genera notice de WP 5.3+)
        add_submenu_page(
            'nv-dashboard',
            'Vista General',
            '📊 Vista General',
            'edit_posts',
            'nv-dashboard',
            [__CLASS__, 'render_overview']);
        
        add_submenu_page(
            'nv-dashboard',
            'Editorial',
            '📅 Editorial',
            'edit_posts',
            'nv-dashboard-editorial',
            [__CLASS__, 'render_editorial']);
        
        add_submenu_page(
            'nv-dashboard',
            'Publicaciones',
            '📝 Publicaciones',
            'edit_posts',
            'edit.php?post_type=nv_publicacion',
            '');
        
        add_submenu_page(
            'nv-dashboard',
            'Clientes',
            '👥 Clientes',
            'edit_posts',
            'nv-dashboard-clientes',
            [__CLASS__, 'render_clientes']);

        // Mantener acceso directo a la pantalla nativa de WP por si la prefieres
        add_submenu_page(
            'nv-dashboard',
            'Clientes (lista WP)',
            '↳ Lista WP',
            'edit_posts',
            'edit-tags.php?taxonomy=nv_cliente&post_type=nv_publicacion',
            '');
        
        add_submenu_page(
            'nv-dashboard',
            'Configuración',
            '⚙️ Configuración',
            'manage_options',
            'nv-dashboard-settings',
            [__CLASS__, 'render_settings']);

        // v1.0.41: página de diagnóstico
        add_submenu_page(
            'nv-dashboard',
            'Diagnóstico',
            '🩺 Diagnóstico',
            'edit_posts',
            'nv-dashboard-diagnostico',
            [__CLASS__, 'render_diagnostico']);

        // v1.0.47: página de estado del plugin (versión, rutas REST, flush manual)
        add_submenu_page(
            'nv-dashboard',
            'Estado del plugin',
            '🔧 Estado del plugin',
            'manage_options',
            'nv-dashboard-status',
            [__CLASS__, 'render_status']);
    }

    /**
     * v1.0.41 — Página de diagnóstico para imágenes problemáticas.
     * Permite introducir un ID de publicación y ver el estado interno completo.
     */
    public static function render_diagnostico() {
        $view = NV_DASHBOARD_PATH . 'admin/views/diagnostico.php';
        if (file_exists($view)) {
            include $view;
        } else {
            echo '<div class="wrap"><h1>Diagnóstico</h1><p>Vista no encontrada.</p></div>';
        }
    }

    /**
     * v1.0.47 — Página de estado del plugin.
     */
    public static function render_status() {
        if (isset($_POST['nv_flush_permalinks']) && check_admin_referer('nv_flush_permalinks')) {
            flush_rewrite_rules(false);
            echo '<div class="notice notice-success is-dismissible"><p>✓ Permalinks refrescados. Las rutas REST se han re-registrado.</p></div>';
        }
        $view = NV_DASHBOARD_PATH . 'admin/views/status.php';
        if (file_exists($view)) {
            include $view;
        } else {
            echo '<div class="wrap"><h1>Estado del plugin</h1><p>Vista no encontrada.</p></div>';
        }
    }
    
    /**
     * Vista general (resumen)
     */
    public static function render_overview() {
        $clientes = get_terms(['taxonomy' => 'nv_cliente', 'hide_empty' => false]);
        $cliente_actual = isset($_GET['cliente']) ? sanitize_text_field($_GET['cliente']) : 'all';
        
        // Stats
        $args = [
            'post_type' => 'nv_publicacion',
            'posts_per_page' => -1,
            'post_status' => 'publish',
        ];
        if ($cliente_actual !== 'all') {
            $args['tax_query'] = [[
                'taxonomy' => 'nv_cliente',
                'field' => 'slug',
                'terms' => $cliente_actual,
            ]];
        }
        $publicaciones = get_posts($args);
        
        $stats = ['total' => count($publicaciones), 'aprobadas' => 0, 'pendientes' => 0, 'programadas' => 0, 'publicadas' => 0];
        foreach ($publicaciones as $p) {
            $estado = get_field('nv_estado', $p->ID) ?: 'borrador';
            $aprobado = get_field('nv_aprobar_metricool', $p->ID);
            
            if ($estado === 'publicado') $stats['publicadas']++;
            elseif ($estado === 'programado') $stats['programadas']++;
            elseif ($aprobado) $stats['aprobadas']++;
            else $stats['pendientes']++;
        }
        
        include NV_DASHBOARD_PATH . 'admin/views/overview.php';
    }
    
    /**
     * Vista editorial (calendario)
     */
    public static function render_editorial() {
        $clientes = get_terms(['taxonomy' => 'nv_cliente', 'hide_empty' => false]);
        $cliente_actual = isset($_GET['cliente']) ? sanitize_text_field($_GET['cliente']) : 'all';
        
        include NV_DASHBOARD_PATH . 'admin/views/editorial.php';
    }
    
    /**
     * Vista configuración
     */
    public static function render_settings() {
        if (isset($_POST['nv_save_settings']) && check_admin_referer('nv_settings')) {
            update_option('nv_dashboard_make_webhook_url', esc_url_raw($_POST['make_webhook_url'] ?? ''));
            update_option('nv_dashboard_drive_folder_id', sanitize_text_field($_POST['drive_folder_id'] ?? ''));
            update_option('nv_dashboard_metricool_brand_name', sanitize_text_field($_POST['metricool_brand_name'] ?? ''));
            update_option('nv_dashboard_notification_email', sanitize_email($_POST['notification_email'] ?? ''));
            // v1.0.8: API key Anthropic + modelo
            if (!empty($_POST['anthropic_api_key'])) {
                update_option('nv_dashboard_anthropic_api_key', sanitize_text_field($_POST['anthropic_api_key']));
            }
            update_option('nv_dashboard_anthropic_model', sanitize_text_field($_POST['anthropic_model'] ?? 'claude-sonnet-4-5'));
            // v1.0.11: URLs avatar Negocio Vivo (textarea, una por línea)
            $avatares_raw = isset($_POST['nv_avatares_urls']) ? wp_unslash($_POST['nv_avatares_urls']) : '';
            $avatares_clean = [];
            foreach (preg_split('/\R/', $avatares_raw) as $line) {
                $u = esc_url_raw(trim($line));
                if ($u) $avatares_clean[] = $u;
            }
            update_option('nv_dashboard_avatares_urls', implode("\n", $avatares_clean));

            // v1.0.15: OpenAI API key (para gpt-image-2) + modelo de imagen por cliente
            if (!empty($_POST['openai_api_key'])) {
                update_option('nv_dashboard_openai_api_key', sanitize_text_field($_POST['openai_api_key']));
            }
            // v1.0.25: Freepik API key
            if (isset($_POST['freepik_api_key'])) {
                update_option('nv_dashboard_freepik_api_key', sanitize_text_field($_POST['freepik_api_key']));
            }
            // Modelo de imagen por defecto (global)
            $modelo_global = sanitize_text_field($_POST['nv_modelo_imagen_default'] ?? 'seedream-v4-5-edit');
            $modelos_validos = ['seedream-v4-5-edit', 'gpt-image-2', 'mystic-2-5', 'gpt-1-5-high', 'nano-banana-pro'];
            if (in_array($modelo_global, $modelos_validos, true)) {
                update_option('nv_dashboard_modelo_imagen_default', $modelo_global);
            }
            // Modelo de imagen por cliente (override del global) — formato JSON {slug: modelo}
            $por_cliente_raw = isset($_POST['nv_modelo_imagen_por_cliente']) && is_array($_POST['nv_modelo_imagen_por_cliente'])
                ? $_POST['nv_modelo_imagen_por_cliente'] : [];
            $por_cliente_clean = [];
            foreach ($por_cliente_raw as $slug => $modelo) {
                $slug = sanitize_text_field($slug);
                $modelo = sanitize_text_field($modelo);
                if ($slug && in_array($modelo, $modelos_validos, true)) {
                    $por_cliente_clean[$slug] = $modelo;
                }
            }
            update_option('nv_dashboard_modelo_imagen_por_cliente', wp_json_encode($por_cliente_clean));

            // v1.0.22: Google OAuth (Drive Picker + auto-create)
            if (isset($_POST['google_client_id'])) {
                update_option('nv_dashboard_google_client_id', sanitize_text_field($_POST['google_client_id']));
            }
            if (isset($_POST['google_api_key'])) {
                update_option('nv_dashboard_google_api_key', sanitize_text_field($_POST['google_api_key']));
            }

            // v1.0.76: URL de destino tras login (Sign in with Google, password, etc.).
            // Sanitizado en NV_Login_Redirect::get_configured_url() en cada uso —
            // aquí solo guardamos el string crudo (acepta tanto absoluta como
            // relativa "/wp-admin/admin.php?page=nv-dashboard").
            if (isset($_POST['nv_login_redirect_url'])) {
                $url_raw = trim(wp_unslash($_POST['nv_login_redirect_url']));
                // Permitir vacío para volver al default WP
                if ($url_raw === '') {
                    delete_option('nv_dashboard_login_redirect_url');
                } else {
                    // Solo guardar si es URL bien formada o ruta relativa razonable
                    if (preg_match('#^(https?://|/)#i', $url_raw)) {
                        update_option('nv_dashboard_login_redirect_url', esc_url_raw($url_raw, ['http', 'https']));
                    }
                }
            }

            // v1.0.77: Configuración PWA (Add to Home Screen)
            if (isset($_POST['nv_pwa_app_name'])) {
                $v = sanitize_text_field(wp_unslash($_POST['nv_pwa_app_name']));
                $v = mb_substr($v, 0, 60);
                if ($v === '') delete_option('nv_dashboard_pwa_app_name');
                else           update_option('nv_dashboard_pwa_app_name', $v);
            }
            if (isset($_POST['nv_pwa_short_name'])) {
                $v = sanitize_text_field(wp_unslash($_POST['nv_pwa_short_name']));
                $v = mb_substr($v, 0, 12);
                if ($v === '') delete_option('nv_dashboard_pwa_short_name');
                else           update_option('nv_dashboard_pwa_short_name', $v);
            }
            if (isset($_POST['nv_pwa_theme_color'])) {
                $v = trim((string) $_POST['nv_pwa_theme_color']);
                if ($v === '' || !preg_match('/^#[0-9A-Fa-f]{6}$/', $v)) {
                    delete_option('nv_dashboard_pwa_theme_color');
                } else {
                    update_option('nv_dashboard_pwa_theme_color', strtoupper($v));
                }
            }

            echo '<div class="notice notice-success is-dismissible"><p>Configuración guardada.</p></div>';
        }
        
        include NV_DASHBOARD_PATH . 'admin/views/settings.php';
    }

    /**
     * v1.0.22: Página dedicada de Clientes — dashboard visual.
     */
    public static function render_clientes() {
        include NV_DASHBOARD_PATH . 'admin/views/clientes.php';
    }
}
