<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

/**
 * Receptor de webhooks de Asana.
 *
 * Flujo handshake (Asana docs):
 *  1. Crear webhook con POST /webhooks → Asana hace GET/POST a target con header X-Hook-Secret.
 *  2. Debemos responder ese mismo header en la respuesta y guardarlo.
 *  3. En cada evento posterior, Asana añade X-Hook-Signature = HMAC-SHA256(secret, body) que validamos.
 *
 * URL pública: /wp-json/aiwd/v1/asana/webhook
 */
class AIWD_Asana_Webhook {

    const SECRET_OPT = 'aiwd_asana_webhook_secret';
    const META_HOOK  = '_aiwd_asana_webhook_gid';

    public function register() {
        add_action( 'rest_api_init', [ $this, 'routes' ] );
    }

    public function routes() {
        register_rest_route( 'aiwd/v1', '/asana/webhook', [
            'methods'             => [ 'POST', 'GET', 'HEAD' ],
            'callback'            => [ $this, 'handle' ],
            'permission_callback' => '__return_true', // Asana no autentica con nonce; validamos con HMAC.
        ] );
    }

    public static function endpoint_url() {
        return esc_url_raw( rest_url( 'aiwd/v1/asana/webhook' ) );
    }

    public function handle( WP_REST_Request $req ) {
        // Handshake: Asana envía X-Hook-Secret y espera que se lo devolvamos en la respuesta.
        $hook_secret = $req->get_header( 'x_hook_secret' );
        if ( $hook_secret ) {
            update_option( self::SECRET_OPT, $hook_secret, false );
            $response = new WP_REST_Response( null, 200 );
            $response->header( 'X-Hook-Secret', $hook_secret );
            return $response;
        }

        // Evento real: validar firma HMAC.
        $secret = (string) get_option( self::SECRET_OPT, '' );
        $sig    = (string) $req->get_header( 'x_hook_signature' );
        $body   = $req->get_body();
        if ( $secret && $sig ) {
            $expected = hash_hmac( 'sha256', $body, $secret );
            if ( ! hash_equals( $expected, $sig ) ) {
                aiwd_log( 'Asana webhook: firma inválida' );
                return new WP_REST_Response( 'Invalid signature', 401 );
            }
        }

        $payload = json_decode( $body, true );
        $events  = $payload['events'] ?? [];
        foreach ( $events as $event ) {
            $this->process_event( $event );
        }
        return new WP_REST_Response( [ 'ok' => true ], 200 );
    }

    private function process_event( array $event ) {
        $type     = $event['resource']['resource_type'] ?? '';
        $task_gid = $event['resource']['gid'] ?? '';
        $action   = $event['action'] ?? '';
        if ( $type !== 'task' || ! $task_gid ) return;

        $project_id = $this->find_project_by_task( $task_gid );
        if ( ! $project_id ) return;

        $task_key = $this->find_task_key( $project_id, $task_gid );
        if ( ! $task_key ) return;

        if ( $action === 'changed' ) {
            // Releer la tarea para ver si está completed
            $client = new AIWD_Asana_Client();
            $task = $client->request( 'GET', '/tasks/' . $task_gid, [ 'opt_fields' => 'completed,name' ] );
            if ( is_wp_error( $task ) ) return;
            if ( ! empty( $task['completed'] ) ) {
                $this->mark_section_approved( $project_id, $task_key, 'Cerrada desde Asana: ' . ( $task['name'] ?? '' ) );
            }
        } elseif ( $action === 'added' ) {
            // Comentario añadido — opcionalmente importarlo
            $story_gid = $event['resource']['gid'] ?? '';
            if ( $story_gid ) {
                $this->import_story( $project_id, $task_key, $story_gid );
            }
        }
    }

    private function find_project_by_task( $task_gid ) {
        global $wpdb;
        $rows = $wpdb->get_col( $wpdb->prepare(
            "SELECT post_id FROM {$wpdb->postmeta} WHERE meta_key = %s",
            AIWD_Asana_Sync::META_TASKS
        ) );
        foreach ( $rows as $post_id ) {
            $tasks = (array) get_post_meta( $post_id, AIWD_Asana_Sync::META_TASKS, true );
            if ( in_array( $task_gid, $tasks, true ) ) return (int) $post_id;
        }
        return 0;
    }

    private function find_task_key( $project_id, $task_gid ) {
        $tasks = (array) get_post_meta( $project_id, AIWD_Asana_Sync::META_TASKS, true );
        foreach ( $tasks as $key => $gid ) {
            if ( $gid === $task_gid ) return $key;
        }
        return null;
    }

    private function mark_section_approved( $project_id, $task_key, $note = '' ) {
        $map = [
            'briefing' => 'briefing',
            'content'  => 'content',
            'design'   => 'design',
            'seo'      => 'seo',
            'legal'    => 'legal',
            'approval' => 'final',
            'publish'  => 'final',
        ];
        $section = $map[ $task_key ] ?? $task_key;

        global $wpdb;
        $wpdb->insert( AIWD_Database::table( 'approvals' ), [
            'project_id' => $project_id,
            'section_key'=> $section,
            'user_id'    => 0,
            'status'     => 'approved',
            'note'       => sanitize_text_field( $note ),
            'created_at' => current_time( 'mysql' ),
        ] );

        // Si la tarea es "publish", marcar el proyecto como publicado.
        if ( $task_key === 'publish' ) {
            update_post_meta( $project_id, '_aiwd_status', 'published' );
        }
        do_action( 'aiwd_section_approved_from_asana', $project_id, $section );
    }

    private function import_story( $project_id, $task_key, $story_gid ) {
        $client = new AIWD_Asana_Client();
        $story = $client->request( 'GET', '/stories/' . $story_gid, [ 'opt_fields' => 'text,created_by.name,type' ] );
        if ( is_wp_error( $story ) || ($story['type'] ?? '') !== 'comment' ) return;
        $body = sprintf( '[Asana · %s] %s', $story['created_by']['name'] ?? '?', $story['text'] ?? '' );

        global $wpdb;
        $wpdb->insert( AIWD_Database::table( 'section_comments' ), [
            'project_id' => $project_id,
            'section_key'=> sanitize_key( $task_key ),
            'user_id'    => 0,
            'body'       => wp_kses_post( $body ),
            'resolved'   => 0,
            'created_at' => current_time( 'mysql' ),
        ] );
    }

    /**
     * Crea el webhook en Asana para el proyecto Asana indicado.
     */
    public static function ensure_for_project( $asana_project_gid ) {
        $client = new AIWD_Asana_Client();
        return $client->create_webhook( $asana_project_gid, self::endpoint_url() );
    }
}
