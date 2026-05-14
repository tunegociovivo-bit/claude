<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

class AIWD_Deactivator {
    public static function deactivate() {
        flush_rewrite_rules();
    }
}
