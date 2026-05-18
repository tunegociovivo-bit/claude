<?php
/**
 * Plugin Name: Automatic Choice — Solicitud de Reseñas
 * Description: Landing con 5 estrellas que redirige según puntuación: 4-5★ → reviewthis.biz/automaticchoice, 1-3★ → página de contacto interna. Inserta el shortcode [ac_resenas] en cualquier página.
 * Version:     1.1.0
 * Author:      Automatic Choice
 * License:     GPLv2 or later
 * Text Domain: ac-resenas
 */

if (!defined('ABSPATH')) {
    exit;
}

const AC_RESENAS_URL_POSITIVAS_DEFAULT = 'https://reviewthis.biz/automaticchoice';
const AC_RESENAS_URL_NEGATIVAS_DEFAULT = 'https://automaticchoice.es/contacto-resenas/';

/* ============================================================================
 * 1. AJUSTES EN EL ADMIN (Ajustes → Reseñas AC)
 * ========================================================================== */

add_action('admin_menu', function () {
    add_options_page(
        'Reseñas Automatic Choice',
        'Reseñas AC',
        'manage_options',
        'ac-resenas',
        'ac_resenas_render_admin'
    );
});

add_action('admin_init', function () {
    register_setting('ac_resenas', 'ac_resenas_url_positivas', ['sanitize_callback' => 'esc_url_raw']);
    register_setting('ac_resenas', 'ac_resenas_url_negativas', ['sanitize_callback' => 'esc_url_raw']);
    register_setting('ac_resenas', 'ac_resenas_empresa',       ['sanitize_callback' => 'sanitize_text_field']);
});

function ac_resenas_render_admin() {
    if (!current_user_can('manage_options')) return;
    $url_pos = get_option('ac_resenas_url_positivas', AC_RESENAS_URL_POSITIVAS_DEFAULT);
    $url_neg = get_option('ac_resenas_url_negativas', AC_RESENAS_URL_NEGATIVAS_DEFAULT);
    ?>
    <div class="wrap">
      <h1>Reseñas Automatic Choice</h1>
      <p>Crea una página (por ejemplo, <em>Reseñas</em>) y pega dentro el shortcode <code>[ac_resenas]</code>.
         La URL pública que enviarás a clientes será algo como <code><?= esc_html(home_url('/resenas/')) ?></code>.</p>
      <form method="post" action="options.php">
        <?php settings_fields('ac_resenas'); ?>
        <table class="form-table" role="presentation">
          <tr>
            <th><label for="ac_url_pos">URL para 4 y 5 estrellas (reseña pública)</label></th>
            <td>
              <input id="ac_url_pos" name="ac_resenas_url_positivas" type="url" class="regular-text"
                value="<?= esc_attr($url_pos) ?>"
                placeholder="<?= esc_attr(AC_RESENAS_URL_POSITIVAS_DEFAULT) ?>">
              <p class="description">Dónde mandar al cliente si valora con 4 o 5 estrellas.</p>
            </td>
          </tr>
          <tr>
            <th><label for="ac_url_neg">URL para 1, 2 y 3 estrellas (contacto interno)</label></th>
            <td>
              <input id="ac_url_neg" name="ac_resenas_url_negativas" type="url" class="regular-text"
                value="<?= esc_attr($url_neg) ?>"
                placeholder="<?= esc_attr(AC_RESENAS_URL_NEGATIVAS_DEFAULT) ?>">
              <p class="description">Dónde mandar al cliente si valora con 1, 2 o 3 estrellas.</p>
            </td>
          </tr>
          <tr>
            <th><label for="ac_empresa">Nombre de la empresa</label></th>
            <td>
              <input id="ac_empresa" name="ac_resenas_empresa" type="text" class="regular-text"
                value="<?= esc_attr(get_option('ac_resenas_empresa', 'Automatic Choice')) ?>">
            </td>
          </tr>
        </table>
        <?php submit_button(); ?>
      </form>
    </div>
    <?php
}

/* ============================================================================
 * 2. SHORTCODE [ac_resenas]
 * ========================================================================== */

add_shortcode('ac_resenas', 'ac_resenas_shortcode');

function ac_resenas_shortcode() {
    $empresa = get_option('ac_resenas_empresa', 'Automatic Choice');
    $url_pos = get_option('ac_resenas_url_positivas', AC_RESENAS_URL_POSITIVAS_DEFAULT);
    $url_neg = get_option('ac_resenas_url_negativas', AC_RESENAS_URL_NEGATIVAS_DEFAULT);

    $stars   = isset($_GET['s']) ? max(0, min(5, (int) $_GET['s'])) : 0;

    // Redirección por JS porque el shortcode se ejecuta dentro de una página ya renderizada
    if ($stars >= 4 && $stars <= 5) {
        $destino = $url_pos;
    } elseif ($stars >= 1 && $stars <= 3) {
        $destino = $url_neg;
    } else {
        $destino = '';
    }

    if ($destino) {
        return '<script>window.location.replace(' . wp_json_encode($destino) . ');</script>'
             . '<p style="text-align:center;font-family:sans-serif;padding:24px">'
             . 'Redirigiendo… <a href="' . esc_url($destino) . '">Pulsa aquí si no se abre.</a></p>';
    }

    // Landing con 5 estrellas
    ob_start();
    ?>
    <style>
      .ac-card{max-width:560px;margin:24px auto;background:#fff;border-radius:18px;
               box-shadow:0 12px 40px rgba(0,0,0,.08);padding:36px 28px;
               font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a}
      .ac-card h2{color:#0a3d62;font-size:22px;margin:0 0 8px;text-align:center}
      .ac-card p{color:#444;line-height:1.5;margin:8px 0 16px;text-align:center}
      .ac-logo{font-weight:700;color:#0a3d62;letter-spacing:.5px;margin-bottom:6px;text-align:center}
      .ac-stars{display:flex;justify-content:center;gap:6px;margin:20px 0 8px;flex-wrap:wrap;flex-direction:row-reverse}
      .ac-star{font-size:54px;line-height:1;cursor:pointer;color:#d8dde4;text-decoration:none;
               transition:color .15s;user-select:none}
      .ac-star:hover, .ac-star:hover ~ .ac-star { color:#fdcb6e }
      .ac-pie{font-size:12px;color:#888;margin-top:18px;text-align:center}
    </style>
    <div class="ac-card">
      <div class="ac-logo"><?= esc_html($empresa) ?></div>
      <h2>Hola 👋</h2>
      <p>Gracias por confiar en nosotros. ¿Cómo valorarías tu experiencia?</p>
      <div class="ac-stars" role="radiogroup" aria-label="Valoración">
        <?php for ($i = 5; $i >= 1; $i--): ?>
          <a class="ac-star" href="<?= esc_url(add_query_arg('s', $i, get_permalink())) ?>"
             role="radio" aria-label="<?= $i ?> estrellas" title="<?= $i ?> estrellas">★</a>
        <?php endfor; ?>
      </div>
      <p class="ac-pie">Tu opinión nos ayuda a mejorar.</p>
    </div>
    <?php
    return ob_get_clean();
}
