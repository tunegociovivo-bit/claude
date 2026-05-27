<?php
if ( ! defined( 'WPINC' ) ) { die; }
$page    = isset( $_GET['paged'] ) ? max( 1, intval( $_GET['paged'] ) ) : 1;
$per     = 20;
$offset  = ( $page - 1 ) * $per;
$status  = isset( $_GET['status'] ) ? sanitize_text_field( wp_unslash( $_GET['status'] ) ) : '';
$rows    = NVL_DB::get_searches( array( 'status' => $status, 'limit' => $per, 'offset' => $offset ) );
?>
<div class="wrap nvl-wrap">
    <h1 class="wp-heading-inline">Búsquedas</h1>
    <a href="<?php echo esc_url( admin_url( 'admin.php?page=nvl-new-search' ) ); ?>" class="page-title-action">Nueva búsqueda</a>

    <?php if ( isset( $_GET['deleted'] ) ) : ?>
        <div class="notice notice-success is-dismissible"><p>Búsqueda eliminada.</p></div>
    <?php endif; ?>

    <ul class="subsubsub">
        <li><a href="<?php echo esc_url( admin_url( 'admin.php?page=nvl-searches' ) ); ?>" class="<?php echo $status === '' ? 'current' : ''; ?>">Todas</a> |</li>
        <li><a href="<?php echo esc_url( admin_url( 'admin.php?page=nvl-searches&status=processing' ) ); ?>" class="<?php echo $status === 'processing' ? 'current' : ''; ?>">En proceso</a> |</li>
        <li><a href="<?php echo esc_url( admin_url( 'admin.php?page=nvl-searches&status=completed' ) ); ?>" class="<?php echo $status === 'completed' ? 'current' : ''; ?>">Completadas</a> |</li>
        <li><a href="<?php echo esc_url( admin_url( 'admin.php?page=nvl-searches&status=error' ) ); ?>" class="<?php echo $status === 'error' ? 'current' : ''; ?>">Con error</a></li>
    </ul>

    <table class="wp-list-table widefat fixed striped">
        <thead>
            <tr>
                <th>Keyword</th>
                <th>Localidad</th>
                <th>Estado</th>
                <th>Progreso</th>
                <th>Resultados</th>
                <th>Creada</th>
                <th>Acciones</th>
            </tr>
        </thead>
        <tbody>
        <?php if ( empty( $rows ) ) : ?>
            <tr><td colspan="7">No hay búsquedas que mostrar.</td></tr>
        <?php else : foreach ( $rows as $s ) : ?>
            <tr>
                <td><strong><a href="<?php echo esc_url( admin_url( 'admin.php?page=nvl-search-detail&id=' . $s->id ) ); ?>"><?php echo esc_html( $s->keyword ); ?></a></strong>
                    <?php if ( $s->error_message ) : ?><br><small style="color:#a00;"><?php echo esc_html( $s->error_message ); ?></small><?php endif; ?>
                </td>
                <td><?php echo esc_html( $s->location ); ?></td>
                <td><span class="nvl-status nvl-status-<?php echo esc_attr( $s->status ); ?>"><?php echo esc_html( $s->status ); ?></span></td>
                <td><?php echo intval( $s->processed_provinces ) . ' / ' . intval( $s->total_provinces ); ?><?php if ( $s->current_province ) : ?><br><small><?php echo esc_html( $s->current_province ); ?></small><?php endif; ?></td>
                <td><?php echo (int) $s->total_results; ?></td>
                <td><?php echo esc_html( mysql2date( 'd/m/Y H:i', $s->created_at ) ); ?></td>
                <td>
                    <a class="button button-small" href="<?php echo esc_url( admin_url( 'admin.php?page=nvl-search-detail&id=' . $s->id ) ); ?>">Ver leads</a>
                    <a class="button button-small" href="<?php echo esc_url( admin_url( 'admin-post.php?action=nvl_export_csv&search_id=' . $s->id ) ); ?>">CSV</a>
                    <?php $del = wp_nonce_url( admin_url( 'admin.php?page=nvl-searches&nvl_action=delete_search&id=' . $s->id ), 'nvl_delete_search_' . $s->id ); ?>
                    <a class="button button-small button-link-delete" href="<?php echo esc_url( $del ); ?>" onclick="return confirm('¿Eliminar la búsqueda y todos sus leads?');">Borrar</a>
                </td>
            </tr>
        <?php endforeach; endif; ?>
        </tbody>
    </table>
</div>
