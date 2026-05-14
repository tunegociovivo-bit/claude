<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

class AIWD_Integration_Calendly {
    public static function inline_embed( $url ) {
        if ( ! $url ) return '';
        return '<div class="calendly-inline-widget" data-url="' . esc_url( $url ) . '" style="min-width:320px;height:700px;"></div>
        <script src="https://assets.calendly.com/assets/external/widget.js" async></script>';
    }
}
