<?php
/**
 * Formulario de queja para puntuaciones 1-3 estrellas.
 * Envía la queja por email a la dirección configurada en .env (MAIL_TO).
 */

require_once __DIR__ . '/../src/config.php';
require_once __DIR__ . '/../src/token.php';
require_once __DIR__ . '/../src/mailer.php';

$token = $_GET['t'] ?? $_POST['t'] ?? '';
$stars = (int) ($_GET['s'] ?? $_POST['s'] ?? 0);
$datos = verificarToken($token);

if (!$datos || $stars < 1 || $stars > 3) {
    http_response_code(400);
    exit('Enlace inválido o caducado.');
}

$idCliente = $datos['id']  ?? 'desconocido';
$nombre    = $datos['n']   ?? '';
$enviado   = false;
$errorMsg  = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $emailCliente = trim($_POST['email'] ?? '');
    $telefono     = trim($_POST['telefono'] ?? '');
    $motivo       = trim($_POST['motivo'] ?? '');
    $comentario   = trim($_POST['comentario'] ?? '');
    $hp           = trim($_POST['website'] ?? ''); // honeypot anti-bot

    if ($hp !== '') {
        // Bot detectado, fingimos éxito
        $enviado = true;
    } elseif ($comentario === '') {
        $errorMsg = 'Por favor, cuéntanos brevemente qué ha ocurrido.';
    } else {
        $asunto = sprintf('[%s estrellas] Queja de cliente — %s',
            $stars, $nombre ?: $idCliente);

        $html  = '<h2>Nueva queja recibida</h2>';
        $html .= '<table cellpadding="6" style="border-collapse:collapse;font-family:Arial">';
        $html .= '<tr><td><b>Puntuación</b></td><td>' . $stars . ' / 5 ⭐</td></tr>';
        $html .= '<tr><td><b>Cliente</b></td><td>' . htmlspecialchars($nombre) . ' (id: ' . htmlspecialchars($idCliente) . ')</td></tr>';
        $html .= '<tr><td><b>Email</b></td><td>' . htmlspecialchars($emailCliente) . '</td></tr>';
        $html .= '<tr><td><b>Teléfono</b></td><td>' . htmlspecialchars($telefono) . '</td></tr>';
        $html .= '<tr><td><b>Motivo</b></td><td>' . htmlspecialchars($motivo) . '</td></tr>';
        $html .= '<tr><td valign="top"><b>Comentario</b></td><td>' . nl2br(htmlspecialchars($comentario)) . '</td></tr>';
        $html .= '<tr><td><b>Fecha</b></td><td>' . date('Y-m-d H:i') . '</td></tr>';
        $html .= '</table>';

        try {
            if (enviarEmail($asunto, $html)) {
                @file_put_contents(
                    __DIR__ . '/../logs/quejas.log',
                    date('c') . "\t{$idCliente}\t{$stars}*\t{$emailCliente}\n",
                    FILE_APPEND
                );
                $enviado = true;
            } else {
                $errorMsg = 'No se pudo enviar el mensaje. Inténtalo de nuevo más tarde o llámanos directamente.';
            }
        } catch (Throwable $e) {
            error_log('Queja: ' . $e->getMessage());
            $errorMsg = 'Error técnico al enviar. Inténtalo de nuevo.';
        }
    }
}

$empresa = htmlspecialchars(config('EMPRESA_NOMBRE'));
?>
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cuéntanos qué ha pasado — <?= $empresa ?></title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;
       background:#f4f7fb;margin:0;padding:24px;color:#1a1a1a;
       display:flex;align-items:flex-start;justify-content:center;min-height:100vh}
  .card{background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.08);
        max-width:560px;width:100%;padding:32px 28px}
  h1{color:#0a3d62;font-size:22px;margin:0 0 6px}
  .stars{color:#fdcb6e;font-size:24px;margin-bottom:14px}
  label{display:block;font-weight:600;margin:14px 0 6px;color:#333}
  input,select,textarea{width:100%;padding:10px 12px;border:1px solid #d1d6dd;
        border-radius:8px;font-size:15px;font-family:inherit}
  textarea{min-height:120px;resize:vertical}
  button{background:#0a3d62;color:#fff;border:0;border-radius:10px;
        padding:14px 22px;font-size:16px;font-weight:600;cursor:pointer;
        margin-top:18px;width:100%}
  button:hover{background:#0d4d7d}
  .ok{background:#e6f7ee;color:#0a6b3b;padding:16px;border-radius:10px;text-align:center}
  .err{background:#fde8e8;color:#8a1f1f;padding:12px;border-radius:8px;margin-bottom:12px}
  .hp{position:absolute;left:-9999px;height:0;width:0}
  .pie{font-size:12px;color:#888;margin-top:18px;text-align:center}
</style>
</head>
<body>
<main class="card">
  <?php if ($enviado): ?>
    <h1>Gracias por avisarnos</h1>
    <p class="ok">Hemos recibido tu mensaje. Un responsable de <?= $empresa ?> se pondrá en contacto contigo lo antes posible para resolver lo ocurrido.</p>
  <?php else: ?>
    <h1>Lamentamos que tu experiencia no fuese la esperada</h1>
    <div class="stars">
      <?php for ($i = 0; $i < $stars; $i++) echo '★'; for ($i = $stars; $i < 5; $i++) echo '☆'; ?>
    </div>
    <p>Cuéntanos qué ha ocurrido. Nos pondremos en contacto contigo para solucionarlo.</p>

    <?php if ($errorMsg): ?><div class="err"><?= htmlspecialchars($errorMsg) ?></div><?php endif; ?>

    <form method="post" autocomplete="on" novalidate>
      <input type="hidden" name="t" value="<?= htmlspecialchars($token) ?>">
      <input type="hidden" name="s" value="<?= $stars ?>">
      <input class="hp" type="text" name="website" tabindex="-1" autocomplete="off">

      <label for="email">Tu email</label>
      <input id="email" name="email" type="email" required>

      <label for="telefono">Teléfono (opcional)</label>
      <input id="telefono" name="telefono" type="tel">

      <label for="motivo">Motivo</label>
      <select id="motivo" name="motivo">
        <option>Atención recibida</option>
        <option>Calidad del servicio / trabajo</option>
        <option>Plazos y tiempos</option>
        <option>Precio o factura</option>
        <option>Otro</option>
      </select>

      <label for="comentario">Cuéntanos qué ha pasado *</label>
      <textarea id="comentario" name="comentario" required></textarea>

      <button type="submit">Enviar mensaje</button>
    </form>
  <?php endif; ?>
  <p class="pie"><?= $empresa ?> · <?= htmlspecialchars(config('EMPRESA_WEB')) ?></p>
</main>
</body>
</html>
