<?php
/**
 * NV Public Dashboard
 *
 * Expone el dashboard NV mediante una URL pública dentro del propio dominio
 * WordPress (ej: https://www.negociovivo.com/nv-dashboard/) sin necesidad de
 * acceder a /wp-admin/. La página renderizada es iframe-friendly y se adapta
 * según el estado de login del usuario:
 *
 *   - Usuario logueado con permiso edit_posts → vista interactiva completa
 *     (puede aprobar mes, ver botones de edición, etc.)
 *   - Usuario sin login → vista solo-lectura (calendario, no acciones de
 *     escritura). Los endpoints REST API protegidos seguirán requiriendo
 *     auth, así que ningún visitante anónimo puede modificar nada.
 *
 * URLs disponibles:
 *   /nv-dashboard/                              → vista overview (todos)
 *   /nv-dashboard/?cliente=negocio-vivo         → overview filtrado
 *   /nv-dashboard/?vista=editorial              → calendario mensual
 *   /nv-dashboard/?vista=editorial&cliente=...  → calendario filtrado
 *
 * @package NV_Dashboard
 * @since 1.0.5
 */

if (!defined('ABSPATH')) {
    exit;
}

class NV_Public_Dashboard {

    /**
     * Slug de la URL pública. Cambiar aquí si se quisiera renombrar.
     */
    const SLUG = 'nv-dashboard';

    /**
     * Bootstrap
     */
    public static function init() {
        add_action('init', [__CLASS__, 'register_rewrite_rules']);
        add_filter('query_vars', [__CLASS__, 'register_query_vars']);
        add_action('template_redirect', [__CLASS__, 'maybe_render'], 1);
    }

    /**
     * Registra rewrite rules para /nv-dashboard/ y subrutas
     */
    public static function register_rewrite_rules() {
        add_rewrite_rule(
            '^' . self::SLUG . '/?$',
            'index.php?nv_dashboard_public=1',
            'top'
        );
    }

    /**
     * Declara las query vars que utilizamos
     */
    public static function register_query_vars($vars) {
        $vars[] = 'nv_dashboard_public';
        return $vars;
    }

    /**
     * Si la URL actual es la pública del dashboard, renderiza y termina
     */
    public static function maybe_render() {
        if (!get_query_var('nv_dashboard_public')) {
            return;
        }

        // Permitir embed en iframe de cualquier origen del propio site.
        // No mandamos X-Frame-Options para que se pueda embeber en otras
        // plataformas (Notion, CRM, etc.) si el host lo permite.
        // CSP frame-ancestors la deja a discreción del admin.
        @header_remove('X-Frame-Options');

        // No-cache para que siempre muestre datos frescos
        nocache_headers();

        $vista = isset($_GET['vista']) ? sanitize_key($_GET['vista']) : 'overview';
        $cliente = isset($_GET['cliente']) ? sanitize_text_field($_GET['cliente']) : 'all';

        // Vistas válidas
        if (!in_array($vista, ['overview', 'editorial'], true)) {
            $vista = 'overview';
        }

        self::render($vista, $cliente);
        exit;
    }

    /**
     * Renderiza el HTML completo (sin chrome de wp-admin)
     */
    private static function render($vista, $cliente) {
        $puede_editar = current_user_can('edit_posts');
        $usuario = wp_get_current_user();

        // Datos comunes
        $clientes = get_terms(['taxonomy' => 'nv_cliente', 'hide_empty' => false]);
        if (is_wp_error($clientes)) {
            $clientes = [];
        }

        // URLs base públicas
        $base_url = home_url('/' . self::SLUG . '/');

        // CSS/JS del plugin
        $css_url = NV_DASHBOARD_URL . 'admin/css/dashboard.css';
        $public_css_url = NV_DASHBOARD_URL . 'admin/css/public-dashboard.css';
        $js_url = NV_DASHBOARD_URL . 'admin/js/dashboard.js';
        $public_js_url = NV_DASHBOARD_URL . 'admin/js/public-dashboard.js';
        $version = NV_DASHBOARD_VERSION;

        // Stats si vista=overview
        $stats = null;
        if ($vista === 'overview') {
            $stats = self::compute_stats($cliente);
        }

        // Renderizar shell + vista interna
        ?><!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex, nofollow">
    <title>NV Dashboard · <?php echo esc_html($vista === 'editorial' ? 'Editorial' : 'Vista General'); ?></title>

    <!-- jQuery (necesario para dashboard.js) -->
    <script src="<?php echo esc_url(includes_url('js/jquery/jquery.min.js?ver=3.7.1')); ?>"></script>

    <!-- FullCalendar -->
    <?php if ($vista === 'editorial'): ?>
    <script src="https://cdn.jsdelivr.net/npm/fullcalendar@6.1.10/index.global.min.js"></script>
    <?php endif; ?>

    <!-- CSS dashboard original (estilos NV) -->
    <link rel="stylesheet" href="<?php echo esc_url($css_url . '?ver=' . $version); ?>">

    <!-- CSS específico del modo público (sin wp-admin chrome) -->
    <link rel="stylesheet" href="<?php echo esc_url($public_css_url . '?ver=' . $version); ?>">
</head>
<body class="nv-public-body">

    <!-- Topbar pública -->
    <header class="nv-public-topbar">
        <div class="nv-public-topbar-inner">
            <a href="<?php echo esc_url($base_url); ?>" class="nv-public-brand">
                <span class="nv-public-brand-logo">NV</span>
                <span class="nv-public-brand-text">Dashboard Editorial</span>
            </a>

            <nav class="nv-public-nav">
                <a href="<?php echo esc_url(add_query_arg(['vista' => 'overview', 'cliente' => $cliente], $base_url)); ?>"
                   class="nv-public-nav-link <?php echo $vista === 'overview' ? 'active' : ''; ?>">
                    📊 Vista General
                </a>
                <a href="<?php echo esc_url(add_query_arg(['vista' => 'editorial', 'cliente' => $cliente], $base_url)); ?>"
                   class="nv-public-nav-link <?php echo $vista === 'editorial' ? 'active' : ''; ?>">
                    📅 Editorial
                </a>
            </nav>

            <div class="nv-public-user">
                <?php if ($puede_editar): ?>
                    <span class="nv-public-user-badge nv-public-user-edit">
                        ✏️ Modo edición · <?php echo esc_html($usuario->display_name); ?>
                    </span>
                    <a href="<?php echo esc_url(admin_url('admin.php?page=nv-dashboard')); ?>"
                       class="nv-public-link-admin" target="_top">Abrir en wp-admin →</a>
                <?php else: ?>
                    <span class="nv-public-user-badge nv-public-user-readonly">
                        👁 Solo lectura
                    </span>
                    <a href="<?php echo esc_url(wp_login_url($base_url . '?vista=' . $vista . '&cliente=' . $cliente)); ?>"
                       class="nv-public-link-admin">Iniciar sesión →</a>
                <?php endif; ?>
            </div>
        </div>
    </header>

    <!-- Selector cliente -->
    <div class="nv-public-cliente-bar">
        <div class="nv-public-cliente-bar-inner">
            <label for="nv-public-cliente-select" class="nv-public-cliente-label">Cliente:</label>
            <select id="nv-public-cliente-select" class="nv-public-cliente-select"
                    onchange="window.location.href='<?php echo esc_url($base_url); ?>?vista=<?php echo esc_attr($vista); ?>&cliente=' + this.value">
                <option value="all" <?php selected($cliente, 'all'); ?>>Todos los clientes</option>
                <?php foreach ($clientes as $c): ?>
                    <option value="<?php echo esc_attr($c->slug); ?>" <?php selected($cliente, $c->slug); ?>>
                        <?php echo esc_html($c->name); ?>
                    </option>
                <?php endforeach; ?>
            </select>

            <?php if (!$puede_editar): ?>
            <span class="nv-public-readonly-notice">
                Esta vista es de solo lectura · <a href="<?php echo esc_url(wp_login_url($base_url . '?vista=' . $vista . '&cliente=' . $cliente)); ?>">Iniciar sesión</a> para editar
            </span>
            <?php endif; ?>
        </div>
    </div>

    <!-- Contenido -->
    <main class="nv-public-main">
        <?php
        // Contexto disponible en las views públicas
        $cliente_actual = $cliente;
        $base_public_url = $base_url;
        $can_edit = $puede_editar;

        if ($vista === 'editorial') {
            include NV_DASHBOARD_PATH . 'admin/views/public-editorial.php';
        } else {
            include NV_DASHBOARD_PATH . 'admin/views/public-overview.php';
        }
        ?>
    </main>

    <footer class="nv-public-footer">
        <p>
            NV Dashboard v<?php echo esc_html($version); ?> ·
            <a href="https://negociovivo.com" target="_blank" rel="noopener">Negocio Vivo</a> ·
            URL pública embebible
        </p>
    </footer>

    <!-- Variables JS comunes -->
    <script>
        window.nvDashboard = {
            restUrl:   <?php echo wp_json_encode(rest_url('nv/v1/')); ?>,
            wpRestUrl: <?php echo wp_json_encode(rest_url('wp/v2/')); ?>,
            restNonce: <?php echo wp_json_encode(wp_create_nonce('wp_rest')); ?>,
            adminUrl:  <?php echo wp_json_encode(admin_url()); ?>,
            baseUrl:   <?php echo wp_json_encode($base_url); ?>,
            isPublic:  true,
            canEdit:   <?php echo $puede_editar ? 'true' : 'false'; ?>
        };
    </script>

    <!-- JS dashboard original (calendario etc.) -->
    <script src="<?php echo esc_url($js_url . '?ver=' . $version); ?>"></script>

    <!-- JS específico modo público (overrides para enlaces) -->
    <script src="<?php echo esc_url($public_js_url . '?ver=' . $version); ?>"></script>

    <?php if ($vista === 'editorial'): ?>
    <script>
        window.nvCliente = <?php echo wp_json_encode($cliente); ?>;
        window.nvCurrentMonth = <?php echo wp_json_encode(date('Y-m')); ?>;
        window.nvAvataresUrls = <?php echo wp_json_encode(array_filter(preg_split('/\R/', (string) get_option('nv_dashboard_avatares_urls', '')))); ?>;
        window.nvSiteUrl = <?php echo wp_json_encode(home_url('/')); ?>;
        window.nvRestBase = <?php echo wp_json_encode(rest_url('nv/v1/')); ?>;
    </script>
    <?php endif; ?>

</body>
</html><?php
    }

    /**
     * Computa estadísticas para el overview
     */
    private static function compute_stats($cliente) {
        $args = [
            'post_type' => 'nv_publicacion',
            'posts_per_page' => -1,
            'post_status' => 'publish',
        ];
        if ($cliente !== 'all') {
            $args['tax_query'] = [[
                'taxonomy' => 'nv_cliente',
                'field' => 'slug',
                'terms' => $cliente,
            ]];
        }
        $publicaciones = get_posts($args);

        $stats = [
            'total' => count($publicaciones),
            'aprobadas' => 0,
            'pendientes' => 0,
            'programadas' => 0,
            'publicadas' => 0,
        ];
        foreach ($publicaciones as $p) {
            $estado = function_exists('get_field') ? get_field('nv_estado', $p->ID) : '';
            $estado = $estado ?: 'borrador';
            $aprobado = function_exists('get_field') ? get_field('nv_aprobar_metricool', $p->ID) : false;

            if ($estado === 'publicado') {
                $stats['publicadas']++;
            } elseif ($estado === 'programado') {
                $stats['programadas']++;
            } elseif ($aprobado) {
                $stats['aprobadas']++;
            } else {
                $stats['pendientes']++;
            }
        }
        return $stats;
    }
}
