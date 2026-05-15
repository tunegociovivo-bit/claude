<?php
/**
 * Utilidades de calidad de datos: deduplicación y validación batch de WhatsApp.
 */

if ( ! defined( 'WPINC' ) ) {
    die;
}

class NVL_Data_Quality {

    /**
     * Devuelve grupos de leads duplicados (mismo place_id en distintas búsquedas).
     */
    public static function find_duplicate_groups( $limit = 50 ) {
        global $wpdb;
        $sql = "SELECT place_id, GROUP_CONCAT(id) AS ids, COUNT(*) AS n
                FROM " . NVL_DB::table( 'leads' ) . "
                GROUP BY place_id
                HAVING n > 1
                ORDER BY n DESC
                LIMIT %d";
        return $wpdb->get_results( $wpdb->prepare( $sql, intval( $limit ) ) );
    }

    /**
     * Valida en batch hasta N leads cuyo has_whatsapp aún es NULL.
     */
    public static function validate_pending_whatsapp( $limit = 50 ) {
        global $wpdb;
        $leads = $wpdb->get_results( $wpdb->prepare(
            "SELECT id, phone FROM " . NVL_DB::table( 'leads' ) . "
             WHERE has_whatsapp IS NULL AND phone IS NOT NULL AND phone <> ''
             LIMIT %d",
            $limit
        ) );
        if ( empty( $leads ) ) return array( 'checked' => 0, 'with_wa' => 0, 'without_wa' => 0 );

        $api = new NVL_Evolution_API();
        if ( ! $api->is_configured() ) {
            return new WP_Error( 'not_configured', 'Evolution API no configurada.' );
        }
        $settings = get_option( 'nvl_settings', array() );
        $cc       = isset( $settings['whatsapp_country_code'] ) ? $settings['whatsapp_country_code'] : '34';

        $with = 0; $without = 0;
        $numbers_map = array();
        $numbers = array();
        foreach ( $leads as $l ) {
            $n = NVL_WhatsApp::normalize_phone( $l->phone, $cc );
            if ( ! $n ) continue;
            $numbers_map[ $n ] = $l->id;
            $numbers[] = $n;
        }
        if ( empty( $numbers ) ) return array( 'checked' => 0, 'with_wa' => 0, 'without_wa' => 0 );

        $res = $api->check_whatsapp_numbers( $numbers );
        if ( is_wp_error( $res ) ) return $res;

        $now = current_time( 'mysql' );
        if ( is_array( $res ) ) {
            foreach ( $res as $row ) {
                $num = isset( $row['number'] ) ? $row['number'] : '';
                $exists = ! empty( $row['exists'] ) || ! empty( $row['jid'] );
                if ( $num && isset( $numbers_map[ $num ] ) ) {
                    $lead_id = $numbers_map[ $num ];
                    NVL_DB::update_lead_details( $lead_id, array(
                        'has_whatsapp'        => $exists ? 1 : 0,
                        'whatsapp_checked_at' => $now,
                    ) );
                    if ( $exists ) $with++; else $without++;
                }
            }
        }
        return array( 'checked' => count( $numbers ), 'with_wa' => $with, 'without_wa' => $without );
    }

    /**
     * Recalcula score de todos los leads (útil tras cambiar el algoritmo).
     */
    public static function rescore_all( $limit = 500 ) {
        global $wpdb;
        $ids = $wpdb->get_col( $wpdb->prepare( "SELECT id FROM " . NVL_DB::table( 'leads' ) . " ORDER BY id ASC LIMIT %d", intval( $limit ) ) );
        $n = 0;
        foreach ( $ids as $id ) {
            NVL_Lead_Scorer::score_and_persist( intval( $id ) );
            $n++;
        }
        return $n;
    }
}
