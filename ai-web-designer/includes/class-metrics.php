<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

/**
 * Motor de métricas / KPIs de productividad de la agencia.
 */
class AIWD_Metrics {

    public static function snapshot( $from = null, $to = null ) {
        $from = $from ?: strtotime( '-30 days' );
        $to   = $to   ?: time();

        return [
            'range'                => [ 'from' => gmdate( 'Y-m-d', $from ), 'to' => gmdate( 'Y-m-d', $to ) ],
            'total_projects'       => self::count_projects(),
            'by_status'            => self::projects_by_status(),
            'created_in_range'     => self::created_in_range( $from, $to ),
            'published_in_range'   => self::published_in_range( $from, $to ),
            'avg_delivery_days'    => self::avg_delivery_days(),
            'ai_cost_total'        => self::ai_cost_total(),
            'ai_cost_by_month'     => self::ai_cost_by_month(),
            'ai_cost_by_user'      => self::ai_cost_by_user(),
            'ai_cost_by_operation' => self::ai_cost_by_operation(),
            'top_presets'          => self::top_presets(),
            'top_qa_fails'         => self::top_qa_fails(),
            'projects_per_designer'=> self::projects_per_designer(),
            'recent_activity'      => self::recent_activity(),
        ];
    }

    public static function count_projects() {
        $c = wp_count_posts( AIWD_CPT_Project::POST_TYPE );
        $total = 0;
        foreach ( (array) $c as $n ) $total += (int) $n;
        return $total;
    }

    public static function projects_by_status() {
        global $wpdb;
        $rows = $wpdb->get_results( $wpdb->prepare(
            "SELECT pm.meta_value as status, COUNT(*) as n
             FROM {$wpdb->postmeta} pm
             INNER JOIN {$wpdb->posts} p ON p.ID = pm.post_id
             WHERE pm.meta_key = %s AND p.post_type = %s AND p.post_status != 'trash'
             GROUP BY pm.meta_value",
            '_aiwd_status', AIWD_CPT_Project::POST_TYPE
        ) );
        $out = [];
        foreach ( $rows as $r ) $out[ $r->status ?: 'unknown' ] = (int) $r->n;
        return $out;
    }

    public static function created_in_range( $from, $to ) {
        global $wpdb;
        return (int) $wpdb->get_var( $wpdb->prepare(
            "SELECT COUNT(*) FROM {$wpdb->posts}
             WHERE post_type = %s AND post_status != 'trash'
               AND post_date >= %s AND post_date <= %s",
            AIWD_CPT_Project::POST_TYPE,
            gmdate( 'Y-m-d H:i:s', $from ),
            gmdate( 'Y-m-d H:i:s', $to )
        ) );
    }

    public static function published_in_range( $from, $to ) {
        global $wpdb;
        // Cuenta proyectos cuyo último guardado de status puso 'published' en el rango.
        return (int) $wpdb->get_var( $wpdb->prepare(
            "SELECT COUNT(DISTINCT pm.post_id) FROM {$wpdb->postmeta} pm
             INNER JOIN {$wpdb->posts} p ON p.ID = pm.post_id
             WHERE pm.meta_key = '_aiwd_status' AND pm.meta_value = 'published'
               AND p.post_type = %s AND p.post_modified >= %s AND p.post_modified <= %s",
            AIWD_CPT_Project::POST_TYPE,
            gmdate( 'Y-m-d H:i:s', $from ),
            gmdate( 'Y-m-d H:i:s', $to )
        ) );
    }

    /**
     * Tiempo medio en días desde la creación hasta el último modified de
     * proyectos cuyo status = 'published'.
     */
    public static function avg_delivery_days() {
        global $wpdb;
        $row = $wpdb->get_var( $wpdb->prepare(
            "SELECT AVG( TIMESTAMPDIFF(HOUR, p.post_date, p.post_modified) ) / 24
             FROM {$wpdb->posts} p
             INNER JOIN {$wpdb->postmeta} pm ON pm.post_id = p.ID
             WHERE p.post_type = %s AND pm.meta_key = '_aiwd_status' AND pm.meta_value = 'published'",
            AIWD_CPT_Project::POST_TYPE
        ) );
        return $row !== null ? round( (float) $row, 1 ) : 0;
    }

    public static function ai_cost_total() {
        global $wpdb;
        $t = AIWD_Database::table( 'ai_logs' );
        return (int) $wpdb->get_var( "SELECT COALESCE(SUM(cost_cents),0) FROM $t" );
    }

    public static function ai_cost_by_month() {
        global $wpdb;
        $t = AIWD_Database::table( 'ai_logs' );
        $rows = $wpdb->get_results(
            "SELECT DATE_FORMAT(created_at,'%Y-%m') as month, SUM(cost_cents) as cost, SUM(tokens_in+tokens_out) as tokens, COUNT(*) as calls
             FROM $t WHERE created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
             GROUP BY DATE_FORMAT(created_at,'%Y-%m') ORDER BY month ASC"
        );
        return array_map( function( $r ) {
            return [
                'month'  => $r->month,
                'cost'   => round( $r->cost / 100, 2 ),
                'tokens' => (int) $r->tokens,
                'calls'  => (int) $r->calls,
            ];
        }, $rows );
    }

    public static function ai_cost_by_user() {
        global $wpdb;
        $t = AIWD_Database::table( 'ai_logs' );
        // Aproximamos por autor del proyecto vinculado al log
        $rows = $wpdb->get_results( $wpdb->prepare(
            "SELECT u.display_name as user_name, SUM(l.cost_cents) as cost, COUNT(*) as calls
             FROM $t l
             LEFT JOIN {$wpdb->posts} p   ON p.ID = l.project_id
             LEFT JOIN {$wpdb->users} u   ON u.ID = p.post_author
             WHERE l.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
             GROUP BY u.ID ORDER BY cost DESC LIMIT 10"
        ) );
        return array_map( function( $r ) {
            return [ 'user' => $r->user_name ?: '—', 'cost' => round( $r->cost / 100, 2 ), 'calls' => (int) $r->calls ];
        }, $rows );
    }

    public static function ai_cost_by_operation() {
        global $wpdb;
        $t = AIWD_Database::table( 'ai_logs' );
        $rows = $wpdb->get_results(
            "SELECT operation, SUM(cost_cents) as cost, COUNT(*) as calls
             FROM $t WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
             GROUP BY operation ORDER BY cost DESC LIMIT 10"
        );
        return array_map( function( $r ) {
            return [ 'op' => $r->operation, 'cost' => round( $r->cost / 100, 2 ), 'calls' => (int) $r->calls ];
        }, $rows );
    }

    public static function top_presets() {
        global $wpdb;
        $rows = $wpdb->get_results(
            "SELECT meta_value as preset, COUNT(*) as n
             FROM {$wpdb->postmeta} WHERE meta_key = '_aiwd_preset_applied'
             GROUP BY meta_value ORDER BY n DESC LIMIT 10"
        );
        return array_map( fn( $r ) => [ 'preset' => $r->preset, 'count' => (int) $r->n ], $rows );
    }

    public static function top_qa_fails() {
        global $wpdb;
        $rows = $wpdb->get_results(
            "SELECT post_id, meta_value FROM {$wpdb->postmeta}
             WHERE meta_key = %s",
            ARRAY_A
        );
        $rows = $wpdb->get_col( $wpdb->prepare(
            "SELECT meta_value FROM {$wpdb->postmeta} WHERE meta_key = %s",
            AIWD_QA_Checker::META_RESULTS
        ) );
        $counts = [];
        foreach ( $rows as $serialized ) {
            $data = maybe_unserialize( $serialized );
            if ( ! is_array( $data ) ) continue;
            foreach ( $data as $key => $r ) {
                if ( ( $r['status'] ?? '' ) === 'fail' ) {
                    $counts[ $key ] = ( $counts[ $key ] ?? 0 ) + 1;
                }
            }
        }
        arsort( $counts );
        $checks = AIWD_QA_Checker::checks();
        $out = [];
        foreach ( array_slice( $counts, 0, 10, true ) as $k => $n ) {
            $out[] = [ 'key' => $k, 'label' => $checks[ $k ]['label'] ?? $k, 'count' => $n ];
        }
        return $out;
    }

    public static function projects_per_designer() {
        global $wpdb;
        $rows = $wpdb->get_results( $wpdb->prepare(
            "SELECT u.display_name as user, COUNT(*) as n
             FROM {$wpdb->posts} p LEFT JOIN {$wpdb->users} u ON u.ID = p.post_author
             WHERE p.post_type = %s AND p.post_status != 'trash'
             GROUP BY p.post_author ORDER BY n DESC LIMIT 10",
            AIWD_CPT_Project::POST_TYPE
        ) );
        return array_map( fn( $r ) => [ 'user' => $r->user ?: '—', 'count' => (int) $r->n ], $rows );
    }

    public static function recent_activity() {
        global $wpdb;
        $t = AIWD_Database::table( 'approvals' );
        $rows = $wpdb->get_results( "SELECT * FROM $t ORDER BY created_at DESC LIMIT 15" );
        return array_map( function( $r ) {
            return [
                'project' => get_the_title( $r->project_id ),
                'section' => $r->section_key,
                'status'  => $r->status,
                'when'    => $r->created_at,
            ];
        }, $rows );
    }
}
