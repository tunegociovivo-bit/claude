<?php
/**
 * Custom Post Type: Publicación Editorial
 */

if (!defined('ABSPATH')) exit;

class NV_CPT_Publicacion {
    
    public static function init() {
        add_action('init', [__CLASS__, 'register']);
        add_filter('manage_nv_publicacion_posts_columns', [__CLASS__, 'admin_columns']);
        add_action('manage_nv_publicacion_posts_custom_column', [__CLASS__, 'admin_column_content'], 10, 2);
    }
    
    public static function register() {
        nv_dashboard_register_post_type();
    }
    
    public static function admin_columns($cols) {
        $new = [];
        $new['cb'] = $cols['cb'];
        $new['title'] = 'Título';
        $new['nv_cliente'] = 'Cliente';
        $new['nv_tipo'] = 'Tipo';
        $new['nv_fecha'] = 'Fecha publicación';
        $new['nv_estado'] = 'Estado';
        $new['nv_aprobado'] = 'Aprobado';
        return $new;
    }
    
    public static function admin_column_content($column, $post_id) {
        switch ($column) {
            case 'nv_cliente':
                $terms = get_the_terms($post_id, 'nv_cliente');
                if ($terms && !is_wp_error($terms)) {
                    echo esc_html($terms[0]->name);
                }
                break;
                
            case 'nv_tipo':
                $tipo = get_field('nv_tipo', $post_id);
                $colores = [
                    'reel' => '#FAEEDA;color:#854F0B',
                    'imagen' => '#E6F1FB;color:#0C447C',
                    'carrusel' => '#EEEDFE;color:#3C3489',
                    'story' => '#E1F5EE;color:#085041',
                ];
                $estilo = $colores[$tipo] ?? '#f0f0f0;color:#666';
                echo '<span style="background:' . $estilo . ';padding:3px 8px;border-radius:4px;font-size:11px;text-transform:uppercase">' . esc_html($tipo) . '</span>';
                break;
                
            case 'nv_fecha':
                $fecha = get_field('nv_fecha_publicacion', $post_id);
                if ($fecha) {
                    echo esc_html(date('d/m/Y H:i', strtotime($fecha)));
                }
                break;
                
            case 'nv_estado':
                $estado = get_field('nv_estado', $post_id) ?: 'borrador';
                $estados = [
                    'borrador' => ['#f0f0f0', '#666', 'Borrador'],
                    'revision' => ['#FAEEDA', '#854F0B', 'En revisión'],
                    'aprobado' => ['#E1F5EE', '#085041', 'Aprobado'],
                    'programado' => ['#E6F1FB', '#0C447C', 'Programado'],
                    'publicado' => ['#EEEDFE', '#3C3489', 'Publicado'],
                ];
                $e = $estados[$estado] ?? $estados['borrador'];
                echo '<span style="background:' . $e[0] . ';color:' . $e[1] . ';padding:3px 8px;border-radius:4px;font-size:11px">' . $e[2] . '</span>';
                break;
                
            case 'nv_aprobado':
                $ok = get_field('nv_aprobar_metricool', $post_id);
                echo $ok ? '<span style="color:#28a745;font-size:18px">✓</span>' : '<span style="color:#ccc">—</span>';
                break;
        }
    }
}
