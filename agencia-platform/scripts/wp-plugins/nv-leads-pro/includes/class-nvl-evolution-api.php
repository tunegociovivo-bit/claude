<?php
/**
 * Cliente HTTP para WAHA (WhatsApp HTTP API).
 *
 * Nota: la clase mantiene el nombre NVL_Evolution_API por compatibilidad con
 * el resto del plugin, pero internamente habla con WAHA (devlikeapro/waha).
 * Las variables de configuracion siguen llamandose evolution_* en BD por
 * compatibilidad con instalaciones previas. Se interpretan asi:
 *   - evolution_api_url   -> URL base de WAHA (ej. http://IP:3000)
 *   - evolution_api_key   -> WHATSAPP_API_KEY de WAHA
 *   - evolution_instance  -> Nombre de la session de WAHA (ej. "default")
 */

if ( ! defined( 'WPINC' ) ) {
    die;
}

class NVL_Evolution_API {

    private $base_url;
    private $api_key;
    private $session;

    public function __construct( $base_url = null, $api_key = null, $session = null ) {
        $settings = get_option( 'nvl_settings', array() );
        $this->base_url = $base_url ? $base_url : ( isset( $settings['evolution_api_url'] ) ? $settings['evolution_api_url'] : '' );
        $this->api_key  = $api_key  ? $api_key  : ( isset( $settings['evolution_api_key'] ) ? $settings['evolution_api_key'] : '' );
        $this->session  = $session  ? $session  : ( isset( $settings['evolution_instance'] ) ? $settings['evolution_instance'] : 'default' );
        $this->base_url = rtrim( (string) $this->base_url, '/' );
        if ( ! $this->session ) $this->session = 'default';
    }

    public function is_configured() {
        return $this->base_url && $this->api_key && $this->session;
    }

    private function headers() {
        return array(
            'X-Api-Key'    => $this->api_key,
            'Content-Type' => 'application/json',
        );
    }

    private function phone_to_chat_id( $phone ) {
        $clean = preg_replace( '/\D/', '', (string) $phone );
        return $clean . '@c.us';
    }

    public function connection_state() {
        if ( ! $this->is_configured() ) {
            return new WP_Error( 'not_configured', 'WAHA no esta configurado.' );
        }
        $url = $this->base_url . '/api/sessions/' . rawurlencode( $this->session );
        $resp = wp_remote_get( $url, array( 'timeout' => 15, 'headers' => $this->headers() ) );
        if ( is_wp_error( $resp ) ) return $resp;
        $code = (int) wp_remote_retrieve_response_code( $resp );
        $body = json_decode( wp_remote_retrieve_body( $resp ), true );
        if ( $code === 404 ) {
            return new WP_Error( 'no_session', 'La session "' . $this->session . '" no existe. Inicia la sesion desde el panel WAHA.' );
        }
        if ( $code >= 400 ) {
            return new WP_Error( 'waha_http', 'HTTP ' . $code . ' al consultar la session.', $body );
        }
        return $body;
    }

    public function start_session() {
        if ( ! $this->is_configured() ) {
            return new WP_Error( 'not_configured', 'WAHA no esta configurado.' );
        }
        $url = $this->base_url . '/api/sessions/start';
        $resp = wp_remote_post( $url, array(
            'timeout' => 30,
            'headers' => $this->headers(),
            'body'    => wp_json_encode( array(
                'name'   => $this->session,
                'config' => array( 'webhooks' => array() ),
            ) ),
        ) );
        if ( is_wp_error( $resp ) ) return $resp;
        $code = (int) wp_remote_retrieve_response_code( $resp );
        $body = json_decode( wp_remote_retrieve_body( $resp ), true );
        if ( $code >= 400 ) {
            return new WP_Error( 'waha_http', 'HTTP ' . $code, $body );
        }
        return $body;
    }

    public function qr_url() {
        if ( ! $this->is_configured() ) return '';
        return $this->base_url . '/api/' . rawurlencode( $this->session ) . '/auth/qr?format=image';
    }

    public function send_text( $phone_e164, $message ) {
        if ( ! $this->is_configured() ) {
            return new WP_Error( 'not_configured', 'WAHA no esta configurado.' );
        }
        $url = $this->base_url . '/api/sendText';
        $body = array(
            'session' => $this->session,
            'chatId'  => $this->phone_to_chat_id( $phone_e164 ),
            'text'    => $message,
        );
        $resp = wp_remote_post( $url, array(
            'timeout' => 30,
            'headers' => $this->headers(),
            'body'    => wp_json_encode( $body ),
        ) );
        if ( is_wp_error( $resp ) ) return $resp;
        $code = (int) wp_remote_retrieve_response_code( $resp );
        $raw  = wp_remote_retrieve_body( $resp );
        $data = json_decode( $raw, true );
        if ( $code >= 400 ) {
            $msg = is_array( $data ) && ! empty( $data['message'] ) ? $data['message'] : ( 'HTTP ' . $code );
            if ( is_array( $msg ) ) $msg = wp_json_encode( $msg );
            return new WP_Error( 'waha_http', $msg, $data );
        }
        return is_array( $data ) ? $data : array( 'raw' => $raw );
    }

    public function check_whatsapp_numbers( $numbers ) {
        if ( ! $this->is_configured() ) {
            return new WP_Error( 'not_configured', 'WAHA no esta configurado.' );
        }
        $arr = is_array( $numbers ) ? $numbers : array( $numbers );
        $results = array();
        foreach ( $arr as $n ) {
            $clean = preg_replace( '/\D/', '', (string) $n );
            $url = $this->base_url . '/api/contacts/check-exists?phone=' . rawurlencode( $clean ) . '&session=' . rawurlencode( $this->session );
            $resp = wp_remote_get( $url, array( 'timeout' => 15, 'headers' => $this->headers() ) );
            if ( is_wp_error( $resp ) ) {
                $results[] = array( 'number' => $clean, 'exists' => null );
                continue;
            }
            $code = (int) wp_remote_retrieve_response_code( $resp );
            $data = json_decode( wp_remote_retrieve_body( $resp ), true );
            if ( $code >= 400 || ! is_array( $data ) ) {
                $results[] = array( 'number' => $clean, 'exists' => null );
                continue;
            }
            $exists = ! empty( $data['numberExists'] ) || ! empty( $data['exists'] ) || ! empty( $data['chatId'] );
            $results[] = array( 'number' => $clean, 'exists' => $exists );
        }
        return $results;
    }

    public function configure_webhook( $webhook_url ) {
        if ( ! $this->is_configured() ) {
            return new WP_Error( 'not_configured', 'WAHA no esta configurado.' );
        }
        $url = $this->base_url . '/api/sessions/' . rawurlencode( $this->session );
        $body = array(
            'config' => array(
                'webhooks' => array(
                    array(
                        'url'    => $webhook_url,
                        'events' => array( 'message', 'session.status' ),
                    ),
                ),
            ),
        );
        $resp = wp_remote_request( $url, array(
            'method'  => 'PUT',
            'timeout' => 20,
            'headers' => $this->headers(),
            'body'    => wp_json_encode( $body ),
        ) );
        if ( is_wp_error( $resp ) ) return $resp;
        $code = (int) wp_remote_retrieve_response_code( $resp );
        if ( $code >= 400 ) {
            return new WP_Error( 'waha_http', 'HTTP ' . $code, json_decode( wp_remote_retrieve_body( $resp ), true ) );
        }
        return true;
    }

    public static function extract_message_id( $response ) {
        if ( ! is_array( $response ) ) return null;
        if ( ! empty( $response['id'] ) ) return $response['id'];
        if ( ! empty( $response['_data']['id']['id'] ) ) return $response['_data']['id']['id'];
        if ( ! empty( $response['key']['id'] ) ) return $response['key']['id'];
        return null;
    }
}
