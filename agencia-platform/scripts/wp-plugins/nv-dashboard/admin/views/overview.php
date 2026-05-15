<?php
/**
 * Vista General del NV Dashboard
 * @var array $stats
 * @var array $clientes
 * @var string $cliente_actual
 */
if (!defined('ABSPATH')) exit;
?>

<div class="wrap nv-dashboard">
    <div class="nv-header">
        <div class="nv-logo-block">
            <div class="nv-logo">NV</div>
            <div>
                <h1>NV Dashboard</h1>
                <p class="nv-subtitle">Centro de control · Negocio Vivo</p>
            </div>
        </div>
        
        <div class="nv-cliente-selector">
            <label>Cliente:</label>
            <select onchange="window.location.href='?page=nv-dashboard&cliente='+this.value">
                <option value="all" <?php selected($cliente_actual, 'all'); ?>>Todos los clientes</option>
                <?php foreach ($clientes as $c): ?>
                    <option value="<?php echo esc_attr($c->slug); ?>" <?php selected($cliente_actual, $c->slug); ?>>
                        <?php echo esc_html($c->name); ?>
                    </option>
                <?php endforeach; ?>
            </select>
        </div>
    </div>
    
    <div class="nv-tabs">
        <a href="?page=nv-dashboard" class="nv-tab active">📊 Vista General</a>
        <a href="?page=nv-dashboard-editorial" class="nv-tab">📅 Editorial</a>
        <a href="<?php echo admin_url('edit.php?post_type=nv_publicacion'); ?>" class="nv-tab">📝 Publicaciones</a>
        <a href="<?php echo admin_url('edit-tags.php?taxonomy=nv_cliente&post_type=nv_publicacion'); ?>" class="nv-tab">👥 Clientes</a>
        <a href="?page=nv-dashboard-settings" class="nv-tab">⚙️ Configuración</a>
    </div>
    
    <div class="nv-stats-grid">
        <div class="nv-stat-card">
            <p class="nv-stat-label">Total publicaciones</p>
            <p class="nv-stat-value"><?php echo $stats['total']; ?></p>
        </div>
        <div class="nv-stat-card nv-stat-warning">
            <p class="nv-stat-label">Pendientes aprobar</p>
            <p class="nv-stat-value"><?php echo $stats['pendientes']; ?></p>
        </div>
        <div class="nv-stat-card nv-stat-success">
            <p class="nv-stat-label">Aprobadas</p>
            <p class="nv-stat-value"><?php echo $stats['aprobadas']; ?></p>
        </div>
        <div class="nv-stat-card nv-stat-info">
            <p class="nv-stat-label">Programadas</p>
            <p class="nv-stat-value"><?php echo $stats['programadas']; ?></p>
        </div>
        <div class="nv-stat-card nv-stat-purple">
            <p class="nv-stat-label">Publicadas</p>
            <p class="nv-stat-value"><?php echo $stats['publicadas']; ?></p>
        </div>
    </div>
    
    <!-- v1.0.6: Stats granulares por red y tipo -->
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
        <a href="<?php echo admin_url('post-new.php?post_type=nv_publicacion'); ?>" class="button button-primary nv-button-gold">
            + Nueva publicación
        </a>
        <a href="?page=nv-dashboard-editorial" class="button">
            Ver calendario mensual
        </a>
        <a href="<?php echo admin_url('edit.php?post_type=nv_publicacion&meta_key=nv_aprobar_metricool&meta_value=1'); ?>" class="button">
            Ver aprobadas
        </a>
    </div>
    
    <div class="nv-info-box">
        <h3>👋 Bienvenido a NV Dashboard</h3>
        <p>Tu centro unificado de gestión editorial para todos los clientes de Negocio Vivo.</p>
        <ol>
            <li><strong>Crea publicaciones</strong> en "Publicaciones" con el copy, fecha, asset y redes.</li>
            <li><strong>Revisa el calendario</strong> en la pestaña "Editorial" para ver todo el mes de un vistazo.</li>
            <li><strong>Marca como aprobadas</strong> las que estén listas (checkbox "Aprobar para Metricool").</li>
            <li><strong>Click en "Aprobar mes"</strong> y se genera CSV + email automático para subir a Metricool.</li>
        </ol>
        <p>📚 <a href="?page=nv-dashboard-settings">Configura el webhook Make en Configuración →</a></p>
    </div>
</div>
