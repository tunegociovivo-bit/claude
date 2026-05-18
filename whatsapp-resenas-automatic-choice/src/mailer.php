<?php
/**
 * Envío de email vía SMTP nativo (sin dependencias externas).
 * Si prefieres PHPMailer, puedes sustituir esta función — la firma se mantiene.
 */

require_once __DIR__ . '/config.php';

function enviarEmail(string $asunto, string $cuerpoHtml): bool
{
    $host    = config('SMTP_HOST');
    $puerto  = (int) config('SMTP_PORT', '587');
    $usuario = config('SMTP_USER');
    $clave   = config('SMTP_PASS');
    $seguro  = strtolower(config('SMTP_SECURE', 'tls'));
    $from    = config('MAIL_FROM');
    $fromN   = config('MAIL_FROM_NAME', 'Sistema');
    $to      = config('MAIL_TO');

    $prefijo = ($seguro === 'ssl') ? 'ssl://' : '';
    $sock = @stream_socket_client(
        "{$prefijo}{$host}:{$puerto}",
        $errno,
        $errstr,
        15,
        STREAM_CLIENT_CONNECT
    );
    if (!$sock) {
        error_log("SMTP: no se pudo conectar - {$errstr}");
        return false;
    }

    $leer = function () use ($sock) {
        $linea = '';
        while ($l = fgets($sock, 515)) {
            $linea .= $l;
            if (substr($l, 3, 1) === ' ') {
                break;
            }
        }
        return $linea;
    };
    $escribir = function (string $cmd) use ($sock) {
        fwrite($sock, $cmd . "\r\n");
    };

    $leer();
    $escribir("EHLO " . parse_url(config('BASE_URL'), PHP_URL_HOST));
    $leer();

    if ($seguro === 'tls') {
        $escribir("STARTTLS");
        $leer();
        stream_socket_enable_crypto($sock, true, STREAM_CRYPTO_METHOD_TLS_CLIENT);
        $escribir("EHLO " . parse_url(config('BASE_URL'), PHP_URL_HOST));
        $leer();
    }

    $escribir("AUTH LOGIN");
    $leer();
    $escribir(base64_encode($usuario));
    $leer();
    $escribir(base64_encode($clave));
    $respAuth = $leer();
    if (!str_starts_with(trim($respAuth), '235')) {
        error_log("SMTP: autenticación fallida - {$respAuth}");
        fclose($sock);
        return false;
    }

    $escribir("MAIL FROM:<{$from}>");
    $leer();
    $escribir("RCPT TO:<{$to}>");
    $leer();
    $escribir("DATA");
    $leer();

    $cabeceras  = "From: " . encodeMime($fromN) . " <{$from}>\r\n";
    $cabeceras .= "To: <{$to}>\r\n";
    $cabeceras .= "Subject: " . encodeMime($asunto) . "\r\n";
    $cabeceras .= "MIME-Version: 1.0\r\n";
    $cabeceras .= "Content-Type: text/html; charset=UTF-8\r\n";
    $cabeceras .= "Content-Transfer-Encoding: 8bit\r\n";
    $cabeceras .= "Date: " . date('r') . "\r\n";

    $escribir($cabeceras . "\r\n" . $cuerpoHtml . "\r\n.");
    $respFinal = $leer();
    $escribir("QUIT");
    fclose($sock);

    return str_starts_with(trim($respFinal), '250');
}

function encodeMime(string $texto): string
{
    return '=?UTF-8?B?' . base64_encode($texto) . '?=';
}
