<?php
if ( ! defined( 'WPINC' ) ) { die; }
$stats    = NVL_DB::dashboard_stats();
$settings = get_option( 'nvl_settings', array() );
$has_key  = ! empty( $settings['google_api_key'] );
$recent   = NVL_DB::get_searches( array( 'limit' => 10 ) );
?>
<div class="wrap nvl-wrap">
    <h1>Negocio Vivo Leads</h1>
    <p class="nvl-subtitle">Captación de leads desde Google My Business.</p>

    <?php if ( ! $has_key ) : ?>
        <div class="notice notice-warning">
            <p><strong>Configuración pendiente:</strong> Aún no has añadido la API key de Google Places.
            <a href="<?php echo esc_url( admin_url( 'admin.php?page=nvl-settings' ) ); ?>">Ir a Ajustes →</a></p>
        </div>
    <?php endif; ?>

    <div class="nvl-stats-grid">
        <div class="nvl-card">
            <div class="nvl-card-label">Búsquedas totales</div>
            <div class="nvl-card-value"><?php echo (int) $stats['total_searches']; ?></div>
        </div>
        <div class="nvl-card">
            <div class="nvl-card-label">En proceso</div>
            <div class="nvl-card-value"><?php echo (int) $stats['pending_searches']; ?></div>
        </div>
        <div class="nvl-card">
            <div class="nvl-card-label">Leads totales</div>
            <div class="nvl-card-value"><?php echo (int) $stats['total_leads']; ?></div>
        </div>
        <div class="nvl-card">
            <div class="nvl-card-label">Con teléfono</div>
            <div class="nvl-card-value"><?php echo (int) $stats['leads_with_phone']; ?></div>
        </div>
        <div class="nvl-card">
            <div class="nvl-card-label">Contactados</div>
            <div class="nvl-card-value"><?php echo (int) $stats['contacted']; ?></div>
        </div>
        <div class="nvl-card nvl-card-success">
            <div class="nvl-card-label">Clientes</div>
            <div class="nvl-card-value"><?php echo (int) $stats['clients']; ?></div>
        </div>
    </div>

    <div class="nvl-actions">
        <a href="<?php echo esc_url( admin_url( 'admin.php?page=nvl-new-search' ) ); ?>" class="button button-primary button-hero">+ Nueva búsqueda</a>
        <a href="<?php echo esc_url( admin_url( 'admin.php?page=nvl-searches' ) ); ?>" class="button button-hero">Ver todas las búsquedas</a>
    </div>

    <h2 style="margin-top:2rem;">Últimas búsquedas</h2>
    <?php if ( empty( $recent ) ) : ?>
        <p>Aún no has lanzado ninguna búsqueda. <a href="<?php echo esc_url( admin_url( 'admin.php?page=nvl-new-search' ) ); ?>">Crea la primera →</a></p>
    <?php else : ?>
        <table class="widefat striped">
            <thead>
                <tr>
                    <th>Keyword</th>
                    <th>Localidad</th>
                    <th>Estado</th>
                    <th>Resultados</th>
                    <th>Creada</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
                <?php foreach ( $recent as $s ) : ?>
                    <tr>
                        <td><strong><?php echo esc_html( $s->keyword ); ?></strong></td>
                        <td><?php echo esc_html( $s->location ); ?></td>
                        <td><span class="nvl-status nvl-status-<?php echo esc_attr( $s->status ); ?>"><?php echo esc_html( $s->status ); ?></span>
                            <?php if ( in_array( $s->status, array( 'pending', 'processing' ), true ) ) : ?>
                                <small>(<?php echo intval( $s->processed_provinces ) . ' / ' . intval( $s->total_provinces ); ?>)</small>
                            <?php endif; ?>
                        </td>
                        <td><?php echo (int) $s->total_results; ?></td>
                        <td><?php echo esc_html( mysql2date( 'd/m/Y H:i', $s->created_at ) ); ?></td>
                        <td>
                            <a class="button button-small" href="<?php echo esc_url( admin_url( 'admin.php?page=nvl-search-detail&id=' . $s->id ) ); ?>">Ver</a>
                        </td>
                    </tr>
                <?php endforeach; ?>
            </tbody>
        </table>
    <?php endif; ?>
</div>
