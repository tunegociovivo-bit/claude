<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

class AIWD_SEO_Generator {

    private $claude;

    public function __construct() {
        $this->claude = new AIWD_Claude_Client();
    }

    public function generate_meta( $project_id ) {
        $data = AIWD_CPT_Project::get_project_data( $project_id );
        $briefing = $data['briefing'] ?? [];

        $resp = $this->claude->messages(
            [ [ 'role' => 'user', 'content' => "Genera SEO on-page para:\n" . wp_json_encode( $briefing ) . "\nDevuelve JSON: { meta_title, meta_description, keywords[], h1_suggestions[], og_title, og_description }. Meta title 60ch máx, description 155ch." ] ],
            "Eres especialista SEO. Solo JSON válido.",
            [ 'max_tokens' => 1200 ]
        );
        if ( is_wp_error( $resp ) ) return $resp;
        $text = $this->claude->extract_text( $resp );
        return json_decode( $text, true ) ?: [];
    }

    public function suggest_keywords( $project_id ) {
        $meta = $this->generate_meta( $project_id );
        return $meta['keywords'] ?? [];
    }

    public function apply_to_page( $page_id, array $seo ) {
        if ( ! empty( $seo['meta_title'] ) ) {
            update_post_meta( $page_id, '_aiwd_meta_title', sanitize_text_field( $seo['meta_title'] ) );
            update_post_meta( $page_id, '_yoast_wpseo_title', sanitize_text_field( $seo['meta_title'] ) );
            update_post_meta( $page_id, 'rank_math_title', sanitize_text_field( $seo['meta_title'] ) );
        }
        if ( ! empty( $seo['meta_description'] ) ) {
            update_post_meta( $page_id, '_aiwd_meta_description', sanitize_textarea_field( $seo['meta_description'] ) );
            update_post_meta( $page_id, '_yoast_wpseo_metadesc', sanitize_textarea_field( $seo['meta_description'] ) );
            update_post_meta( $page_id, 'rank_math_description', sanitize_textarea_field( $seo['meta_description'] ) );
        }
    }
}
