<?php
/**
 * Plugin Name:       Negocio Vivo Leads
 * Plugin URI:        https://negociovivo.com
 * Description:       Plataforma de captación de leads desde Google My Business. Busca fichas por palabra clave y localidad, almacena los resultados en una base de datos, identifica competidores mejor posicionados y prepara mensajes personalizados de WhatsApp para prospección.
 * Version:           1.3.2
 * Requires at least: 5.8
 * Requires PHP:      7.4
 * Author:            Negocio Vivo
 * Author URI:        https://negociovivo.com
 * License:           GPL-2.0+
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.txt
 * Text Domain:       negocio-vivo-leads
 * Domain Path:       /languages
 */

// Si se accede directamente, abortar.
if ( ! defined( 'WPINC' ) ) {
    die;
}

// Constantes del plugin.
define( 'NVL_VERSION', '1.3.2' );
define( 'NVL_PLUGIN_FILE', __FILE__ );
define( 'NVL_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'NVL_PLUGIN_URL', plugin_dir_url( __FILE__ ) );
define( 'NVL_PLUGIN_BASENAME', plugin_basename( __FILE__ ) );
define( 'NVL_DB_VERSION', '1.3.2' );

/**
 * Activación: crea tablas y opciones por defecto.
 */
function nvl_activate() {
    require_once NVL_PLUGIN_DIR . 'includes/class-nvl-activator.php';
    NVL_Activator::activate();
}
register_activation_hook( __FILE__, 'nvl_activate' );

/**
 * Desactivación: desprograma el cron.
 */
function nvl_deactivate() {
    require_once NVL_PLUGIN_DIR . 'includes/class-nvl-deactivator.php';
    NVL_Deactivator::deactivate();
}
register_deactivation_hook( __FILE__, 'nvl_deactivate' );

/**
 * Carga principal del plugin.
 */
require_once NVL_PLUGIN_DIR . 'includes/class-nvl-plugin.php';

function nvl_run() {
    $plugin = new NVL_Plugin();
    $plugin->run();
}
nvl_run();
