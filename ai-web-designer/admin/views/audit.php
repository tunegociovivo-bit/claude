<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }
global $wpdb;

$table = AIWD_Database::table( 'audit_log' );
$page  = max( 1, (int) ( $_GET['paged'] ?? 1 ) );
$per   = 50;
$offset= ( $page - 1 ) * $per;

$where = [];
$args  = [];
if ( ! empty( $_GET['action_f'] ) ) {
    $where[] = 'action = %s';
    $args[]  = sanitize_key( $_GET['action_f'] );
}
if ( ! empty( $_GET['user_f'] ) ) {
    $where[] = 'user_id = %d';
    $args[]  = (int) $_GET['user_f'];
}
if ( ! empty( $_GET['target_f'] ) ) {
    $where[] = 'target_id = %d';
    $args[]  = (int) $_GET['target_f'];
}
$where_sql = $where ? ( 'WHERE ' . implode( ' AND ', $where ) ) : '';

$query = "SELECT SQL_CALC_FOUND_ROWS * FROM $table $where_sql ORDER BY created_at DESC LIMIT %d OFFSET %d";
$rows  = $wpdb->get_results( $wpdb->prepare( $query, ...array_merge( $args, [ $per, $offset ] ) ) );
$total = (int) $wpdb->get_var( 'SELECT FOUND_ROWS()' );
$pages = (int) ceil( $total / $per );

$actions = $wpdb->get_col( "SELECT DISTINCT action FROM $table ORDER BY action" );
?>
<div class="wrap aiwd-wrap">
    <h1><?php esc_html_e( 'Audit log', 'ai-web-designer' ); ?></h1>
    <p class="description"><?php esc_html_e( 'Registro inmutable de acciones críticas: publicaciones, generaciones IA, cambios de roles, cambios de claves API, sincronizaciones con Asana, etc.', 'ai-web-designer' ); ?></p>

    <form method="get" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:12px 0">
        <input type="hidden" name="page" value="aiwd-audit" />
        <select name="action_f"><option value="">— <?php esc_html_e( 'Acción', 'ai-web-designer' ); ?> —</option>
            <?php foreach ( $actions as $a ) : ?>
                <option value="<?php echo esc_attr( $a ); ?>" <?php selected( $a, ( $_GET['action_f'] ?? '' ) ); ?>><?php echo esc_html( $a ); ?></option>
            <?php endforeach; ?>
        </select>
        <input type="number" name="user_f"   placeholder="User ID"   value="<?php echo esc_attr( $_GET['user_f'] ?? '' ); ?>" />
        <input type="number" name="target_f" placeholder="Target ID" value="<?php echo esc_attr( $_GET['target_f'] ?? '' ); ?>" />
        <button class="button"><?php esc_html_e( 'Filtrar', 'ai-web-designer' ); ?></button>
    </form>

    <table class="widefat striped">
        <thead><tr>
            <th><?php esc_html_e( 'Fecha', 'ai-web-designer' ); ?></th>
            <th><?php esc_html_e( 'Usuario', 'ai-web-designer' ); ?></th>
            <th><?php esc_html_e( 'Acción', 'ai-web-designer' ); ?></th>
            <th><?php esc_html_e( 'Target', 'ai-web-designer' ); ?></th>
            <th><?php esc_html_e( 'Detalles', 'ai-web-designer' ); ?></th>
            <th><?php esc_html_e( 'IP', 'ai-web-designer' ); ?></th>
        </tr></thead>
        <tbody>
        <?php if ( $rows ) : foreach ( $rows as $r ) :
            $user = $r->user_id ? get_userdata( $r->user_id ) : null; ?>
            <tr>
                <td><?php echo esc_html( $r->created_at ); ?></td>
                <td><?php echo esc_html( $user->display_name ?? '—' ); ?></td>
                <td><code><?php echo esc_html( $r->action ); ?></code></td>
                <td>
                    <?php if ( $r->target_type === 'project' && $r->target_id ) : ?>
                        <a href="<?php echo esc_url( admin_url( 'admin.php?page=aiwd-wizard&project_id=' . $r->target_id ) ); ?>"><?php echo esc_html( get_the_title( $r->target_id ) ?: '#' . $r->target_id ); ?></a>
                    <?php else : ?>
                        <?php echo esc_html( $r->target_type . ( $r->target_id ? ' #' . $r->target_id : '' ) ); ?>
                    <?php endif; ?>
                </td>
                <td><small><?php echo esc_html( $r->details ); ?></small></td>
                <td><small><?php echo esc_html( $r->ip ); ?></small></td>
            </tr>
        <?php endforeach; else : ?>
            <tr><td colspan="6"><?php esc_html_e( 'Sin entradas.', 'ai-web-designer' ); ?></td></tr>
        <?php endif; ?>
        </tbody>
    </table>

    <?php if ( $pages > 1 ) : ?>
        <p class="aiwd-pagination">
            <?php for ( $i = 1; $i <= $pages; $i++ ) :
                $url = add_query_arg( 'paged', $i ); ?>
                <a class="button <?php echo $i === $page ? 'button-primary' : ''; ?>" href="<?php echo esc_url( $url ); ?>"><?php echo $i; ?></a>
            <?php endfor; ?>
        </p>
    <?php endif; ?>
</div>
