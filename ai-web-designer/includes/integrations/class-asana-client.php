<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

/**
 * Cliente Asana (Personal Access Token).
 * Docs: https://developers.asana.com/reference/
 */
class AIWD_Asana_Client {

    const BASE = 'https://app.asana.com/api/1.0';

    private $token;

    public function __construct() {
        $this->token = (string) aiwd_get_option( 'asana_token' );
    }

    public function is_configured() {
        return ! empty( $this->token );
    }

    public function request( $method, $path, $args = [] ) {
        if ( ! $this->is_configured() ) {
            return new WP_Error( 'aiwd_no_asana', __( 'Falta configurar el token de Asana.', 'ai-web-designer' ) );
        }
        $url = self::BASE . $path;
        $opts = [
            'method'  => strtoupper( $method ),
            'timeout' => 30,
            'headers' => [
                'Authorization' => 'Bearer ' . $this->token,
                'Accept'        => 'application/json',
            ],
        ];
        if ( in_array( $opts['method'], [ 'POST', 'PUT' ], true ) ) {
            $opts['headers']['Content-Type'] = 'application/json';
            $opts['body'] = wp_json_encode( [ 'data' => $args ] );
        } elseif ( $args ) {
            $url = add_query_arg( $args, $url );
        }
        $resp = wp_remote_request( $url, $opts );
        if ( is_wp_error( $resp ) ) return $resp;

        $code = wp_remote_retrieve_response_code( $resp );
        $body = json_decode( wp_remote_retrieve_body( $resp ), true );
        if ( $code >= 400 ) {
            return new WP_Error( 'aiwd_asana_api', $body['errors'][0]['message'] ?? 'Asana API error', [ 'status' => $code, 'body' => $body ] );
        }
        return $body['data'] ?? $body;
    }

    public function get_workspaces() {
        return $this->request( 'GET', '/workspaces', [ 'opt_fields' => 'name,gid' ] );
    }

    public function get_projects( $workspace_gid ) {
        return $this->request( 'GET', '/projects', [ 'workspace' => $workspace_gid, 'archived' => 'false', 'opt_fields' => 'name,gid', 'limit' => 100 ] );
    }

    public function get_users( $workspace_gid ) {
        return $this->request( 'GET', '/users', [ 'workspace' => $workspace_gid, 'opt_fields' => 'name,email,gid' ] );
    }

    public function create_project( $workspace_gid, $name, $notes = '', $team_gid = '' ) {
        $args = [ 'workspace' => $workspace_gid, 'name' => $name, 'notes' => $notes ];
        if ( $team_gid ) $args['team'] = $team_gid;
        return $this->request( 'POST', '/projects', $args );
    }

    public function create_task( $project_gid, $name, $notes = '', $assignee = '', $due_on = '' ) {
        $args = [ 'projects' => [ $project_gid ], 'name' => $name, 'notes' => $notes ];
        if ( $assignee ) $args['assignee'] = $assignee;
        if ( $due_on )   $args['due_on']   = $due_on;
        return $this->request( 'POST', '/tasks', $args );
    }

    public function update_task( $task_gid, $args ) {
        return $this->request( 'PUT', '/tasks/' . $task_gid, $args );
    }

    public function complete_task( $task_gid ) {
        return $this->update_task( $task_gid, [ 'completed' => true ] );
    }

    public function add_comment( $task_gid, $text ) {
        return $this->request( 'POST', '/tasks/' . $task_gid . '/stories', [ 'text' => $text ] );
    }

    public function get_tasks_of_project( $project_gid ) {
        return $this->request( 'GET', '/projects/' . $project_gid . '/tasks', [ 'opt_fields' => 'name,gid,completed', 'limit' => 100 ] );
    }

    public function get_project( $project_gid ) {
        return $this->request( 'GET', '/projects/' . $project_gid, [ 'opt_fields' => 'name,gid,workspace,team' ] );
    }

    public function search_projects( $workspace_gid, $query ) {
        return $this->request( 'GET', '/workspaces/' . $workspace_gid . '/typeahead', [
            'resource_type' => 'project',
            'query'         => $query,
            'count'         => 20,
            'opt_fields'    => 'name,gid',
        ] );
    }

    public function create_webhook( $resource_gid, $target_url ) {
        return $this->request( 'POST', '/webhooks', [ 'resource' => $resource_gid, 'target' => $target_url ] );
    }

    public function delete_webhook( $webhook_gid ) {
        return $this->request( 'DELETE', '/webhooks/' . $webhook_gid );
    }

    public function list_webhooks( $workspace_gid ) {
        return $this->request( 'GET', '/webhooks', [ 'workspace' => $workspace_gid, 'opt_fields' => 'resource,target,gid' ] );
    }

    /**
     * Sube un attachment (archivo) a una tarea.
     */
    public function upload_attachment( $task_gid, $file_path, $filename = '' ) {
        if ( ! $this->is_configured() ) return new WP_Error( 'aiwd_no_asana', 'Sin token' );
        if ( ! file_exists( $file_path ) ) return new WP_Error( 'aiwd_no_file', 'Archivo no encontrado' );

        $boundary = wp_generate_uuid4();
        $eol = "\r\n";
        $name = $filename ?: basename( $file_path );
        $mime = function_exists( 'mime_content_type' ) ? mime_content_type( $file_path ) : 'application/octet-stream';

        $body  = '--' . $boundary . $eol;
        $body .= 'Content-Disposition: form-data; name="parent"' . $eol . $eol . $task_gid . $eol;
        $body .= '--' . $boundary . $eol;
        $body .= 'Content-Disposition: form-data; name="file"; filename="' . $name . '"' . $eol;
        $body .= 'Content-Type: ' . $mime . $eol . $eol;
        $body .= file_get_contents( $file_path ) . $eol;
        $body .= '--' . $boundary . '--' . $eol;

        $resp = wp_remote_post( self::BASE . '/attachments', [
            'timeout' => 60,
            'headers' => [
                'Authorization' => 'Bearer ' . $this->token,
                'Content-Type'  => 'multipart/form-data; boundary=' . $boundary,
            ],
            'body' => $body,
        ] );
        if ( is_wp_error( $resp ) ) return $resp;
        return json_decode( wp_remote_retrieve_body( $resp ), true )['data'] ?? [];
    }
}
