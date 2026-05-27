<?php
/**
 * Variaciones de mensaje para reducir el fingerprinting de WhatsApp.
 *
 * No reescribe el mensaje completo: aplica pequeños cambios humanos
 * (saludo, sinonimos, separadores, puntuacion, capitalizacion ocasional)
 * para que dos mensajes con la misma plantilla base tengan superficie
 * distinta cuando WhatsApp aplica matching de patrones.
 *
 * Combinar SIEMPRE con rotacion de plantillas (NVL_DB::get_default_template
 * escoge una al azar entre las plantillas marcadas como is_default=1).
 */

if ( ! defined( 'WPINC' ) ) {
    die;
}

class NVL_Message_Variations {

    public static function vary( $text, $seed = 0 ) {
        if ( $seed <= 0 ) {
            $seed = wp_rand( 1, PHP_INT_MAX );
        }
        mt_srand( $seed );

        // 1. SALUDO inicial. Si empieza por uno de los esperados, lo reemplaza por otro.
        $greetings = array(
            'Hola',
            'Buenas',
            'Buenas tardes',
            'Buenos dias',
            'Hola buenas',
            'Hola que tal',
            'Que tal',
        );
        $text = preg_replace_callback(
            '/^(Hola buenas|Hola que tal|Buenas tardes|Buenos dias|Que tal|Hola|Buenas)\b/u',
            function() use ( $greetings ) {
                return $greetings[ mt_rand( 0, count( $greetings ) - 1 ) ];
            },
            $text,
            1
        );

        // 2. CONECTORES y frases comunes (substituciones lexicas suaves).
        $lex = array(
            '/\buna pregunta r[aá]pida\b/u'      => array( 'una pregunta rapida', 'una duda rapida', 'una cosa rapida', 'una preguntita' ),
            '/\bestaba revisando\b/u'            => array( 'estaba revisando', 'estaba mirando', 'estuve mirando', 'he estado revisando' ),
            '/\bme he fijado\b/u'                => array( 'me he fijado', 'me llamo la atencion', 'me ha llamado la atencion' ),
            '/\bun par de\b/u'                   => array( 'un par de', 'algunas', 'un par' ),
            '/\bobservaciones concretas\b/u'     => array( 'observaciones concretas', 'puntos concretos', 'detalles concretos', 'ideas concretas' ),
            '/\bSi te interesa\b/u'              => array( 'Si te interesa', 'Si te encaja', 'Si te viene bien', 'Si quieres' ),
            '/\b¿Te encaja\?/u'                  => array( '¿Te encaja?', '¿Te suena bien?', '¿Te interesa?', '¿Que opinas?' ),
            '/\bvuestra ficha\b/u'               => array( 'vuestra ficha', 'tu ficha', 'la ficha de vuestro negocio', 'el perfil de vuestro negocio' ),
            '/\bvuestro perfil\b/u'              => array( 'vuestro perfil', 'tu perfil', 'el perfil del negocio' ),
            '/\bel sector\b/u'                   => array( 'el sector', 'el nicho', 'el mercado' ),
            '/\bcuando os busca\b/u'             => array( 'cuando os busca', 'al buscaros', 'cuando os buscan', 'cuando hacen busquedas' ),
            '/\b2 minutos\b/u'                   => array( '2 minutos', '2 min', 'un minuto', 'un momento' ),
            '/\besta semana\b/u'                 => array( 'esta semana', 'estos dias', 'cuando puedas' ),
            '/\bSin compromiso\b/u'              => array( 'Sin compromiso', 'No es vender nada', 'Sin presion', 'Solo info' ),
            '/\bcomentaros\b/u'                  => array( 'comentaros', 'contaros', 'compartiros' ),
            '/\bMe gustaria\b/u'                 => array( 'Me gustaria', 'Queria', 'Quisiera' ),
            '/\bllevais por libre\b/u'           => array( 'llevais por libre', 'lo llevais vosotros mismos', 'os encargais vosotros' ),
            '/\bvisibilidad online\b/u'          => array( 'visibilidad online', 'aparecer online', 'salir online', 'que os encuentren online' ),
        );
        foreach ( $lex as $pattern => $opts ) {
            $text = preg_replace_callback( $pattern, function() use ( $opts ) {
                return $opts[ mt_rand( 0, count( $opts ) - 1 ) ];
            }, $text, 1 );
        }

        // 3. COMA antes del nombre del negocio: a veces "Hola Negocio," a veces "Hola, Negocio,".
        if ( mt_rand( 0, 1 ) === 1 ) {
            $text = preg_replace( '/^(Hola|Buenas|Buenas tardes|Buenos dias|Que tal)\s+([A-Z])/u', '$1, $2', $text, 1 );
        }

        // 4. SEPARACION de parrafos: doble salto vs simple.
        if ( mt_rand( 0, 2 ) === 0 ) {
            $text = preg_replace( "/\n\n/", "\n", $text, 1 );
        }
        if ( mt_rand( 0, 3 ) === 0 ) {
            // Insertar un salto extra de vez en cuando para humanizar.
            $parts = preg_split( '/(?<=[.!?])\s+/', $text, 2 );
            if ( count( $parts ) === 2 ) {
                $text = $parts[0] . "\n\n" . $parts[1];
            }
        }

        // 5. PUNTUACION FINAL aleatoria.
        $r = mt_rand( 0, 5 );
        $text = rtrim( $text, ".!? \n" );
        switch ( $r ) {
            case 0: $text .= '.';  break;
            case 1: $text .= '';   break;  // sin punto final
            case 2: $text .= ' :)'; break;
            case 3: $text .= '.';  break;
            case 4: $text .= '';   break;
            case 5: $text .= '.';  break;
        }

        // 6. EMOJI MUY ESPORADICO (1 de cada 6).
        if ( mt_rand( 0, 5 ) === 0 ) {
            $emojis = array( '🙌', '👋', '✨', '📍', '👀', '🙂' );
            $text = trim( $text ) . ' ' . $emojis[ mt_rand( 0, count( $emojis ) - 1 ) ];
        }

        return $text;
    }
}
