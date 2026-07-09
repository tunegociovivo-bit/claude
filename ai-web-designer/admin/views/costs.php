<?php if ( ! defined( 'ABSPATH' ) ) { exit; }
global $wpdb;
$table = AIWD_Database::table( 'ai_logs' );
$total = (int) $wpdb->get_var( "SELECT COALESCE(SUM(cost_cents),0) FROM $table" );
$last  = $wpdb->get_results( "SELECT * FROM $table ORDER BY created_at DESC LIMIT 50" );
?>
<div class="wrap aiwd-wrap">
    <h1><?php esc_html_e( 'Coste y uso de IA', 'ai-web-designer' ); ?></h1>
    <p><strong><?php esc_html_e( 'Total estimado:', 'ai-web-designer' ); ?></strong> <?php echo esc_html( number_format( $total / 100, 2 ) ); ?> $</p>
    <table class="widefat striped">
        <thead><tr><th><?php esc_html_e( 'Fecha', 'ai-web-designer' ); ?></th><th><?php esc_html_e( 'Proveedor', 'ai-web-designer' ); ?></th><th><?php esc_html_e( 'Operación', 'ai-web-designer' ); ?></th><th><?php esc_html_e( 'Tokens', 'ai-web-designer' ); ?></th><th><?php esc_html_e( 'Coste', 'ai-web-designer' ); ?></th><th><?php esc_html_e( 'Estado', 'ai-web-designer' ); ?></th></tr></thead>
        <tbody>
        <?php foreach ( $last as $row ) : ?>
            <tr>
                <td><?php echo esc_html( $row->created_at ); ?></td>
                <td><?php echo esc_html( $row->provider ); ?></td>
                <td><?php echo esc_html( $row->operation ); ?></td>
                <td><?php echo (int) $row->tokens_in . ' / ' . (int) $row->tokens_out; ?></td>
                <td><?php echo esc_html( number_format( $row->cost_cents / 100, 4 ) ); ?> $</td>
                <td><?php echo esc_html( $row->status ); ?></td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
</div>
