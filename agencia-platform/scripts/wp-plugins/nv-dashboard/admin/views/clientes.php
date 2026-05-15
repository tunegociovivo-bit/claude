<?php
/**
 * Vista: Página Clientes (NV Dashboard → 👥 Clientes)
 *
 * Dashboard visual de clientes con tarjetas que muestran estado Drive,
 * número de publicaciones, modelo IA configurado, y acciones rápidas.
 *
 * @since 1.0.22
 */

if (!defined('ABSPATH')) exit;

$clientes = get_terms([
    'taxonomy'   => 'nv_cliente',
    'hide_empty' => false,
    'orderby'    => 'name',
    'order'      => 'ASC',
]);

// Modelo de imagen
$por_cliente_json = get_option('nv_dashboard_modelo_imagen_por_cliente', '{}');
$por_cliente = json_decode($por_cliente_json, true);
if (!is_array($por_cliente)) $por_cliente = [];
$modelo_default = get_option('nv_dashboard_modelo_imagen_default', 'seedream-v4-5-edit');

// Stats globales
$total_clientes = is_array($clientes) ? count($clientes) : 0;
$configurados = 0;
$pendientes = 0;
$sin_drive = 0;
$invalidos = 0;
if (is_array($clientes)) {
    foreach ($clientes as $term) {
        if (!class_exists('NV_Cliente_Meta')) break;
        $mode = NV_Cliente_Meta::get_drive_mode($term->term_id);
        if ($mode === 'configured') {
            $root = NV_Cliente_Meta::get_drive_root_id($term->term_id);
            if (!NV_Cliente_Meta::is_valid_drive_id($root)) $invalidos++;
            else $configurados++;
        } elseif ($mode === 'no_drive_refs') $sin_drive++;
        else $pendientes++;
    }
}
?>
<div class="wrap nv-clientes-page">
    <h1 style="display:flex; align-items:center; gap:10px;">
        👥 Clientes
        <a href="<?php echo esc_url(admin_url('edit-tags.php?taxonomy=nv_cliente&post_type=nv_publicacion')); ?>" class="page-title-action">+ Nuevo cliente</a>
    </h1>

    <p class="description" style="margin: 8px 0 18px; max-width: 700px;">
        Gestión de clientes de Negocio Vivo con su configuración Drive, modelo de imagen IA y publicaciones asociadas.
        Para crear un cliente nuevo o editar campos avanzados, sigue usando la pantalla nativa de WP <a href="<?php echo esc_url(admin_url('edit-tags.php?taxonomy=nv_cliente&post_type=nv_publicacion')); ?>">Editorial → Lista WP</a>.
    </p>

    <!-- Stats summary -->
    <div class="nv-clientes-stats" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap:12px; margin-bottom:24px;">
        <div class="nv-stat-card" style="background:#fff; border:1px solid #c5d2e2; border-radius:6px; padding:14px; text-align:center;">
            <div style="font-size:28px; font-weight:600; color:#0a0a0a;"><?php echo (int) $total_clientes; ?></div>
            <div style="font-size:12px; color:#555; text-transform:uppercase; letter-spacing:.5px;">Clientes totales</div>
        </div>
        <div class="nv-stat-card" style="background:#f0f9ee; border:1px solid #2ea043; border-radius:6px; padding:14px; text-align:center;">
            <div style="font-size:28px; font-weight:600; color:#2ea043;">🟢 <?php echo (int) $configurados; ?></div>
            <div style="font-size:12px; color:#555; text-transform:uppercase; letter-spacing:.5px;">Configurados</div>
        </div>
        <div class="nv-stat-card" style="background:#fffbe5; border:1px solid #dba000; border-radius:6px; padding:14px; text-align:center;">
            <div style="font-size:28px; font-weight:600; color:#dba000;">🟡 <?php echo (int) $pendientes; ?></div>
            <div style="font-size:12px; color:#555; text-transform:uppercase; letter-spacing:.5px;">Pendientes</div>
        </div>
        <div class="nv-stat-card" style="background:#f4f4f4; border:1px solid #999; border-radius:6px; padding:14px; text-align:center;">
            <div style="font-size:28px; font-weight:600; color:#666;">⚪ <?php echo (int) $sin_drive; ?></div>
            <div style="font-size:12px; color:#555; text-transform:uppercase; letter-spacing:.5px;">Sin Drive</div>
        </div>
        <?php if ($invalidos > 0): ?>
        <div class="nv-stat-card" style="background:#fff5f5; border:1px solid #c00; border-radius:6px; padding:14px; text-align:center;">
            <div style="font-size:28px; font-weight:600; color:#c00;">🔴 <?php echo (int) $invalidos; ?></div>
            <div style="font-size:12px; color:#555; text-transform:uppercase; letter-spacing:.5px;">Inválidos</div>
        </div>
        <?php endif; ?>
    </div>

    <!-- Lista de clientes en tarjetas -->
    <?php if (empty($clientes) || is_wp_error($clientes)): ?>
        <div class="notice notice-warning"><p>No hay clientes registrados todavía. <a href="<?php echo esc_url(admin_url('edit-tags.php?taxonomy=nv_cliente&post_type=nv_publicacion')); ?>">Crea el primero aquí</a>.</p></div>
    <?php else: ?>
    <div class="nv-clientes-grid" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap:16px;">
        <?php foreach ($clientes as $term):
            $mode = class_exists('NV_Cliente_Meta') ? NV_Cliente_Meta::get_drive_mode($term->term_id) : 'pending';
            $root_id = class_exists('NV_Cliente_Meta') ? NV_Cliente_Meta::get_drive_root_id($term->term_id) : '';
            $subfolders = class_exists('NV_Cliente_Meta') ? NV_Cliente_Meta::get_drive_subfolders($term->term_id) : [];
            $is_root_valid = $mode === 'configured' && NV_Cliente_Meta::is_valid_drive_id($root_id);

            // Modelo IA
            $modelo_cliente = !empty($por_cliente[$term->slug]) ? $por_cliente[$term->slug] : $modelo_default;

            // Posts count
            $posts_count = (int) $term->count;

            // Edit URL
            $edit_url = admin_url('term.php?taxonomy=nv_cliente&tag_ID=' . $term->term_id . '&post_type=nv_publicacion');

            // Color de borde según estado
            switch ($mode) {
                case 'configured':
                    $border = $is_root_valid ? '#2ea043' : '#c00';
                    $badge_bg = $is_root_valid ? '#e6f4ea' : '#fde7e7';
                    $badge_color = $is_root_valid ? '#2ea043' : '#c00';
                    $badge_text = $is_root_valid ? '🟢 Configurado' : '🔴 ID inválido';
                    break;
                case 'no_drive_refs':
                    $border = '#999';
                    $badge_bg = '#f4f4f4';
                    $badge_color = '#666';
                    $badge_text = '⚪ Sin Drive';
                    break;
                default:
                    $border = '#dba000';
                    $badge_bg = '#fffbe5';
                    $badge_color = '#dba000';
                    $badge_text = '🟡 Pendiente';
            }
        ?>
        <div class="nv-cliente-card" style="background:#fff; border:1px solid <?php echo esc_attr($border); ?>; border-left-width:4px; border-radius:6px; padding:16px; display:flex; flex-direction:column;">
            <div style="display:flex; justify-content:space-between; align-items:start; gap:8px; margin-bottom:8px;">
                <div>
                    <h3 style="margin:0 0 2px; font-size:16px; color:#0a0a0a;"><?php echo esc_html($term->name); ?></h3>
                    <code style="font-size:11px; color:#888;"><?php echo esc_html($term->slug); ?></code>
                </div>
                <span style="background:<?php echo esc_attr($badge_bg); ?>; color:<?php echo esc_attr($badge_color); ?>; padding:3px 10px; border-radius:12px; font-size:11px; font-weight:600; white-space:nowrap;">
                    <?php echo esc_html($badge_text); ?>
                </span>
            </div>

            <div style="font-size:13px; color:#444; line-height:1.7; flex:1;">
                <div>📝 <strong><?php echo (int) $posts_count; ?></strong> publicaciones</div>
                <div>🤖 Modelo IA: <code style="background:#f0f0f0; padding:1px 6px; border-radius:3px; font-size:11px;"><?php echo esc_html($modelo_cliente); ?></code></div>
                <?php if ($mode === 'configured' && $is_root_valid): ?>
                    <div>📁 <strong><?php echo count($subfolders); ?></strong> subcarpeta<?php echo count($subfolders) === 1 ? '' : 's'; ?> Drive
                        <?php if (count($subfolders) > 0): ?>
                            <details style="margin-top:4px;">
                                <summary style="cursor:pointer; font-size:11px; color:#0073aa;">Ver tipos</summary>
                                <ul style="margin:4px 0 0 18px; font-size:11px; color:#666;">
                                    <?php foreach ($subfolders as $sf):
                                        $type_label = isset(NV_Cliente_Meta::SUBFOLDER_TYPES[$sf['type']]) ? NV_Cliente_Meta::SUBFOLDER_TYPES[$sf['type']] : $sf['type'];
                                    ?>
                                        <li><?php echo esc_html($sf['name']); ?> <span style="color:#999;"><?php echo esc_html($type_label); ?></span></li>
                                    <?php endforeach; ?>
                                </ul>
                            </details>
                        <?php endif; ?>
                    </div>
                    <div style="margin-top:6px;">
                        <a href="https://drive.google.com/drive/folders/<?php echo esc_attr($root_id); ?>" target="_blank" rel="noopener" style="font-size:11px; text-decoration:none;">
                            📂 Abrir carpeta en Drive →
                        </a>
                    </div>
                <?php elseif ($mode === 'no_drive_refs'): ?>
                    <div style="color:#888; font-style:italic;">Cliente sin refs de Drive (decisión explícita)</div>
                <?php else: ?>
                    <div style="color:#dba000;">⚠️ Drive refs sin configurar — Claude no podrá usar refs canónicas</div>
                <?php endif; ?>
            </div>

            <div style="margin-top:12px; padding-top:12px; border-top:1px solid #eee; display:flex; gap:6px; flex-wrap:wrap;">
                <a href="<?php echo esc_url($edit_url); ?>" class="button button-small">✏️ Editar</a>
                <a href="<?php echo esc_url(admin_url('edit.php?post_type=nv_publicacion&nv_cliente=' . $term->slug)); ?>" class="button button-small">📝 Ver publicaciones</a>
                <?php if ($mode === 'configured' && $is_root_valid): ?>
                    <a href="https://drive.google.com/drive/folders/<?php echo esc_attr($root_id); ?>" target="_blank" rel="noopener" class="button button-small">📂 Drive</a>
                <?php endif; ?>
            </div>
        </div>
        <?php endforeach; ?>
    </div>
    <?php endif; ?>
</div>
