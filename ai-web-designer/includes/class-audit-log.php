<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

/**
 * Registro de auditoría de acciones críticas. Tabla aiwd_audit_log.
 *
 * Eventos registrados:
 *  project.created, project.published, project.deleted
 *  design.generated, legal.generated, image.generated
 *  qa.override, qa.publish_blocked
 *  asana.linked, asana.project_created
 *  secret.updated, settings.updated
 *  user.role_changed
 *  ai.api_call (opcional / debug)
 *  portal.token_used
 */
class AIWD_Audit_Log {

    public function register() {
        // Project lifecycle
        add_action( 'aiwd_project_published',         [ $this, 'log_published' ], 10, 1 );
        add_action( 'aiwd_design_generated',          [ $this, 'log_design' ], 10, 1 );
        add_action( 'aiwd_legal_generated',           [ $this, 'log_legal' ], 10, 1 );
        add_action( 'aiwd_qa_passed',                 [ $this, 'log_qa_passed' ], 10, 1 );
        // Asana
        add_action( 'aiwd_asana_project_created',     [ $this, 'log_asana_created' ], 10, 2 );
        add_action( 'aiwd_asana_project_linked',      [ $this, 'log_asana_linked' ], 10, 2 );
        // Secrets / settings
        add_action( 'aiwd_secret_updated',            [ $this, 'log_secret' ], 10, 1 );
        add_action( 'update_option_aiwd_settings',    [ $this, 'log_settings' ], 10, 2 );
        // Portal
        add_action( 'aiwd_client_token_generated',    [ $this, 'log_token' ], 10, 1 );
        add_action( 'aiwd_portal_briefing_saved',     [ $this, 'log_portal_save' ], 10, 1 );
        // Roles
        add_action( 'set_user_role',                  [ $this, 'log_role' ], 10, 3 );
    }

    public static function record( $action, $args = [] ) {
        global $wpdb;
        $wpdb->insert( AIWD_Database::table( 'audit_log' ), [
            'user_id'     => get_current_user_id(),
            'action'      => sanitize_key( $action ),
            'target_type' => sanitize_key( $args['target_type'] ?? '' ),
            'target_id'   => (int) ( $args['target_id'] ?? 0 ),
            'details'     => wp_json_encode( $args['details'] ?? [] ),
            'ip'          => self::ip(),
            'ua'          => substr( (string) ( $_SERVER['HTTP_USER_AGENT'] ?? '' ), 0, 250 ),
            'created_at'  => current_time( 'mysql' ),
        ] );
    }

    private static function ip() {
        $ip = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? '';
        if ( strpos( $ip, ',' ) !== false ) $ip = trim( explode( ',', $ip )[0] );
        return substr( (string) $ip, 0, 45 );
    }

    public function log_published( $project_id )   { self::record( 'project.published',    [ 'target_type' => 'project', 'target_id' => $project_id ] ); }
    public function log_design( $project_id )      { self::record( 'design.generated',     [ 'target_type' => 'project', 'target_id' => $project_id ] ); }
    public function log_legal( $project_id )       { self::record( 'legal.generated',      [ 'target_type' => 'project', 'target_id' => $project_id ] ); }
    public function log_qa_passed( $project_id )   { self::record( 'qa.passed',            [ 'target_type' => 'project', 'target_id' => $project_id ] ); }
    public function log_token( $project_id )       { self::record( 'portal.token_generated',[ 'target_type' => 'project', 'target_id' => $project_id ] ); }
    public function log_portal_save( $project_id ) { self::record( 'portal.briefing_saved',[ 'target_type' => 'project', 'target_id' => $project_id ] ); }
    public function log_secret( $key )             { self::record( 'secret.updated',       [ 'target_type' => 'secret',  'details' => [ 'key' => $key ] ] ); }

    public function log_asana_created( $project_id, $asana_gid ) {
        self::record( 'asana.project_created', [ 'target_type' => 'project', 'target_id' => $project_id, 'details' => [ 'asana_gid' => $asana_gid ] ] );
    }

    public function log_asana_linked( $project_id, $asana_gid ) {
        self::record( 'asana.project_linked', [ 'target_type' => 'project', 'target_id' => $project_id, 'details' => [ 'asana_gid' => $asana_gid ] ] );
    }

    public function log_settings( $old, $new ) {
        // Detecta diff de keys no secretas
        $diff = [];
        foreach ( (array) $new as $k => $v ) {
            $ov = $old[ $k ] ?? null;
            if ( AIWD_Secrets::is_secret( $k ) ) continue;
            if ( $ov !== $v ) $diff[] = $k;
        }
        if ( $diff ) self::record( 'settings.updated', [ 'target_type' => 'settings', 'details' => [ 'changed' => $diff ] ] );
    }

    public function log_role( $user_id, $role, $old_roles ) {
        self::record( 'user.role_changed', [ 'target_type' => 'user', 'target_id' => $user_id, 'details' => [ 'new' => $role, 'old' => $old_roles ] ] );
    }
}
