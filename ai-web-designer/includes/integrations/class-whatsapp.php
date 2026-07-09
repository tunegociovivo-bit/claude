<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

class AIWD_Integration_WhatsApp {

    public static function floating_button_html( $number, $message = '' ) {
        $number = preg_replace( '/[^0-9+]/', '', $number );
        if ( ! $number ) return '';
        $msg = rawurlencode( $message ?: __( 'Hola, vengo desde la web.', 'ai-web-designer' ) );
        $url = "https://wa.me/{$number}?text={$msg}";
        return '<a href="' . esc_url( $url ) . '" class="aiwd-wa-fab" target="_blank" rel="noopener" aria-label="WhatsApp">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="#fff"><path d="M20.5 3.5A11 11 0 003.7 17.6L2 22l4.5-1.2a11 11 0 0014-17.3zM12 20a8 8 0 01-4.3-1.2l-.3-.2-2.7.7.7-2.6-.2-.3A8 8 0 1112 20zm4.6-5.9c-.3-.1-1.7-.8-1.9-.9-.3-.1-.5-.1-.7.1-.2.2-.7.9-.9 1-.2.2-.4.2-.7.1-.3-.1-1.2-.4-2.3-1.4-.9-.8-1.5-1.7-1.6-2-.2-.3 0-.5.1-.6.1-.1.3-.4.4-.5.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5 0-.1-.7-1.7-1-2.3-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4s1.1 2.8 1.2 3c.1.1 2.1 3.2 5.1 4.4 1.8.8 2.4.8 3.3.7.5-.1 1.7-.7 2-1.4.3-.7.3-1.3.2-1.4-.1-.2-.3-.2-.6-.3z"/></svg>
        </a>';
    }
}
