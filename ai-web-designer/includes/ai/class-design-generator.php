<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

/**
 * Genera el diseño completo invocando Claude (Claude Design) con un prompt estructurado.
 * Devuelve una estructura JSON de páginas + secciones + bloques que el Template Builder
 * convertirá en plantillas Elementor.
 */
class AIWD_Design_Generator {

    private $claude;

    public function __construct() {
        $this->claude = new AIWD_Claude_Client();
    }

    public function generate( $project_id, $mode = 'full' ) {
        $data = AIWD_CPT_Project::get_project_data( $project_id );

        $system  = "Eres un diseñador web senior. Recibes un briefing y devuelves un diseño completo en JSON. ";
        $system .= "Cada página tiene: slug, title, sections[]. Cada section tiene: type (hero|features|about|gallery|services|testimonials|faq|cta|contact|map|pricing|team|stats|blog), variant (1-5), props (textos, imágenes, layout). ";
        $system .= "Aplica colores, tipografías y tono indicados. Estructura clara, mobile-first, jerarquía visual fuerte. ";
        $system .= "Devuelve SOLO JSON válido.";

        $user = wp_json_encode( [
            'mode'    => $mode,
            'data'    => $data,
            'rules'   => [
                'pages_min' => 4,
                'sections_per_page_min' => 4,
                'use_palette' => true,
                'mobile_first' => true,
            ],
        ] );

        $resp = $this->claude->messages(
            [ [ 'role' => 'user', 'content' => $user ] ],
            $system,
            [ 'max_tokens' => 12000, 'temperature' => 0.6 ]
        );

        if ( is_wp_error( $resp ) ) return $resp;

        $text = $this->claude->extract_text( $resp );
        $json = json_decode( $text, true );
        if ( ! is_array( $json ) ) {
            if ( preg_match( '/\{.*\}/s', $text, $m ) ) {
                $json = json_decode( $m[0], true );
            }
        }
        if ( ! is_array( $json ) ) {
            return new WP_Error( 'aiwd_bad_json', __( 'Respuesta de IA no parseable como JSON', 'ai-web-designer' ), [ 'raw' => $text ] );
        }

        update_post_meta( $project_id, '_aiwd_design_blueprint', $json );
        update_post_meta( $project_id, '_aiwd_design_generated_at', current_time( 'mysql' ) );

        $builder = new AIWD_Template_Builder();
        $pages   = $builder->build_from_blueprint( $project_id, $json );

        return [ 'blueprint' => $json, 'pages' => $pages ];
    }

    public function generate_proposals( $project_id, $n = 3 ) {
        $out = [];
        for ( $i = 0; $i < $n; $i++ ) {
            $out[] = $this->generate( $project_id, 'proposal_' . ( $i + 1 ) );
        }
        return $out;
    }
}
