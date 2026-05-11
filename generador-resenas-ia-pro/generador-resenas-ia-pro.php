<?php
/**
 * Plugin Name: Generador de Reseñas IA PRO
 * Description: Genera reseñas realistas con OpenAI, incluye panel de ajustes para la API Key.
 * Version: 2.0
 * Author: Mar Costa del Sol
 */

if (!defined('ABSPATH')) exit;

// 1. CREAR EL MENÚ DE AJUSTES EN EL BACKEND
add_action('admin_menu', function() {
    add_menu_page(
        'Ajustes Reseñas IA',
        'Reseñas IA',
        'manage_options',
        'resenas-ia-settings',
        'resenas_ia_settings_page',
        'dashicons-admin-comments'
    );
});

// 2. PÁGINA DE CONFIGURACIÓN
function resenas_ia_settings_page() {
    if (isset($_POST['save_resenas_settings'])) {
        update_option('resenas_ia_api_key', sanitize_text_field($_POST['api_key']));
        echo '<div class="updated"><p>Configuración guardada.</p></div>';
    }
    $api_key = get_option('resenas_ia_api_key', '');
    ?>
    <div class="wrap">
        <h1>Configuración de Reseñas IA</h1>
        <form method="post">
            <table class="form-table">
                <tr>
                    <th scope="row"><label for="api_key">OpenAI API Key</label></th>
                    <td><input name="api_key" type="password" id="api_key" value="<?php echo esc_attr($api_key); ?>" class="regular-text"></td>
                </tr>
            </table>
            <input type="submit" name="save_resenas_settings" class="button button-primary" value="Guardar Cambios">
        </form>
        <br>
        <div style="background: #e7f3ff; padding: 15px; border-left: 4px solid #0073aa;">
            <h3>Cómo usar el Shortcode:</h3>
            <code>[cuadro_ia_dinamico cliente="Nombre Cliente" url_destino="https://link-de-resena.com"]</code>
        </div>
    </div>
    <?php
}

// 3. EL SHORTCODE
add_shortcode('cuadro_ia_dinamico', function($atts) {
    $api_key = get_option('resenas_ia_api_key');
    if (!$api_key) return "<p style='color:red;'>Error: Configura la API Key en el menú Reseñas IA.</p>";

    $config = shortcode_atts([
        'cliente'     => 'Dos Romeiros',
        'url_web'     => 'https://dosromeiros.com/',
        'url_destino' => 'https://es.trustpilot.com/evaluate/dosromeiros.com'
    ], $atts);

    $option_name = 'hist_ia_' . sanitize_title($config['cliente']);
    $historial = get_option($option_name, []);
    $ultima = !empty($historial) ? $historial[0] : "";

    // Lógica de alternancia
    $orden_longitud = (strlen($ultima) < 120) ? "Escribe unas 4 líneas detalladas." : "Sé muy breve (máx 12 palabras).";

    $temas = ["Descanso y habitación", "Comida y guisos gallegos", "El entorno y naturaleza", "Trato personal y rapidez"];
    $tema_elegido = $temas[array_rand($temas)];

    $prompt = "Actúa como cliente real de {$config['cliente']}. Escribe una reseña para Trustpilot.
    TEMA: $tema_elegido. LONGITUD: $orden_longitud.
    REGLAS: Lenguaje de calle, de WhatsApp. PROHIBIDO: palabras poéticas, místico, cosmos, aromas, mágico, excelencia.
    Usa: 'sitio de diez', 'de lujo', 'repetiré'. No saludes. Solo el texto.";

    $response = wp_remote_post('https://api.openai.com/v1/chat/completions', [
        'headers' => [ 'Authorization' => 'Bearer ' . $api_key, 'Content-Type' => 'application/json' ],
        'body' => json_encode([
            'model' => 'gpt-4o-mini',
            'messages' => [['role' => 'user', 'content' => $prompt]],
            'temperature' => 1.1,
            'presence_penalty' => 2.0
        ]),
        'timeout' => 15
    ]);

    $texto_ia = "Todo perfecto, recomendado.";
    if (!is_wp_error($response)) {
        $body = json_decode(wp_remote_retrieve_body($response), true);
        if (isset($body['choices'][0]['message']['content'])) {
            $texto_ia = trim(str_replace(['"', '“', '”'], '', $body['choices'][0]['message']['content']));
            array_unshift($historial, $texto_ia);
            update_option($option_name, array_slice($historial, 0, 5));
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
