<?php
/**
 * Plugin Name: Automatic Choice — Solicitud de Reseñas
 * Description: Sistema de captación de reseñas con filtro inteligente: 4-5★ a Google My Business, 1-3★ a un formulario que llega por email. Inserta el shortcode [ac_resenas] en cualquier página.
 * Version:     1.0.0
 * Author:      Automatic Choice
 * License:     GPLv2 or later
 * Text Domain: ac-resenas
 */

if (!defined('ABSPATH')) {
    exit;
}

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
    register_setting('ac_resenas', 'ac_resenas_gmb_url', ['sanitize_callback' => 'esc_url_raw']);
    register_setting('ac_resenas', 'ac_resenas_mail_to', ['sanitize_callback' => 'sanitize_email']);
    register_setting('ac_resenas', 'ac_resenas_empresa', ['sanitize_callback' => 'sanitize_text_field']);
});

function ac_resenas_render_admin() {
    if (!current_user_can('manage_options')) return;
    ?>
    <div class="wrap">
      <h1>Reseñas Automatic Choice</h1>
      <p>Crea una página (por ejemplo, <em>Reseñas</em>) y dentro escribe el shortcode <code>[ac_resenas]</code>.
         La URL pública será algo como <code><?= esc_html(home_url('/resenas/')) ?></code> según el slug que pongas.</p>
      <form method="post" action="options.php">
        <?php settings_fields('ac_resenas'); ?>
        <table class="form-table" role="presentation">
          <tr>
            <th><label for="ac_resenas_gmb_url">URL de Google My Business</label></th>
            <td>
              <input id="ac_resenas_gmb_url" name="ac_resenas_gmb_url" type="url" class="regular-text"
                value="<?= esc_attr(get_option('ac_resenas_gmb_url')) ?>"
                placeholder="https://search.google.com/local/writereview?placeid=...">
              <p class="description">Obtén tu Place ID en <a href="https://placeid.gmbapi.com/" target="_blank">placeid.gmbapi.com</a>.</p>
            </td>
          </tr>
          <tr>
            <th><label for="ac_resenas_mail_to">Email destinatario de las quejas</label></th>
            <td>
              <input id="ac_resenas_mail_to" name="ac_resenas_mail_to" type="email" class="regular-text"
                value="<?= esc_attr(get_option('ac_resenas_mail_to', get_option('admin_email'))) ?>">
              <p class="description">A esta dirección llegarán las puntuaciones de 1, 2 y 3 estrellas.</p>
            </td>
          </tr>
          <tr>
            <th><label for="ac_resenas_empresa">Nombre de la empresa</label></th>
            <td>
              <input id="ac_resenas_empresa" name="ac_resenas_empresa" type="text" class="regular-text"
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
    $empresa     = get_option('ac_resenas_empresa', 'Automatic Choice');
    $gmb_url     = get_option('ac_resenas_gmb_url', '');
    $mail_to     = get_option('ac_resenas_mail_to', get_option('admin_email'));

    $stars       = isset($_GET['s']) ? max(0, min(5, (int) $_GET['s'])) : 0;
    $accion      = isset($_GET['a']) ? sanitize_key($_GET['a']) : '';

    // 4-5 estrellas → redirige a Google (JS porque ya estamos dentro de la página)
    if ($stars === 4 || $stars === 5) {
        if (!$gmb_url) {
            return '<p>Falta configurar la URL de Google My Business en Ajustes → Reseñas AC.</p>';
        }
        return '<script>window.location.replace(' . wp_json_encode($gmb_url) . ');</script>'
             . '<p>Redirigiendo a Google… <a href="' . esc_url($gmb_url) . '">Pulsa aquí si no se abre.</a></p>';
    }

    // Procesar envío del formulario de queja
    $enviado  = false;
    $errorMsg = '';

    if ($_SERVER['REQUEST_METHOD'] === 'POST'
        && $accion === 'queja'
        && isset($_POST['ac_nonce'])
        && wp_verify_nonce($_POST['ac_nonce'], 'ac_resenas_queja')) {

        $stars_post = max(1, min(3, (int) ($_POST['s'] ?? 0)));
        $nombre     = sanitize_text_field($_POST['nombre']     ?? '');
        $email_cli  = sanitize_email($_POST['email']           ?? '');
        $telefono   = sanitize_text_field($_POST['telefono']   ?? '');
        $motivo     = sanitize_text_field($_POST['motivo']     ?? '');
        $comentario = sanitize_textarea_field($_POST['comentario'] ?? '');
        $honeypot   = sanitize_text_field($_POST['website']    ?? '');

        if ($honeypot !== '') {
            $enviado = true; // bot
        } elseif ($comentario === '') {
            $errorMsg = 'Por favor, cuéntanos brevemente qué ha ocurrido.';
        } else {
            $asunto = sprintf('[%d estrellas] Queja de cliente — %s',
                $stars_post, $nombre !== '' ? $nombre : 'anónimo');

            $cuerpo  = '<h2>Nueva queja recibida</h2>';
            $cuerpo .= '<table cellpadding="6" style="border-collapse:collapse;font-family:Arial,sans-serif">';
            $cuerpo .= '<tr><td><b>Puntuación</b></td><td>' . $stars_post . ' / 5 ★</td></tr>';
            $cuerpo .= '<tr><td><b>Nombre</b></td><td>' . esc_html($nombre) . '</td></tr>';
            $cuerpo .= '<tr><td><b>Email</b></td><td>' . esc_html($email_cli) . '</td></tr>';
            $cuerpo .= '<tr><td><b>Teléfono</b></td><td>' . esc_html($telefono) . '</td></tr>';
            $cuerpo .= '<tr><td><b>Motivo</b></td><td>' . esc_html($motivo) . '</td></tr>';
            $cuerpo .= '<tr><td valign="top"><b>Comentario</b></td><td>' . nl2br(esc_html($comentario)) . '</td></tr>';
            $cuerpo .= '<tr><td><b>Fecha</b></td><td>' . esc_html(current_time('mysql')) . '</td></tr>';
            $cuerpo .= '</table>';

            $cabeceras = ['Content-Type: text/html; charset=UTF-8'];
            if ($email_cli) {
                $cabeceras[] = 'Reply-To: ' . $email_cli;
            }

            $enviado = wp_mail($mail_to, $asunto, $cuerpo, $cabeceras);
            if (!$enviado) {
                $errorMsg = 'No se pudo enviar el mensaje. Inténtalo de nuevo o llámanos directamente.';
            }
        }
    }

    // Render
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
      .ac-card form label{display:block;font-weight:600;margin:14px 0 6px;color:#333;text-align:left}
      .ac-card form input, .ac-card form select, .ac-card form textarea{
         width:100%;padding:10px 12px;border:1px solid #d1d6dd;border-radius:8px;
         font-size:15px;font-family:inherit;box-sizing:border-box}
      .ac-card form textarea{min-height:120px;resize:vertical}
      .ac-card form button{background:#0a3d62;color:#fff;border:0;border-radius:10px;
         padding:14px 22px;font-size:16px;font-weight:600;cursor:pointer;margin-top:18px;width:100%}
      .ac-card form button:hover{background:#0d4d7d}
      .ac-hp{position:absolute;left:-9999px;height:0;width:0}
      .ac-ok{background:#e6f7ee;color:#0a6b3b;padding:16px;border-radius:10px;text-align:center}
      .ac-err{background:#fde8e8;color:#8a1f1f;padding:12px;border-radius:8px;margin-bottom:12px}
      .ac-stars-rate{color:#fdcb6e;font-size:24px;margin-bottom:14px;text-align:center}
    </style>
    <div class="ac-card">
      <div class="ac-logo"><?= esc_html($empresa) ?></div>

      <?php if ($enviado): ?>
        <h2>Gracias por avisarnos</h2>
        <p class="ac-ok">Hemos recibido tu mensaje. Un responsable de <?= esc_html($empresa) ?> se pondrá en contacto contigo lo antes posible para resolver lo ocurrido.</p>

      <?php elseif ($stars >= 1 && $stars <= 3): ?>
        <h2>Lamentamos que tu experiencia no fuese la esperada</h2>
        <div class="ac-stars-rate">
          <?php for ($i=0;$i<$stars;$i++) echo '★'; for ($i=$stars;$i<5;$i++) echo '☆'; ?>
        </div>
        <p>Cuéntanos qué ha ocurrido. Nos pondremos en contacto contigo para solucionarlo.</p>
        <?php if ($errorMsg): ?><div class="ac-err"><?= esc_html($errorMsg) ?></div><?php endif; ?>
        <form method="post" action="<?= esc_url(add_query_arg(['s' => $stars, 'a' => 'queja'], get_permalink())) ?>" autocomplete="on" novalidate>
          <?php wp_nonce_field('ac_resenas_queja', 'ac_nonce'); ?>
          <input type="hidden" name="s" value="<?= esc_attr($stars) ?>">
          <input class="ac-hp" type="text" name="website" tabindex="-1" autocomplete="off">

          <label for="ac_nombre">Tu nombre</label>
          <input id="ac_nombre" name="nombre" type="text">

          <label for="ac_email">Tu email *</label>
          <input id="ac_email" name="email" type="email" required>

          <label for="ac_tel">Teléfono (opcional)</label>
          <input id="ac_tel" name="telefono" type="tel">

          <label for="ac_motivo">Motivo</label>
          <select id="ac_motivo" name="motivo">
            <option>Atención recibida</option>
            <option>Calidad del servicio / trabajo</option>
            <option>Plazos y tiempos</option>
            <option>Precio o factura</option>
            <option>Otro</option>
          </select>

          <label for="ac_comentario">Cuéntanos qué ha pasado *</label>
          <textarea id="ac_comentario" name="comentario" required></textarea>

          <button type="submit">Enviar mensaje</button>
        </form>

      <?php else: ?>
        <h2>Hola 👋</h2>
        <p>Gracias por confiar en nosotros. ¿Cómo valorarías tu experiencia?</p>
        <div class="ac-stars" role="radiogroup" aria-label="Valoración">
          <?php for ($i = 5; $i >= 1; $i--): ?>
            <a class="ac-star" href="<?= esc_url(add_query_arg('s', $i, get_permalink())) ?>"
               role="radio" aria-label="<?= $i ?> estrellas" title="<?= $i ?> estrellas">★</a>
          <?php endfor; ?>
        </div>
        <p class="ac-pie">Tu opinión nos ayuda a mejorar.</p>
      <?php endif; ?>
    </div>
    <?php
    return ob_get_clean();
}
