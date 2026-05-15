<?php
/**
 * Se ejecuta cuando el plugin es desinstalado desde el panel de WordPress.
 * Borra todas las tablas y opciones del plugin.
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
    exit;
}

global $wpdb;

$tables = array(
    $wpdb->prefix . 'nvl_searches',
    $wpdb->prefix . 'nvl_leads',
    $wpdb->prefix . 'nvl_competitors',
    $wpdb->prefix . 'nvl_messages',
    $wpdb->prefix . 'nvl_templates',
);

foreach ( $tables as $table ) {
    $wpdb->query( "DROP TABLE IF EXISTS {$table}" );
}

// Opciones.
delete_option( 'nvl_settings' );
delete_option( 'nvl_db_version' );

// Desprogramar cron.
wp_clear_scheduled_hook( 'nvl_process_pending_searches' );
