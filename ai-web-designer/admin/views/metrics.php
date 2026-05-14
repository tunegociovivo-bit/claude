<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }
$m = AIWD_Metrics::snapshot();
$statuses = aiwd_project_statuses();
?>
<div class="wrap aiwd-wrap aiwd-metrics">
    <h1><?php esc_html_e( 'Dashboard de productividad', 'ai-web-designer' ); ?></h1>
    <p class="description"><?php esc_html_e( 'KPIs internos de la agencia. Datos en vivo desde el plugin.', 'ai-web-designer' ); ?></p>

    <div class="aiwd-kpi-row">
        <div class="aiwd-kpi">
            <span class="aiwd-kpi-label"><?php esc_html_e( 'Proyectos totales', 'ai-web-designer' ); ?></span>
            <strong><?php echo (int) $m['total_projects']; ?></strong>
        </div>
        <div class="aiwd-kpi">
            <span class="aiwd-kpi-label"><?php esc_html_e( 'Creados (30d)', 'ai-web-designer' ); ?></span>
            <strong><?php echo (int) $m['created_in_range']; ?></strong>
        </div>
        <div class="aiwd-kpi">
            <span class="aiwd-kpi-label"><?php esc_html_e( 'Publicados (30d)', 'ai-web-designer' ); ?></span>
            <strong><?php echo (int) $m['published_in_range']; ?></strong>
        </div>
        <div class="aiwd-kpi">
            <span class="aiwd-kpi-label"><?php esc_html_e( 'Tiempo medio entrega', 'ai-web-designer' ); ?></span>
            <strong><?php echo esc_html( $m['avg_delivery_days'] ); ?> d</strong>
        </div>
        <div class="aiwd-kpi">
            <span class="aiwd-kpi-label"><?php esc_html_e( 'Coste IA total', 'ai-web-designer' ); ?></span>
            <strong>$<?php echo esc_html( number_format( $m['ai_cost_total'] / 100, 2 ) ); ?></strong>
        </div>
    </div>

    <div class="aiwd-metric-grid">
        <div class="aiwd-card aiwd-card-static">
            <h3><?php esc_html_e( 'Proyectos por estado', 'ai-web-designer' ); ?></h3>
            <ul class="aiwd-metric-list">
                <?php foreach ( $m['by_status'] as $k => $n ) : ?>
                    <li><span><?php echo esc_html( $statuses[ $k ] ?? $k ); ?></span><strong><?php echo (int) $n; ?></strong></li>
                <?php endforeach; ?>
            </ul>
        </div>

        <div class="aiwd-card aiwd-card-static">
            <h3><?php esc_html_e( 'Coste IA por mes (12m)', 'ai-web-designer' ); ?></h3>
            <table class="widefat striped">
                <thead><tr><th>Mes</th><th>Calls</th><th>Tokens</th><th>$</th></tr></thead>
                <tbody>
                <?php foreach ( $m['ai_cost_by_month'] as $row ) : ?>
                    <tr><td><?php echo esc_html( $row['month'] ); ?></td><td><?php echo (int) $row['calls']; ?></td><td><?php echo number_format( $row['tokens'] ); ?></td><td>$<?php echo esc_html( $row['cost'] ); ?></td></tr>
                <?php endforeach; ?>
                </tbody>
            </table>
        </div>

        <div class="aiwd-card aiwd-card-static">
            <h3><?php esc_html_e( 'Coste IA por usuario (30d)', 'ai-web-designer' ); ?></h3>
            <ul class="aiwd-metric-list">
                <?php foreach ( $m['ai_cost_by_user'] as $row ) : ?>
                    <li><span><?php echo esc_html( $row['user'] ); ?></span><strong>$<?php echo esc_html( $row['cost'] ); ?> <small>(<?php echo (int) $row['calls']; ?>)</small></strong></li>
                <?php endforeach; ?>
            </ul>
        </div>

        <div class="aiwd-card aiwd-card-static">
            <h3><?php esc_html_e( 'Coste IA por operación (30d)', 'ai-web-designer' ); ?></h3>
            <ul class="aiwd-metric-list">
                <?php foreach ( $m['ai_cost_by_operation'] as $row ) : ?>
                    <li><span><?php echo esc_html( $row['op'] ); ?></span><strong>$<?php echo esc_html( $row['cost'] ); ?> <small>(<?php echo (int) $row['calls']; ?>)</small></strong></li>
                <?php endforeach; ?>
            </ul>
        </div>

        <div class="aiwd-card aiwd-card-static">
            <h3><?php esc_html_e( 'Presets más usados', 'ai-web-designer' ); ?></h3>
            <ul class="aiwd-metric-list">
                <?php foreach ( $m['top_presets'] as $row ) : ?>
                    <li><span><?php echo esc_html( $row['preset'] ); ?></span><strong><?php echo (int) $row['count']; ?></strong></li>
                <?php endforeach; ?>
            </ul>
        </div>

        <div class="aiwd-card aiwd-card-static">
            <h3><?php esc_html_e( 'Fallos QA frecuentes', 'ai-web-designer' ); ?></h3>
            <ul class="aiwd-metric-list">
                <?php foreach ( $m['top_qa_fails'] as $row ) : ?>
                    <li><span><?php echo esc_html( $row['label'] ); ?></span><strong><?php echo (int) $row['count']; ?></strong></li>
                <?php endforeach; ?>
            </ul>
        </div>

        <div class="aiwd-card aiwd-card-static">
            <h3><?php esc_html_e( 'Proyectos por diseñador', 'ai-web-designer' ); ?></h3>
            <ul class="aiwd-metric-list">
                <?php foreach ( $m['projects_per_designer'] as $row ) : ?>
                    <li><span><?php echo esc_html( $row['user'] ); ?></span><strong><?php echo (int) $row['count']; ?></strong></li>
                <?php endforeach; ?>
            </ul>
        </div>

        <div class="aiwd-card aiwd-card-static aiwd-span-2">
            <h3><?php esc_html_e( 'Actividad reciente', 'ai-web-designer' ); ?></h3>
            <table class="widefat striped">
                <thead><tr><th>Proyecto</th><th>Sección</th><th>Estado</th><th>Cuándo</th></tr></thead>
                <tbody>
                <?php foreach ( $m['recent_activity'] as $row ) : ?>
                    <tr>
                        <td><?php echo esc_html( $row['project'] ); ?></td>
                        <td><?php echo esc_html( $row['section'] ); ?></td>
                        <td><?php echo esc_html( $row['status'] ); ?></td>
                        <td><?php echo esc_html( $row['when'] ); ?></td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
        </div>
    </div>
</div>
