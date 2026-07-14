<?php
/**
 * Landing con 5 estrellas. Enrutamiento según puntuación:
 *   - 4 o 5 estrellas: redirige a la ficha de Google My Business
 *   - 1, 2 o 3 estrellas: lleva al formulario de queja
 */

require_once __DIR__ . '/../src/config.php';
require_once __DIR__ . '/../src/token.php';

$token  = $_GET['t']     ?? '';
$stars  = (int) ($_GET['s'] ?? 0);
$datos  = verificarToken($token);
$nombre = $datos['n'] ?? 'cliente';

if ($stars >= 4 && $stars <= 5) {
    // Log opcional de "estrella positiva"
    @file_put_contents(
        __DIR__ . '/../logs/clicks.log',
        date('c') . "\tid={$datos['id']}\tstars={$stars}\tdestino=GMB\n",
        FILE_APPEND
    );
    header('Location: ' . config('GMB_REVIEW_URL'));
    exit;
}
if ($stars >= 1 && $stars <= 3) {
    @file_put_contents(
        __DIR__ . '/../logs/clicks.log',
        date('c') . "\tid={$datos['id']}\tstars={$stars}\tdestino=queja\n",
        FILE_APPEND
    );
    header('Location: queja.php?t=' . urlencode($token) . '&s=' . $stars);
    exit;
}

$empresa = htmlspecialchars(config('EMPRESA_NOMBRE'));
?>
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tu opinión cuenta — <?= $empresa ?></title>
<style>
  :root { --azul:#0a3d62; --amarillo:#fdcb6e; }
  *{box-sizing:border-box}
  body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
       background:linear-gradient(180deg,#f4f7fb 0%,#e8eef5 100%);
       min-height:100vh;display:flex;align-items:center;justify-content:center;
       margin:0;padding:24px;color:#1a1a1a}
  .card{background:#fff;border-radius:18px;box-shadow:0 12px 40px rgba(0,0,0,.08);
        max-width:520px;width:100%;padding:36px 28px;text-align:center}
  h1{color:var(--azul);font-size:22px;margin:0 0 8px}
  p{color:#444;line-height:1.5;margin:8px 0 24px}
  .stars{display:flex;justify-content:center;gap:6px;margin:20px 0 8px;flex-wrap:wrap}
  .star{font-size:54px;line-height:1;cursor:pointer;color:#d8dde4;
        text-decoration:none;transition:transform .15s, color .15s;user-select:none}
  .star:hover, .star:hover ~ .star { color:var(--amarillo) }
  /* Truco para que al pasar por encima de una estrella se iluminen también las anteriores */
  .stars{flex-direction:row-reverse}
  .pie{font-size:12px;color:#888;margin-top:18px}
  .logo{font-weight:700;color:var(--azul);letter-spacing:.5px;margin-bottom:6px}
</style>
</head>
<body>
  <main class="card">
    <div class="logo"><?= $empresa ?></div>
    <h1>Hola<?= $nombre !== 'cliente' ? ', ' . htmlspecialchars($nombre) : '' ?> 👋</h1>
    <p>Gracias por confiar en nosotros. ¿Cómo valorarías tu experiencia?</p>
    <div class="stars" role="radiogroup" aria-label="Valoración">
      <?php for ($i = 5; $i >= 1; $i--): ?>
        <a class="star" href="?t=<?= urlencode($token) ?>&s=<?= $i ?>"
           role="radio" aria-label="<?= $i ?> estrellas" title="<?= $i ?> estrellas">★</a>
      <?php endfor; ?>
    </div>
    <p class="pie">Tu opinión nos ayuda a mejorar.</p>
  </main>
</body>
</html>
