<?php
/**
 * Script CLI para envío masivo de mensajes de WhatsApp solicitando reseña.
 *
 * Uso:
 *   php enviar_whatsapp.php data/clientes.csv
 *
 * Formato del CSV (con cabecera):
 *   id,nombre,telefono
 *   1001,Juan Pérez,34666112233
 *   1002,María López,34655998877
 *
 * El teléfono debe ir en formato internacional, sin '+' ni espacios.
 */

require_once __DIR__ . '/src/config.php';
require_once __DIR__ . '/src/token.php';
require_once __DIR__ . '/src/whatsapp.php';

if (PHP_SAPI !== 'cli') {
    exit("Este script debe ejecutarse desde la línea de comandos.\n");
}

$ruta = $argv[1] ?? __DIR__ . '/data/clientes.csv';
if (!file_exists($ruta)) {
    exit("No se encuentra el CSV: {$ruta}\n");
}

$fh = fopen($ruta, 'r');
$cabecera = fgetcsv($fh);
$idxId   = array_search('id', $cabecera);
$idxNom  = array_search('nombre', $cabecera);
$idxTel  = array_search('telefono', $cabecera);

if ($idxId === false || $idxNom === false || $idxTel === false) {
    exit("El CSV debe tener cabecera: id,nombre,telefono\n");
}

$base = rtrim(config('BASE_URL'), '/');
$total = 0;
$ok    = 0;
$fail  = 0;
$log   = fopen(__DIR__ . '/logs/envios.log', 'a');

echo "Iniciando envío masivo desde {$ruta}\n";

while (($fila = fgetcsv($fh)) !== false) {
    $id     = trim($fila[$idxId]);
    $nombre = trim($fila[$idxNom]);
    $tel    = preg_replace('/[^0-9]/', '', $fila[$idxTel]);
    if ($tel === '' || $id === '') {
        continue;
    }
    $total++;
    $token   = firmarToken($id, $nombre);
    $urlResena = $base . '/?t=' . urlencode($token);

    echo "[{$total}] {$nombre} <{$tel}> ... ";
    try {
        $resp = enviarPlantillaWhatsApp($tel, $nombre, $urlResena);
        if (isset($resp['messages'][0]['id'])) {
            $ok++;
            echo "OK ({$resp['messages'][0]['id']})\n";
            fwrite($log, date('c') . "\tOK\t{$id}\t{$tel}\t{$resp['messages'][0]['id']}\n");
        } else {
            $fail++;
            $err = $resp['error']['message'] ?? json_encode($resp);
            echo "FAIL: {$err}\n";
            fwrite($log, date('c') . "\tFAIL\t{$id}\t{$tel}\t{$err}\n");
        }
    } catch (Throwable $e) {
        $fail++;
        echo "EXCEPTION: " . $e->getMessage() . "\n";
        fwrite($log, date('c') . "\tEXCEPTION\t{$id}\t{$tel}\t{$e->getMessage()}\n");
    }
    // Pequeña pausa para no saturar la API de Meta
    usleep(400000);
}

fclose($fh);
fclose($log);

echo "\nResumen: total={$total}  enviados={$ok}  fallidos={$fail}\n";
