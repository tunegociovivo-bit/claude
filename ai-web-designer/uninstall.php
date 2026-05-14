<?php
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) { exit; }

global $wpdb;
$tables = [ 'versions', 'assets', 'ai_logs', 'section_comments', 'approvals' ];
foreach ( $tables as $t ) {
    $name = $wpdb->prefix . 'aiwd_' . $t;
    $wpdb->query( "DROP TABLE IF EXISTS $name" );
}
delete_option( 'aiwd_settings' );
delete_option( 'aiwd_db_version' );

remove_role( 'aiwd_designer' );
remove_role( 'aiwd_client' );
