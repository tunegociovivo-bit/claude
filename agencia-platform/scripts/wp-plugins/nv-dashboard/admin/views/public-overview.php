<?php
/**
 * Vista pública: Vista General del NV Dashboard
 *
 * Variables disponibles desde NV_Public_Dashboard::render():
 *   $stats          - Array con totales (total, aprobadas, pendientes, programadas, publicadas)
 *   $clientes       - Array de WP_Term de clientes
 *   $cliente_actual - Slug del cliente filtrado o 'all'
 *   $base_public_url - URL base pública del dashboard
 *   $can_edit       - bool, si el usuario logueado puede editar
 *
 * @since 1.0.5
 */
if (!defined('ABSPATH')) exit;
?>

<div class="wrap nv-dashboard nv-public-wrap">

    <div class="nv-stats-grid">
        <div class="nv-stat-card">
            <p class="nv-stat-label">Total publicaciones</p>
            <p class="nv-stat-value"><?php echo (int) $stats['total']; ?></p>
        </div>
        <div class="nv-stat-card nv-stat-warning">
            <p class="nv-stat-label">Pendientes aprobar</p>
            <p class="nv-stat-value"><?php echo (int) $stats['pendientes']; ?></p>
        </div>
        <div class="nv-stat-card nv-stat-success">
            <p class="nv-stat-label">Aprobadas</p>
            <p class="nv-stat-value"><?php echo (int) $stats['aprobadas']; ?></p>
        </div>
        <div class="nv-stat-card nv-stat-info">
            <p class="nv-stat-label">Programadas</p>
            <p class="nv-stat-value"><?php echo (int) $stats['programadas']; ?></p>
        </div>
        <div class="nv-stat-card nv-stat-purple">
            <p class="nv-stat-label">Publicadas</p>
            <p class="nv-stat-value"><?php echo (int) $stats['publicadas']; ?></p>
        </div>
    </div>
    
    <!-- v1.0.6: Stats granulares -->
    <div id="nv-granular-stats" class="nv-granular-stats"
         data-cliente="<?php echo esc_attr($cliente_actual); ?>"
         style="margin-top: 24px;">
        <h3 style="margin: 0 0 14px;">📊 Distribución por red y tipo</h3>
        <div class="nv-granular-grid">
            <div class="nv-granular-card">
                <h4>Por red social</h4>
                <div class="nv-granular-list" id="nv-granular-redes">
                    <span class="nv-loading">Cargando…</span>
                </div>
            </div>
            <div class="nv-granular-card">
                <h4>Por tipo de contenido</h4>
                <div class="nv-granular-list" id="nv-granular-tipos">
                    <span class="nv-loading">Cargando…</span>
                </div>
            </div>
        </div>
    </div>

    <div class="nv-quick-actions">
        <?php if ($can_edit): ?>
            <a href="<?php echo esc_url(admin_url('post-new.php?post_type=nv_publicacion')); ?>"
               class="button button-primary nv-button-gold" target="_top">
                + Nueva publicación
            </a>
        <?php endif; ?>

        <a href="<?php echo esc_url(add_query_arg(['vista' => 'editorial', 'cliente' => $cliente_actual], $base_public_url)); ?>"
           class="button">
            Ver calendario mensual
        </a>

        <?php if ($can_edit): ?>
            <a href="<?php echo esc_url(admin_url('edit.php?post_type=nv_publicacion&meta_key=nv_aprobar_metricool&meta_value=1')); ?>"
               class="button" target="_top">
                Ver aprobadas en wp-admin
            </a>
        <?php endif; ?>
    </div>

    <div class="nv-info-box">
        <h3>👋 NV Dashboard · URL pública</h3>
        <p>Esta vista es <strong>embebible</strong> en cualquier plataforma mediante iframe. URLs útiles:</p>

        <ul style="margin-top: 12px; line-height: 1.8;">
            <li><code><?php echo esc_html($base_public_url); ?></code> · Vista general</li>
            <li><code><?php echo esc_html($base_public_url); ?>?vista=editorial</code> · Calendario mensual</li>
            <li><code><?php echo esc_html($base_public_url); ?>?vista=editorial&amp;cliente=negocio-vivo</code> · Calendario filtrado por cliente</li>
        </ul>

        <?php if (!$can_edit): ?>
        <p style="margin-top: 14px; padding: 10px 12px; background: #fff7e0; border-left: 3px solid #D2A039; border-radius: 4px;">
            <strong>👁 Estás en modo solo-lectura.</strong> Para aprobar el mes, crear publicaciones o editar copy,
            <a href="<?php echo esc_url(wp_login_url($base_public_url)); ?>">inicia sesión</a> con tu cuenta de WordPress.
        </p>
        <?php endif; ?>
    </div>

    <!-- Embed snippet helper -->
    <div class="nv-info-box" style="margin-top: 16px;">
        <h3 style="margin-top: 0;">📎 Embeber en otra plataforma</h3>
        <p>Copia el siguiente HTML y pégalo donde quieras embeber el calendario:</p>
        <pre style="background: #1e1e1e; color: #f0f0f0; padding: 12px 14px; border-radius: 4px; overflow-x: auto; font-size: 12px; line-height: 1.5; user-select: all;">&lt;iframe
  src="<?php echo esc_html($base_public_url); ?>?vista=editorial&amp;cliente=<?php echo esc_html($cliente_actual); ?>"
  width="100%"
  height="900"
  frameborder="0"
  style="border: 0; border-radius: 8px;"&gt;
&lt;/iframe&gt;</pre>
    </div>

</div>
