<?php
/**
 * Generador de enlaces personalizados para envío manual.
 *
 * Uso:
 *   php generar_enlace.php "Juan Pérez"
 *   php generar_enlace.php          (sin argumento → enlace genérico, sin nombre)
 *
 * También puede invocarse desde el navegador:
 *   https://resenas.automaticchoice.es/generar_enlace.php?n=Juan%20P%C3%A9rez
 */

require_once __DIR__ . '/src/config.php';
require_once __DIR__ . '/src/token.php';

$base = rtrim(config('BASE_URL'), '/');

$nombre = '';
if (PHP_SAPI === 'cli') {
    $nombre = $argv[1] ?? '';
} else {
    $nombre = trim($_GET['n'] ?? '');
    header('Content-Type: text/plain; charset=UTF-8');
}

if ($nombre === '') {
    $url = $base . '/';
    echo "Enlace genérico (sin nombre):\n{$url}\n";
} else {
    $token = firmarToken('manual-' . substr(md5($nombre . microtime()), 0, 6), $nombre);
    $url   = $base . '/?t=' . urlencode($token);
    echo "Enlace para «{$nombre}»:\n{$url}\n";
}
