<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

class AIWD_Content_Generator {

    private $claude;

    public function __construct() {
        $this->claude = new AIWD_Claude_Client();
    }

    public function generate_block( $project_id, $block_key, array $opts = [] ) {
        $data = AIWD_CPT_Project::get_project_data( $project_id );
        $briefing = $data['briefing'] ?? [];

        $system  = "Eres un copywriter experto en webs corporativas en español. ";
        $system .= "Adopta el tono: " . ( $briefing['tone'] ?? 'professional' ) . ". ";
        $system .= "Sector: " . ( $briefing['sector'] ?? 'other' ) . ". ";
        $system .= "Genera textos persuasivos, claros y orientados a conversión. ";
        $system .= "Devuelve SOLO el texto solicitado, sin introducciones ni markdown.";

        $context = sprintf(
            "Negocio: %s\nDescripción: %s\nPúblico: %s\nUSP: %s",
            $briefing['business_name'] ?? '',
            $briefing['description']   ?? '',
            $briefing['audience']      ?? '',
            $briefing['usp']           ?? ''
        );

        $prompts = [
            'hero_headline' => "Genera un titular potente para el hero (máx 10 palabras).",
            'hero_sub'      => "Genera un subtítulo de hero (1-2 frases, persuasivo).",
            'about'         => "Genera la sección 'Sobre nosotros' (150-200 palabras).",
            'services'      => "Genera 3-6 servicios con título y descripción corta. Formato: '## Servicio\\nDescripción'.",
            'why_us'        => "Genera 4 razones para elegirnos, cada una con título y 1 frase.",
            'testimonials'  => "Inventa 3 testimonios realistas con nombre y profesión.",
            'faq'           => "Genera 6 preguntas frecuentes con respuestas claras.",
            'cta'           => "Genera una llamada a la acción potente (máx 12 palabras).",
            'briefing_description' => "Sugiere una descripción profesional para este negocio en 80-120 palabras.",
            'briefing_audience'    => "Define el público objetivo ideal (perfil, edad, intereses).",
            'tagline'              => "Genera 5 propuestas de eslogan, una por línea.",
        ];

        $prompt = $prompts[ $block_key ] ?? "Genera el contenido de la sección '$block_key'.";

        $resp = $this->claude->messages(
            [ [ 'role' => 'user', 'content' => $context . "\n\n" . $prompt ] ],
            $system,
            [ 'max_tokens' => 1200, 'temperature' => $opts['temperature'] ?? 0.7 ]
        );

        if ( is_wp_error( $resp ) ) {
            return $resp;
        }
        return $this->claude->extract_text( $resp );
    }

    public function generate_variants( $project_id, $block_key, $n = 3 ) {
        $variants = [];
        for ( $i = 0; $i < $n; $i++ ) {
            $variants[] = $this->generate_block( $project_id, $block_key, [ 'temperature' => 0.5 + ( $i * 0.2 ) ] );
        }
        return $variants;
    }

    public function generate_blog_posts( $project_id, $count = 5 ) {
        $data = AIWD_CPT_Project::get_project_data( $project_id );
        $briefing = $data['briefing'] ?? [];

        $resp = $this->claude->messages(
            [ [ 'role' => 'user', 'content' => "Genera $count títulos de posts de blog orientados a SEO para el negocio '" . ( $briefing['business_name'] ?? '' ) . "' (sector " . ( $briefing['sector'] ?? '' ) . "). Devuelve JSON: [{title, slug, excerpt, body_markdown}]. " ] ],
            "Eres redactor SEO. Devuelve solo JSON válido.",
            [ 'max_tokens' => 6000 ]
        );

        if ( is_wp_error( $resp ) ) return $resp;
        $text = $this->claude->extract_text( $resp );
        $json = json_decode( $text, true );
        if ( ! is_array( $json ) ) return [];

        $created = [];
        foreach ( $json as $item ) {
            $post_id = wp_insert_post( [
                'post_type'    => 'post',
                'post_status'  => 'draft',
                'post_title'   => sanitize_text_field( $item['title'] ?? '' ),
                'post_name'    => sanitize_title( $item['slug'] ?? '' ),
                'post_excerpt' => sanitize_textarea_field( $item['excerpt'] ?? '' ),
                'post_content' => wp_kses_post( $item['body_markdown'] ?? '' ),
            ] );
            if ( $post_id && ! is_wp_error( $post_id ) ) {
                update_post_meta( $post_id, '_aiwd_generated', 1 );
                update_post_meta( $post_id, '_aiwd_project_id', $project_id );
                $created[] = $post_id;
            }
        }
        return $created;
    }
}
