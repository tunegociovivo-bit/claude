<?php
/**
 * Handler de WP-Cron: procesa la siguiente busqueda pendiente en bloques.
 */

if ( ! defined( 'WPINC' ) ) {
    die;
}

class NVL_Cron {

    /**
     * Procesa la cola de envio de WhatsApp. Envia un unico mensaje por tick
     * para respetar los delays y el ritmo humano.
     */
    public static function process_send_queue() {
        $lock_key = 'nvl_send_lock';
        if ( get_transient( $lock_key ) ) {
            return;
        }
        set_transient( $lock_key, 1, 2 * MINUTE_IN_SECONDS );

        try {
            $msg = NVL_Send_Queue::next_ready_message();
            if ( $msg ) {
                NVL_Send_Queue::send_message( $msg );
            }
        } catch ( Exception $e ) {
            error_log( '[NVL] Excepcion en cola de envio: ' . $e->getMessage() );
        } finally {
            delete_transient( $lock_key );
        }
    }

    public static function process_pending_searches() {
        $lock_key = 'nvl_cron_lock';
        if ( get_transient( $lock_key ) ) {
            return;
        }
        set_transient( $lock_key, 1, 5 * MINUTE_IN_SECONDS );

        try {
            $search = NVL_DB::get_next_pending_search();
            if ( $search ) {
                NVL_Search_Manager::process_batch( $search );
                $refreshed = NVL_DB::get_search( $search->id );
                if ( $refreshed && in_array( $refreshed->status, array( 'pending', 'processing' ), true ) ) {
                    wp_schedule_single_event( time() + 15, 'nvl_process_pending_searches' );
                }
            }
        } catch ( Exception $e ) {
            error_log( '[NVL] Excepcion en cron: ' . $e->getMessage() );
        } finally {
            delete_transient( $lock_key );
        }
    }
}
