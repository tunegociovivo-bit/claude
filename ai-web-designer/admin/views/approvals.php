<?php if ( ! defined( 'ABSPATH' ) ) { exit; }
global $wpdb;
$table = AIWD_Database::table( 'approvals' );
$rows = $wpdb->get_results( "SELECT * FROM $table ORDER BY created_at DESC LIMIT 100" );
?>
<div class="wrap aiwd-wrap">
    <h1><?php esc_html_e( 'Aprobaciones por sección', 'ai-web-designer' ); ?></h1>
    <table class="widefat striped">
        <thead><tr>
            <th><?php esc_html_e( 'Proyecto', 'ai-web-designer' ); ?></th>
            <th><?php esc_html_e( 'Sección', 'ai-web-designer' ); ?></th>
            <th><?php esc_html_e( 'Estado', 'ai-web-designer' ); ?></th>
            <th><?php esc_html_e( 'Usuario', 'ai-web-designer' ); ?></th>
            <th><?php esc_html_e( 'Fecha', 'ai-web-designer' ); ?></th>
        </tr></thead>
        <tbody>
        <?php if ( $rows ) : foreach ( $rows as $row ) : ?>
            <tr>
                <td><?php echo esc_html( get_the_title( $row->project_id ) ); ?></td>
                <td><?php echo esc_html( $row->section_key ); ?></td>
                <td><?php echo esc_html( $row->status ); ?></td>
                <td><?php echo esc_html( get_userdata( $row->user_id )->display_name ?? '—' ); ?></td>
                <td><?php echo esc_html( $row->created_at ); ?></td>
            </tr>
        <?php endforeach; else : ?>
            <tr><td colspan="5"><?php esc_html_e( 'No hay aprobaciones todavía.', 'ai-web-designer' ); ?></td></tr>
        <?php endif; ?>
        </tbody>
    </table>
</div>
