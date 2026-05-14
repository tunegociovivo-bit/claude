<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

final class AIWD_Plugin {
    private static $instance = null;

    public static function instance() {
        if ( null === self::$instance ) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function run() {
        ( new AIWD_I18n() )->load_textdomain();
        ( new AIWD_CPT_Project() )->register();
        ( new AIWD_Admin() )->register();
        ( new AIWD_Public() )->register();
        ( new AIWD_Rest_API() )->register();
        ( new AIWD_Client_Portal() )->register();
        ( new AIWD_Asana_Sync() )->register();
        ( new AIWD_Asana_Webhook() )->register();
        ( new AIWD_QA_Checker() )->register();
        ( new AIWD_Email_Events() )->register();
    }
}
