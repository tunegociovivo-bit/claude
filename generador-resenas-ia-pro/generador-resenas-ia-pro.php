<?php
/**
 * Plugin Name: Generador de Reseñas IA PRO
 * Description: Genera reseñas realistas con OpenAI. Incluye gestor de clientes y prompts personalizables por cliente.
 * Version: 3.0
 * Author: Mar Costa del Sol
 */

if (!defined('ABSPATH')) exit;

const RESENAS_IA_OPT_API_KEY = 'resenas_ia_api_key';
const RESENAS_IA_OPT_CLIENTES = 'resenas_ia_clientes';

// ─────────────────────────────────────────────────────────────
// MENÚ DE ADMINISTRACIÓN
// ─────────────────────────────────────────────────────────────
add_action('admin_menu', function() {
    add_menu_page(
        'Reseñas IA',
        'Reseñas IA',
        'manage_options',
        'resenas-ia-settings',
        'resenas_ia_render_admin',
        'dashicons-admin-comments'
    );
});

function resenas_ia_render_admin() {
    if (!current_user_can('manage_options')) return;
    $tab = isset($_GET['tab']) ? sanitize_key($_GET['tab']) : 'clientes';
    ?>
    <div class="wrap">
        <h1>Reseñas IA PRO</h1>
        <h2 class="nav-tab-wrapper">
            <a href="?page=resenas-ia-settings&tab=clientes" class="nav-tab <?php echo $tab === 'clientes' ? 'nav-tab-active' : ''; ?>">Clientes</a>
            <a href="?page=resenas-ia-settings&tab=ajustes" class="nav-tab <?php echo $tab === 'ajustes' ? 'nav-tab-active' : ''; ?>">Ajustes</a>
            <a href="?page=resenas-ia-settings&tab=ayuda" class="nav-tab <?php echo $tab === 'ayuda' ? 'nav-tab-active' : ''; ?>">Ayuda</a>
        </h2>
        <?php
        if ($tab === 'ajustes') resenas_ia_tab_ajustes();
        elseif ($tab === 'ayuda') resenas_ia_tab_ayuda();
        else resenas_ia_tab_clientes();
        ?>
    </div>
    <?php
}

// ─────────────────────────────────────────────────────────────
// TAB AJUSTES (API Key)
// ─────────────────────────────────────────────────────────────
function resenas_ia_tab_ajustes() {
    if (isset($_POST['save_ajustes']) && check_admin_referer('resenas_ia_ajustes')) {
        update_option(RESENAS_IA_OPT_API_KEY, sanitize_text_field($_POST['api_key']));
        echo '<div class="updated notice"><p>Ajustes guardados.</p></div>';
    }
    $api_key = get_option(RESENAS_IA_OPT_API_KEY, '');
    ?>
    <form method="post">
        <?php wp_nonce_field('resenas_ia_ajustes'); ?>
        <table class="form-table">
            <tr>
                <th><label for="api_key">OpenAI API Key</label></th>
                <td>
                    <input name="api_key" type="password" id="api_key" value="<?php echo esc_attr($api_key); ?>" class="regular-text">
                    <p class="description">Tu clave de la API de OpenAI (sk-...). Se almacena en la base de datos de WordPress.</p>
                </td>
            </tr>
        </table>
        <?php submit_button('Guardar ajustes', 'primary', 'save_ajustes'); ?>
    </form>
    <?php
}

// ─────────────────────────────────────────────────────────────
// TAB CLIENTES (CRUD)
// ─────────────────────────────────────────────────────────────
function resenas_ia_tab_clientes() {
    $clientes = get_option(RESENAS_IA_OPT_CLIENTES, []);
    if (!is_array($clientes)) $clientes = [];

    // BORRAR
    if (isset($_GET['action'], $_GET['slug']) && $_GET['action'] === 'delete' && check_admin_referer('resenas_ia_del_' . $_GET['slug'])) {
        $slug = sanitize_key($_GET['slug']);
        if (isset($clientes[$slug])) {
            unset($clientes[$slug]);
            update_option(RESENAS_IA_OPT_CLIENTES, $clientes);
            delete_option('hist_ia_' . $slug);
            echo '<div class="updated notice"><p>Cliente eliminado.</p></div>';
        }
    }

    // GUARDAR (nuevo o editar)
    if (isset($_POST['save_cliente']) && check_admin_referer('resenas_ia_cliente')) {
        $nombre = sanitize_text_field($_POST['nombre']);
        $slug_original = isset($_POST['slug_original']) ? sanitize_key($_POST['slug_original']) : '';
        $slug = $slug_original ?: sanitize_title($nombre);
        if ($nombre && $slug) {
            $clientes[$slug] = [
                'nombre'                => $nombre,
                'url_web'               => esc_url_raw($_POST['url_web']),
                'url_destino'           => esc_url_raw($_POST['url_destino']),
                'temas'                 => sanitize_textarea_field($_POST['temas']),
                'palabras_prohibidas'   => sanitize_text_field($_POST['palabras_prohibidas']),
                'palabras_recomendadas' => sanitize_text_field($_POST['palabras_recomendadas']),
                'instrucciones_extra'   => sanitize_textarea_field($_POST['instrucciones_extra']),
                'modelo'                => sanitize_text_field($_POST['modelo'] ?? 'gpt-4o-mini'),
            ];
            update_option(RESENAS_IA_OPT_CLIENTES, $clientes);
            echo '<div class="updated notice"><p>Cliente guardado correctamente. Slug: <code>' . esc_html($slug) . '</code></p></div>';
        } else {
            echo '<div class="error notice"><p>El nombre es obligatorio.</p></div>';
        }
    }

    $editar = null;
    if (isset($_GET['action'], $_GET['slug']) && $_GET['action'] === 'edit') {
        $slug_edit = sanitize_key($_GET['slug']);
        if (isset($clientes[$slug_edit])) {
            $editar = $clientes[$slug_edit];
            $editar['slug'] = $slug_edit;
        }
    }
    ?>
    <h2><?php echo $editar ? 'Editar cliente' : 'Añadir nuevo cliente'; ?></h2>
    <form method="post">
        <?php wp_nonce_field('resenas_ia_cliente'); ?>
        <?php if ($editar): ?>
            <input type="hidden" name="slug_original" value="<?php echo esc_attr($editar['slug']); ?>">
        <?php endif; ?>
        <table class="form-table">
            <tr>
                <th><label for="nombre">Nombre del cliente *</label></th>
                <td>
                    <input name="nombre" id="nombre" type="text" class="regular-text" required value="<?php echo esc_attr($editar['nombre'] ?? ''); ?>">
                    <p class="description">Ej: "Hotel Dos Romeiros". Se usa en el prompt y como slug del shortcode.</p>
                </td>
            </tr>
            <tr>
                <th><label for="url_web">URL del sitio web</label></th>
                <td><input name="url_web" id="url_web" type="url" class="regular-text" value="<?php echo esc_attr($editar['url_web'] ?? ''); ?>"></td>
            </tr>
            <tr>
                <th><label for="url_destino">URL de destino (Trustpilot/Google) *</label></th>
                <td>
                    <input name="url_destino" id="url_destino" type="url" class="regular-text" required value="<?php echo esc_attr($editar['url_destino'] ?? ''); ?>">
                    <p class="description">A dónde se envía al usuario tras copiar la reseña.</p>
                </td>
            </tr>
            <tr>
                <th><label for="temas">Temas posibles</label></th>
                <td>
                    <textarea name="temas" id="temas" rows="4" class="large-text"><?php echo esc_textarea($editar['temas'] ?? "Descanso y habitación\nComida y guisos gallegos\nEl entorno y naturaleza\nTrato personal y rapidez"); ?></textarea>
                    <p class="description">Un tema por línea. Se elige uno al azar en cada generación.</p>
                </td>
            </tr>
            <tr>
                <th><label for="palabras_prohibidas">Palabras prohibidas</label></th>
                <td>
                    <input name="palabras_prohibidas" id="palabras_prohibidas" type="text" class="large-text" value="<?php echo esc_attr($editar['palabras_prohibidas'] ?? 'místico, cosmos, aromas, mágico, excelencia'); ?>">
                    <p class="description">Separadas por comas. La IA evitará usarlas.</p>
                </td>
            </tr>
            <tr>
                <th><label for="palabras_recomendadas">Palabras / expresiones recomendadas</label></th>
                <td>
                    <input name="palabras_recomendadas" id="palabras_recomendadas" type="text" class="large-text" value="<?php echo esc_attr($editar['palabras_recomendadas'] ?? "sitio de diez, de lujo, repetiré"); ?>">
                    <p class="description">Separadas por comas. La IA intentará incluir alguna.</p>
                </td>
            </tr>
            <tr>
                <th><label for="instrucciones_extra">Instrucciones extra al prompt</label></th>
                <td>
                    <textarea name="instrucciones_extra" id="instrucciones_extra" rows="3" class="large-text"><?php echo esc_textarea($editar['instrucciones_extra'] ?? 'Lenguaje de calle, de WhatsApp. No saludes. Solo el texto.'); ?></textarea>
                </td>
            </tr>
            <tr>
                <th><label for="modelo">Modelo de OpenAI</label></th>
                <td>
                    <?php $m = $editar['modelo'] ?? 'gpt-4o-mini'; ?>
                    <select name="modelo" id="modelo">
                        <option value="gpt-4o-mini" <?php selected($m, 'gpt-4o-mini'); ?>>gpt-4o-mini (rápido y barato)</option>
                        <option value="gpt-4o" <?php selected($m, 'gpt-4o'); ?>>gpt-4o (mejor calidad)</option>
                        <option value="gpt-4-turbo" <?php selected($m, 'gpt-4-turbo'); ?>>gpt-4-turbo</option>
                    </select>
                </td>
            </tr>
        </table>
        <?php submit_button($editar ? 'Actualizar cliente' : 'Crear cliente', 'primary', 'save_cliente'); ?>
        <?php if ($editar): ?>
            <a href="?page=resenas-ia-settings&tab=clientes" class="button">Cancelar</a>
        <?php endif; ?>
    </form>

    <hr style="margin: 30px 0;">

    <h2>Clientes existentes</h2>
    <?php if (empty($clientes)): ?>
        <p>Aún no has creado ningún cliente.</p>
    <?php else: ?>
        <table class="wp-list-table widefat fixed striped">
            <thead>
                <tr>
                    <th>Nombre</th>
                    <th>Slug</th>
                    <th>Shortcode</th>
                    <th>URL destino</th>
                    <th>Acciones</th>
                </tr>
            </thead>
            <tbody>
                <?php foreach ($clientes as $slug => $c): ?>
                    <tr>
                        <td><strong><?php echo esc_html($c['nombre']); ?></strong></td>
                        <td><code><?php echo esc_html($slug); ?></code></td>
                        <td><code>[cuadro_ia_dinamico cliente_id="<?php echo esc_attr($slug); ?>"]</code></td>
                        <td><a href="<?php echo esc_url($c['url_destino']); ?>" target="_blank"><?php echo esc_html(parse_url($c['url_destino'], PHP_URL_HOST)); ?></a></td>
                        <td>
                            <a href="?page=resenas-ia-settings&tab=clientes&action=edit&slug=<?php echo esc_attr($slug); ?>">Editar</a> |
                            <a href="<?php echo wp_nonce_url('?page=resenas-ia-settings&tab=clientes&action=delete&slug=' . urlencode($slug), 'resenas_ia_del_' . $slug); ?>" onclick="return confirm('¿Eliminar este cliente?');" style="color:#a00;">Eliminar</a>
                        </td>
                    </tr>
                <?php endforeach; ?>
            </tbody>
        </table>
    <?php endif;
}

// ─────────────────────────────────────────────────────────────
// TAB AYUDA
// ─────────────────────────────────────────────────────────────
function resenas_ia_tab_ayuda() {
    ?>
    <h2>Cómo usar el plugin</h2>
    <ol>
        <li>Ve a la pestaña <strong>Ajustes</strong> y pega tu API Key de OpenAI.</li>
        <li>Ve a la pestaña <strong>Clientes</strong> y crea un cliente con su nombre, URL de destino y temas.</li>
        <li>Copia el shortcode que aparece en la tabla y pégalo en cualquier página o entrada.</li>
    </ol>
    <h3>Ejemplos de shortcode</h3>
    <p>Por cliente guardado (recomendado):</p>
    <pre><code>[cuadro_ia_dinamico cliente_id="hotel-dos-romeiros"]</code></pre>
    <p>Inline sin guardar cliente (compatibilidad con v2):</p>
    <pre><code>[cuadro_ia_dinamico cliente="Mi Negocio" url_destino="https://es.trustpilot.com/evaluate/midominio.com"]</code></pre>
    <p>Sobrescribir la URL destino de un cliente guardado:</p>
    <pre><code>[cuadro_ia_dinamico cliente_id="hotel-dos-romeiros" url_destino="https://otra.com"]</code></pre>
    <?php
}

// ─────────────────────────────────────────────────────────────
// SHORTCODE
// ─────────────────────────────────────────────────────────────
add_shortcode('cuadro_ia_dinamico', function($atts) {
    $api_key = get_option(RESENAS_IA_OPT_API_KEY);
    if (!$api_key) return "<p style='color:red;'>Error: configura la API Key en Reseñas IA → Ajustes.</p>";

    $atts = shortcode_atts([
        'cliente_id'  => '',
        'cliente'     => '',
        'url_web'     => '',
        'url_destino' => '',
    ], $atts);

    $clientes = get_option(RESENAS_IA_OPT_CLIENTES, []);
    $config = null;
    $slug = '';

    if ($atts['cliente_id'] && isset($clientes[$atts['cliente_id']])) {
        $slug = $atts['cliente_id'];
        $config = $clientes[$slug];
    } elseif ($atts['cliente']) {
        $slug = sanitize_title($atts['cliente']);
        if (isset($clientes[$slug])) {
            $config = $clientes[$slug];
        } else {
            $config = [
                'nombre'                => $atts['cliente'],
                'url_web'               => $atts['url_web'],
                'url_destino'           => $atts['url_destino'],
                'temas'                 => "Descanso y habitación\nComida\nEl entorno\nTrato personal",
                'palabras_prohibidas'   => 'místico, cosmos, aromas, mágico, excelencia',
                'palabras_recomendadas' => 'sitio de diez, de lujo, repetiré',
                'instrucciones_extra'   => 'Lenguaje de calle, de WhatsApp. No saludes. Solo el texto.',
                'modelo'                => 'gpt-4o-mini',
            ];
        }
    } else {
        return "<p style='color:red;'>Error: indica <code>cliente_id</code> o <code>cliente</code> en el shortcode.</p>";
    }

    if ($atts['url_destino']) $config['url_destino'] = $atts['url_destino'];
    if ($atts['url_web'])     $config['url_web']     = $atts['url_web'];

    if (empty($config['url_destino'])) {
        return "<p style='color:red;'>Error: este cliente no tiene URL de destino configurada.</p>";
    }

    $option_hist = 'hist_ia_' . $slug;
    $historial = get_option($option_hist, []);
    $ultima = !empty($historial) ? $historial[0] : "";
    $orden_longitud = (strlen($ultima) < 120) ? "Escribe unas 4 líneas detalladas." : "Sé muy breve (máx 12 palabras).";

    $temas_arr = array_filter(array_map('trim', explode("\n", $config['temas'])));
    if (empty($temas_arr)) $temas_arr = ['Experiencia general'];
    $tema_elegido = $temas_arr[array_rand($temas_arr)];

    $prompt  = "Actúa como cliente real de {$config['nombre']}. Escribe una reseña.\n";
    $prompt .= "TEMA: $tema_elegido.\n";
    $prompt .= "LONGITUD: $orden_longitud\n";
    if (!empty($config['palabras_prohibidas'])) {
        $prompt .= "PROHIBIDO usar: {$config['palabras_prohibidas']}.\n";
    }
    if (!empty($config['palabras_recomendadas'])) {
        $prompt .= "INTENTA usar alguna de estas expresiones: {$config['palabras_recomendadas']}.\n";
    }
    if (!empty($config['instrucciones_extra'])) {
        $prompt .= $config['instrucciones_extra'];
    }

    $response = wp_remote_post('https://api.openai.com/v1/chat/completions', [
        'headers' => [
            'Authorization' => 'Bearer ' . $api_key,
            'Content-Type'  => 'application/json',
        ],
        'body' => wp_json_encode([
            'model'            => $config['modelo'] ?: 'gpt-4o-mini',
            'messages'         => [['role' => 'user', 'content' => $prompt]],
            'temperature'      => 1.1,
            'presence_penalty' => 2.0,
        ]),
        'timeout' => 20,
    ]);

    $texto_ia = "Todo perfecto, recomendado.";
    if (!is_wp_error($response)) {
        $body = json_decode(wp_remote_retrieve_body($response), true);
        if (isset($body['choices'][0]['message']['content'])) {
            $texto_ia = trim(str_replace(['"', '“', '”'], '', $body['choices'][0]['message']['content']));
            array_unshift($historial, $texto_ia);
            update_option($option_hist, array_slice($historial, 0, 5));
        }
    }

    ob_start(); ?>
    <div class="ia-card" onclick="copyAndGoIA(this, '<?php echo esc_url($config['url_destino']); ?>')">
        <p class="ia-txt"><?php echo esc_html($texto_ia); ?></p>
        <span class="ia-btn">Copiar y opinar</span>
    </div>
    <script>
    function copyAndGoIA(el, url) {
        const t = el.querySelector('.ia-txt').innerText;
        navigator.clipboard.writeText(t).then(() => { window.location.href = url; });
    }
    </script>
    <style>
        .ia-card { border: 2px dashed #0073aa; padding: 25px; border-radius: 12px; cursor: pointer; background: #fff; text-align: center; max-width: 500px; margin: 20px auto; }
        .ia-card:hover { transform: translateY(-2px); border-color: #00a0d2; box-shadow: 0 5px 15px rgba(0,0,0,0.05); }
        .ia-txt { font-family: sans-serif; color: #333; margin-bottom: 15px; font-style: italic; line-height: 1.5; }
        .ia-btn { background: #0073aa; color: #fff; padding: 6px 15px; border-radius: 4px; font-weight: bold; font-size: 12px; }
    </style>
    <?php
    return ob_get_clean();
});
