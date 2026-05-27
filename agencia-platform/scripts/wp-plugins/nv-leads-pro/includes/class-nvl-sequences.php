<?php
/**
 * Motor de secuencias de follow-up automático.
 *
 * Una secuencia tiene N pasos. Cada paso tiene un delay (en días) desde el envío
 * del paso anterior y un cuerpo de mensaje (con variables {{...}}).
 *
 * Cuando un lead se enrola en una secuencia:
 *  1. El paso #0 se encola inmediatamente (o se asume ya enviado si se enroló desde un envío manual).
 *  2. Tras cada envío exitoso, programamos el siguiente paso scheduled_at = ahora + delay_days.
 *  3. Si llega una respuesta del lead → la secuencia se PARA automáticamente.
 */

if ( ! defined( 'WPINC' ) ) {
    die;
}

class NVL_Sequences {

    /* ===== CRUD de secuencias ===== */

    public static function get_sequences() {
        global $wpdb;
        return $wpdb->get_results( "SELECT * FROM " . NVL_DB::table( 'sequences' ) . " ORDER BY is_default DESC, name ASC" );
    }

    public static function get_sequence( $id ) {
        global $wpdb;
        return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM " . NVL_DB::table( 'sequences' ) . " WHERE id = %d", $id ) );
    }

    public static function get_default_sequence() {
        global $wpdb;
        $r = $wpdb->get_row( "SELECT * FROM " . NVL_DB::table( 'sequences' ) . " WHERE is_default = 1 AND is_active = 1 LIMIT 1" );
        return $r ?: $wpdb->get_row( "SELECT * FROM " . NVL_DB::table( 'sequences' ) . " WHERE is_active = 1 ORDER BY id ASC LIMIT 1" );
    }

    public static function get_steps( $sequence_id ) {
        global $wpdb;
        return $wpdb->get_results( $wpdb->prepare(
            "SELECT * FROM " . NVL_DB::table( 'sequence_steps' ) . " WHERE sequence_id = %d ORDER BY step_order ASC",
            $sequence_id
        ) );
    }

    public static function save_sequence( $data, $id = 0 ) {
        global $wpdb;
        $row = array(
            'name'        => sanitize_text_field( $data['name'] ),
            'description' => sanitize_textarea_field( isset( $data['description'] ) ? $data['description'] : '' ),
            'is_active'   => ! empty( $data['is_active'] ) ? 1 : 0,
            'is_default'  => ! empty( $data['is_default'] ) ? 1 : 0,
        );
        if ( $row['is_default'] ) {
            $wpdb->query( "UPDATE " . NVL_DB::table( 'sequences' ) . " SET is_default = 0" );
        }
        if ( $id ) {
            $wpdb->update( NVL_DB::table( 'sequences' ), $row, array( 'id' => $id ) );
            return $id;
        }
        $wpdb->insert( NVL_DB::table( 'sequences' ), $row );
        return $wpdb->insert_id;
    }

    public static function delete_sequence( $id ) {
        global $wpdb;
        $wpdb->delete( NVL_DB::table( 'sequences' ),     array( 'id' => $id ),          array( '%d' ) );
        $wpdb->delete( NVL_DB::table( 'sequence_steps' ),array( 'sequence_id' => $id ), array( '%d' ) );
        $wpdb->delete( NVL_DB::table( 'lead_sequences' ),array( 'sequence_id' => $id ), array( '%d' ) );
    }

    public static function replace_steps( $sequence_id, $steps ) {
        global $wpdb;
        $wpdb->delete( NVL_DB::table( 'sequence_steps' ), array( 'sequence_id' => $sequence_id ), array( '%d' ) );
        foreach ( $steps as $i => $s ) {
            if ( empty( $s['template_body'] ) ) continue;
            $wpdb->insert( NVL_DB::table( 'sequence_steps' ), array(
                'sequence_id'       => $sequence_id,
                'step_order'        => $i,
                'delay_days'        => max( 0, intval( $s['delay_days'] ) ),
                'template_body'     => wp_kses_post( $s['template_body'] ),
                'channel'           => 'whatsapp',
                'stop_if_responded' => 1,
            ) );
        }
    }

    /* ===== Enrolment ===== */

    public static function enroll_lead( $lead_id, $sequence_id = 0, $start_from_step = 0 ) {
        global $wpdb;
        $lead = NVL_DB::get_lead( $lead_id );
        if ( ! $lead ) return new WP_Error( 'no_lead', 'Lead no encontrado.' );
        if ( $lead->contact_status === 'excluded' ) {
            return new WP_Error( 'excluded', 'Lead excluido (cliente existente).' );
        }
        if ( class_exists( 'NVL_Exclusions' ) && NVL_Exclusions::is_phone_optout( $lead->phone ) ) {
            return new WP_Error( 'optout', 'Telefono en lista de opt-outs.' );
        }

        if ( $sequence_id <= 0 ) {
            $seq = self::get_default_sequence();
            if ( ! $seq ) return new WP_Error( 'no_seq', 'No hay secuencia por defecto activa.' );
            $sequence_id = $seq->id;
        }

        // Evitar duplicados activos.
        $existing = $wpdb->get_var( $wpdb->prepare(
            "SELECT id FROM " . NVL_DB::table( 'lead_sequences' ) . " WHERE lead_id = %d AND sequence_id = %d AND status = 'active'",
            $lead_id, $sequence_id
        ) );
        if ( $existing ) return new WP_Error( 'already_enrolled', 'El lead ya está en esta secuencia.' );

        $wpdb->insert( NVL_DB::table( 'lead_sequences' ), array(
            'lead_id'            => $lead_id,
            'sequence_id'        => $sequence_id,
            'current_step_index' => $start_from_step,
            'status'             => 'active',
        ) );

        // Encolar el primer paso aplicable.
        return self::queue_current_step( $lead_id, $sequence_id );
    }

    public static function get_active_enrolment( $lead_id ) {
        global $wpdb;
        return $wpdb->get_row( $wpdb->prepare(
            "SELECT * FROM " . NVL_DB::table( 'lead_sequences' ) . " WHERE lead_id = %d AND status = 'active' LIMIT 1",
            $lead_id
        ) );
    }

    /**
     * Encola el paso actual de la secuencia para un lead concreto.
     */
    public static function queue_current_step( $lead_id, $sequence_id ) {
        global $wpdb;
        $enrolment = $wpdb->get_row( $wpdb->prepare(
            "SELECT * FROM " . NVL_DB::table( 'lead_sequences' ) . " WHERE lead_id = %d AND sequence_id = %d AND status = 'active'",
            $lead_id, $sequence_id
        ) );
        if ( ! $enrolment ) return false;

        $steps = self::get_steps( $sequence_id );
        if ( empty( $steps ) ) {
            self::complete_enrolment( $enrolment->id, 'no_steps' );
            return false;
        }

        $idx = intval( $enrolment->current_step_index );
        if ( ! isset( $steps[ $idx ] ) ) {
            self::complete_enrolment( $enrolment->id, 'completed' );
            return false;
        }

        $step = $steps[ $idx ];
        $body = NVL_Template_Engine::render( $step->template_body, $lead_id );
        $settings = get_option( 'nvl_settings', array() );
        if ( ! empty( $settings['enable_variations'] ) ) {
            $body = NVL_Message_Variations::vary( $body, intval( $lead_id ) * 7919 + $idx );
        }

        // Si delay_days > 0 y es el primer paso, asumimos que ya envió el inicial manualmente:
        // el primer paso es scheduled_at = ahora + delay del propio paso.
        // Si delay_days = 0 → encolar inmediatamente (compute_next_slot lo metería justo después).
        $delay_seconds = intval( $step->delay_days ) * DAY_IN_SECONDS;
        if ( $delay_seconds > 0 ) {
            $base = current_time( 'timestamp' ) + $delay_seconds;
            $scheduled = date( 'Y-m-d H:i:s',
                NVL_Send_Queue::shift_into_window(
                    $base,
                    isset( $settings['send_window_start'] ) ? $settings['send_window_start'] : '09:00',
                    isset( $settings['send_window_end'] )   ? $settings['send_window_end']   : '20:00',
                    ! empty( $settings['send_on_weekends'] )
                )
            );
        } else {
            $scheduled = NVL_Send_Queue::compute_next_slot();
        }

        $lead = NVL_DB::get_lead( $lead_id );
        $cc   = isset( $settings['whatsapp_country_code'] ) ? $settings['whatsapp_country_code'] : '34';

        $wpdb->insert( NVL_DB::table( 'messages' ), array(
            'lead_id'          => $lead_id,
            'rendered_message' => $body,
            'channel'          => 'whatsapp',
            'instance_name'    => isset( $settings['evolution_instance'] ) ? $settings['evolution_instance'] : '',
            'phone_normalized' => NVL_WhatsApp::normalize_phone( $lead->phone, $cc ),
            'status'           => 'queued',
            'scheduled_at'     => $scheduled,
            'priority'         => 5,
        ) );

        return true;
    }

    /**
     * Llamado tras un envío exitoso para avanzar la secuencia del lead.
     */
    public static function advance_after_send( $lead_id ) {
        global $wpdb;
        $enrolment = self::get_active_enrolment( $lead_id );
        if ( ! $enrolment ) return;

        $steps = self::get_steps( $enrolment->sequence_id );
        $next  = intval( $enrolment->current_step_index ) + 1;

        if ( $next >= count( $steps ) ) {
            self::complete_enrolment( $enrolment->id, 'completed' );
            return;
        }

        $wpdb->update( NVL_DB::table( 'lead_sequences' ),
            array( 'current_step_index' => $next ),
            array( 'id' => $enrolment->id )
        );
        self::queue_current_step( $lead_id, $enrolment->sequence_id );
    }

    /**
     * Detiene la secuencia activa de un lead (por respuesta, baja, etc.).
     */
    public static function stop_enrolment_for_lead( $lead_id, $reason = 'responded' ) {
        global $wpdb;
        $enrolment = self::get_active_enrolment( $lead_id );
        if ( ! $enrolment ) return;
        self::complete_enrolment( $enrolment->id, $reason );

        // Y cancelar mensajes en cola para ese lead.
        $wpdb->query( $wpdb->prepare(
            "UPDATE " . NVL_DB::table( 'messages' ) . " SET status = 'cancelled', last_error = %s WHERE lead_id = %d AND status = 'queued'",
            'sequence_stopped: ' . $reason,
            $lead_id
        ) );
    }

    private static function complete_enrolment( $enrolment_id, $reason ) {
        global $wpdb;
        $wpdb->update( NVL_DB::table( 'lead_sequences' ), array(
            'status'         => 'stopped',
            'completed_at'   => current_time( 'mysql' ),
            'stopped_reason' => $reason,
        ), array( 'id' => $enrolment_id ) );
    }
}
