<?php
/**
 * Capa de administracion.
 */

if ( ! defined( 'WPINC' ) ) {
    die;
}

class NVL_Admin {

    const CAPABILITY = 'manage_options';
    const MENU_SLUG  = 'nvl-dashboard';

    public function register() {
        add_action( 'admin_menu', array( $this, 'add_menus' ) );
        add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_assets' ) );
        add_action( 'admin_init', array( $this, 'handle_actions' ) );
        add_action( 'admin_post_nvl_export_csv', array( 'NVL_CSV_Exporter', 'export_search' ) );
        add_action( 'wp_ajax_nvl_render_preview', array( $this, 'ajax_render_preview' ) );
    }

    public function ajax_render_preview() {
        check_ajax_referer( 'nvl_render', '_wpnonce' );
        if ( ! current_user_can( self::CAPABILITY ) ) wp_send_json_error( 'No autorizado' );
        $lead_id = isset( $_POST['lead_id'] ) ? intval( $_POST['lead_id'] ) : 0;
        $body    = isset( $_POST['body'] ) ? wp_unslash( $_POST['body'] ) : '';
        $rendered = NVL_Template_Engine::render( $body, $lead_id );
        wp_send_json_success( array( 'rendered' => $rendered ) );
    }

    public function add_menus() {
        $cap = self::CAPABILITY;
        add_menu_page( 'Negocio Vivo Leads', 'NV Leads', $cap, self::MENU_SLUG, array( $this, 'render_dashboard' ), 'dashicons-businessperson', 26 );
        add_submenu_page( self::MENU_SLUG, 'Dashboard',     'Dashboard',     $cap, self::MENU_SLUG,       array( $this, 'render_dashboard' ) );
        add_submenu_page( self::MENU_SLUG, 'Analytics',     'Analytics',     $cap, 'nvl-analytics',       array( $this, 'render_analytics' ) );
        add_submenu_page( self::MENU_SLUG, 'Nueva busqueda','Nueva busqueda',$cap, 'nvl-new-search',      array( $this, 'render_new_search' ) );
        add_submenu_page( self::MENU_SLUG, 'Busquedas',     'Busquedas',     $cap, 'nvl-searches',        array( $this, 'render_searches' ) );
        add_submenu_page( self::MENU_SLUG, 'Cola de envio', 'Cola de envio', $cap, 'nvl-queue',           array( $this, 'render_queue' ) );
        add_submenu_page( self::MENU_SLUG, 'Bandeja',       'Bandeja',       $cap, 'nvl-inbox',           array( $this, 'render_inbox' ) );
        add_submenu_page( self::MENU_SLUG, 'Secuencias',    'Secuencias',    $cap, 'nvl-sequences',       array( $this, 'render_sequences' ) );
        add_submenu_page( self::MENU_SLUG, 'Exclusiones',   'Exclusiones',   $cap, 'nvl-exclusions',      array( $this, 'render_exclusions' ) );
        add_submenu_page( self::MENU_SLUG, 'Plantillas',    'Plantillas',    $cap, 'nvl-templates',       array( $this, 'render_templates' ) );
        add_submenu_page( self::MENU_SLUG, 'Ajustes',       'Ajustes',       $cap, 'nvl-settings',        array( $this, 'render_settings' ) );
        add_submenu_page( null, 'Detalle busqueda', 'Detalle busqueda', $cap, 'nvl-search-detail', array( $this, 'render_search_detail' ) );
        add_submenu_page( null, 'Detalle lead',     'Detalle lead',     $cap, 'nvl-lead-detail',   array( $this, 'render_lead_detail' ) );
    }

    public function enqueue_assets( $hook ) {
        if ( strpos( $hook, 'nvl' ) === false && strpos( $hook, self::MENU_SLUG ) === false ) return;
        wp_enqueue_style( 'nvl-admin', NVL_PLUGIN_URL . 'admin/css/admin.css', array(), NVL_VERSION );
        wp_enqueue_script( 'nvl-admin', NVL_PLUGIN_URL . 'admin/js/admin.js', array( 'jquery' ), NVL_VERSION, true );
    }

    public function handle_actions() {
        if ( ! current_user_can( self::CAPABILITY ) ) return;

        if ( isset( $_POST['nvl_action'] ) && $_POST['nvl_action'] === 'start_search' ) {
            check_admin_referer( 'nvl_start_search' );
            $keyword = isset( $_POST['keyword'] ) ? sanitize_text_field( wp_unslash( $_POST['keyword'] ) ) : '';
            $scope   = isset( $_POST['scope'] ) ? sanitize_text_field( wp_unslash( $_POST['scope'] ) ) : 'custom';
            $location = '';
            if ( $scope === 'spain' )         $location = 'Toda España';
            elseif ( $scope === 'province' )  $location = isset( $_POST['province'] ) ? sanitize_text_field( wp_unslash( $_POST['province'] ) ) : '';
            else                              $location = isset( $_POST['location'] ) ? sanitize_text_field( wp_unslash( $_POST['location'] ) ) : '';

            $res = NVL_Search_Manager::start_search( $keyword, $location, $scope );
            if ( is_wp_error( $res ) ) {
                wp_safe_redirect( add_query_arg( array( 'page' => 'nvl-new-search', 'nvl_error' => urlencode( $res->get_error_message() ) ), admin_url( 'admin.php' ) ) );
                exit;
            }
            wp_safe_redirect( admin_url( 'admin.php?page=nvl-search-detail&id=' . intval( $res ) ) );
            exit;
        }

        if ( isset( $_GET['nvl_action'] ) && $_GET['nvl_action'] === 'delete_search' && isset( $_GET['id'] ) ) {
            check_admin_referer( 'nvl_delete_search_' . intval( $_GET['id'] ) );
            NVL_DB::delete_search( intval( $_GET['id'] ) );
            wp_safe_redirect( admin_url( 'admin.php?page=nvl-searches&deleted=1' ) );
            exit;
        }

        if ( isset( $_POST['nvl_action'] ) && $_POST['nvl_action'] === 'update_lead_status' ) {
            check_admin_referer( 'nvl_update_lead' );
            $lead_id = intval( $_POST['lead_id'] );
            $status  = sanitize_text_field( wp_unslash( $_POST['contact_status'] ) );
            $notes   = isset( $_POST['notes'] ) ? sanitize_textarea_field( wp_unslash( $_POST['notes'] ) ) : '';
            NVL_DB::update_lead_details( $lead_id, array( 'contact_status' => $status, 'notes' => $notes ) );
            wp_safe_redirect( admin_url( 'admin.php?page=nvl-lead-detail&id=' . $lead_id . '&updated=1' ) );
            exit;
        }

        if ( isset( $_POST['nvl_action'] ) && $_POST['nvl_action'] === 'save_template' ) {
            check_admin_referer( 'nvl_save_template' );
            $id = intval( $_POST['template_id'] );
            NVL_DB::save_template( array(
                'name'       => sanitize_text_field( wp_unslash( $_POST['name'] ) ),
                'body'       => wp_unslash( $_POST['body'] ),
                'is_default' => ! empty( $_POST['is_default'] ),
            ), $id );
            wp_safe_redirect( admin_url( 'admin.php?page=nvl-templates&saved=1' ) );
            exit;
        }

        if ( isset( $_GET['nvl_action'] ) && $_GET['nvl_action'] === 'delete_template' && isset( $_GET['id'] ) ) {
            check_admin_referer( 'nvl_delete_template_' . intval( $_GET['id'] ) );
            NVL_DB::delete_template( intval( $_GET['id'] ) );
            wp_safe_redirect( admin_url( 'admin.php?page=nvl-templates&deleted=1' ) );
            exit;
        }

        if ( isset( $_POST['nvl_action'] ) && $_POST['nvl_action'] === 'save_settings' ) {
            check_admin_referer( 'nvl_save_settings' );
            $settings = get_option( 'nvl_settings', array() );

            // IMPORTANTE: solo actualizar campos que ESTAN PRESENTES en el POST.
            // Cada formulario en settings.php envia solo sus propios campos. Si
            // sobrescribieramos todos, los demas se borrarian con cadenas vacias.
            if ( isset( $_POST['google_api_key'] ) )         $settings['google_api_key']        = sanitize_text_field( wp_unslash( $_POST['google_api_key'] ) );
            if ( isset( $_POST['batch_size'] ) )             $settings['batch_size']            = max( 1, intval( $_POST['batch_size'] ) );
            if ( isset( $_POST['competitor_count'] ) )       $settings['competitor_count']      = max( 1, intval( $_POST['competitor_count'] ) );
            if ( isset( $_POST['whatsapp_country_code'] ) )  $settings['whatsapp_country_code'] = preg_replace( '/[^0-9]/', '', $_POST['whatsapp_country_code'] );
            if ( isset( $_POST['evolution_api_url'] ) )      $settings['evolution_api_url']     = esc_url_raw( wp_unslash( $_POST['evolution_api_url'] ) );
            if ( isset( $_POST['evolution_api_key'] ) )      $settings['evolution_api_key']     = sanitize_text_field( wp_unslash( $_POST['evolution_api_key'] ) );
            if ( isset( $_POST['evolution_instance'] ) )     $settings['evolution_instance']    = sanitize_text_field( wp_unslash( $_POST['evolution_instance'] ) );
            if ( isset( $_POST['send_delay_min'] ) )         $settings['send_delay_min']        = max( 5, intval( $_POST['send_delay_min'] ) );
            if ( isset( $_POST['send_delay_max'] ) )         $settings['send_delay_max']        = max( intval( $settings['send_delay_min'] ), intval( $_POST['send_delay_max'] ) );
            if ( isset( $_POST['send_window_start'] ) )      $settings['send_window_start']     = preg_match( '/^\d{2}:\d{2}$/', $_POST['send_window_start'] ) ? $_POST['send_window_start'] : '09:00';
            if ( isset( $_POST['send_window_end'] ) )        $settings['send_window_end']       = preg_match( '/^\d{2}:\d{2}$/', $_POST['send_window_end'] ) ? $_POST['send_window_end'] : '20:00';
            if ( isset( $_POST['daily_limit'] ) )            $settings['daily_limit']           = max( 1, intval( $_POST['daily_limit'] ) );

            // Checkboxes: solo actualizar si el form contenia el grupo correspondiente.
            // Usamos un campo hidden "form_section" para saber que form se envio.
            $section = isset( $_POST['form_section'] ) ? sanitize_key( $_POST['form_section'] ) : '';
            if ( $section === 'main' || isset( $_POST['google_api_key'] ) ) {
                $settings['fetch_details']          = ! empty( $_POST['fetch_details'] ) ? 1 : 0;
                $settings['validate_keyword_match'] = ! empty( $_POST['validate_keyword_match'] ) ? 1 : 0;
                $settings['send_enabled']           = ! empty( $_POST['send_enabled'] ) ? 1 : 0;
                $settings['send_on_weekends']       = ! empty( $_POST['send_on_weekends'] ) ? 1 : 0;
                $settings['enable_variations']      = ! empty( $_POST['enable_variations'] ) ? 1 : 0;
            }
            if ( $section === 'ai' || isset( $_POST['ai_provider'] ) ) {
                if ( isset( $_POST['ai_provider'] ) )      $settings['ai_provider']    = sanitize_text_field( wp_unslash( $_POST['ai_provider'] ) );
                if ( isset( $_POST['ai_api_key'] ) )       $settings['ai_api_key']     = sanitize_text_field( wp_unslash( $_POST['ai_api_key'] ) );
                if ( isset( $_POST['ai_model_opener'] ) )  $settings['ai_model_opener']= sanitize_text_field( wp_unslash( $_POST['ai_model_opener'] ) );
                $settings['ai_enabled_opener']   = ! empty( $_POST['ai_enabled_opener'] ) ? 1 : 0;
                $settings['ai_enabled_classify'] = ! empty( $_POST['ai_enabled_classify'] ) ? 1 : 0;
            }
            if ( $section === 'wa_validate' || isset( $_POST['validate_wa_before_send'] ) || ( isset( $_POST['form_section'] ) && $section === 'wa_validate' ) ) {
                $settings['validate_wa_before_send'] = ! empty( $_POST['validate_wa_before_send'] ) ? 1 : 0;
            }

            update_option( 'nvl_settings', $settings );
            wp_safe_redirect( admin_url( 'admin.php?page=nvl-settings&saved=1' ) );
            exit;
        }

        if ( isset( $_POST['nvl_action'] ) && $_POST['nvl_action'] === 'test_api_key' ) {
            check_admin_referer( 'nvl_save_settings' );
            $client = new NVL_Google_Places( sanitize_text_field( wp_unslash( $_POST['google_api_key'] ) ) );
            $r = $client->test_api_key();
            if ( is_wp_error( $r ) ) {
                wp_safe_redirect( add_query_arg( array( 'page' => 'nvl-settings', 'test_error' => urlencode( $r->get_error_message() ) ), admin_url( 'admin.php' ) ) );
            } else {
                wp_safe_redirect( add_query_arg( array( 'page' => 'nvl-settings', 'test_ok' => intval( $r ) ), admin_url( 'admin.php' ) ) );
            }
            exit;
        }

        if ( isset( $_POST['nvl_action'] ) && $_POST['nvl_action'] === 'test_evolution' ) {
            check_admin_referer( 'nvl_save_settings' );
            $api = new NVL_Evolution_API(
                esc_url_raw( wp_unslash( $_POST['evolution_api_url'] ) ),
                sanitize_text_field( wp_unslash( $_POST['evolution_api_key'] ) ),
                sanitize_text_field( wp_unslash( $_POST['evolution_instance'] ) )
            );
            $r = $api->connection_state();
            if ( is_wp_error( $r ) ) {
                wp_safe_redirect( add_query_arg( array( 'page' => 'nvl-settings', 'evo_error' => urlencode( $r->get_error_message() ) ), admin_url( 'admin.php' ) ) );
            } else {
                $state = is_array( $r ) ? wp_json_encode( $r ) : (string) $r;
                wp_safe_redirect( add_query_arg( array( 'page' => 'nvl-settings', 'evo_ok' => urlencode( $state ) ), admin_url( 'admin.php' ) ) );
            }
            exit;
        }

        if ( isset( $_POST['nvl_action'] ) && $_POST['nvl_action'] === 'test_ai' ) {
            check_admin_referer( 'nvl_save_settings' );
            $settings = get_option( 'nvl_settings', array() );
            $settings['ai_provider']    = sanitize_text_field( wp_unslash( $_POST['ai_provider'] ) );
            $settings['ai_api_key']     = sanitize_text_field( wp_unslash( $_POST['ai_api_key'] ) );
            $settings['ai_model_opener']= sanitize_text_field( wp_unslash( $_POST['ai_model_opener'] ) );
            update_option( 'nvl_settings', $settings );
            $ai = new NVL_AI_Client();
            $r  = $ai->test();
            if ( is_wp_error( $r ) ) {
                wp_safe_redirect( add_query_arg( array( 'page' => 'nvl-settings', 'ai_error' => urlencode( $r->get_error_message() ) ), admin_url( 'admin.php' ) ) );
            } else {
                wp_safe_redirect( add_query_arg( array( 'page' => 'nvl-settings', 'ai_ok' => urlencode( substr( (string) $r, 0, 50 ) ) ), admin_url( 'admin.php' ) ) );
            }
            exit;
        }

        if ( isset( $_POST['nvl_action'] ) && $_POST['nvl_action'] === 'configure_webhook' ) {
            check_admin_referer( 'nvl_save_settings' );
            $api = new NVL_Evolution_API();
            $url = NVL_Webhook::endpoint_url();
            $r = $api->configure_webhook( $url );
            if ( is_wp_error( $r ) ) {
                wp_safe_redirect( add_query_arg( array( 'page' => 'nvl-settings', 'wh_error' => urlencode( $r->get_error_message() ) ), admin_url( 'admin.php' ) ) );
            } else {
                wp_safe_redirect( add_query_arg( array( 'page' => 'nvl-settings', 'wh_ok' => 1 ), admin_url( 'admin.php' ) ) );
            }
            exit;
        }

        if ( isset( $_POST['nvl_action'] ) && $_POST['nvl_action'] === 'enqueue_lead' ) {
            check_admin_referer( 'nvl_enqueue_lead' );
            $lead_id = intval( $_POST['lead_id'] );
            $custom  = isset( $_POST['custom_message'] ) ? wp_unslash( $_POST['custom_message'] ) : '';
            $r = NVL_Send_Queue::enqueue_lead( $lead_id, 0, $custom );
            $msg = is_wp_error( $r ) ? $r->get_error_message() : 'Mensaje encolado correctamente.';
            wp_safe_redirect( add_query_arg( array( 'page' => 'nvl-lead-detail', 'id' => $lead_id, 'queue_msg' => urlencode( $msg ) ), admin_url( 'admin.php' ) ) );
            exit;
        }

        if ( isset( $_POST['nvl_action'] ) && $_POST['nvl_action'] === 'bulk_enqueue' ) {
            check_admin_referer( 'nvl_bulk_enqueue' );
            $lead_ids = isset( $_POST['lead_ids'] ) ? array_map( 'intval', (array) $_POST['lead_ids'] ) : array();
            $tpl_id   = isset( $_POST['template_id'] ) ? intval( $_POST['template_id'] ) : 0;
            if ( empty( $lead_ids ) ) {
                wp_safe_redirect( wp_get_referer() ? wp_get_referer() : admin_url( 'admin.php?page=' . self::MENU_SLUG ) );
                exit;
            }
            $res = NVL_Send_Queue::bulk_enqueue( $lead_ids, $tpl_id );
            $search_id = isset( $_POST['search_id'] ) ? intval( $_POST['search_id'] ) : 0;
            wp_safe_redirect( add_query_arg( array( 'page' => 'nvl-search-detail', 'id' => $search_id, 'enq_ok' => $res['ok'], 'enq_skip' => $res['skipped'] ), admin_url( 'admin.php' ) ) );
            exit;
        }

        if ( isset( $_POST['nvl_action'] ) && $_POST['nvl_action'] === 'bulk_enroll_sequence' ) {
            check_admin_referer( 'nvl_bulk_enqueue' );
            $lead_ids = isset( $_POST['lead_ids'] ) ? array_map( 'intval', (array) $_POST['lead_ids'] ) : array();
            $seq_id   = isset( $_POST['sequence_id'] ) ? intval( $_POST['sequence_id'] ) : 0;
            $ok = 0; $skipped = 0;
            foreach ( $lead_ids as $lid ) {
                $r = NVL_Sequences::enroll_lead( $lid, $seq_id );
                if ( is_wp_error( $r ) ) $skipped++; else $ok++;
            }
            $search_id = isset( $_POST['search_id'] ) ? intval( $_POST['search_id'] ) : 0;
            wp_safe_redirect( add_query_arg( array( 'page' => 'nvl-search-detail', 'id' => $search_id, 'enq_ok' => $ok, 'enq_skip' => $skipped ), admin_url( 'admin.php' ) ) );
            exit;
        }

        if ( isset( $_POST['nvl_action'] ) && $_POST['nvl_action'] === 'enroll_sequence' ) {
            check_admin_referer( 'nvl_enroll_sequence' );
            $lead_id = intval( $_POST['lead_id'] );
            $seq_id  = intval( $_POST['sequence_id'] );
            $r = NVL_Sequences::enroll_lead( $lead_id, $seq_id );
            $msg = is_wp_error( $r ) ? $r->get_error_message() : 'Lead enrolado en secuencia.';
            wp_safe_redirect( add_query_arg( array( 'page' => 'nvl-lead-detail', 'id' => $lead_id, 'queue_msg' => urlencode( $msg ) ), admin_url( 'admin.php' ) ) );
            exit;
        }

        if ( isset( $_POST['nvl_action'] ) && $_POST['nvl_action'] === 'save_sequence' ) {
            check_admin_referer( 'nvl_save_sequence' );
            $id = intval( $_POST['sequence_id'] );
            $saved_id = NVL_Sequences::save_sequence( array(
                'name'        => sanitize_text_field( wp_unslash( $_POST['name'] ) ),
                'description' => sanitize_textarea_field( wp_unslash( $_POST['description'] ) ),
                'is_active'   => ! empty( $_POST['is_active'] ),
                'is_default'  => ! empty( $_POST['is_default'] ),
            ), $id );
            $steps_raw = isset( $_POST['steps'] ) ? (array) $_POST['steps'] : array();
            $steps = array();
            foreach ( $steps_raw as $s ) {
                if ( empty( $s['template_body'] ) ) continue;
                $steps[] = array( 'delay_days' => intval( $s['delay_days'] ), 'template_body' => wp_unslash( $s['template_body'] ) );
            }
            NVL_Sequences::replace_steps( $saved_id, $steps );
            wp_safe_redirect( admin_url( 'admin.php?page=nvl-sequences&edit=' . $saved_id . '&saved=1' ) );
            exit;
        }

        if ( isset( $_GET['nvl_action'] ) && $_GET['nvl_action'] === 'delete_sequence' && isset( $_GET['id'] ) ) {
            check_admin_referer( 'nvl_delete_sequence_' . intval( $_GET['id'] ) );
            NVL_Sequences::delete_sequence( intval( $_GET['id'] ) );
            wp_safe_redirect( admin_url( 'admin.php?page=nvl-sequences&deleted=1' ) );
            exit;
        }

        if ( isset( $_GET['nvl_action'] ) && in_array( $_GET['nvl_action'], array( 'queue_pause', 'queue_resume', 'queue_retry_failed' ), true ) ) {
            check_admin_referer( 'nvl_queue_action' );
            $settings = get_option( 'nvl_settings', array() );
            if ( $_GET['nvl_action'] === 'queue_pause' )  $settings['send_paused'] = 1;
            if ( $_GET['nvl_action'] === 'queue_resume' ) $settings['send_paused'] = 0;
            update_option( 'nvl_settings', $settings );
            if ( $_GET['nvl_action'] === 'queue_retry_failed' ) NVL_Send_Queue::reset_failed_to_queue();
            wp_safe_redirect( admin_url( 'admin.php?page=nvl-queue' ) );
            exit;
        }

        if ( isset( $_GET['nvl_action'] ) && $_GET['nvl_action'] === 'queue_delete' && isset( $_GET['id'] ) ) {
            check_admin_referer( 'nvl_queue_delete_' . intval( $_GET['id'] ) );
            NVL_Send_Queue::delete_message( intval( $_GET['id'] ) );
            wp_safe_redirect( admin_url( 'admin.php?page=nvl-queue' ) );
            exit;
        }

        if ( isset( $_GET['nvl_action'] ) && $_GET['nvl_action'] === 'send_now' && isset( $_GET['id'] ) ) {
            check_admin_referer( 'nvl_send_now_' . intval( $_GET['id'] ) );
            global $wpdb;
            $row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM " . NVL_DB::table( 'messages' ) . " WHERE id = %d", intval( $_GET['id'] ) ) );
            if ( $row ) NVL_Send_Queue::send_message( $row );
            wp_safe_redirect( admin_url( 'admin.php?page=nvl-queue' ) );
            exit;
        }

        if ( isset( $_GET['nvl_action'] ) && $_GET['nvl_action'] === 'inbox_mark_read' && isset( $_GET['id'] ) ) {
            check_admin_referer( 'nvl_inbox_read_' . intval( $_GET['id'] ) );
            NVL_Inbox::mark_read( intval( $_GET['id'] ) );
            wp_safe_redirect( wp_get_referer() ? wp_get_referer() : admin_url( 'admin.php?page=nvl-inbox' ) );
            exit;
        }

        if ( isset( $_GET['nvl_action'] ) && $_GET['nvl_action'] === 'run_cron_now' ) {
            check_admin_referer( 'nvl_run_cron' );
            NVL_Cron::process_pending_searches();
            wp_safe_redirect( wp_get_referer() ? wp_get_referer() : admin_url( 'admin.php?page=' . self::MENU_SLUG ) );
            exit;
        }

        if ( isset( $_GET['nvl_action'] ) && $_GET['nvl_action'] === 'validate_wa_batch' ) {
            check_admin_referer( 'nvl_validate_wa_batch' );
            $r = NVL_Data_Quality::validate_pending_whatsapp( 50 );
            $msg = is_wp_error( $r ) ? $r->get_error_message() : sprintf( 'Comprobados %d. Con WA: %d. Sin WA: %d.', $r['checked'], $r['with_wa'], $r['without_wa'] );
            wp_safe_redirect( add_query_arg( array( 'page' => 'nvl-settings', 'wa_batch_msg' => urlencode( $msg ) ), admin_url( 'admin.php' ) ) );
            exit;
        }

        if ( isset( $_GET['nvl_action'] ) && $_GET['nvl_action'] === 'rescore_all' ) {
            check_admin_referer( 'nvl_rescore_all' );
            $n = NVL_Data_Quality::rescore_all( 1000 );
            wp_safe_redirect( add_query_arg( array( 'page' => 'nvl-settings', 'rescored' => $n ), admin_url( 'admin.php' ) ) );
            exit;
        }

        if ( isset( $_GET['nvl_action'] ) && $_GET['nvl_action'] === 'revalidate_keyword' ) {
            check_admin_referer( 'nvl_revalidate_keyword' );
            $limit = isset( $_GET['limit'] ) ? max( 1, intval( $_GET['limit'] ) ) : 200;
            $r = self::revalidate_pending_leads_keyword( $limit );
            $msg = is_wp_error( $r )
                ? $r->get_error_message()
                : sprintf( 'Revisados %d leads. Encajan: %d. Descartados: %d. Errores: %d.', $r['checked'], $r['match'], $r['excluded'], $r['errors'] );
            wp_safe_redirect( add_query_arg( array( 'page' => 'nvl-settings', 'kw_msg' => urlencode( $msg ) ), admin_url( 'admin.php' ) ) );
            exit;
        }

        if ( isset( $_POST['nvl_action'] ) && $_POST['nvl_action'] === 'add_exclusion' ) {
            check_admin_referer( 'nvl_add_exclusion' );
            $r = NVL_Exclusions::add_exclusion(
                wp_unslash( $_POST['match_value'] ),
                isset( $_POST['reason'] ) ? wp_unslash( $_POST['reason'] ) : '',
                'name',
                isset( $_POST['match_mode'] ) ? sanitize_text_field( wp_unslash( $_POST['match_mode'] ) ) : 'contains'
            );
            if ( is_wp_error( $r ) ) {
                wp_safe_redirect( add_query_arg( array( 'page' => 'nvl-exclusions', 'tab' => 'clients', 'excl_error' => urlencode( $r->get_error_message() ) ), admin_url( 'admin.php' ) ) );
            } else {
                wp_safe_redirect( admin_url( 'admin.php?page=nvl-exclusions&tab=clients&saved=1' ) );
            }
            exit;
        }

        if ( isset( $_GET['nvl_action'] ) && $_GET['nvl_action'] === 'delete_exclusion' && isset( $_GET['id'] ) ) {
            check_admin_referer( 'nvl_del_exclusion_' . intval( $_GET['id'] ) );
            NVL_Exclusions::delete_exclusion( intval( $_GET['id'] ) );
            wp_safe_redirect( admin_url( 'admin.php?page=nvl-exclusions&tab=clients&deleted=1' ) );
            exit;
        }

        if ( isset( $_POST['nvl_action'] ) && $_POST['nvl_action'] === 'add_optout' ) {
            check_admin_referer( 'nvl_add_optout' );
            $r = NVL_Exclusions::add_optout(
                wp_unslash( $_POST['phone'] ),
                isset( $_POST['reason'] ) ? wp_unslash( $_POST['reason'] ) : '',
                'manual'
            );
            if ( is_wp_error( $r ) ) {
                wp_safe_redirect( add_query_arg( array( 'page' => 'nvl-exclusions', 'tab' => 'optouts', 'excl_error' => urlencode( $r->get_error_message() ) ), admin_url( 'admin.php' ) ) );
            } else {
                wp_safe_redirect( admin_url( 'admin.php?page=nvl-exclusions&tab=optouts&saved=1' ) );
            }
            exit;
        }

        if ( isset( $_GET['nvl_action'] ) && $_GET['nvl_action'] === 'delete_optout' && isset( $_GET['id'] ) ) {
            check_admin_referer( 'nvl_del_optout_' . intval( $_GET['id'] ) );
            NVL_Exclusions::delete_optout( intval( $_GET['id'] ) );
            wp_safe_redirect( admin_url( 'admin.php?page=nvl-exclusions&tab=optouts&deleted=1' ) );
            exit;
        }
    }

    public function render_dashboard()      { include NVL_PLUGIN_DIR . 'admin/views/dashboard.php'; }
    public function render_new_search()     { include NVL_PLUGIN_DIR . 'admin/views/new-search.php'; }
    public function render_searches()       { include NVL_PLUGIN_DIR . 'admin/views/searches.php'; }
    public function render_search_detail()  { include NVL_PLUGIN_DIR . 'admin/views/search-detail.php'; }
    public function render_lead_detail()    { include NVL_PLUGIN_DIR . 'admin/views/lead-detail.php'; }
    public function render_queue()          { include NVL_PLUGIN_DIR . 'admin/views/queue.php'; }
    public function render_templates()      { include NVL_PLUGIN_DIR . 'admin/views/templates.php'; }
    public function render_settings()       { include NVL_PLUGIN_DIR . 'admin/views/settings.php'; }
    public function render_analytics()      { include NVL_PLUGIN_DIR . 'admin/views/analytics.php'; }
    public function render_inbox()          { include NVL_PLUGIN_DIR . 'admin/views/inbox.php'; }
    public function render_sequences()      { include NVL_PLUGIN_DIR . 'admin/views/sequences.php'; }
    public function render_exclusions()     { include NVL_PLUGIN_DIR . 'admin/views/exclusions.php'; }

    /**
     * Revalida con IA los leads pendientes contra la keyword de su busqueda.
     * Marca como excluded los que no encajen.
     */
    public static function revalidate_pending_leads_keyword( $limit = 200 ) {
        if ( ! class_exists( 'NVL_AI_Client' ) ) {
            return new WP_Error( 'no_ai', 'Cliente IA no disponible.' );
        }
        $ai = new NVL_AI_Client();
        if ( ! $ai->is_configured() ) {
            return new WP_Error( 'ai_not_configured', 'Configura la IA antes de revalidar.' );
        }
        global $wpdb;
        $rows = $wpdb->get_results( $wpdb->prepare(
            "SELECT l.id, l.name, l.formatted_address, l.category, l.types, l.reviews_json, s.keyword
             FROM {$wpdb->prefix}nvl_leads l
             JOIN {$wpdb->prefix}nvl_searches s ON s.id = l.search_id
             WHERE l.contact_status IS NULL OR l.contact_status IN ('pending','')
             ORDER BY l.id DESC
             LIMIT %d", $limit
        ), ARRAY_A );

        $stats = array( 'checked' => 0, 'match' => 0, 'excluded' => 0, 'errors' => 0 );
        foreach ( $rows as $lead ) {
            $stats['checked']++;
            $verdict = $ai->validate_keyword_match( $lead['keyword'], $lead );
            if ( is_wp_error( $verdict ) ) {
                $stats['errors']++;
                continue;
            }
            if ( empty( $verdict['match'] ) ) {
                $wpdb->update(
                    "{$wpdb->prefix}nvl_leads",
                    array(
                        'contact_status' => 'excluded',
                        'notes'          => 'IA descarte: no encaja con "' . $lead['keyword'] . '". ' . mb_substr( $verdict['reason'], 0, 280 ),
                    ),
                    array( 'id' => $lead['id'] )
                );
                $stats['excluded']++;
            } else {
                $stats['match']++;
            }
            usleep( 250000 );
        }
        return $stats;
    }
}
