<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

/**
 * Engancha eventos del plugin a envíos de email.
 */
class AIWD_Email_Events {

    const CRON_HOOK = 'aiwd_briefing_reminders';

    public function register() {
        add_action( 'aiwd_client_token_generated', [ $this, 'on_token_generated' ], 10, 3 );
        add_action( 'aiwd_portal_briefing_saved',  [ $this, 'on_briefing_saved'  ], 10, 1 );
        add_action( 'aiwd_section_comment_added',  [ $this, 'on_section_comment' ], 10, 3 );
        add_action( 'aiwd_design_generated',       [ $this, 'on_design_generated' ], 10, 1 );
        add_action( 'aiwd_section_approved',       [ $this, 'on_section_approved' ], 10, 2 );
        add_action( 'aiwd_qa_passed',              [ $this, 'on_qa_passed' ], 10, 1 );
        add_action( 'aiwd_project_published',      [ $this, 'on_project_published' ], 10, 1 );

        add_action( self::CRON_HOOK, [ $this, 'run_briefing_reminders' ] );
    }

    public static function schedule_cron() {
        if ( ! wp_next_scheduled( self::CRON_HOOK ) ) {
            wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', self::CRON_HOOK );
        }
    }

    public static function unschedule_cron() {
        wp_clear_scheduled_hook( self::CRON_HOOK );
    }

    private function base_vars( $project_id ) {
        $data = AIWD_CPT_Project::get_project_data( $project_id );
        $client_email = $data['contact']['email'] ?? '';
        $client_name  = $data['briefing']['business_name'] ?? wp_get_post_terms( $project_id, 'aiwd_client', [ 'fields' => 'names' ] )[0] ?? '';
        return [
            '{project_id}'         => $project_id,
            '{project_name}'       => get_the_title( $project_id ),
            '{project_url}'        => admin_url( 'admin.php?page=aiwd-wizard&project_id=' . $project_id ),
            '{client_email}'       => $client_email,
            '{client_name_label}'  => $client_name ? ' ' . $client_name : '',
        ];
    }

    public function on_token_generated( $project_id, $token, $url ) {
        $vars = $this->base_vars( $project_id );
        $vars['{magic_link}'] = $url;
        AIWD_Mailer::send_event( 'client_briefing', $vars );
    }

    public function on_briefing_saved( $project_id ) {
        $vars = $this->base_vars( $project_id );
        AIWD_Mailer::send_event( 'client_briefing_completed', $vars );
    }

    public function on_section_comment( $project_id, $section, $body ) {
        $vars = $this->base_vars( $project_id );
        $vars['{section}'] = $section;
        $vars['{body}']    = wp_strip_all_tags( $body );
        AIWD_Mailer::send_event( 'section_comment', $vars );
    }

    public function on_design_generated( $project_id ) {
        AIWD_Mailer::send_event( 'design_generated', $this->base_vars( $project_id ) );
    }

    public function on_section_approved( $project_id, $section ) {
        $vars = $this->base_vars( $project_id );
        $vars['{section}'] = $section;
        AIWD_Mailer::send_event( 'section_approved', $vars );
    }

    public function on_qa_passed( $project_id ) {
        AIWD_Mailer::send_event( 'qa_passed', $this->base_vars( $project_id ) );
    }

    public function on_project_published( $project_id ) {
        AIWD_Mailer::send_event( 'project_published', $this->base_vars( $project_id ) );
    }

    /**
     * Diariamente: para cada proyecto en estado 'briefing' con magic-link
     * generado hace > N días sin briefing completado, manda recordatorio.
     */
    public function run_briefing_reminders() {
        $days = max( 1, (int) aiwd_get_option( 'notify_reminder_days', 3 ) );
        $projects = get_posts( [
            'post_type'      => AIWD_CPT_Project::POST_TYPE,
            'numberposts'    => 100,
            'meta_query'     => [
                [ 'key' => '_aiwd_status', 'value' => 'briefing' ],
                [ 'key' => AIWD_Client_Portal::TOKEN_META, 'compare' => 'EXISTS' ],
            ],
        ] );
        $now = time();
        foreach ( $projects as $p ) {
            $exp = (int) get_post_meta( $p->ID, AIWD_Client_Portal::TOKEN_EXP, true );
            // Calculamos cuándo se generó (TTL por defecto 30 días → start = exp - 30d)
            $generated_at = $exp - ( 30 * DAY_IN_SECONDS );
            if ( $now < $generated_at + ( $days * DAY_IN_SECONDS ) ) continue;

            $data = AIWD_CPT_Project::get_project_data( $p->ID );
            // Si ya hay contenido del cliente, asumimos completado y no recordamos.
            if ( ! empty( $data['briefing']['description'] ) ) continue;

            $last_reminder = (int) get_post_meta( $p->ID, '_aiwd_last_reminder', true );
            if ( $now - $last_reminder < ( $days * DAY_IN_SECONDS ) ) continue;

            $token = get_post_meta( $p->ID, AIWD_Client_Portal::TOKEN_META, true );
            $url   = add_query_arg( [ 'token' => $token ], home_url( '/briefing/' ) );

            $vars = $this->base_vars( $p->ID );
            $vars['{magic_link}'] = $url;
            AIWD_Mailer::send_event( 'briefing_reminder', $vars );

            update_post_meta( $p->ID, '_aiwd_last_reminder', $now );
        }
    }
}
