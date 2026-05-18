<?php
/**
 * Generación y verificación de tokens firmados para los enlaces enviados por WhatsApp.
 * Evita que un usuario pueda manipular el id de cliente o suplantar reseñas.
 */

require_once __DIR__ . '/config.php';

function firmarToken(string $idCliente, string $nombre = ''): string
{
    $payload = base64_encode(json_encode([
        'id' => $idCliente,
        'n'  => $nombre,
        't'  => time(),
    ]));
    $firma = hash_hmac('sha256', $payload, config('SECRET_KEY'));
    return $payload . '.' . substr($firma, 0, 16);
}

function verificarToken(string $token): ?array
{
    if (!str_contains($token, '.')) {
        return null;
    }
    [$payload, $firma] = explode('.', $token, 2);
    $esperada = substr(hash_hmac('sha256', $payload, config('SECRET_KEY')), 0, 16);
    if (!hash_equals($esperada, $firma)) {
        return null;
    }
    $datos = json_decode(base64_decode($payload), true);
    return is_array($datos) ? $datos : null;
}
