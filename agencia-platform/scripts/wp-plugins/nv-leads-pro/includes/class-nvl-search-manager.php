<?php
/**
 * Orquestador de busqueda.
 */

if ( ! defined( 'WPINC' ) ) {
    die;
}

class NVL_Search_Manager {

    public static function start_search( $keyword, $location, $scope = 'custom' ) {
        $keyword  = trim( $keyword );
        $location = trim( $location );
        if ( $keyword === '' ) {
            return new WP_Error( 'invalid_input', 'La palabra clave es obligatoria.' );
        }
        if ( $scope === 'spain' ) {
            $provinces = NVL_Spain_Provinces::all();
            $total     = count( $provinces );
            $location  = 'Toda España';
        } else {
            $total = 1;
        }
        $search_id = NVL_DB::create_search( array(
            'keyword'         => $keyword,
            'location'        => $location,
            'scope'           => $scope,
            'total_provinces' => $total,
        ) );
        wp_schedule_single_event( time() + 5, 'nvl_process_pending_searches' );
        return $search_id;
    }

    public static function process_batch( $search ) {
        $settings = get_option( 'nvl_settings', array() );
        $batch    = isset( $settings['batch_size'] ) ? max( 1, intval( $settings['batch_size'] ) ) : 5;

        NVL_DB::update_search( $search->id, array( 'status' => 'processing' ) );

        $places = new NVL_Google_Places();
        if ( ! $places->has_api_key() ) {
            NVL_DB::update_search( $search->id, array(
                'status'        => 'error',
                'error_message' => 'API key de Google Places no configurada.',
            ) );
            return;
        }

        if ( $search->scope === 'spain' ) {
            $all_provinces = NVL_Spain_Provinces::all();
            $start         = intval( $search->processed_provinces );
            $end           = min( $start + $batch, count( $all_provinces ) );
            for ( $i = $start; $i < $end; $i++ ) {
                $province = $all_provinces[ $i ];
                self::process_province( $search, $places, $province );
                NVL_DB::update_search( $search->id, array(
                    'processed_provinces' => $i + 1,
                    'current_province'    => $province['name'],
                ) );
            }
            if ( $end >= count( $all_provinces ) ) {
                self::finalize_search( $search->id );
            }
        } else {
            $province = NVL_Spain_Provinces::find( $search->location );
            if ( ! $province ) {
                $province = array( 'name' => $search->location, 'lat' => null, 'lng' => null );
            }
            self::process_province( $search, $places, $province );
            NVL_DB::update_search( $search->id, array( 'processed_provinces' => 1 ) );
            self::finalize_search( $search->id );
        }
    }

    private static function process_province( $search, NVL_Google_Places $places, $province ) {
        $opts = array();
        if ( ! empty( $province['lat'] ) && ! empty( $province['lng'] ) ) {
            $opts['lat']      = $province['lat'];
            $opts['lng']      = $province['lng'];
            $opts['radius_m'] = 50000;
        }

        $results = $places->text_search( $search->keyword, $province['name'] . ', España', $opts );
        if ( is_wp_error( $results ) ) {
            error_log( '[NVL] Error en text_search para ' . $province['name'] . ': ' . $results->get_error_message() );
            return;
        }

        $settings      = get_option( 'nvl_settings', array() );
        $fetch_details = ! empty( $settings['fetch_details'] );
        $competitor_n  = isset( $settings['competitor_count'] ) ? intval( $settings['competitor_count'] ) : 3;

        $validate_kw    = ! empty( $settings['validate_keyword_match'] );
        $ai_validator   = null;
        if ( $validate_kw && class_exists( 'NVL_AI_Client' ) ) {
            $ai_validator = new NVL_AI_Client();
            if ( ! $ai_validator->is_configured() ) $ai_validator = null;
        }

        $inserted_ids = array();
        foreach ( $results as $idx => $r ) {
            $position = $idx + 1;
            $lead_id  = self::save_lead_from_result( $search, $r, $position, $province['name'] );
            if ( $lead_id ) {
                $inserted_ids[ $position ] = $lead_id;
                if ( $fetch_details && isset( $r['place_id'] ) ) {
                    $details = $places->place_details( $r['place_id'] );
                    if ( ! is_wp_error( $details ) && is_array( $details ) ) {
                        self::merge_details_into_lead( $lead_id, $details );
                    }
                }
                // Validacion semantica IA: descarta leads que no encajan con la keyword.
                if ( $ai_validator ) {
                    global $wpdb;
                    $fresh = $wpdb->get_row( $wpdb->prepare(
                        "SELECT name, formatted_address, category, types, reviews_json FROM {$wpdb->prefix}nvl_leads WHERE id = %d",
                        $lead_id
                    ), ARRAY_A );
                    if ( $fresh ) {
                        $verdict = $ai_validator->validate_keyword_match( $search->keyword, $fresh );
                        if ( ! is_wp_error( $verdict ) && empty( $verdict['match'] ) ) {
                            $reason = isset( $verdict['reason'] ) ? mb_substr( $verdict['reason'], 0, 280 ) : '';
                            $wpdb->update(
                                "{$wpdb->prefix}nvl_leads",
                                array(
                                    'contact_status' => 'excluded',
                                    'notes'          => 'IA descarte: no encaja con "' . $search->keyword . '". ' . $reason,
                                ),
                                array( 'id' => $lead_id )
                            );
                        }
                    }
                }
            }
        }

        foreach ( $inserted_ids as $position => $lead_id ) {
            if ( $position === 1 ) continue;
            NVL_DB::clear_competitors_for_lead( $lead_id );
            $start_idx = max( 0, $position - 1 - $competitor_n );
            $end_idx   = $position - 1;
            for ( $i = $start_idx; $i < $end_idx; $i++ ) {
                if ( ! isset( $results[ $i ] ) ) continue;
                $c = $results[ $i ];
                NVL_DB::insert_competitor( array(
                    'lead_id'             => $lead_id,
                    'competitor_place_id' => isset( $c['place_id'] ) ? $c['place_id'] : '',
                    'competitor_name'     => isset( $c['name'] ) ? $c['name'] : '',
                    'competitor_position' => $i + 1,
                    'competitor_rating'   => isset( $c['rating'] ) ? floatval( $c['rating'] ) : null,
                    'competitor_reviews'  => isset( $c['user_ratings_total'] ) ? intval( $c['user_ratings_total'] ) : 0,
                ) );
            }
        }

        $current = (int) $search->total_results;
        NVL_DB::update_search( $search->id, array( 'total_results' => $current + count( $results ) ) );
        $search->total_results = $current + count( $results );

        foreach ( $inserted_ids as $lead_id ) {
            if ( class_exists( 'NVL_Lead_Scorer' ) ) {
                NVL_Lead_Scorer::score_and_persist( $lead_id );
            }
        }
    }

    private static function save_lead_from_result( $search, $r, $position, $province_name ) {
        if ( empty( $r['place_id'] ) || empty( $r['name'] ) ) return 0;
        $data = array(
            'search_id'         => $search->id,
            'place_id'          => $r['place_id'],
            'name'              => $r['name'],
            'formatted_address' => isset( $r['formatted_address'] ) ? $r['formatted_address'] : null,
            'province'          => $province_name,
            'rating'            => isset( $r['rating'] ) ? floatval( $r['rating'] ) : null,
            'reviews_count'     => isset( $r['user_ratings_total'] ) ? intval( $r['user_ratings_total'] ) : 0,
            'price_level'       => isset( $r['price_level'] ) ? intval( $r['price_level'] ) : null,
            'category'          => isset( $r['types'][0] ) ? $r['types'][0] : null,
            'types'             => isset( $r['types'] ) ? $r['types'] : array(),
            'latitude'          => isset( $r['geometry']['location']['lat'] ) ? floatval( $r['geometry']['location']['lat'] ) : null,
            'longitude'         => isset( $r['geometry']['location']['lng'] ) ? floatval( $r['geometry']['location']['lng'] ) : null,
            'position'          => $position,
            'business_status'   => isset( $r['business_status'] ) ? $r['business_status'] : null,
            'raw_data'          => $r,
        );
        return NVL_DB::insert_lead( $data );
    }

    private static function merge_details_into_lead( $lead_id, $details ) {
        $update = array();
        if ( ! empty( $details['formatted_phone_number'] ) )    $update['phone'] = $details['formatted_phone_number'];
        if ( ! empty( $details['international_phone_number'] ) ) $update['international_phone'] = $details['international_phone_number'];
        if ( ! empty( $details['website'] ) ) $update['website'] = $details['website'];
        if ( ! empty( $details['url'] ) ) $update['gmb_url'] = $details['url'];
        if ( isset( $details['rating'] ) ) $update['rating'] = floatval( $details['rating'] );
        if ( isset( $details['user_ratings_total'] ) ) $update['reviews_count'] = intval( $details['user_ratings_total'] );

        if ( ! empty( $details['reviews'] ) && is_array( $details['reviews'] ) ) {
            $update['reviews_json'] = wp_json_encode( $details['reviews'] );
            if ( class_exists( 'NVL_Lead_Scorer' ) ) {
                $polarity = NVL_Lead_Scorer::compute_polarity( $details['reviews'] );
                if ( $polarity['positive'] !== null ) $update['positive_pct'] = $polarity['positive'];
                if ( $polarity['negative'] !== null ) $update['negative_pct'] = $polarity['negative'];
                if ( $polarity['neutral']  !== null ) $update['neutral_pct']  = $polarity['neutral'];
            }
        }
        if ( ! empty( $update ) ) {
            NVL_DB::update_lead_details( $lead_id, $update );
        }
        if ( class_exists( 'NVL_Lead_Scorer' ) ) {
            NVL_Lead_Scorer::score_and_persist( $lead_id );
        }
    }

    private static function finalize_search( $search_id ) {
        NVL_DB::update_search( $search_id, array(
            'status'       => 'completed',
            'completed_at' => current_time( 'mysql' ),
        ) );
    }
}
