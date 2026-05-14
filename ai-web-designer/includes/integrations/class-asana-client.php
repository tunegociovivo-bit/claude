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
}
