<?php
/**
 * Desactivacion: limpia el cron pero conserva los datos.
 */

if ( ! defined( 'WPINC' ) ) {
    die;
}

class NVL_Deactivator {
    public static function deactivate() {
        wp_clear_scheduled_hook( 'nvl_process_pending_searches' );
        wp_clear_scheduled_hook( 'nvl_process_send_queue' );
    }
}
