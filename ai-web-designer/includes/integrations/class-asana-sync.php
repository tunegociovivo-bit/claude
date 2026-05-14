<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

/**
 * Sincroniza proyectos AI Web Designer con Asana.
 *
 * Por cada proyecto WP creado, opcionalmente crea un proyecto Asana en el workspace
 * configurado, con una plantilla de tareas que cubren el flujo (briefing,
 * diseño, contenido, SEO, legales, QA, publicación).
 *
 * Estado guardado en meta del proyecto WP:
 *   _aiwd_asana_project_gid : gid del proyecto en Asana
 *   _aiwd_asana_tasks       : [ task_key => task_gid ]
 */
class AIWD_Asana_Sync {

    const META_PROJECT = '_aiwd_asana_project_gid';
    const META_TASKS   = '_aiwd_asana_tasks';

    public function register() {
        // Crea proyecto Asana al publicar un proyecto AIWD por primera vez.
        add_action( 'save_post_' . AIWD_CPT_Project::POST_TYPE, [ $this, 'maybe_create_asana_project' ], 20, 3 );
        // Completa tareas al aprobar secciones.
        add_action( 'aiwd_section_approved', [ $this, 'on_section_approved' ], 10, 2 );
        // Completa la tarea de "Generar diseño" al generarlo.
        add_action( 'aiwd_design_generated', [ $this, 'on_design_generated' ], 10, 1 );
        // Completa "Legales" cuando se generan.
        add_action( 'aiwd_legal_generated', [ $this, 'on_legal_generated' ], 10, 1 );
    }

    public static function task_template() {
        return [
            'briefing'   => __( 'Recoger briefing del cliente', 'ai-web-designer' ),
            'assets'     => __( 'Recopilar logo, fotos y textos', 'ai-web-designer' ),
            'design'     => __( 'Generar diseño con Claude', 'ai-web-designer' ),
            'content'    => __( 'Revisar y ajustar contenidos', 'ai-web-designer' ),
            'seo'        => __( 'Configurar SEO y Schema.org', 'ai-web-designer' ),
            'legal'      => __( 'Generar textos legales y cookies', 'ai-web-designer' ),
            'integrations'=> __( 'Configurar integraciones (WhatsApp, GMB, GA4)', 'ai-web-designer' ),
            'qa'         => __( 'QA: responsive, formularios, velocidad', 'ai-web-designer' ),
            'approval'   => __( 'Aprobación final del cliente', 'ai-web-designer' ),
            'publish'    => __( 'Publicar y entregar', 'ai-web-designer' ),
        ];
    }

    public function maybe_create_asana_project( $post_id, $post, $update ) {
        if ( wp_is_post_revision( $post_id ) || wp_is_post_autosave( $post_id ) ) return;
        if ( ! aiwd_get_option( 'asana_auto_create', 0 ) ) return;
        if ( get_post_meta( $post_id, self::META_PROJECT, true ) ) return; // ya creado

        $this->create_asana_project( $post_id );
    }

    public function create_asana_project( $post_id ) {
        $client = new AIWD_Asana_Client();
        if ( ! $client->is_configured() ) return new WP_Error( 'aiwd_no_asana', 'Asana no configurada' );

        $workspace = aiwd_get_option( 'asana_workspace' );
        $team      = aiwd_get_option( 'asana_team' );
        if ( ! $workspace ) return new WP_Error( 'aiwd_no_ws', 'Falta workspace Asana' );

        $post = get_post( $post_id );
        $name = sprintf( '[Web] %s', $post->post_title );
        $url  = admin_url( 'admin.php?page=aiwd-wizard&project_id=' . $post_id );
        $notes = sprintf(
            "Proyecto web generado por AI Web Designer.\n\nEditor: %s\n\nCliente: %s",
            $url,
            wp_get_post_terms( $post_id, 'aiwd_client', [ 'fields' => 'names' ] )[0] ?? '—'
        );

        $project = $client->create_project( $workspace, $name, $notes, $team );
        if ( is_wp_error( $project ) ) return $project;

        $project_gid = $project['gid'] ?? '';
        if ( ! $project_gid ) return new WP_Error( 'aiwd_asana', 'No se pudo crear el proyecto' );

        update_post_meta( $post_id, self::META_PROJECT, $project_gid );

        $tasks = [];
        $assignee = aiwd_get_option( 'asana_default_assignee' );
        foreach ( self::task_template() as $key => $title ) {
            $task = $client->create_task( $project_gid, $title, '', $assignee );
            if ( ! is_wp_error( $task ) && ! empty( $task['gid'] ) ) {
                $tasks[ $key ] = $task['gid'];
            }
        }
        update_post_meta( $post_id, self::META_TASKS, $tasks );

        do_action( 'aiwd_asana_project_created', $post_id, $project_gid, $tasks );

        return [ 'project' => $project_gid, 'tasks' => $tasks ];
    }

    public function on_section_approved( $project_id, $section_key ) {
        $map = [
            'briefing' => 'briefing',
            'content'  => 'content',
            'design'   => 'design',
            'seo'      => 'seo',
            'legal'    => 'legal',
            'final'    => 'approval',
        ];
        $task_key = $map[ $section_key ] ?? null;
        if ( $task_key ) $this->complete_task( $project_id, $task_key, "Sección '$section_key' aprobada." );
    }

    public function on_design_generated( $project_id ) {
        $this->complete_task( $project_id, 'design', 'Diseño generado con Claude.' );
    }

    public function on_legal_generated( $project_id ) {
        $this->complete_task( $project_id, 'legal', 'Textos legales generados.' );
    }

    public function complete_task( $project_id, $task_key, $comment = '' ) {
        $tasks = (array) get_post_meta( $project_id, self::META_TASKS, true );
        $gid = $tasks[ $task_key ] ?? '';
        if ( ! $gid ) return;
        $client = new AIWD_Asana_Client();
        if ( $comment ) $client->add_comment( $gid, $comment );
        $client->complete_task( $gid );
    }

    public function asana_url( $project_id ) {
        $gid = get_post_meta( $project_id, self::META_PROJECT, true );
        return $gid ? "https://app.asana.com/0/{$gid}/list" : '';
    }
}
