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
        add_action( 'save_post_' . AIWD_CPT_Project::POST_TYPE, [ $this, 'maybe_create_asana_project' ], 20, 3 );
        add_action( 'aiwd_section_approved',       [ $this, 'on_section_approved' ], 10, 2 );
        add_action( 'aiwd_design_generated',       [ $this, 'on_design_generated' ], 10, 1 );
        add_action( 'aiwd_legal_generated',        [ $this, 'on_legal_generated' ], 10, 1 );
        // Comentarios del portal del cliente → comentario en tarea correspondiente.
        add_action( 'aiwd_section_comment_added',  [ $this, 'on_section_comment' ], 10, 3 );
    }

    public static function default_template() {
        return [
            'briefing'    => __( 'Recoger briefing del cliente', 'ai-web-designer' ),
            'assets'      => __( 'Recopilar logo, fotos y textos', 'ai-web-designer' ),
            'design'      => __( 'Generar diseño con Claude', 'ai-web-designer' ),
            'content'     => __( 'Revisar y ajustar contenidos', 'ai-web-designer' ),
            'seo'         => __( 'Configurar SEO y Schema.org', 'ai-web-designer' ),
            'legal'       => __( 'Generar textos legales y cookies', 'ai-web-designer' ),
            'integrations'=> __( 'Configurar integraciones (WhatsApp, GMB, GA4)', 'ai-web-designer' ),
            'qa'          => __( 'QA: responsive, formularios, velocidad', 'ai-web-designer' ),
            'approval'    => __( 'Aprobación final del cliente', 'ai-web-designer' ),
            'publish'     => __( 'Publicar y entregar', 'ai-web-designer' ),
        ];
    }

    public static function task_template() {
        $raw = aiwd_get_option( 'asana_task_template', '' );
        if ( $raw ) {
            $decoded = json_decode( $raw, true );
            if ( is_array( $decoded ) && $decoded ) return $decoded;
        }
        return self::default_template();
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

        // Adjuntar el PDF de propuesta a la tarea de briefing.
        $this->attach_proposal_pdf( $post_id );

        // Registrar webhook si está activado.
        $this->register_webhook( $post_id, $project_gid );

        do_action( 'aiwd_asana_project_created', $post_id, $project_gid, $tasks );

        return [ 'project' => $project_gid, 'tasks' => $tasks ];
    }

    /**
     * Vincula un proyecto Asana ya existente al proyecto WP en lugar de crear uno nuevo.
     * Importa las tareas existentes y las mapea por nombre a las task_keys de la plantilla.
     */
    public function link_existing_project( $post_id, $asana_project_gid ) {
        $client = new AIWD_Asana_Client();
        if ( ! $client->is_configured() ) return new WP_Error( 'aiwd_no_asana', 'Asana no configurada' );

        $project = $client->get_project( $asana_project_gid );
        if ( is_wp_error( $project ) ) return $project;

        $existing = $client->get_tasks_of_project( $asana_project_gid );
        if ( is_wp_error( $existing ) ) return $existing;

        // Mapear por coincidencia de nombre (case-insensitive y primeras palabras)
        $template = self::task_template();
        $tasks_map = [];
        foreach ( $template as $key => $title ) {
            foreach ( (array) $existing as $t ) {
                if ( stripos( $t['name'] ?? '', $title ) !== false || stripos( $title, $t['name'] ?? '' ) !== false ) {
                    $tasks_map[ $key ] = $t['gid'];
                    break;
                }
            }
        }
        // Crear las que falten
        $assignee = aiwd_get_option( 'asana_default_assignee' );
        foreach ( $template as $key => $title ) {
            if ( empty( $tasks_map[ $key ] ) ) {
                $task = $client->create_task( $asana_project_gid, $title, '', $assignee );
                if ( ! is_wp_error( $task ) && ! empty( $task['gid'] ) ) {
                    $tasks_map[ $key ] = $task['gid'];
                }
            }
        }

        update_post_meta( $post_id, self::META_PROJECT, $asana_project_gid );
        update_post_meta( $post_id, self::META_TASKS, $tasks_map );

        $this->attach_proposal_pdf( $post_id );
        $this->register_webhook( $post_id, $asana_project_gid );

        do_action( 'aiwd_asana_project_linked', $post_id, $asana_project_gid, $tasks_map );

        return [ 'project' => $asana_project_gid, 'tasks' => $tasks_map ];
    }

    public function attach_proposal_pdf( $post_id ) {
        if ( ! aiwd_get_option( 'asana_attach_pdf', 1 ) ) return;
        $tasks = (array) get_post_meta( $post_id, self::META_TASKS, true );
        $target_task = $tasks['briefing'] ?? reset( $tasks );
        if ( ! $target_task ) return;

        $pdf_gen = new AIWD_PDF_Proposal();
        $result  = $pdf_gen->build( $post_id );
        if ( is_wp_error( $result ) ) return;

        $upload = wp_upload_dir();
        $tmp = trailingslashit( $upload['basedir'] ) . 'aiwd-proposal-' . $post_id . '-' . time() . '.' . ( $result['mime'] === 'application/pdf' ? 'pdf' : 'html' );
        file_put_contents( $tmp, $result['body'] );

        $client = new AIWD_Asana_Client();
        $client->upload_attachment( $target_task, $tmp, $result['filename'] );
        @unlink( $tmp );
    }

    public function register_webhook( $post_id, $asana_project_gid ) {
        if ( ! aiwd_get_option( 'asana_webhooks_enabled', 0 ) ) return;
        $hook = AIWD_Asana_Webhook::ensure_for_project( $asana_project_gid );
        if ( ! is_wp_error( $hook ) && ! empty( $hook['gid'] ) ) {
            update_post_meta( $post_id, AIWD_Asana_Webhook::META_HOOK, $hook['gid'] );
        }
    }

    public function on_section_comment( $project_id, $section_key, $body ) {
        $tasks = (array) get_post_meta( $project_id, self::META_TASKS, true );
        $map = [ 'briefing' => 'briefing', 'content' => 'content', 'design' => 'design', 'seo' => 'seo', 'legal' => 'legal' ];
        $task_key = $map[ $section_key ] ?? $section_key;
        $gid = $tasks[ $task_key ] ?? '';
        if ( ! $gid ) return;
        ( new AIWD_Asana_Client() )->add_comment( $gid, "[Portal cliente] " . wp_strip_all_tags( $body ) );
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
