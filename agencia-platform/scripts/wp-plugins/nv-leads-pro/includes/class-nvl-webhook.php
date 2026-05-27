<?php
/**
 * Endpoint REST que recibe webhooks de WAHA cuando llegan mensajes.
 *
 * URL: /wp-json/nvl/v1/webhook/{token}
 *
 * WAHA envia eventos con el formato:
 * {
 *   "event": "message",
 *   "session": "default",
 *   "payload": {
 *     "id": "false_34666123456@c.us_xxx",
 *     "from": "34666123456@c.us",
 *     "fromMe": false,
 *     "body": "texto",
 *     "hasMedia": false
 *   }
 * }
 */

if ( ! defined( 'WPINC' ) ) {
    die;
}

class NVL_Webhook {

    public static function register_routes() {
        register_rest_route( 'nvl/v1', '/webhook/(?P<token>[a-zA-Z0-9]+)', array(
            'methods'             => 'POST',
            'callback'            => array( __CLASS__, 'handle' ),
            'permission_callback' => '__return_true',
        ) );
    }

    public static function endpoint_url() {
        $settings = get_option( 'nvl_settings', array() );
        $token = isset( $settings['webhook_token'] ) ? $settings['webhook_token'] : '';
        if ( ! $token ) return '';
        return rest_url( 'nvl/v1/webhook/' . $token );
    }

    public static function handle( WP_REST_Request $req ) {
        $settings = get_option( 'nvl_settings', array() );
        $expected = isset( $settings['webhook_token'] ) ? $settings['webhook_token'] : '';
        $given    = $req->get_param( 'token' );

        if ( empty( $expected ) || ! hash_equals( $expected, (string) $given ) ) {
            return new WP_REST_Response( array( 'error' => 'invalid_token' ), 401 );
        }

        $body = $req->get_json_params();
        if ( ! is_array( $body ) ) {
            return new WP_REST_Response( array( 'error' => 'invalid_body' ), 400 );
        }

        $event = isset( $body['event'] ) ? $body['event'] : '';

        // WAHA: evento "message" o "message.any"
        if ( $event === 'message' || $event === 'message.any' ) {
            self::process_message_event( $body );
        }

        // (Compatibilidad legacy con Evolution: por si quedan webhooks antiguos en cola)
        if ( in_array( $event, array( 'messages.upsert', 'MESSAGES_UPSERT' ), true ) ) {
            self::process_legacy_evolution_event( $body );
        }

        return new WP_REST_Response( array( 'ok' => true ), 200 );
    }

    /**
     * Parser para webhook WAHA.
     */
    private static function process_message_event( $body ) {
        $payload  = isset( $body['payload'] ) ? $body['payload'] : array();
        $session  = isset( $body['session'] ) ? $body['session'] : '';

        // Ignorar mensajes salientes (los que enviamos nosotros).
        if ( ! empty( $payload['fromMe'] ) ) return;

        // "from" en WAHA viene como "34666123456@c.us". Extraer numero.
        $from = isset( $payload['from'] ) ? $payload['from'] : '';
        $phone = preg_replace( '/@.*/', '', $from );
        $phone = preg_replace( '/\D/', '', $phone );
        if ( ! $phone ) return;

        // Ignorar mensajes de grupos (terminan en @g.us).
        if ( strpos( $from, '@g.us' ) !== false ) return;

        // Texto del mensaje.
        $text = '';
        if ( ! empty( $payload['body'] ) ) {
            $text = $payload['body'];
        } elseif ( ! empty( $payload['caption'] ) ) {
            $text = $payload['caption'];
        } elseif ( ! empty( $payload['hasMedia'] ) ) {
            $text = '[media]';
        }
        if ( ! $text ) return;

        $ext_id = isset( $payload['id'] ) ? $payload['id'] : '';

        NVL_Inbox::ingest( array(
            'phone_normalized'    => $phone,
            'message_text'        => $text,
            'external_message_id' => $ext_id,
            'instance_name'       => $session,
        ) );
    }

    /**
     * Parser legacy de Evolution API (por compatibilidad si alguien tiene mensajes
     * encolados con el formato viejo).
     */
    private static function process_legacy_evolution_event( $body ) {
        $data     = isset( $body['data'] ) ? $body['data'] : array();
        $instance = isset( $body['instance'] ) ? $body['instance'] : '';
        $key      = isset( $data['key'] ) ? $data['key'] : array();
        if ( ! empty( $key['fromMe'] ) ) return;

        $remote_jid = isset( $key['remoteJid'] ) ? $key['remoteJid'] : '';
        $phone = preg_replace( '/@.*/', '', $remote_jid );
        $phone = preg_replace( '/\D/', '', $phone );
        if ( ! $phone ) return;

        $msg_obj = isset( $data['message'] ) ? $data['message'] : array();
        $text    = '';
        if ( ! empty( $msg_obj['conversation'] ) ) {
            $text = $msg_obj['conversation'];
        } elseif ( ! empty( $msg_obj['extendedTextMessage']['text'] ) ) {
            $text = $msg_obj['extendedTextMessage']['text'];
        }
        if ( ! $text ) return;

        NVL_Inbox::ingest( array(
            'phone_normalized'    => $phone,
            'message_text'        => $text,
            'external_message_id' => isset( $key['id'] ) ? $key['id'] : '',
            'instance_name'       => $instance,
        ) );
    }
}
