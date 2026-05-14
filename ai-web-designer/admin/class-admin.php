<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

class AIWD_Admin {

    public function register() {
        add_action( 'admin_menu', [ $this, 'add_menu' ] );
        add_action( 'admin_enqueue_scripts', [ $this, 'enqueue_assets' ] );
        add_action( 'admin_init', [ $this, 'register_settings' ] );
        add_action( 'admin_post_aiwd_save_project', [ $this, 'handle_save_project' ] );
        add_action( 'admin_post_aiwd_create_project', [ $this, 'handle_create_project' ] );
    }

    public function add_menu() {
        $cap = 'aiwd_manage_projects';
        add_menu_page(
            __( 'AI Web Designer', 'ai-web-designer' ),
            __( 'AI Web Designer', 'ai-web-designer' ),
            $cap,
            'aiwd-dashboard',
            [ $this, 'view_dashboard' ],
            'dashicons-art',
            58
        );
        add_submenu_page( 'aiwd-dashboard', __( 'Dashboard', 'ai-web-designer' ),     __( 'Dashboard', 'ai-web-designer' ),     $cap, 'aiwd-dashboard', [ $this, 'view_dashboard' ] );
        add_submenu_page( 'aiwd-dashboard', __( 'Proyectos', 'ai-web-designer' ),     __( 'Proyectos', 'ai-web-designer' ),     $cap, 'aiwd-projects',  [ $this, 'view_projects' ] );
        add_submenu_page( 'aiwd-dashboard', __( 'Nuevo proyecto', 'ai-web-designer' ),__( 'Nuevo proyecto', 'ai-web-designer' ), $cap, 'aiwd-new',       [ $this, 'view_new' ] );
        add_submenu_page( 'aiwd-dashboard', __( 'Briefing (Wizard)', 'ai-web-designer' ),__( 'Briefing', 'ai-web-designer' ),    $cap, 'aiwd-wizard',    [ $this, 'view_wizard' ] );
        add_submenu_page( 'aiwd-dashboard', __( 'Librería de plantillas', 'ai-web-designer' ),__( 'Plantillas', 'ai-web-designer' ), $cap, 'aiwd-templates', [ $this, 'view_templates' ] );
        add_submenu_page( 'aiwd-dashboard', __( 'Aprobaciones', 'ai-web-designer' ),  __( 'Aprobaciones', 'ai-web-designer' ),  $cap, 'aiwd-approvals',[ $this, 'view_approvals' ] );
        add_submenu_page( 'aiwd-dashboard', __( 'QA / Calidad', 'ai-web-designer' ),  __( 'QA', 'ai-web-designer' ),            $cap, 'aiwd-qa',       [ $this, 'view_qa' ] );
        add_submenu_page( 'aiwd-dashboard', __( 'Agencia / Clientes', 'ai-web-designer' ),__( 'Agencia', 'ai-web-designer' ),   $cap, 'aiwd-agency',    [ $this, 'view_agency' ] );
        add_submenu_page( 'aiwd-dashboard', __( 'Coste / Uso IA', 'ai-web-designer' ),__( 'Coste IA', 'ai-web-designer' ),     $cap, 'aiwd-costs',     [ $this, 'view_costs' ] );
        add_submenu_page( 'aiwd-dashboard', __( 'Ajustes', 'ai-web-designer' ),       __( 'Ajustes', 'ai-web-designer' ),       'manage_options', 'aiwd-settings', [ $this, 'view_settings' ] );
    }

    public function enqueue_assets( $hook ) {
        if ( strpos( (string) $hook, 'aiwd' ) === false ) {
            return;
        }
        wp_enqueue_style( 'aiwd-admin', AIWD_PLUGIN_URL . 'admin/assets/css/admin.css', [], AIWD_VERSION );
        wp_enqueue_media();
        wp_enqueue_script( 'aiwd-admin', AIWD_PLUGIN_URL . 'admin/assets/js/admin.js', [ 'jquery', 'wp-i18n' ], AIWD_VERSION, true );
        wp_enqueue_script( 'aiwd-wizard', AIWD_PLUGIN_URL . 'admin/assets/js/wizard.js', [ 'jquery', 'wp-api-fetch' ], AIWD_VERSION, true );
        wp_enqueue_script( 'aiwd-qa',     AIWD_PLUGIN_URL . 'admin/assets/js/qa.js',     [ 'jquery' ], AIWD_VERSION, true );
        wp_localize_script( 'aiwd-admin', 'AIWD', [
            'ajax_url'   => admin_url( 'admin-ajax.php' ),
            'rest_url'   => esc_url_raw( rest_url( 'aiwd/v1/' ) ),
            'nonce'      => wp_create_nonce( 'wp_rest' ),
            'admin_nonce'=> wp_create_nonce( 'aiwd_admin' ),
            'i18n'       => [
                'generating' => __( 'Generando con IA...', 'ai-web-designer' ),
                'select'     => __( 'Seleccionar', 'ai-web-designer' ),
                'regen'      => __( 'Regenerar', 'ai-web-designer' ),
                'confirm'    => __( '¿Seguro?', 'ai-web-designer' ),
            ],
        ] );
    }

    public function register_settings() {
        register_setting( 'aiwd_settings_group', 'aiwd_settings', [
            'sanitize_callback' => 'aiwd_sanitize_array',
        ] );
    }

    public function view_dashboard()  { include AIWD_PLUGIN_DIR . 'admin/views/dashboard.php'; }
    public function view_projects()   { include AIWD_PLUGIN_DIR . 'admin/views/projects.php'; }
    public function view_new()        { include AIWD_PLUGIN_DIR . 'admin/views/new-project.php'; }
    public function view_wizard()     { include AIWD_PLUGIN_DIR . 'admin/views/wizard.php'; }
    public function view_templates()  { include AIWD_PLUGIN_DIR . 'admin/views/templates-library.php'; }
    public function view_approvals()  { include AIWD_PLUGIN_DIR . 'admin/views/approvals.php'; }
    public function view_qa()         { include AIWD_PLUGIN_DIR . 'admin/views/qa.php'; }
    public function view_agency()     { include AIWD_PLUGIN_DIR . 'admin/views/agency.php'; }
    public function view_costs()      { include AIWD_PLUGIN_DIR . 'admin/views/costs.php'; }
    public function view_settings()   { include AIWD_PLUGIN_DIR . 'admin/views/settings.php'; }

    public function handle_create_project() {
        if ( ! aiwd_current_user_can_manage() || ! check_admin_referer( 'aiwd_create_project' ) ) {
            wp_die( __( 'No autorizado.', 'ai-web-designer' ) );
        }
        $title = sanitize_text_field( $_POST['project_title'] ?? '' );
        if ( ! $title ) {
            wp_safe_redirect( admin_url( 'admin.php?page=aiwd-new&error=1' ) );
            exit;
        }
        $post_id = wp_insert_post( [
            'post_title'  => $title,
            'post_type'   => AIWD_CPT_Project::POST_TYPE,
            'post_status' => 'publish',
            'post_author' => get_current_user_id(),
        ] );
        if ( $post_id && ! is_wp_error( $post_id ) ) {
            update_post_meta( $post_id, '_aiwd_status', 'briefing' );
            wp_safe_redirect( admin_url( 'admin.php?page=aiwd-wizard&project_id=' . $post_id ) );
            exit;
        }
        wp_safe_redirect( admin_url( 'admin.php?page=aiwd-new&error=1' ) );
        exit;
    }

    public function handle_save_project() {
        if ( ! aiwd_current_user_can_manage() || ! check_admin_referer( 'aiwd_save_project' ) ) {
            wp_die( __( 'No autorizado.', 'ai-web-designer' ) );
        }
        $project_id = (int) ( $_POST['project_id'] ?? 0 );
        $section    = sanitize_key( $_POST['section'] ?? '' );
        $payload    = aiwd_sanitize_array( $_POST['data'] ?? [] );

        if ( $project_id && $section ) {
            AIWD_CPT_Project::save_project_data( $project_id, $section, $payload );
        }
        wp_safe_redirect( wp_get_referer() ?: admin_url( 'admin.php?page=aiwd-dashboard' ) );
        exit;
    }
}
