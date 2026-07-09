<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

/**
 * Transcribe audio (Whisper / OpenAI) y extrae estructura del briefing con Claude.
 *
 * Flujo:
 *  1. transcribe($audio_path) → texto plano (Whisper)
 *  2. extract($transcript)    → JSON estructurado del briefing
 *  3. apply_to_project()      → guarda en las secciones briefing/brand/contact
 */
class AIWD_Audio_Briefing {

    const WHISPER_ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';

    private $claude;

    public function __construct() {
        $this->claude = new AIWD_Claude_Client();
    }

    public function is_configured() {
        return ! empty( aiwd_get_option( 'whisper_api_key' ) ) || ! empty( aiwd_get_option( 'image_api_key' ) );
    }

    private function whisper_key() {
        // Reutiliza la image_api_key si es OpenAI y no hay whisper específica.
        return aiwd_get_option( 'whisper_api_key' ) ?: aiwd_get_option( 'image_api_key' );
    }

    public function transcribe( $audio_path, $language = 'es' ) {
        $key = $this->whisper_key();
        if ( ! $key ) return new WP_Error( 'aiwd_no_whisper', __( 'Falta API key de Whisper/OpenAI.', 'ai-web-designer' ) );
        if ( ! file_exists( $audio_path ) ) return new WP_Error( 'aiwd_no_file', 'Archivo no encontrado' );

        $boundary = wp_generate_uuid4();
        $eol = "\r\n";
        $name = basename( $audio_path );
        $mime = function_exists( 'mime_content_type' ) ? mime_content_type( $audio_path ) : 'audio/webm';

        $body  = '--' . $boundary . $eol;
        $body .= 'Content-Disposition: form-data; name="model"' . $eol . $eol . 'whisper-1' . $eol;
        $body .= '--' . $boundary . $eol;
        $body .= 'Content-Disposition: form-data; name="language"' . $eol . $eol . $language . $eol;
        $body .= '--' . $boundary . $eol;
        $body .= 'Content-Disposition: form-data; name="response_format"' . $eol . $eol . 'json' . $eol;
        $body .= '--' . $boundary . $eol;
        $body .= 'Content-Disposition: form-data; name="file"; filename="' . $name . '"' . $eol;
        $body .= 'Content-Type: ' . $mime . $eol . $eol;
        $body .= file_get_contents( $audio_path ) . $eol;
        $body .= '--' . $boundary . '--' . $eol;

        $resp = wp_remote_post( self::WHISPER_ENDPOINT, [
            'timeout' => 120,
            'headers' => [
                'Authorization' => 'Bearer ' . $key,
                'Content-Type'  => 'multipart/form-data; boundary=' . $boundary,
            ],
            'body' => $body,
        ] );
        if ( is_wp_error( $resp ) ) return $resp;
        $code = wp_remote_retrieve_response_code( $resp );
        $data = json_decode( wp_remote_retrieve_body( $resp ), true );
        if ( $code >= 400 ) {
            return new WP_Error( 'aiwd_whisper_api', $data['error']['message'] ?? 'Whisper error', [ 'status' => $code ] );
        }
        return (string) ( $data['text'] ?? '' );
    }

    /**
     * Extrae campos del briefing a partir del texto transcrito.
     */
    public function extract( $transcript ) {
        $system = "Eres analista de negocio. A partir de la transcripción del cliente, extrae estructura del briefing en JSON estricto con esta forma (deja vacíos los campos no mencionados):\n"
                . "{\"business_name\":\"\",\"sector\":\"\",\"description\":\"\",\"audience\":\"\",\"tone\":\"\",\"usp\":\"\",\"competitors\":\"\",\"notes\":\"\","
                . "\"contact\":{\"email\":\"\",\"phone\":\"\",\"whatsapp\":\"\",\"address\":\"\",\"schedule\":\"\",\"domain\":\"\"},"
                . "\"brand\":{\"color_primary\":\"\",\"color_secondary\":\"\",\"color_accent\":\"\",\"font_heading\":\"\",\"font_body\":\"\",\"tagline\":\"\"},"
                . "\"content\":{\"hero_headline\":\"\",\"hero_sub\":\"\",\"about\":\"\",\"services\":\"\",\"cta\":\"\"}}\n"
                . "Los sectores válidos son: restaurant, legal, clinic, ecommerce, portfolio, real_estate, education, beauty, construction, tech, nonprofit, other.\n"
                . "Los tonos válidos son: professional, friendly, luxury, fun, technical, inspirational.\n"
                . "Devuelve SOLO JSON, sin markdown.";

        $resp = $this->claude->messages(
            [ [ 'role' => 'user', 'content' => "Transcripción:\n\n" . $transcript ] ],
            $system,
            [ 'max_tokens' => 3000, 'temperature' => 0.2 ]
        );
        if ( is_wp_error( $resp ) ) return $resp;
        $text = $this->claude->extract_text( $resp );
        $json = json_decode( $text, true );
        if ( ! is_array( $json ) && preg_match( '/\{.*\}/s', $text, $m ) ) {
            $json = json_decode( $m[0], true );
        }
        if ( ! is_array( $json ) ) {
            return new WP_Error( 'aiwd_bad_json', __( 'No se pudo estructurar la transcripción.', 'ai-web-designer' ), [ 'raw' => $text ] );
        }
        return $json;
    }

    public function apply_to_project( $project_id, array $extracted, $merge = true ) {
        $existing = AIWD_CPT_Project::get_project_data( $project_id );

        $briefing_keys = [ 'business_name', 'sector', 'description', 'audience', 'tone', 'usp', 'competitors', 'notes' ];
        $briefing = array_intersect_key( $extracted, array_flip( $briefing_keys ) );
        $briefing = array_filter( $briefing, fn( $v ) => $v !== '' && $v !== null );

        $contact = array_filter( $extracted['contact'] ?? [], fn( $v ) => $v !== '' && $v !== null );
        $brand   = array_filter( $extracted['brand']   ?? [], fn( $v ) => $v !== '' && $v !== null );
        $content = array_filter( $extracted['content'] ?? [], fn( $v ) => $v !== '' && $v !== null );

        if ( $merge ) {
            $briefing = array_merge( (array) $existing['briefing'], $briefing );
            $contact  = array_merge( (array) $existing['contact'],  $contact );
            $brand    = array_merge( (array) $existing['brand'],    $brand );
            $content  = array_merge( (array) $existing['content'],  $content );
        }

        AIWD_CPT_Project::save_project_data( $project_id, 'briefing', $briefing );
        AIWD_CPT_Project::save_project_data( $project_id, 'contact',  $contact );
        AIWD_CPT_Project::save_project_data( $project_id, 'brand',    $brand );
        AIWD_CPT_Project::save_project_data( $project_id, 'content',  $content );

        do_action( 'aiwd_audio_briefing_applied', $project_id, $extracted );
        return true;
    }

    /**
     * Pipeline completo: archivo de audio → transcripción → extracción → aplicación.
     */
    public function process( $project_id, $audio_path, $language = 'es', $save_transcript = true ) {
        $transcript = $this->transcribe( $audio_path, $language );
        if ( is_wp_error( $transcript ) ) return $transcript;

        if ( $save_transcript ) {
            update_post_meta( $project_id, '_aiwd_audio_transcript', $transcript );
            update_post_meta( $project_id, '_aiwd_audio_transcribed_at', current_time( 'mysql' ) );
        }

        $extracted = $this->extract( $transcript );
        if ( is_wp_error( $extracted ) ) return $extracted;

        $this->apply_to_project( $project_id, $extracted );

        return [
            'transcript' => $transcript,
            'extracted'  => $extracted,
        ];
    }
}
