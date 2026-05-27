<?php
/**
 * Datos para el dashboard de analytics.
 */

if ( ! defined( 'WPINC' ) ) {
    die;
}

class NVL_Analytics {

    public static function funnel() {
        global $wpdb;
        $leads_table = NVL_DB::table( 'leads' );
        return array(
            'total'      => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$leads_table}" ),
            'with_phone' => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$leads_table} WHERE phone IS NOT NULL AND phone <> ''" ),
            'with_wa'    => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$leads_table} WHERE has_whatsapp = 1" ),
            'contacted'  => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$leads_table} WHERE contact_status = 'contacted'" ),
            'responded'  => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$leads_table} WHERE contact_status = 'responded'" ),
            'client'     => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$leads_table} WHERE contact_status = 'client'" ),
            'discarded'  => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$leads_table} WHERE contact_status = 'discarded'" ),
        );
    }

    public static function score_distribution() {
        global $wpdb;
        $leads_table = NVL_DB::table( 'leads' );
        $rows = $wpdb->get_results(
            "SELECT
                SUM(CASE WHEN score >= 80 THEN 1 ELSE 0 END) AS s80,
                SUM(CASE WHEN score >= 60 AND score < 80 THEN 1 ELSE 0 END) AS s60,
                SUM(CASE WHEN score >= 40 AND score < 60 THEN 1 ELSE 0 END) AS s40,
                SUM(CASE WHEN score >= 20 AND score < 40 THEN 1 ELSE 0 END) AS s20,
                SUM(CASE WHEN score < 20 THEN 1 ELSE 0 END) AS s0
             FROM {$leads_table} WHERE score IS NOT NULL"
        );
        $r = $rows ? $rows[0] : null;
        return array(
            '80-100' => $r ? (int) $r->s80 : 0,
            '60-79'  => $r ? (int) $r->s60 : 0,
            '40-59'  => $r ? (int) $r->s40 : 0,
            '20-39'  => $r ? (int) $r->s20 : 0,
            '0-19'   => $r ? (int) $r->s0  : 0,
        );
    }

    public static function urgency_breakdown() {
        global $wpdb;
        $leads_table = NVL_DB::table( 'leads' );
        $rows = $wpdb->get_results( "SELECT urgency, COUNT(*) AS n FROM {$leads_table} WHERE urgency IS NOT NULL GROUP BY urgency" );
        $out = array( 'critica' => 0, 'alta' => 0, 'media' => 0, 'baja' => 0, 'descartar' => 0 );
        foreach ( $rows as $r ) {
            $out[ $r->urgency ] = (int) $r->n;
        }
        return $out;
    }

    public static function messages_last_30_days() {
        global $wpdb;
        $m = NVL_DB::table( 'messages' );
        $start = date( 'Y-m-d', strtotime( '-29 days', current_time( 'timestamp' ) ) );
        $rows  = $wpdb->get_results( $wpdb->prepare(
            "SELECT DATE(sent_at) AS d, COUNT(*) AS n FROM {$m} WHERE status = 'sent' AND sent_at >= %s GROUP BY DATE(sent_at) ORDER BY d ASC",
            $start
        ) );
        $by = array();
        foreach ( $rows as $r ) $by[ $r->d ] = (int) $r->n;

        $out = array();
        for ( $i = 29; $i >= 0; $i-- ) {
            $d = date( 'Y-m-d', strtotime( "-{$i} days", current_time( 'timestamp' ) ) );
            $out[ $d ] = isset( $by[ $d ] ) ? $by[ $d ] : 0;
        }
        return $out;
    }

    public static function responses_last_30_days() {
        global $wpdb;
        $i = NVL_DB::table( 'inbox' );
        $start = date( 'Y-m-d', strtotime( '-29 days', current_time( 'timestamp' ) ) );
        $rows  = $wpdb->get_results( $wpdb->prepare(
            "SELECT DATE(received_at) AS d, COUNT(*) AS n FROM {$i} WHERE received_at >= %s GROUP BY DATE(received_at) ORDER BY d ASC",
            $start
        ) );
        $by = array();
        foreach ( $rows as $r ) $by[ $r->d ] = (int) $r->n;
        $out = array();
        for ( $k = 29; $k >= 0; $k-- ) {
            $d = date( 'Y-m-d', strtotime( "-{$k} days", current_time( 'timestamp' ) ) );
            $out[ $d ] = isset( $by[ $d ] ) ? $by[ $d ] : 0;
        }
        return $out;
    }

    public static function top_provinces( $limit = 10 ) {
        global $wpdb;
        return $wpdb->get_results( $wpdb->prepare(
            "SELECT province, COUNT(*) AS leads,
                    SUM(CASE WHEN contact_status = 'responded' THEN 1 ELSE 0 END) AS responded,
                    SUM(CASE WHEN contact_status = 'client' THEN 1 ELSE 0 END) AS clients
             FROM " . NVL_DB::table( 'leads' ) . "
             WHERE province IS NOT NULL AND province <> ''
             GROUP BY province
             ORDER BY responded DESC, leads DESC
             LIMIT %d",
            $limit
        ) );
    }

    public static function inbox_classification_breakdown() {
        global $wpdb;
        $rows = $wpdb->get_results( "SELECT classification, COUNT(*) AS n FROM " . NVL_DB::table( 'inbox' ) . " WHERE classification IS NOT NULL GROUP BY classification" );
        $out = array();
        foreach ( $rows as $r ) $out[ $r->classification ] = (int) $r->n;
        return $out;
    }

    public static function response_rate() {
        $f = self::funnel();
        if ( $f['contacted'] === 0 ) return 0;
        return round( ( $f['responded'] / max( 1, $f['contacted'] ) ) * 100, 1 );
    }

    public static function client_rate() {
        $f = self::funnel();
        if ( $f['responded'] === 0 ) return 0;
        return round( ( $f['client'] / max( 1, $f['responded'] ) ) * 100, 1 );
    }
}
