<?php
/* ============================================================================
   Automatic Choice — Solicitud de reseñas
   Sube este archivo a:  https://automaticchoice.es/resenas/index.php
   ============================================================================
   FLUJO:
     - El cliente abre el enlace y ve 5 estrellas.
     - Si pulsa 4 o 5  → redirige a la ficha de Google My Business.
     - Si pulsa 1, 2 o 3 → muestra un formulario de queja.
     - Al enviar el formulario → llega un email a la empresa.
   ============================================================================ */

// ====== EDITAR ESTAS 3 LÍNEAS ===============================================

// 1) URL a tu ficha de Google para dejar reseña.
//    Obtenla en https://placeid.gmbapi.com/ y construye la URL:
const GMB_REVIEW_URL = 'https://search.google.com/local/writereview?placeid=PEGA_AQUI_TU_PLACE_ID';

// 2) Email donde quieres recibir las quejas (1-3 estrellas).
const MAIL_TO = 'atencionalcliente@automaticchoice.es';

// 3) Dirección "De:" desde la que se envía el aviso. Recomendado: un email del propio dominio.
const MAIL_FROM = 'web@automaticchoice.es';

// ============================================================================

const EMPRESA_NOMBRE = 'Automatic Choice';
const EMPRESA_WEB    = 'https://automaticchoice.es/';

$stars  = isset($_GET['s']) ? (int) $_GET['s'] : 0;
$accion = $_GET['a'] ?? '';

/* ---------- 4 o 5 estrellas → Google My Business --------------------------- */
if ($stars === 4 || $stars === 5) {
    header('Location: ' . GMB_REVIEW_URL);
    exit;
}

/* ---------- Procesar envío del formulario de queja ------------------------- */
$enviado  = false;
$errorMsg = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $accion === 'queja') {
    $stars        = max(1, min(3, (int) ($_POST['s'] ?? 0)));
    $nombre       = trim($_POST['nombre']     ?? '');
    $emailCli     = trim($_POST['email']      ?? '');
    $telefono     = trim($_POST['telefono']   ?? '');
    $motivo       = trim($_POST['motivo']     ?? '');
    $comentario   = trim($_POST['comentario'] ?? '');
    $honeypot     = trim($_POST['website']    ?? '');

    if ($honeypot !== '') {
        $enviado = true; // bot: fingimos éxito
    } elseif ($comentario === '') {
        $errorMsg = 'Por favor, cuéntanos brevemente qué ha ocurrido.';
    } else {
        $asunto  = '[' . $stars . ' estrellas] Queja de cliente - ' . ($nombre !== '' ? $nombre : 'anónimo');

        $cuerpo  = "<h2>Nueva queja recibida desde la web</h2>";
        $cuerpo .= "<table cellpadding='6' style='border-collapse:collapse;font-family:Arial,sans-serif'>";
        $cuerpo .= "<tr><td><b>Puntuación</b></td><td>{$stars} / 5 estrellas</td></tr>";
        $cuerpo .= "<tr><td><b>Nombre</b></td><td>" . htmlspecialchars($nombre) . "</td></tr>";
        $cuerpo .= "<tr><td><b>Email</b></td><td>" . htmlspecialchars($emailCli) . "</td></tr>";
        $cuerpo .= "<tr><td><b>Teléfono</b></td><td>" . htmlspecialchars($telefono) . "</td></tr>";
        $cuerpo .= "<tr><td><b>Motivo</b></td><td>" . htmlspecialchars($motivo) . "</td></tr>";
        $cuerpo .= "<tr><td valign='top'><b>Comentario</b></td><td>" . nl2br(htmlspecialchars($comentario)) . "</td></tr>";
        $cuerpo .= "<tr><td><b>Fecha</b></td><td>" . date('Y-m-d H:i') . "</td></tr>";
        $cuerpo .= "</table>";

        $cabeceras  = "From: " . EMPRESA_NOMBRE . " <" . MAIL_FROM . ">\r\n";
        if ($emailCli !== '' && filter_var($emailCli, FILTER_VALIDATE_EMAIL)) {
            $cabeceras .= "Reply-To: {$emailCli}\r\n";
        }
        $cabeceras .= "MIME-Version: 1.0\r\n";
        $cabeceras .= "Content-Type: text/html; charset=UTF-8\r\n";

        $enviado = @mail(MAIL_TO, '=?UTF-8?B?' . base64_encode($asunto) . '?=', $cuerpo, $cabeceras);
        if (!$enviado) {
            $errorMsg = 'No se pudo enviar el mensaje. Llámanos o escríbenos directamente, por favor.';
        }
    }
}

/* ---------- Página de "queja enviada" -------------------------------------- */
function renderPagina(string $titulo, string $contenido): void {
?>
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= htmlspecialchars($titulo) ?> — <?= EMPRESA_NOMBRE ?></title>
<style>
  :root { --azul:#0a3d62; --amarillo:#fdcb6e; }
  *{box-sizing:border-box}
  body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
       background:linear-gradient(180deg,#f4f7fb 0%,#e8eef5 100%);
       min-height:100vh;display:flex;align-items:center;justify-content:center;
       margin:0;padding:24px;color:#1a1a1a}
  .card{background:#fff;border-radius:18px;box-shadow:0 12px 40px rgba(0,0,0,.08);
        max-width:560px;width:100%;padding:36px 28px}
  .center{text-align:center}
  h1{color:var(--azul);font-size:22px;margin:0 0 8px}
  p{color:#444;line-height:1.5;margin:8px 0 16px}
  .logo{font-weight:700;color:var(--azul);letter-spacing:.5px;margin-bottom:6px;text-align:center}
  .stars{display:flex;justify-content:center;gap:6px;margin:20px 0 8px;flex-wrap:wrap;flex-direction:row-reverse}
  .star{font-size:54px;line-height:1;cursor:pointer;color:#d8dde4;text-decoration:none;
        transition:color .15s;user-select:none}
  .star:hover, .star:hover ~ .star { color:var(--amarillo) }
  .pie{font-size:12px;color:#888;margin-top:18px;text-align:center}
  label{display:block;font-weight:600;margin:14px 0 6px;color:#333}
  input,select,textarea{width:100%;padding:10px 12px;border:1px solid #d1d6dd;
        border-radius:8px;font-size:15px;font-family:inherit}
  textarea{min-height:120px;resize:vertical}
  button{background:var(--azul);color:#fff;border:0;border-radius:10px;
         padding:14px 22px;font-size:16px;font-weight:600;cursor:pointer;
         margin-top:18px;width:100%}
  button:hover{background:#0d4d7d}
  .hp{position:absolute;left:-9999px;height:0;width:0}
  .ok{background:#e6f7ee;color:#0a6b3b;padding:16px;border-radius:10px;text-align:center}
  .err{background:#fde8e8;color:#8a1f1f;padding:12px;border-radius:8px;margin-bottom:12px}
  .stars-rate{color:var(--amarillo);font-size:24px;margin-bottom:14px;text-align:center}
</style>
</head>
<body>
  <main class="card">
    <div class="logo"><?= EMPRESA_NOMBRE ?></div>
    <?= $contenido ?>
    <p class="pie"><?= EMPRESA_NOMBRE ?> · <a href="<?= EMPRESA_WEB ?>" style="color:#888"><?= EMPRESA_WEB ?></a></p>
  </main>
</body>
</html>
<?php
}

/* ---------- Mostrar formulario de queja (1-3 estrellas) -------------------- */
if ($stars >= 1 && $stars <= 3 && !$enviado) {
    ob_start();
    ?>
    <h1 class="center">Lamentamos que tu experiencia no fuese la esperada</h1>
    <div class="stars-rate">
      <?php for ($i=0;$i<$stars;$i++) echo '★'; for ($i=$stars;$i<5;$i++) echo '☆'; ?>
    </div>
    <p class="center">Cuéntanos qué ha ocurrido. Nos pondremos en contacto contigo para solucionarlo.</p>

    <?php if ($errorMsg): ?><div class="err"><?= htmlspecialchars($errorMsg) ?></div><?php endif; ?>

    <form method="post" action="?a=queja" autocomplete="on" novalidate>
      <input type="hidden" name="s" value="<?= $stars ?>">
      <input class="hp" type="text" name="website" tabindex="-1" autocomplete="off">

      <label for="nombre">Tu nombre</label>
      <input id="nombre" name="nombre" type="text">

      <label for="email">Tu email *</label>
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
    <?php
    renderPagina('Cuéntanos qué ha pasado', ob_get_clean());
    exit;
}

/* ---------- Pantalla de "gracias" tras enviar queja ------------------------ */
if ($enviado) {
    $html  = '<h1 class="center">Gracias por avisarnos</h1>';
    $html .= '<p class="ok">Hemos recibido tu mensaje. Un responsable de ' . EMPRESA_NOMBRE
           . ' se pondrá en contacto contigo lo antes posible para resolver lo ocurrido.</p>';
    renderPagina('Gracias', $html);
    exit;
}

/* ---------- Landing con 5 estrellas (pantalla por defecto) ----------------- */
ob_start();
?>
<h1 class="center">Hola 👋</h1>
<p class="center">Gracias por confiar en nosotros. ¿Cómo valorarías tu experiencia?</p>
<div class="stars" role="radiogroup" aria-label="Valoración">
  <?php for ($i = 5; $i >= 1; $i--): ?>
    <a class="star" href="?s=<?= $i ?>" role="radio" aria-label="<?= $i ?> estrellas" title="<?= $i ?> estrellas">★</a>
  <?php endfor; ?>
</div>
<p class="pie">Tu opinión nos ayuda a mejorar.</p>
<?php
renderPagina('Tu opinión cuenta', ob_get_clean());
