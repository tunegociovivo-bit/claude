<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

class AIWD_Public {

    public function register() {
        add_action( 'wp_head', [ $this, 'inject_schema' ], 99 );
        add_action( 'wp_footer', [ $this, 'inject_cookie_banner' ] );
        add_action( 'wp_footer', [ $this, 'inject_whatsapp' ] );
    }

    public function inject_schema() {
        $project_id = (int) get_post_meta( get_queried_object_id(), '_aiwd_project_id', true );
        if ( ! $project_id ) return;
        $gen = new AIWD_Schema_Generator();
        echo $gen->emit( $project_id );
    }

    public function inject_cookie_banner() {
        if ( empty( aiwd_get_option( 'show_cookie_banner', 1 ) ) ) return;
        if ( ! empty( $_COOKIE['aiwd_cookie_choice'] ?? '' ) ) return;
        $gen = new AIWD_Legal_Generator();
        echo $gen->cookie_banner_html();
    }

    public function inject_whatsapp() {
        $project_id = (int) get_post_meta( get_queried_object_id(), '_aiwd_project_id', true );
        if ( ! $project_id ) return;
        $data = AIWD_CPT_Project::get_project_data( $project_id );
        $num  = $data['design']['wa_number'] ?? ( $data['contact']['whatsapp'] ?? '' );
        if ( $num ) echo AIWD_Integration_WhatsApp::floating_button_html( $num );
    }
}
