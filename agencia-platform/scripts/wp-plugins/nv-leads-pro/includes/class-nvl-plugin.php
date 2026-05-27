<?php
/**
 * Loader principal del plugin.
 */

if ( ! defined( 'WPINC' ) ) {
    die;
}

class NVL_Plugin {

    public function __construct() {
        $this->load_dependencies();
        $this->register_hooks();
    }

    private function load_dependencies() {
        require_once NVL_PLUGIN_DIR . 'includes/class-nvl-db.php';
        require_once NVL_PLUGIN_DIR . 'includes/class-nvl-spain-provinces.php';
        require_once NVL_PLUGIN_DIR . 'includes/class-nvl-google-places.php';
        require_once NVL_PLUGIN_DIR . 'includes/class-nvl-ai-client.php';
        require_once NVL_PLUGIN_DIR . 'includes/class-nvl-lead-scorer.php';
        require_once NVL_PLUGIN_DIR . 'includes/class-nvl-search-manager.php';
        require_once NVL_PLUGIN_DIR . 'includes/class-nvl-template-engine.php';
        require_once NVL_PLUGIN_DIR . 'includes/class-nvl-message-variations.php';
        require_once NVL_PLUGIN_DIR . 'includes/class-nvl-whatsapp.php';
        require_once NVL_PLUGIN_DIR . 'includes/class-nvl-evolution-api.php';
        require_once NVL_PLUGIN_DIR . 'includes/class-nvl-send-queue.php';
        require_once NVL_PLUGIN_DIR . 'includes/class-nvl-sequences.php';
        require_once NVL_PLUGIN_DIR . 'includes/class-nvl-inbox.php';
        require_once NVL_PLUGIN_DIR . 'includes/class-nvl-webhook.php';
        require_once NVL_PLUGIN_DIR . 'includes/class-nvl-analytics.php';
        require_once NVL_PLUGIN_DIR . 'includes/class-nvl-data-quality.php';
        require_once NVL_PLUGIN_DIR . 'includes/class-nvl-exclusions.php';
        require_once NVL_PLUGIN_DIR . 'includes/class-nvl-csv-exporter.php';
        require_once NVL_PLUGIN_DIR . 'includes/class-nvl-cron.php';

        if ( is_admin() ) {
            require_once NVL_PLUGIN_DIR . 'admin/class-nvl-admin.php';
        }
    }

    private function register_hooks() {
        add_filter( 'cron_schedules', array( $this, 'add_cron_schedules' ) );
        add_action( 'nvl_process_pending_searches', array( 'NVL_Cron', 'process_pending_searches' ) );
        add_action( 'nvl_process_send_queue',       array( 'NVL_Cron', 'process_send_queue' ) );
        add_action( 'rest_api_init', array( 'NVL_Webhook', 'register_routes' ) );

        if ( is_admin() ) {
            $admin = new NVL_Admin();
            $admin->register();
        }
    }

    public function add_cron_schedules( $schedules ) {
        $schedules['nvl_one_minute']  = array( 'interval' => 60,  'display' => 'Cada minuto (NV Leads)' );
        $schedules['nvl_two_minutes'] = array( 'interval' => 120, 'display' => 'Cada 2 minutos (NV Leads)' );
        return $schedules;
    }

    public function run() {
        do_action( 'nvl_plugin_loaded' );
    }
}
