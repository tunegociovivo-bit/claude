<?php
/**
 * Cliente unificado para llamadas a IA. Soporta Anthropic (Claude) y OpenAI.
 * Usado para:
 *  - Generar opener personalizado por lead.
 *  - Clasificar respuestas entrantes (interesado/objeción/info/baja/off-topic).
 */

if ( ! defined( 'WPINC' ) ) {
    die;
}

class NVL_AI_Client {

    private $provider;
    private $api_key;
    private $opener_model;
    private $classifier_model;

    public function __construct() {
        $s = get_option( 'nvl_settings', array() );
        $this->provider          = isset( $s['ai_provider'] ) ? $s['ai_provider'] : 'anthropic';
        $this->api_key           = isset( $s['ai_api_key'] ) ? $s['ai_api_key'] : '';
        $this->opener_model      = self::pick_model( $this->provider, isset( $s['ai_model_opener'] ) ? $s['ai_model_opener'] : '' );
        $this->classifier_model  = self::pick_model( $this->provider, isset( $s['ai_model_classifier'] ) ? $s['ai_model_classifier'] : '' );
    }

    /**
     * Devuelve un modelo apropiado para el provider. Si el modelo guardado en
     * settings es de un provider distinto (ej. claude-* con provider=openai),
     * cae al default del provider en lugar de romper con HTTP 404.
     */
    private static function pick_model( $provider, $configured ) {
        $default = $provider === 'openai' ? 'gpt-4o-mini' : 'claude-haiku-4-5-20251001';
        if ( empty( $configured ) ) return $default;
        $is_claude = stripos( $configured, 'claude' ) === 0;
        $is_gpt    = stripos( $configured, 'gpt' )    === 0 || stripos( $configured, 'o1' ) === 0 || stripos( $configured, 'o3' ) === 0;
        if ( $provider === 'openai'    && $is_claude ) return $default;
        if ( $provider === 'anthropic' && $is_gpt )    return $default;
        return $configured;
    }

    public function is_configured() {
        return $this->provider !== 'none' && ! empty( $this->api_key );
    }

    /**
     * Genera un opener personalizado de 1-2 frases para un lead.
     *
     * @param object $lead Fila de nvl_leads.
     * @param array  $context Contexto extra (competidor top, keyword, etc).
     * @return string|WP_Error Texto del opener (sin saludo, va embebido en plantilla).
     */
    public function generate_opener( $lead, $context = array() ) {
        if ( ! $this->is_configured() ) {
            return new WP_Error( 'ai_not_configured', 'IA no configurada en Ajustes.' );
        }

        $system = "Eres un copywriter B2B experto en prospección de negocios locales en España. " .
                  "Tu tarea: escribir UNA frase (máximo 2) que personalice un mensaje de prospección a un negocio. " .
                  "La frase debe basarse en datos REALES del negocio que te paso. " .
                  "Tono: profesional, cercano, sin venta agresiva. " .
                  "Idioma: español (de España). " .
                  "Prohibido: emojis, exageraciones, palabras como 'increíble', 'fantástico'. " .
                  "Prohibido saludos tipo 'Hola'. Empieza directamente por la observación.";

        $facts = array(
            'nombre'           => $lead->name,
            'posicion'         => $lead->position,
            'provincia'        => $lead->province,
            'categoria'        => $lead->category,
            'rating'           => $lead->rating,
            'reseñas_total'    => $lead->reviews_count,
            'pct_positivas'    => $lead->positive_pct,
            'pct_negativas'    => $lead->negative_pct,
            'tiene_web'        => ! empty( $lead->website ) ? 'sí' : 'no',
            'competidor_top'   => isset( $context['competitor_top'] ) ? $context['competitor_top'] : '',
            'keyword'          => isset( $context['keyword'] ) ? $context['keyword'] : '',
        );

        $user = "Datos del negocio:\n" . wp_json_encode( $facts, JSON_UNESCAPED_UNICODE ) . "\n\n" .
                "Escribe una frase personalizada (máximo 35 palabras) que identifique un punto débil obvio o una oportunidad clara para este negocio en concreto. " .
                "Si tiene buena valoración pero mala posición, juega con esa paradoja. " .
                "Si tiene mucha competencia mejor posicionada con peor servicio, menciónalo. " .
                "Devuelve SOLO la frase, sin comillas, sin prólogos.";

        return $this->call_model( $this->opener_model, $system, $user, 200 );
    }

    /**
     * Clasifica una respuesta entrante de un lead.
     *
     * @return array|WP_Error { classification, confidence, reason }
     */
    public function classify_reply( $reply_text, $lead = null ) {
        if ( ! $this->is_configured() ) {
            return new WP_Error( 'ai_not_configured', 'IA no configurada.' );
        }

        $system = "Clasificas respuestas de WhatsApp recibidas tras un mensaje de prospección B2B. " .
                  "Devuelve SIEMPRE un JSON válido con esta forma: " .
                  "{\"classification\":\"interested|objection|info_request|opt_out|off_topic|positive_no|auto_reply\"," .
                   "\"confidence\":0.0-1.0," .
                   "\"reason\":\"breve explicación\"}. " .
                  "Significados: " .
                  "- interested: quiere saber más, agendar, ver propuesta. " .
                  "- objection: muestra duda, precio, momento, no es prioridad ahora. " .
                  "- info_request: pide info específica (precio, demo, datos). " .
                  "- opt_out: pide que NO le contactemos más, baja, stop, denuncia. " .
                  "- off_topic: no parece relacionado con el mensaje. " .
                  "- positive_no: amable pero un no claro (\"gracias, no nos interesa\"). " .
                  "- auto_reply: respuesta automática (bot, vacaciones, fuera de horario).";

        $user = "Texto recibido: \"" . wp_strip_all_tags( $reply_text ) . "\"" .
                ( $lead ? "\nNombre del negocio: " . $lead->name : '' );

        $raw = $this->call_model( $this->classifier_model, $system, $user, 250 );
        if ( is_wp_error( $raw ) ) {
            return $raw;
        }

        // Extraer JSON: el modelo puede devolver texto antes/después.
        if ( preg_match( '/\{[^{}]*"classification"[^{}]*\}/s', $raw, $m ) ) {
            $json = json_decode( $m[0], true );
            if ( is_array( $json ) && isset( $json['classification'] ) ) {
                return $json;
            }
        }
        return new WP_Error( 'parse_error', 'No se pudo parsear la respuesta del clasificador.', array( 'raw' => $raw ) );
    }

    /**
     * Llamada genérica a un modelo. Devuelve el texto plano de la respuesta.
     */
    private function call_model( $model, $system, $user, $max_tokens = 300 ) {
        if ( $this->provider === 'openai' ) {
            return $this->call_openai( $model, $system, $user, $max_tokens );
        }
        return $this->call_anthropic( $model, $system, $user, $max_tokens );
    }

    private function call_anthropic( $model, $system, $user, $max_tokens ) {
        $body = array(
            'model'      => $model,
            'max_tokens' => $max_tokens,
            'system'     => $system,
            'messages'   => array( array( 'role' => 'user', 'content' => $user ) ),
        );
        $resp = wp_remote_post( 'https://api.anthropic.com/v1/messages', array(
            'timeout' => 30,
            'headers' => array(
                'x-api-key'         => $this->api_key,
                'anthropic-version' => '2023-06-01',
                'Content-Type'      => 'application/json',
            ),
            'body' => wp_json_encode( $body ),
        ) );
        if ( is_wp_error( $resp ) ) return $resp;
        $code = (int) wp_remote_retrieve_response_code( $resp );
        $data = json_decode( wp_remote_retrieve_body( $resp ), true );
        if ( $code >= 400 ) {
            $msg = isset( $data['error']['message'] ) ? $data['error']['message'] : 'HTTP ' . $code;
            return new WP_Error( 'ai_http', $msg, $data );
        }
        if ( ! empty( $data['content'][0]['text'] ) ) {
            return trim( $data['content'][0]['text'] );
        }
        return new WP_Error( 'ai_format', 'Respuesta inesperada de Anthropic.', $data );
    }

    private function call_openai( $model, $system, $user, $max_tokens ) {
        $body = array(
            'model'    => $model,
            'messages' => array(
                array( 'role' => 'system', 'content' => $system ),
                array( 'role' => 'user',   'content' => $user ),
            ),
            'max_tokens'  => $max_tokens,
            'temperature' => 0.5,
        );
        $resp = wp_remote_post( 'https://api.openai.com/v1/chat/completions', array(
            'timeout' => 30,
            'headers' => array(
                'Authorization' => 'Bearer ' . $this->api_key,
                'Content-Type'  => 'application/json',
            ),
            'body' => wp_json_encode( $body ),
        ) );
        if ( is_wp_error( $resp ) ) return $resp;
        $code = (int) wp_remote_retrieve_response_code( $resp );
        $data = json_decode( wp_remote_retrieve_body( $resp ), true );
        if ( $code >= 400 ) {
            $msg = isset( $data['error']['message'] ) ? $data['error']['message'] : 'HTTP ' . $code;
            return new WP_Error( 'ai_http', $msg, $data );
        }
        if ( ! empty( $data['choices'][0]['message']['content'] ) ) {
            return trim( $data['choices'][0]['message']['content'] );
        }
        return new WP_Error( 'ai_format', 'Respuesta inesperada de OpenAI.', $data );
    }

    /**
     * Mini-test para validar API key desde Ajustes.
     */
    public function test() {
        return $this->call_model( $this->opener_model, 'Eres un asistente.', 'Devuelve solo la palabra OK.', 10 );
    }

    /**
     * Valida si un lead encaja semanticamente con la keyword de busqueda.
     * Modo MUY CONSERVADOR: ante duda devuelve match=false.
     *
     * @param string $keyword Palabra clave de la busqueda.
     * @param array  $lead    Datos del lead (name, formatted_address, category, types, reviews_json opcional).
     * @return array|WP_Error { match: bool, confidence: 0..1, reason: string }
     */
    public function validate_keyword_match( $keyword, $lead ) {
        if ( ! $this->is_configured() ) {
            return new WP_Error( 'ai_not_configured', 'IA no configurada.' );
        }

        $types = isset( $lead['types'] ) ? $lead['types'] : '';
        if ( is_string( $types ) ) {
            $dec = json_decode( $types, true );
            if ( is_array( $dec ) ) $types = implode( ', ', $dec );
        } elseif ( is_array( $types ) ) {
            $types = implode( ', ', $types );
        }

        $reviews_sample = '';
        if ( ! empty( $lead['reviews_json'] ) ) {
            $rv = is_string( $lead['reviews_json'] ) ? json_decode( $lead['reviews_json'], true ) : $lead['reviews_json'];
            if ( is_array( $rv ) ) {
                $texts = array();
                foreach ( array_slice( $rv, 0, 3 ) as $r ) {
                    if ( ! empty( $r['text'] ) ) $texts[] = mb_substr( $r['text'], 0, 200 );
                }
                $reviews_sample = implode( ' | ', $texts );
            }
        }

        $system = 'Eres un experto en clasificacion de negocios locales en España. Tu tarea: decidir si un negocio encaja con una palabra clave de busqueda, INCLUYENDO sinonimos comerciales reales del sector. ' .
                  'Tu decision se basa en como se entiende el nicho comercialmente en España, no en sentido literal. ' .
                  'Ejemplo: "tantra" en un nombre comercial de centro de masajes en España significa habitualmente "masaje erotico/sensual de pago", no terapia tantrica espiritual. ' .
                  'Devuelve SIEMPRE un JSON exacto: {"match":true|false,"confidence":0.0-1.0,"reason":"explicacion breve en español"}';

        // Reglas por familia de keyword. Lo hacemos dinamico para nichos sensibles.
        $kw_lower = mb_strtolower( $keyword );
        $extra_rules = '';
        if ( preg_match( '/erotic|erotic|eroticos?|eroticas?|tantra|tantric|sensual|sensitive|final feliz/u', $kw_lower ) ) {
            $extra_rules =
                "Para la keyword \"$keyword\" (nicho de masajes eroticos en España):\n" .
                "MATCH=TRUE si en el NOMBRE aparece cualquier senal comercial fuerte del sector: " .
                "'erotic', 'erotico/a/os/as', 'tantra', 'tantric/o/a', 'sensitive', 'sensual', 'sensorial', 'luxury massage', 'premium massage', " .
                "'masaje para hombres', 'final feliz', 'final happy', 'oriental', 'lingam', 'yoni', 'nuru', 'thai erotic', 'body to body'. " .
                "Tambien MATCH=TRUE si la categoria principal es 'massage_spa' Y el negocio NO se autodescribe explicitamente como wellness/terapeutico/fisioterapia.\n" .
                "MATCH=FALSE si el nombre indica claramente otro nicho: quiromasaje, fisioterapia, osteopata, podologo, " .
                "'spa wellness', 'spa hotel', 'masaje deportivo', 'masaje terapeutico', 'shiatsu' (sin otra senal), 'maderoterapia', " .
                "'reflexologia', 'masaje infantil', 'masaje embarazo', escuela de masaje, centro de fisioterapia, clinica de salud.\n" .
                "Si solo dice 'masaje', 'centro de masajes' sin matiz: MATCH=FALSE (ambiguo, no contactar).\n";
        } else {
            $extra_rules =
                "Para esta keyword: MATCH=TRUE si el negocio se dedica especificamente al nicho. " .
                "Tener en cuenta sinonimos comerciales habituales en España. " .
                "MATCH=FALSE si es un nicho relacionado pero distinto (ejemplo: clinica veterinaria NO es centro de adopcion canina). " .
                "Si es ambiguo, prefiere MATCH=FALSE.\n";
        }

        $user = "Palabra clave de busqueda: \"$keyword\"\n\n" .
                "Negocio:\n" .
                '- Nombre: ' . ( isset( $lead['name'] ) ? $lead['name'] : '' ) . "\n" .
                '- Direccion: ' . ( isset( $lead['formatted_address'] ) ? $lead['formatted_address'] : '' ) . "\n" .
                '- Categoria principal (GMB): ' . ( isset( $lead['category'] ) ? $lead['category'] : '' ) . "\n" .
                "- Tipos GMB: $types\n" .
                ( $reviews_sample ? "- Muestras de resenas: $reviews_sample\n" : '' ) .
                "\n" . $extra_rules .
                "\nDecide y responde solo el JSON.";

        $raw = $this->call_model( $this->classifier_model, $system, $user, 250 );
        if ( is_wp_error( $raw ) ) return $raw;

        if ( preg_match( '/\{[\s\S]*?"match"[\s\S]*?\}/s', $raw, $m ) ) {
            $json = json_decode( $m[0], true );
            if ( is_array( $json ) && isset( $json['match'] ) ) {
                return array(
                    'match'      => (bool) $json['match'],
                    'confidence' => isset( $json['confidence'] ) ? floatval( $json['confidence'] ) : 0,
                    'reason'     => isset( $json['reason'] ) ? (string) $json['reason'] : '',
                );
            }
        }
        return new WP_Error( 'parse_error', 'No se pudo parsear respuesta del validador.', array( 'raw' => $raw ) );
    }
}
