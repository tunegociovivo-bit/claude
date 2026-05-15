<?php
/**
 * Bandeja de entrada: gestiona mensajes recibidos vía webhook,
 * los asocia a un lead por teléfono, los clasifica con IA y
 * detiene secuencias automáticamente si procede.
 */

if ( ! defined( 'WPINC' ) ) {
    die;
}

class NVL_Inbox {

    /**
     * Procesa un mensaje recibido vía webhook.
     */
    public static function ingest( $payload ) {
        global $wpdb;
        $phone = preg_replace( '/\D/', '', (string) $payload['phone_normalized'] );
        $text  = trim( (string) $payload['message_text'] );

        // Localizar lead por teléfono normalizado.
        $lead_id = self::find_lead_by_phone( $phone );

        // Persistir mensaje.
        $wpdb->insert( NVL_DB::table( 'inbox' ), array(
            'lead_id'             => $lead_id,
            'phone_normalized'    => $phone,
            'channel'             => 'whatsapp',
            'direction'           => 'in',
            'message_text'        => $text,
            'external_message_id' => isset( $payload['external_message_id'] ) ? $payload['external_message_id'] : null,
            'instance_name'       => isset( $payload['instance_name'] ) ? $payload['instance_name'] : null,
        ) );
        $msg_id = $wpdb->insert_id;

        // Clasificar con IA (si está activado).
        $settings = get_option( 'nvl_settings', array() );
        $classification = self::heuristic_classify( $text );

        if ( ! empty( $settings['ai_enabled_classify'] ) ) {
            $ai = new NVL_AI_Client();
            if ( $ai->is_configured() ) {
                $lead_obj = $lead_id ? NVL_DB::get_lead( $lead_id ) : null;
                $r = $ai->classify_reply( $text, $lead_obj );
                if ( ! is_wp_error( $r ) ) {
                    $classification = array(
                        'classification' => $r['classification'],
                        'confidence'     => isset( $r['confidence'] ) ? floatval( $r['confidence'] ) : null,
                        'reason'         => isset( $r['reason'] ) ? sanitize_text_field( $r['reason'] ) : null,
                    );
                }
            }
        }

        $wpdb->update( NVL_DB::table( 'inbox' ), array(
            'classification'           => $classification['classification'],
            'classification_confidence'=> $classification['confidence'],
            'classification_reason'    => $classification['reason'],
        ), array( 'id' => $msg_id ) );

        // Reacciones automáticas según clasificación.
        if ( $lead_id ) {
            self::apply_classification_actions( $lead_id, $classification['classification'] );
        }
    }

    private static function find_lead_by_phone( $phone ) {
        global $wpdb;
        if ( ! $phone ) return null;

        // Probar directamente.
        $id = $wpdb->get_var( $wpdb->prepare(
            "SELECT lead_id FROM " . NVL_DB::table( 'messages' ) . " WHERE phone_normalized = %s ORDER BY id DESC LIMIT 1",
            $phone
        ) );
        if ( $id ) return intval( $id );

        // Probar sin prefijo 34 / con prefijo.
        if ( strpos( $phone, '34' ) === 0 ) {
            $alt = substr( $phone, 2 );
        } else {
            $alt = '34' . $phone;
        }
        $id = $wpdb->get_var( $wpdb->prepare(
            "SELECT lead_id FROM " . NVL_DB::table( 'messages' ) . " WHERE phone_normalized = %s ORDER BY id DESC LIMIT 1",
            $alt
        ) );
        if ( $id ) return intval( $id );

        // Fallback: por número en la tabla de leads (último contactado coincidente).
        $like = '%' . $wpdb->esc_like( $alt ) . '%';
        $id = $wpdb->get_var( $wpdb->prepare(
            "SELECT id FROM " . NVL_DB::table( 'leads' ) . " WHERE phone LIKE %s ORDER BY id DESC LIMIT 1",
            $like
        ) );
        return $id ? intval( $id ) : null;
    }

    /**
     * Clasificación heurística de respaldo si la IA no está activa o falla.
     */
    public static function heuristic_classify( $text ) {
        $t = mb_strtolower( $text );

        // Opt-out muy claro.
        if ( preg_match( '/\b(stop|baja|no me escrib|no me contact|borrad?me|denuncia|spam)\b/u', $t ) ) {
            return array( 'classification' => 'opt_out', 'confidence' => 0.85, 'reason' => 'Heurística: palabra clave de baja.' );
        }
        // No interesa.
        if ( preg_match( '/\b(no me interes|no estamos interesad|no gracias)\b/u', $t ) ) {
            return array( 'classification' => 'positive_no', 'confidence' => 0.75, 'reason' => 'Heurística: rechazo cortés.' );
        }
        // Pide info.
        if ( preg_match( '/\b(precio|cu[aá]nto|coste|tarifa|info|m[aá]s info|cómo funciona|enviame|env[ií]ame)\b/u', $t ) ) {
            return array( 'classification' => 'info_request', 'confidence' => 0.7, 'reason' => 'Heurística: solicitud de información.' );
        }
        // Interesado.
        if ( preg_match( '/\b(interes|hablamos|llamame|llamad|reuni[oó]n|demo|agend|cuando|dispon)\b/u', $t ) ) {
            return array( 'classification' => 'interested', 'confidence' => 0.65, 'reason' => 'Heurística: muestra interés.' );
        }
        return array( 'classification' => 'off_topic', 'confidence' => 0.4, 'reason' => 'Heurística: sin patrón claro.' );
    }

    private static function apply_classification_actions( $lead_id, $classification ) {
        // Parar secuencia siempre que haya respuesta (excepto auto_reply).
        if ( $classification !== 'auto_reply' && class_exists( 'NVL_Sequences' ) ) {
            NVL_Sequences::stop_enrolment_for_lead( $lead_id, 'lead_replied:' . $classification );
        }

        $update = array();
        switch ( $classification ) {
            case 'opt_out':
                $update['contact_status'] = 'discarded';
                // Añadir telefono a opt-outs automaticamente.
                $lead_obj = NVL_DB::get_lead( $lead_id );
                if ( $lead_obj && $lead_obj->phone && class_exists( 'NVL_Exclusions' ) ) {
                    NVL_Exclusions::add_optout( $lead_obj->phone, 'Pidio baja (auto)', 'auto_reply_classify', $lead_id );
                }
                break;
            case 'positive_no':
                $update['contact_status'] = 'discarded';
                break;
            case 'interested':
            case 'info_request':
            case 'objection':
                $update['contact_status'] = 'responded';
                break;
            default:
                $update['contact_status'] = 'responded';
        }
        NVL_DB::update_lead_details( $lead_id, $update );
    }

    /* ===== Lectura ===== */

    public static function get_messages( $args = array() ) {
        global $wpdb;
        $defaults = array(
            'classification' => '',
            'is_read'        => '',
            'limit'          => 50,
            'offset'         => 0,
        );
        $args  = wp_parse_args( $args, $defaults );
        $where = '1=1';
        if ( $args['classification'] !== '' ) {
            $where .= $wpdb->prepare( ' AND classification = %s', $args['classification'] );
        }
        if ( $args['is_read'] !== '' ) {
            $where .= $wpdb->prepare( ' AND is_read = %d', intval( $args['is_read'] ) );
        }
        $sql = "SELECT i.*, l.name AS lead_name, l.search_id
                FROM " . NVL_DB::table( 'inbox' ) . " i
                LEFT JOIN " . NVL_DB::table( 'leads' ) . " l ON l.id = i.lead_id
                WHERE {$where}
                ORDER BY i.received_at DESC
                LIMIT %d OFFSET %d";
        return $wpdb->get_results( $wpdb->prepare( $sql, intval( $args['limit'] ), intval( $args['offset'] ) ) );
    }

    public static function counts() {
        global $wpdb;
        $t = NVL_DB::table( 'inbox' );
        $stats = array(
            'total'    => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$t}" ),
            'unread'   => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$t} WHERE is_read = 0" ),
            'interested' => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$t} WHERE classification = 'interested'" ),
            'info_request' => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$t} WHERE classification = 'info_request'" ),
            'opt_out' => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$t} WHERE classification = 'opt_out'" ),
            'objection' => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$t} WHERE classification = 'objection'" ),
            'positive_no' => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$t} WHERE classification = 'positive_no'" ),
        );
        return $stats;
    }

    public static function mark_read( $id ) {
        global $wpdb;
        $wpdb->update( NVL_DB::table( 'inbox' ), array( 'is_read' => 1 ), array( 'id' => intval( $id ) ) );
    }

    public static function get_lead_conversation( $lead_id, $limit = 100 ) {
        global $wpdb;
        return $wpdb->get_results( $wpdb->prepare(
            "SELECT * FROM " . NVL_DB::table( 'inbox' ) . " WHERE lead_id = %d ORDER BY received_at ASC LIMIT %d",
            $lead_id, $limit
        ) );
    }
}
