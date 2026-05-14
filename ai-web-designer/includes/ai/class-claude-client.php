<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

class AIWD_Claude_Client {

    const DEFAULT_ENDPOINT = 'https://api.anthropic.com/v1/messages';
    const ANTHROPIC_VERSION = '2023-06-01';

    private $api_key;
    private $model;
    private $endpoint;

    public function __construct() {
        $this->api_key  = (string) aiwd_get_option( 'claude_api_key' );
        $this->model    = (string) aiwd_get_option( 'claude_model', 'claude-opus-4-7' );
        $this->endpoint = (string) ( aiwd_get_option( 'claude_design_endpoint' ) ?: self::DEFAULT_ENDPOINT );
    }

    public function is_configured() {
        return ! empty( $this->api_key );
    }

    /**
     * Llamada principal a Claude (Messages API).
     *
     * @param array  $messages  Lista de mensajes [{role, content}].
     * @param string $system    Prompt de sistema.
     * @param array  $opts      max_tokens, temperature, tools, etc.
     * @return array|WP_Error
     */
    public function messages( array $messages, $system = '', array $opts = [] ) {
        if ( ! $this->is_configured() ) {
            return new WP_Error( 'aiwd_no_key', __( 'Falta configurar la API key de Claude.', 'ai-web-designer' ) );
        }

        $body = array_merge( [
            'model'       => $this->model,
            'max_tokens'  => 4096,
            'temperature' => 0.7,
            'system'      => $system,
            'messages'    => $messages,
        ], $opts );

        $start = microtime( true );

        $response = wp_remote_post( $this->endpoint, [
            'timeout' => 60,
            'headers' => [
                'x-api-key'         => $this->api_key,
                'anthropic-version' => self::ANTHROPIC_VERSION,
                'content-type'      => 'application/json',
            ],
            'body'    => wp_json_encode( $body ),
        ] );

        if ( is_wp_error( $response ) ) {
            $this->log( 'error', 'claude.messages', $body, $response->get_error_message(), 0, 0, 0 );
            return $response;
        }

        $code = wp_remote_retrieve_response_code( $response );
        $data = json_decode( wp_remote_retrieve_body( $response ), true );
        if ( $code >= 400 ) {
            $this->log( 'error', 'claude.messages', $body, $data, 0, 0, 0 );
            return new WP_Error( 'aiwd_api_error', $data['error']['message'] ?? 'Claude API error', [ 'status' => $code ] );
        }

        $tokens_in  = (int) ( $data['usage']['input_tokens']  ?? 0 );
        $tokens_out = (int) ( $data['usage']['output_tokens'] ?? 0 );
        $cost_cents = $this->estimate_cost( $tokens_in, $tokens_out );
        $this->log( 'ok', 'claude.messages', $body, $data, $tokens_in, $tokens_out, $cost_cents );

        return $data;
    }

    /**
     * Helper para sacar texto plano del primer bloque de texto.
     */
    public function extract_text( $response ) {
        if ( is_wp_error( $response ) || ! isset( $response['content'] ) ) {
            return '';
        }
        foreach ( $response['content'] as $block ) {
            if ( ( $block['type'] ?? '' ) === 'text' ) {
                return (string) $block['text'];
            }
        }
        return '';
    }

    /**
     * Coste estimado en céntimos $ (Opus aprox).
     */
    private function estimate_cost( $in, $out ) {
        $in_rate  = 15 / 1000000; // $15 / 1M
        $out_rate = 75 / 1000000;
        return (int) round( ( $in * $in_rate + $out * $out_rate ) * 100 );
    }

    private function log( $status, $op, $req, $resp, $in, $out, $cost ) {
        if ( ! aiwd_get_option( 'cost_tracking', 1 ) ) {
            return;
        }
        global $wpdb;
        $wpdb->insert( AIWD_Database::table( 'ai_logs' ), [
            'project_id' => 0,
            'provider'   => 'claude',
            'operation'  => $op,
            'tokens_in'  => $in,
            'tokens_out' => $out,
            'cost_cents' => $cost,
            'status'     => $status,
            'request'    => wp_json_encode( $req ),
            'response'   => is_string( $resp ) ? $resp : wp_json_encode( $resp ),
            'created_at' => current_time( 'mysql' ),
        ] );
    }
}
