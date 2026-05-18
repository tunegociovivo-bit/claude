<?php
/**
 * Cliente mínimo para la WhatsApp Cloud API de Meta.
 * Documentación: https://developers.facebook.com/docs/whatsapp/cloud-api
 */

require_once __DIR__ . '/config.php';

/**
 * Envía un mensaje basado en una plantilla aprobada por Meta.
 * La plantilla debe contener {{1}} = nombre del cliente y un botón URL dinámico con el token firmado,
 * o el enlace incrustado como variable {{2}}.
 *
 * @param string $telefono   Teléfono en formato internacional sin '+' (ej: 34666112233)
 * @param string $nombre     Nombre del cliente para personalizar el mensaje
 * @param string $urlResena  URL completa al landing de reseña con token
 * @return array             Respuesta de la API decodificada
 */
function enviarPlantillaWhatsApp(string $telefono, string $nombre, string $urlResena): array
{
    $phoneNumberId = config('WHATSAPP_PHONE_NUMBER_ID');
    $token         = config('WHATSAPP_TOKEN');
    $plantilla     = config('WHATSAPP_TEMPLATE_NAME');
    $idioma        = config('WHATSAPP_TEMPLATE_LANG', 'es');

    $endpoint = "https://graph.facebook.com/v19.0/{$phoneNumberId}/messages";

    // El sufijo dinámico del botón URL es lo que viene después del dominio configurado en la plantilla
    // Ej: si en Meta la URL base de la plantilla es https://resenas.automaticchoice.es/?t=
    // pasamos solo el valor del token.
    $sufijoBoton = parse_url($urlResena, PHP_URL_QUERY) ?? '';
    $sufijoBoton = str_replace('t=', '', $sufijoBoton);

    $payload = [
        'messaging_product' => 'whatsapp',
        'to' => $telefono,
        'type' => 'template',
        'template' => [
            'name' => $plantilla,
            'language' => ['code' => $idioma],
            'components' => [
                [
                    'type' => 'body',
                    'parameters' => [
                        ['type' => 'text', 'text' => $nombre],
                    ],
                ],
                [
                    'type' => 'button',
                    'sub_type' => 'url',
                    'index' => '0',
                    'parameters' => [
                        ['type' => 'text', 'text' => $sufijoBoton],
                    ],
                ],
            ],
        ],
    ];

    $ch = curl_init($endpoint);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            "Authorization: Bearer {$token}",
            'Content-Type: application/json',
        ],
        CURLOPT_POSTFIELDS => json_encode($payload),
        CURLOPT_TIMEOUT => 20,
    ]);
    $respuesta = curl_exec($ch);
    $codigo    = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error     = curl_error($ch);
    curl_close($ch);

    if ($error) {
        throw new RuntimeException("Error cURL al llamar a WhatsApp: {$error}");
    }
    $decodificada = json_decode($respuesta, true) ?? [];
    $decodificada['_http_code'] = $codigo;
    return $decodificada;
}
