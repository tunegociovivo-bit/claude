<?php
/**
 * Gestor de la cola de envio de WhatsApp.
 */

if ( ! defined( 'WPINC' ) ) {
    die;
}

class NVL_Send_Queue {

    const TABLE = 'messages';

    public static function enqueue_lead( $lead_id, $template_id = 0, $custom_message = '' ) {
        global $wpdb;
        $lead = NVL_DB::get_lead( $lead_id );
        if ( ! $lead ) {
            return new WP_Error( 'lead_missing', 'Lead no encontrado.' );
        }
        if ( empty( $lead->phone ) ) {
            return new WP_Error( 'no_phone', 'El lead no tiene telefono.' );
        }
        if ( $lead->contact_status === 'excluded' ) {
            return new WP_Error( 'excluded', 'El lead esta marcado como cliente existente (excluido).' );
        }
        if ( class_exists( 'NVL_Exclusions' ) && NVL_Exclusions::is_phone_optout( $lead->phone ) ) {
            return new WP_Error( 'optout', 'Este telefono esta en la lista de opt-outs.' );
        }

        $settings = get_option( 'nvl_settings', array() );
        $cc       = isset( $settings['whatsapp_country_code'] ) ? $settings['whatsapp_country_code'] : '34';
        $phone    = NVL_WhatsApp::normalize_phone( $lead->phone, $cc );

        if ( $custom_message ) {
            $body = $custom_message;
        } else {
            $tpl = $template_id ? NVL_DB::get_template( $template_id ) : NVL_DB::get_default_template();
            if ( ! $tpl ) {
                return new WP_Error( 'no_template', 'No hay plantilla disponible.' );
            }
            $body = NVL_Template_Engine::render( $tpl->body, $lead_id );
        }

        if ( ! empty( $settings['enable_variations'] ) ) {
            $body = NVL_Message_Variations::vary( $body, intval( $lead_id ) * 7919 );
        }

        $existing = $wpdb->get_var( $wpdb->prepare(
            "SELECT id FROM " . NVL_DB::table( 'messages' ) . " WHERE lead_id = %d AND status IN ('queued','sending')",
            $lead_id
        ) );
        if ( $existing ) return new WP_Error( 'already_queued', 'Ya hay un mensaje en cola.' );

        $scheduled_at = self::compute_next_slot();

        $wpdb->insert(
            NVL_DB::table( 'messages' ),
            array(
                'lead_id'          => intval( $lead_id ),
                'template_id'      => intval( $template_id ),
                'rendered_message' => $body,
                'channel'          => 'whatsapp',
                'instance_name'    => isset( $settings['evolution_instance'] ) ? $settings['evolution_instance'] : '',
                'phone_normalized' => $phone,
                'status'           => 'queued',
                'scheduled_at'     => $scheduled_at,
            )
        );
        return $wpdb->insert_id;
    }

    public static function compute_next_slot() {
        global $wpdb;
        $settings  = get_option( 'nvl_settings', array() );
        $delay_min = max( 5, intval( $settings['send_delay_min'] ) );
        $delay_max = max( $delay_min, intval( $settings['send_delay_max'] ) );
        $win_start = isset( $settings['send_window_start'] ) ? $settings['send_window_start'] : '09:00';
        $win_end   = isset( $settings['send_window_end'] ) ? $settings['send_window_end'] : '20:00';
        $weekends  = ! empty( $settings['send_on_weekends'] );

        $last_ts = $wpdb->get_var(
            "SELECT MAX(scheduled_at) FROM " . NVL_DB::table( 'messages' ) . " WHERE status IN ('queued','sending')"
        );
        $now = current_time( 'timestamp' );
        $base = $last_ts ? strtotime( $last_ts ) : $now;
        if ( $base < $now ) $base = $now;

        $candidate = $base + wp_rand( $delay_min, $delay_max );
        return date( 'Y-m-d H:i:s', self::shift_into_window( $candidate, $win_start, $win_end, $weekends ) );
    }

    public static function shift_into_window( $ts, $win_start, $win_end, $weekends ) {
        $tz = wp_timezone();
        $dt = ( new DateTime() )->setTimezone( $tz )->setTimestamp( $ts );

        for ( $i = 0; $i < 10; $i++ ) {
            $dow = (int) $dt->format( 'N' );
            if ( ! $weekends && $dow >= 6 ) {
                $dt->modify( '+' . ( 8 - $dow ) . ' days' );
                $hm = self::parse_hm( $win_start );
                $dt->setTime( $hm[0], $hm[1], 0 );
                continue;
            }
            $hm_start = self::parse_hm( $win_start );
            $hm_end   = self::parse_hm( $win_end );
            $start_today = ( clone $dt )->setTime( $hm_start[0], $hm_start[1], 0 );
            $end_today   = ( clone $dt )->setTime( $hm_end[0], $hm_end[1], 0 );

            if ( $dt < $start_today ) {
                $dt = $start_today;
                continue;
            }
            if ( $dt > $end_today ) {
                $dt->modify( '+1 day' );
                $dt->setTime( $hm_start[0], $hm_start[1], 0 );
                continue;
            }
            return $dt->getTimestamp();
        }
        return $ts;
    }

    private static function parse_hm( $hm ) {
        $parts = explode( ':', (string) $hm );
        $h = isset( $parts[0] ) ? intval( $parts[0] ) : 9;
        $m = isset( $parts[1] ) ? intval( $parts[1] ) : 0;
        return array( $h, $m, 0 );
    }

    public static function next_ready_message() {
        global $wpdb;
        $settings = get_option( 'nvl_settings', array() );
        if ( ! empty( $settings['send_paused'] ) ) return null;
        if ( empty( $settings['send_enabled'] ) ) return null;

        $instance = isset( $settings['evolution_instance'] ) ? $settings['evolution_instance'] : '';
        $sent_today = self::count_sent_today( $instance );
        $limit      = max( 1, intval( $settings['daily_limit'] ) );
        if ( $sent_today >= $limit ) return null;

        // Comprobacion de ventana horaria (anti-baneo: no enviar fuera de horas humanas).
        if ( ! self::is_inside_window( $settings ) ) return null;

        // Anti-baneo: si el ultimo envio fue hace menos de delay_min segundos, esperar.
        // Esto garantiza que el ritmo entre envios respete la cadencia configurada
        // incluso si la cola tiene varios mensajes con scheduled_at en el pasado.
        $delay_min = max( 5, intval( $settings['send_delay_min'] ) );
        $last_sent_at = $wpdb->get_var(
            "SELECT MAX(sent_at) FROM " . NVL_DB::table( 'messages' ) . " WHERE status = 'sent' AND sent_at IS NOT NULL"
        );
        if ( $last_sent_at ) {
            $elapsed = current_time( 'timestamp' ) - strtotime( $last_sent_at );
            if ( $elapsed < $delay_min ) return null;
        }

        $now = current_time( 'mysql' );
        $row = $wpdb->get_row( $wpdb->prepare(
            "SELECT * FROM " . NVL_DB::table( 'messages' ) . " WHERE status = 'queued' AND scheduled_at <= %s ORDER BY scheduled_at ASC LIMIT 1",
            $now
        ) );
        return $row;
    }

    /**
     * Comprueba si la hora actual esta dentro de la ventana de envio configurada.
     * Tambien aplica check de fines de semana.
     */
    private static function is_inside_window( $settings ) {
        $tz = wp_timezone();
        $now = new DateTime( 'now', $tz );
        $dow = (int) $now->format( 'N' );
        if ( empty( $settings['send_on_weekends'] ) && $dow >= 6 ) return false;
        $win_start = isset( $settings['send_window_start'] ) ? $settings['send_window_start'] : '09:00';
        $win_end   = isset( $settings['send_window_end'] ) ? $settings['send_window_end'] : '20:00';
        list( $sh, $sm ) = self::parse_hm( $win_start );
        list( $eh, $em ) = self::parse_hm( $win_end );
        $start = ( clone $now )->setTime( $sh, $sm, 0 );
        $end   = ( clone $now )->setTime( $eh, $em, 0 );
        return $now >= $start && $now <= $end;
    }

    public static function count_sent_today( $instance = '' ) {
        global $wpdb;
        $today = date( 'Y-m-d', current_time( 'timestamp' ) );
        if ( $instance ) {
            return (int) $wpdb->get_var( $wpdb->prepare(
                "SELECT COUNT(*) FROM " . NVL_DB::table( 'messages' ) . " WHERE status = 'sent' AND instance_name = %s AND DATE(sent_at) = %s",
                $instance, $today
            ) );
        }
        return (int) $wpdb->get_var( $wpdb->prepare(
            "SELECT COUNT(*) FROM " . NVL_DB::table( 'messages' ) . " WHERE status = 'sent' AND DATE(sent_at) = %s",
            $today
        ) );
    }

    public static function send_message( $msg_row ) {
        global $wpdb;
        $table = NVL_DB::table( 'messages' );
        $settings = get_option( 'nvl_settings', array() );

        $wpdb->update( $table, array( 'status' => 'sending', 'send_attempts' => intval( $msg_row->send_attempts ) + 1 ), array( 'id' => $msg_row->id ) );

        $api = new NVL_Evolution_API();
        if ( ! $api->is_configured() ) {
            $wpdb->update( $table, array( 'status' => 'failed', 'last_error' => 'Evolution API no configurada.' ), array( 'id' => $msg_row->id ) );
            return;
        }

        if ( ! empty( $settings['validate_wa_before_send'] ) && $msg_row->lead_id ) {
            $lead = NVL_DB::get_lead( $msg_row->lead_id );
            if ( $lead && $lead->has_whatsapp === null ) {
                $check = $api->check_whatsapp_numbers( $msg_row->phone_normalized );
                if ( ! is_wp_error( $check ) ) {
                    $exists = false;
                    if ( is_array( $check ) ) {
                        foreach ( $check as $row ) {
                            if ( ! empty( $row['exists'] ) ) { $exists = true; break; }
                            if ( ! empty( $row['jid'] ) ) { $exists = true; break; }
                        }
                    }
                    NVL_DB::update_lead_details( $msg_row->lead_id, array(
                        'has_whatsapp'        => $exists ? 1 : 0,
                        'whatsapp_checked_at' => current_time( 'mysql' ),
                    ) );
                    if ( ! $exists ) {
                        $wpdb->update( $table, array(
                            'status'     => 'no_whatsapp',
                            'last_error' => 'El numero no esta en WhatsApp.',
                        ), array( 'id' => $msg_row->id ) );
                        NVL_DB::update_lead_details( $msg_row->lead_id, array( 'contact_status' => 'discarded' ) );
                        return;
                    }
                }
            }
        }

        $resp = $api->send_text( $msg_row->phone_normalized, $msg_row->rendered_message );

        if ( is_wp_error( $resp ) ) {
            $err = $resp->get_error_message();
            $new_status = intval( $msg_row->send_attempts ) >= 2 ? 'failed' : 'queued';
            $reschedule = null;
            if ( $new_status === 'queued' ) {
                $reschedule = date( 'Y-m-d H:i:s', current_time( 'timestamp' ) + wp_rand( 600, 1200 ) );
            }
            $update = array( 'status' => $new_status, 'last_error' => $err );
            if ( $reschedule ) $update['scheduled_at'] = $reschedule;
            $wpdb->update( $table, $update, array( 'id' => $msg_row->id ) );
            return;
        }

        $external_id = NVL_Evolution_API::extract_message_id( $resp );
        $wpdb->update( $table,
            array(
                'status'              => 'sent',
                'sent_at'             => current_time( 'mysql' ),
                'last_error'          => null,
                'external_message_id' => $external_id,
            ),
            array( 'id' => $msg_row->id )
        );

        $lead = NVL_DB::get_lead( $msg_row->lead_id );
        if ( $lead && $lead->contact_status === 'pending' ) {
            NVL_DB::update_lead_details( $lead->id, array( 'contact_status' => 'contacted' ) );
        }

        if ( class_exists( 'NVL_Sequences' ) ) {
            NVL_Sequences::advance_after_send( $msg_row->lead_id );
        }
    }

    public static function stats() {
        global $wpdb;
        $table  = NVL_DB::table( 'messages' );
        $today  = date( 'Y-m-d', current_time( 'timestamp' ) );
        return array(
            'queued'         => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$table} WHERE status = 'queued'" ),
            'sending'        => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$table} WHERE status = 'sending'" ),
            'sent_today'     => (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$table} WHERE status = 'sent' AND DATE(sent_at) = %s", $today ) ),
            'sent_total'     => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$table} WHERE status = 'sent'" ),
            'failed'         => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$table} WHERE status = 'failed'" ),
            'next_scheduled' => $wpdb->get_var( "SELECT MIN(scheduled_at) FROM {$table} WHERE status = 'queued'" ),
        );
    }

    public static function get_messages( $args = array() ) {
        global $wpdb;
        $defaults = array( 'status' => '', 'limit' => 50, 'offset' => 0, 'orderby' => 'scheduled_at', 'order' => 'ASC' );
        $args = wp_parse_args( $args, $defaults );
        $where = '1=1';
        if ( ! empty( $args['status'] ) ) {
            $where .= $wpdb->prepare( ' AND status = %s', $args['status'] );
        }
        $orderby = preg_replace( '/[^a-z_]/', '', $args['orderby'] );
        $order   = strtoupper( $args['order'] ) === 'DESC' ? 'DESC' : 'ASC';
        $sql = "SELECT m.*, l.name AS lead_name, l.phone AS lead_phone, l.search_id
                FROM " . NVL_DB::table( 'messages' ) . " m
                LEFT JOIN " . NVL_DB::table( 'leads' ) . " l ON l.id = m.lead_id
                WHERE {$where}
                ORDER BY m.{$orderby} {$order}
                LIMIT %d OFFSET %d";
        return $wpdb->get_results( $wpdb->prepare( $sql, intval( $args['limit'] ), intval( $args['offset'] ) ) );
    }

    public static function delete_message( $id ) {
        global $wpdb;
        $wpdb->delete( NVL_DB::table( 'messages' ), array( 'id' => intval( $id ) ), array( '%d' ) );
    }

    public static function reset_failed_to_queue() {
        global $wpdb;
        $wpdb->query( "UPDATE " . NVL_DB::table( 'messages' ) . " SET status = 'queued', send_attempts = 0, last_error = NULL WHERE status = 'failed'" );
    }

    public static function bulk_enqueue( $lead_ids, $template_id = 0 ) {
        $ok = 0; $skipped = 0; $errors = array();
        foreach ( $lead_ids as $lid ) {
            $r = self::enqueue_lead( intval( $lid ), $template_id );
            if ( is_wp_error( $r ) ) {
                $skipped++;
                $errors[] = $lid . ': ' . $r->get_error_message();
            } else {
                $ok++;
            }
        }
        return array( 'ok' => $ok, 'skipped' => $skipped, 'errors' => $errors );
    }
}
