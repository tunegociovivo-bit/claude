<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

class AIWD_Deactivator {
    public static function deactivate() {
        if ( class_exists( 'AIWD_Email_Events' ) ) {
            AIWD_Email_Events::unschedule_cron();
        }
        flush_rewrite_rules();
    }
}
