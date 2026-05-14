<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

class AIWD_Activator {
    public static function activate() {
        AIWD_Database::install();

        // Capabilities
        $caps = [ 'aiwd_manage_projects', 'aiwd_approve_projects', 'aiwd_client_briefing' ];
        $admin = get_role( 'administrator' );
        if ( $admin ) {
            foreach ( $caps as $c ) { $admin->add_cap( $c ); }
        }

        // Custom roles
        add_role( 'aiwd_designer', __( 'Diseñador IA', 'ai-web-designer' ), [
            'read' => true,
            'aiwd_manage_projects' => true,
            'aiwd_approve_projects' => true,
            'upload_files' => true,
            'edit_posts' => true,
        ] );
        add_role( 'aiwd_client', __( 'Cliente Web', 'ai-web-designer' ), [
            'read' => true,
            'aiwd_client_briefing' => true,
            'upload_files' => true,
        ] );

        // Default settings
        $defaults = [
            'claude_api_key'        => '',
            'claude_model'          => 'claude-opus-4-7',
            'claude_design_endpoint'=> '',
            'image_provider'        => 'openai',
            'image_api_key'         => '',
            'remove_bg_api_key'     => '',
            'default_country'       => 'ES',
            'default_language'      => 'es_ES',
            'gmb_api_key'           => '',
            'enable_multilang'      => 0,
            'enable_agency_mode'    => 0,
            'cost_tracking'         => 1,
        ];
        if ( ! get_option( 'aiwd_settings' ) ) {
            add_option( 'aiwd_settings', $defaults );
        }

        if ( class_exists( 'AIWD_Email_Events' ) ) {
            AIWD_Email_Events::schedule_cron();
        }

        flush_rewrite_rules();
    }
}
