<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

class AIWD_Database {

    public static function install() {
        global $wpdb;
        $charset = $wpdb->get_charset_collate();

        $versions = $wpdb->prefix . 'aiwd_versions';
        $assets   = $wpdb->prefix . 'aiwd_assets';
        $logs     = $wpdb->prefix . 'aiwd_ai_logs';
        $comments = $wpdb->prefix . 'aiwd_section_comments';
        $approvals= $wpdb->prefix . 'aiwd_approvals';

        $sql = [];

        $sql[] = "CREATE TABLE $versions (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            project_id BIGINT UNSIGNED NOT NULL,
            version INT UNSIGNED NOT NULL,
            payload LONGTEXT NOT NULL,
            author_id BIGINT UNSIGNED DEFAULT NULL,
            note TEXT NULL,
            created_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            KEY project_id (project_id),
            KEY version (version)
        ) $charset;";

        $sql[] = "CREATE TABLE $assets (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            project_id BIGINT UNSIGNED NOT NULL,
            type VARCHAR(40) NOT NULL,
            attachment_id BIGINT UNSIGNED DEFAULT NULL,
            external_url TEXT NULL,
            source VARCHAR(40) NOT NULL DEFAULT 'upload',
            ai_prompt TEXT NULL,
            meta LONGTEXT NULL,
            selected TINYINT(1) NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            KEY project_id (project_id),
            KEY type (type),
            KEY source (source)
        ) $charset;";

        $sql[] = "CREATE TABLE $logs (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            project_id BIGINT UNSIGNED DEFAULT NULL,
            provider VARCHAR(40) NOT NULL,
            operation VARCHAR(80) NOT NULL,
            tokens_in INT UNSIGNED DEFAULT 0,
            tokens_out INT UNSIGNED DEFAULT 0,
            cost_cents INT UNSIGNED DEFAULT 0,
            status VARCHAR(20) NOT NULL,
            request LONGTEXT NULL,
            response LONGTEXT NULL,
            created_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            KEY project_id (project_id),
            KEY operation (operation)
        ) $charset;";

        $sql[] = "CREATE TABLE $comments (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            project_id BIGINT UNSIGNED NOT NULL,
            section_key VARCHAR(80) NOT NULL,
            user_id BIGINT UNSIGNED NOT NULL,
            body TEXT NOT NULL,
            resolved TINYINT(1) NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            KEY project_id (project_id),
            KEY section_key (section_key)
        ) $charset;";

        $sql[] = "CREATE TABLE $approvals (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            project_id BIGINT UNSIGNED NOT NULL,
            section_key VARCHAR(80) NOT NULL,
            user_id BIGINT UNSIGNED NOT NULL,
            status VARCHAR(20) NOT NULL,
            note TEXT NULL,
            created_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            KEY project_id (project_id)
        ) $charset;";

        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        foreach ( $sql as $q ) { dbDelta( $q ); }

        update_option( 'aiwd_db_version', AIWD_VERSION );
    }

    public static function table( $name ) {
        global $wpdb;
        return $wpdb->prefix . 'aiwd_' . $name;
    }
}
