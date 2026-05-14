<?php
/**
 * Plugin Name:       AI Web Designer for Elementor
 * Plugin URI:        https://example.com/ai-web-designer
 * Description:       Genera webs completas en WordPress + Elementor a partir de un briefing guiado, conectándose con Claude para diseño y contenidos, generación de imágenes con IA, SEO, textos legales, integraciones y modo agencia multi-cliente.
 * Version:           1.0.0
 * Requires at least: 6.2
 * Requires PHP:      8.0
 * Author:            AI Web Designer Team
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       ai-web-designer
 * Domain Path:       /languages
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

define( 'AIWD_VERSION', '1.0.0' );
define( 'AIWD_PLUGIN_FILE', __FILE__ );
define( 'AIWD_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'AIWD_PLUGIN_URL', plugin_dir_url( __FILE__ ) );
define( 'AIWD_PLUGIN_BASENAME', plugin_basename( __FILE__ ) );

require_once AIWD_PLUGIN_DIR . 'includes/helpers.php';
require_once AIWD_PLUGIN_DIR . 'includes/class-activator.php';
require_once AIWD_PLUGIN_DIR . 'includes/class-deactivator.php';
require_once AIWD_PLUGIN_DIR . 'includes/class-database.php';
require_once AIWD_PLUGIN_DIR . 'includes/class-cpt-project.php';
require_once AIWD_PLUGIN_DIR . 'includes/class-i18n.php';
require_once AIWD_PLUGIN_DIR . 'includes/ai/class-claude-client.php';
require_once AIWD_PLUGIN_DIR . 'includes/ai/class-content-generator.php';
require_once AIWD_PLUGIN_DIR . 'includes/ai/class-image-generator.php';
require_once AIWD_PLUGIN_DIR . 'includes/ai/class-design-generator.php';
require_once AIWD_PLUGIN_DIR . 'includes/ai/class-scraper.php';
require_once AIWD_PLUGIN_DIR . 'includes/elementor/class-template-builder.php';
require_once AIWD_PLUGIN_DIR . 'includes/elementor/class-template-library.php';
require_once AIWD_PLUGIN_DIR . 'includes/seo/class-seo-generator.php';
require_once AIWD_PLUGIN_DIR . 'includes/seo/class-schema-generator.php';
require_once AIWD_PLUGIN_DIR . 'includes/legal/class-legal-generator.php';
require_once AIWD_PLUGIN_DIR . 'includes/integrations/class-whatsapp.php';
require_once AIWD_PLUGIN_DIR . 'includes/integrations/class-gmb.php';
require_once AIWD_PLUGIN_DIR . 'includes/integrations/class-calendly.php';
require_once AIWD_PLUGIN_DIR . 'includes/integrations/class-wpml.php';
require_once AIWD_PLUGIN_DIR . 'includes/integrations/class-asana-client.php';
require_once AIWD_PLUGIN_DIR . 'includes/integrations/class-asana-sync.php';
require_once AIWD_PLUGIN_DIR . 'includes/class-client-portal.php';
require_once AIWD_PLUGIN_DIR . 'includes/class-pdf-proposal.php';
require_once AIWD_PLUGIN_DIR . 'includes/rest/class-rest-api.php';
require_once AIWD_PLUGIN_DIR . 'admin/class-admin.php';
require_once AIWD_PLUGIN_DIR . 'public/class-public.php';
require_once AIWD_PLUGIN_DIR . 'includes/class-plugin.php';

register_activation_hook( __FILE__, [ 'AIWD_Activator', 'activate' ] );
register_deactivation_hook( __FILE__, [ 'AIWD_Deactivator', 'deactivate' ] );

add_action( 'plugins_loaded', static function () {
    AIWD_Plugin::instance()->run();
} );
