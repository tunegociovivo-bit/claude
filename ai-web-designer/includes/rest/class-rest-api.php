<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

class AIWD_Rest_API {

    const NS = 'aiwd/v1';

    public function register() {
        add_action( 'rest_api_init', [ $this, 'routes' ] );
    }

    public function routes() {
        $perm = [ $this, 'permissions' ];

        register_rest_route( self::NS, '/generate/text', [
            'methods'             => 'POST',
            'callback'            => [ $this, 'generate_text' ],
            'permission_callback' => $perm,
        ] );

        register_rest_route( self::NS, '/generate/variants', [
            'methods'             => 'POST',
            'callback'            => [ $this, 'generate_variants' ],
            'permission_callback' => $perm,
        ] );

        register_rest_route( self::NS, '/generate/image', [
            'methods'             => 'POST',
            'callback'            => [ $this, 'generate_image' ],
            'permission_callback' => $perm,
        ] );

        register_rest_route( self::NS, '/generate/design', [
            'methods'             => 'POST',
            'callback'            => [ $this, 'generate_design' ],
            'permission_callback' => $perm,
        ] );

        register_rest_route( self::NS, '/generate/legal', [
            'methods'             => 'POST',
            'callback'            => [ $this, 'generate_legal' ],
            'permission_callback' => $perm,
        ] );

        register_rest_route( self::NS, '/generate/seo', [
            'methods'             => 'POST',
            'callback'            => [ $this, 'generate_seo' ],
            'permission_callback' => $perm,
        ] );

        register_rest_route( self::NS, '/generate/blog', [
            'methods'             => 'POST',
            'callback'            => [ $this, 'generate_blog' ],
            'permission_callback' => $perm,
        ] );

        register_rest_route( self::NS, '/scrape', [
            'methods'             => 'POST',
            'callback'            => [ $this, 'scrape' ],
            'permission_callback' => $perm,
        ] );

        register_rest_route( self::NS, '/project/(?P<id>\d+)/save', [
            'methods'             => 'POST',
            'callback'            => [ $this, 'save_project' ],
            'permission_callback' => $perm,
        ] );

        register_rest_route( self::NS, '/project/(?P<id>\d+)/approve', [
            'methods'             => 'POST',
            'callback'            => [ $this, 'approve_section' ],
            'permission_callback' => $perm,
        ] );

        register_rest_route( self::NS, '/project/(?P<id>\d+)/comment', [
            'methods'             => 'POST',
            'callback'            => [ $this, 'comment_section' ],
            'permission_callback' => $perm,
        ] );

        register_rest_route( self::NS, '/project/(?P<id>\d+)/versions', [
            'methods'             => 'GET',
            'callback'            => [ $this, 'list_versions' ],
            'permission_callback' => $perm,
        ] );

        register_rest_route( self::NS, '/project/(?P<id>\d+)/export', [
            'methods'             => 'GET',
            'callback'            => [ $this, 'export_kit' ],
            'permission_callback' => $perm,
        ] );

        register_rest_route( self::NS, '/translate', [
            'methods'             => 'POST',
            'callback'            => [ $this, 'translate' ],
            'permission_callback' => $perm,
        ] );

        register_rest_route( self::NS, '/remove-bg', [
            'methods'             => 'POST',
            'callback'            => [ $this, 'remove_bg' ],
            'permission_callback' => $perm,
        ] );

        register_rest_route( self::NS, '/project/(?P<id>\d+)/token', [
            'methods'             => 'POST',
            'callback'            => [ $this, 'generate_client_token' ],
            'permission_callback' => $perm,
        ] );

        register_rest_route( self::NS, '/project/(?P<id>\d+)/proposal.pdf', [
            'methods'             => 'GET',
            'callback'            => [ $this, 'download_proposal' ],
            'permission_callback' => $perm,
        ] );

        register_rest_route( self::NS, '/asana/workspaces', [
            'methods'             => 'GET',
            'callback'            => [ $this, 'asana_workspaces' ],
            'permission_callback' => $perm,
        ] );

        register_rest_route( self::NS, '/asana/users', [
            'methods'             => 'GET',
            'callback'            => [ $this, 'asana_users' ],
            'permission_callback' => $perm,
        ] );

        register_rest_route( self::NS, '/project/(?P<id>\d+)/asana/sync', [
            'methods'             => 'POST',
            'callback'            => [ $this, 'asana_sync_project' ],
            'permission_callback' => $perm,
        ] );
    }

    public function asana_workspaces() {
        $client = new AIWD_Asana_Client();
        $r = $client->get_workspaces();
        if ( is_wp_error( $r ) ) return $r;
        return rest_ensure_response( $r );
    }

    public function asana_users( WP_REST_Request $req ) {
        $client = new AIWD_Asana_Client();
        $r = $client->get_users( sanitize_text_field( $req['workspace'] ?? aiwd_get_option( 'asana_workspace' ) ) );
        if ( is_wp_error( $r ) ) return $r;
        return rest_ensure_response( $r );
    }

    public function asana_sync_project( WP_REST_Request $req ) {
        $sync = new AIWD_Asana_Sync();
        $r = $sync->create_asana_project( (int) $req['id'] );
        if ( is_wp_error( $r ) ) return $r;
        return rest_ensure_response( array_merge( $r, [ 'url' => $sync->asana_url( (int) $req['id'] ) ] ) );
    }

    public function generate_client_token( WP_REST_Request $req ) {
        $token = AIWD_Client_Portal::generate_token( (int) $req['id'], (int) ( $req['ttl_days'] ?? 30 ) );
        $url   = add_query_arg( [ 'token' => $token ], home_url( '/briefing/' ) );
        return rest_ensure_response( [ 'token' => $token, 'url' => $url ] );
    }

    public function download_proposal( WP_REST_Request $req ) {
        $pdf = new AIWD_PDF_Proposal();
        $pdf->stream( (int) $req['id'] );
        return null; // stream() llama a exit()
    }

    public function permissions() {
        return aiwd_current_user_can_manage();
    }

    public function generate_text( WP_REST_Request $req ) {
        $gen = new AIWD_Content_Generator();
        $text = $gen->generate_block( (int) $req['project_id'], sanitize_key( $req['block'] ) );
        if ( is_wp_error( $text ) ) return $text;
        return rest_ensure_response( [ 'text' => $text ] );
    }

    public function generate_variants( WP_REST_Request $req ) {
        $gen = new AIWD_Content_Generator();
        $variants = $gen->generate_variants( (int) $req['project_id'], sanitize_key( $req['block'] ), (int) ( $req['n'] ?? 3 ) );
        return rest_ensure_response( [ 'variants' => $variants ] );
    }

    public function generate_image( WP_REST_Request $req ) {
        $gen = new AIWD_Image_Generator();
        $ids = $gen->generate( sanitize_text_field( $req['prompt'] ?? '' ), [
            'size'   => sanitize_text_field( $req['size'] ?? '1536x1024' ),
            'n'      => (int) ( $req['n'] ?? 1 ),
            'aspect' => sanitize_text_field( $req['aspect'] ?? '16:9' ),
        ] );
        if ( is_wp_error( $ids ) ) return $ids;
        $imgs = [];
        foreach ( (array) $ids as $id ) {
            $imgs[] = [ 'id' => $id, 'url' => wp_get_attachment_url( $id ) ];
        }
        return rest_ensure_response( [ 'images' => $imgs ] );
    }

    public function generate_design( WP_REST_Request $req ) {
        $gen = new AIWD_Design_Generator();
        $project_id = (int) $req['project_id'];
        $mode = sanitize_key( $req['mode'] ?? 'full' );
        $result = ( $mode === 'proposals' ) ? $gen->generate_proposals( $project_id, 3 ) : $gen->generate( $project_id, $mode );
        if ( is_wp_error( $result ) ) return $result;
        do_action( 'aiwd_design_generated', $project_id );
        return rest_ensure_response( $result );
    }

    public function generate_legal( WP_REST_Request $req ) {
        $gen = new AIWD_Legal_Generator();
        $project_id = (int) $req['project_id'];
        $created = $gen->generate( $project_id, (array) ( $req['types'] ?? [ 'privacy','cookies','terms' ] ) );
        do_action( 'aiwd_legal_generated', $project_id );
        return rest_ensure_response( [ 'pages' => $created ] );
    }

    public function generate_seo( WP_REST_Request $req ) {
        $gen = new AIWD_SEO_Generator();
        $meta = $gen->generate_meta( (int) $req['project_id'] );
        return rest_ensure_response( [ 'seo' => $meta ] );
    }

    public function generate_blog( WP_REST_Request $req ) {
        $gen = new AIWD_Content_Generator();
        $ids = $gen->generate_blog_posts( (int) $req['project_id'], (int) ( $req['count'] ?? 5 ) );
        return rest_ensure_response( [ 'created' => $ids ] );
    }

    public function scrape( WP_REST_Request $req ) {
        $s = new AIWD_Scraper();
        $r = $s->scrape( esc_url_raw( $req['url'] ?? '' ) );
        if ( is_wp_error( $r ) ) return $r;
        return rest_ensure_response( $r );
    }

    public function save_project( WP_REST_Request $req ) {
        $project_id = (int) $req['id'];
        $params     = $req->get_json_params();
        $payload    = aiwd_sanitize_array( $params['data'] ?? [] );
        if ( ! $project_id ) return new WP_Error( 'aiwd_bad', 'Datos incompletos' );

        // Si llega un section explícito, lo respetamos; si no, repartimos por
        // claves conocidas a sus secciones correspondientes.
        $section = sanitize_key( $params['section'] ?? '' );
        if ( $section ) {
            AIWD_CPT_Project::save_project_data( $project_id, $section, $payload );
        } else {
            $this->dispatch_payload_to_sections( $project_id, $payload );
        }

        // Snapshot de versión
        global $wpdb;
        $current_version = (int) get_post_meta( $project_id, '_aiwd_version', true );
        $next = $current_version + 1;
        $wpdb->insert( AIWD_Database::table( 'versions' ), [
            'project_id' => $project_id,
            'version'    => $next,
            'payload'    => wp_json_encode( AIWD_CPT_Project::get_project_data( $project_id ) ),
            'author_id'  => get_current_user_id(),
            'note'       => sanitize_text_field( $req['note'] ?? '' ),
            'created_at' => current_time( 'mysql' ),
        ] );
        update_post_meta( $project_id, '_aiwd_version', $next );
        return rest_ensure_response( [ 'ok' => true, 'version' => $next ] );
    }

    private function dispatch_payload_to_sections( $project_id, array $payload ) {
        $map = [
            'briefing' => [ 'business_name','sector','description','audience','tone','usp','competitors','notes' ],
            'brand'    => [ 'logo_id','color_primary','color_secondary','color_accent','font_heading','font_body','tagline','gallery','gallery_json','selected_images' ],
            'contact'  => [ 'domain','email','phone','whatsapp','address','schedule','social','maps_url' ],
            'content'  => [ 'hero_headline','hero_sub','about','services','why_us','testimonials','faq','cta' ],
            'design'   => [ 'references','wa_number','calendly','gmb_id','crm','languages','ga4' ],
            'pages'    => [ 'pages','blog_posts' ],
            'seo'      => [ 'keywords','meta_title','meta_description','schema_type' ],
            'legal'    => [ 'country','gen_legal' ],
        ];
        foreach ( $map as $section => $keys ) {
            $subset = array_intersect_key( $payload, array_flip( $keys ) );
            if ( $subset ) {
                $current = (array) get_post_meta( $project_id, '_aiwd_' . $section, true );
                AIWD_CPT_Project::save_project_data( $project_id, $section, array_merge( $current, $subset ) );
            }
        }
    }

    public function approve_section( WP_REST_Request $req ) {
        global $wpdb;
        $project_id = (int) $req['id'];
        $section    = sanitize_key( $req['section'] ?? '' );
        $status     = sanitize_key( $req['status'] ?? 'approved' );
        $wpdb->insert( AIWD_Database::table( 'approvals' ), [
            'project_id' => $project_id,
            'section_key'=> $section,
            'user_id'    => get_current_user_id(),
            'status'     => $status,
            'note'       => sanitize_textarea_field( $req['note'] ?? '' ),
            'created_at' => current_time( 'mysql' ),
        ] );
        if ( $status === 'approved' ) {
            do_action( 'aiwd_section_approved', $project_id, $section );
        }
        return rest_ensure_response( [ 'ok' => true ] );
    }

    public function comment_section( WP_REST_Request $req ) {
        global $wpdb;
        $wpdb->insert( AIWD_Database::table( 'section_comments' ), [
            'project_id' => (int) $req['id'],
            'section_key'=> sanitize_key( $req['section'] ?? '' ),
            'user_id'    => get_current_user_id(),
            'body'       => wp_kses_post( $req['body'] ?? '' ),
            'resolved'   => 0,
            'created_at' => current_time( 'mysql' ),
        ] );
        return rest_ensure_response( [ 'ok' => true ] );
    }

    public function list_versions( WP_REST_Request $req ) {
        global $wpdb;
        $t = AIWD_Database::table( 'versions' );
        $id = (int) $req['id'];
        $rows = $wpdb->get_results( $wpdb->prepare( "SELECT id, version, author_id, note, created_at FROM $t WHERE project_id = %d ORDER BY version DESC", $id ) );
        return rest_ensure_response( $rows );
    }

    public function export_kit( WP_REST_Request $req ) {
        $project_id = (int) $req['id'];
        $data = AIWD_CPT_Project::get_project_data( $project_id );
        $blueprint = get_post_meta( $project_id, '_aiwd_design_blueprint', true );
        return rest_ensure_response( [
            'project_id' => $project_id,
            'data'       => $data,
            'blueprint'  => $blueprint,
            'pages'      => get_post_meta( $project_id, '_aiwd_built_pages', true ),
        ] );
    }

    public function translate( WP_REST_Request $req ) {
        $page_id = (int) $req['page_id'];
        $langs   = array_map( 'sanitize_key', (array) ( $req['langs'] ?? [] ) );
        $created = AIWD_Integration_WPML::translate_page( $page_id, $langs );
        return rest_ensure_response( [ 'created' => $created ] );
    }

    public function remove_bg( WP_REST_Request $req ) {
        $gen = new AIWD_Image_Generator();
        $r = $gen->remove_background( (int) $req['attachment_id'] );
        if ( is_wp_error( $r ) ) return $r;
        return rest_ensure_response( [ 'attachment_id' => $r ] );
    }
}
