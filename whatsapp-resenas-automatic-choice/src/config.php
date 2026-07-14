<?php
/**
 * Carga de configuración desde el archivo .env
 */

function cargarEnv(string $rutaEnv): array
{
    if (!file_exists($rutaEnv)) {
        throw new RuntimeException("No se encuentra el archivo .env en {$rutaEnv}. Copia .env.example a .env y configúralo.");
    }
    $config = [];
    foreach (file($rutaEnv, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $linea) {
        $linea = trim($linea);
        if ($linea === '' || str_starts_with($linea, '#')) {
            continue;
        }
        if (!str_contains($linea, '=')) {
            continue;
        }
        [$clave, $valor] = explode('=', $linea, 2);
        $clave = trim($clave);
        $valor = trim($valor);
        if ((str_starts_with($valor, '"') && str_ends_with($valor, '"')) ||
            (str_starts_with($valor, "'") && str_ends_with($valor, "'"))) {
            $valor = substr($valor, 1, -1);
        }
        $config[$clave] = $valor;
    }
    return $config;
}

function config(string $clave, ?string $defecto = null): string
{
    static $cargado = null;
    if ($cargado === null) {
        $cargado = cargarEnv(__DIR__ . '/../.env');
    }
    return $cargado[$clave] ?? $defecto ?? '';
}
