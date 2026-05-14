<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

class AIWD_I18n {
    public function load_textdomain() {
        load_plugin_textdomain( 'ai-web-designer', false, dirname( AIWD_PLUGIN_BASENAME ) . '/languages' );
    }
}
