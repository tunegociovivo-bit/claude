<?php
/**
 * NV Dashboard Shortcode
 *
 * Añade el shortcode [nv_dashboard] para embeber el calendario editorial
 * en cualquier página o entrada del WordPress (sin necesidad de iframe).
 *
 * El shortcode reutiliza la URL pública /nv-dashboard/ embebida como iframe
 * para máxima compatibilidad con cualquier tema (evita conflictos CSS/JS).
 *
 * Atributos:
 *  - cliente   slug del cliente, ej. "aquaking" (default: "all")
 *  - vista     "editorial" | "overview" (default: "editorial")
 *  - mes       formato YYYY-MM (default: mes actual)
 *  - height    altura del iframe en px (default: 1200)
 *  - aprobacion  "1"|"0" mostrar botón aprobación rápida (default: "1")
 *
 * Ejemplos:
 *   [nv_dashboard]
 *   [nv_dashboard cliente="aquaking" vista="editorial"]
 *   [nv_dashboard cliente="negocio-vivo" mes="2026-05" height="1400"]
 *
 * @package NV_Dashboard
 * @since 1.0.14
 */

if (!defined('ABSPATH')) {
    exit;
}

class NV_Shortcode {

    public static function init() {
        add_shortcode('nv_dashboard', [__CLASS__, 'render_shortcode']);
    }

    /**
     * Render del shortcode [nv_dashboard]
     */
    public static function render_shortcode($atts) {
        $atts = shortcode_atts([
            'cliente'    => 'all',
            'vista'      => 'editorial',
            'mes'        => date('Y-m'),
            'height'     => '1200',
            'aprobacion' => '1',
        ], $atts, 'nv_dashboard');

        // Sanitización
        $cliente = sanitize_text_field($atts['cliente']) ?: 'all';
        $vista = in_array($atts['vista'], ['editorial', 'overview'], true)
            ? $atts['vista'] : 'editorial';
        $mes = preg_match('/^\d{4}-\d{2}$/', $atts['mes'])
            ? $atts['mes'] : date('Y-m');
        $height = (int) $atts['height'] ?: 1200;
        $aprobacion = $atts['aprobacion'] === '1' ? '1' : '0';

        // URL del dashboard público con parámetros
        $base_url = home_url('/' . NV_Public_Dashboard::SLUG . '/');
        $iframe_src = add_query_arg([
            'vista'      => $vista,
            'cliente'    => $cliente,
            'mes'        => $mes,
            'aprobacion' => $aprobacion,
            'embed'      => '1',  // flag interno para detectar iframe embed
        ], $base_url);

        // ID único por instancia
        $unique_id = 'nv-dashboard-embed-' . wp_generate_uuid4();

        ob_start();
        ?>
        <div class="nv-dashboard-shortcode-wrapper" style="width:100%;margin:1rem 0;">
            <iframe
                id="<?php echo esc_attr($unique_id); ?>"
                src="<?php echo esc_url($iframe_src); ?>"
                style="width:100%;height:<?php echo (int) $height; ?>px;border:1px solid #e5e7eb;border-radius:12px;background:#fff;"
                loading="lazy"
                title="NV Dashboard Editorial"
                referrerpolicy="same-origin">
                Tu navegador no soporta iframes. <a href="<?php echo esc_url($iframe_src); ?>">Abrir el dashboard</a>.
            </iframe>
        </div>
        <?php
        return ob_get_clean();
    }
}
