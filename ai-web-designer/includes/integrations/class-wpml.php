<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

class AIWD_Integration_WPML {

    public static function is_active() {
        return defined( 'ICL_SITEPRESS_VERSION' ) || defined( 'POLYLANG_VERSION' );
    }

    /**
     * Sincroniza una página con sus traducciones generadas por Claude.
     */
    public static function translate_page( $page_id, array $target_langs ) {
        if ( ! self::is_active() ) return [];
        $created = [];
        $claude = new AIWD_Claude_Client();
        $page = get_post( $page_id );
        if ( ! $page ) return [];

        foreach ( $target_langs as $lang ) {
            $resp = $claude->messages(
                [ [ 'role' => 'user', 'content' => "Traduce íntegramente al idioma '$lang' este HTML, manteniendo etiquetas:\n\n" . $page->post_content ] ],
                "Traductor profesional. Devuelve solo el HTML traducido.",
                [ 'max_tokens' => 8000 ]
            );
            if ( is_wp_error( $resp ) ) continue;
            $translated_html = $claude->extract_text( $resp );
            $new = wp_insert_post( [
                'post_type'    => $page->post_type,
                'post_status'  => 'draft',
                'post_title'   => $page->post_title . ' [' . $lang . ']',
                'post_content' => wp_kses_post( $translated_html ),
            ] );
            if ( ! is_wp_error( $new ) ) {
                update_post_meta( $new, '_aiwd_lang', $lang );
                update_post_meta( $new, '_aiwd_translated_from', $page_id );
                $created[ $lang ] = $new;
            }
        }
        return $created;
    }
}
