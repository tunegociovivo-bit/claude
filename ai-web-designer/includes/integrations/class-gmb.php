<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

class AIWD_Integration_GMB {

    public static function maps_embed( $place_id_or_address, $api_key = '' ) {
        $api_key = $api_key ?: aiwd_get_option( 'maps_api_key' );
        $q = rawurlencode( $place_id_or_address );
        $src = "https://www.google.com/maps/embed/v1/place?key={$api_key}&q={$q}";
        return '<iframe width="100%" height="400" style="border:0" loading="lazy" allowfullscreen src="' . esc_url( $src ) . '"></iframe>';
    }

    public static function fetch_business_info( $place_id ) {
        $key = aiwd_get_option( 'gmb_api_key' );
        if ( ! $key || ! $place_id ) return new WP_Error( 'aiwd_no_gmb', 'Config GMB incompleta' );
        $url = add_query_arg( [
            'place_id' => $place_id,
            'key'      => $key,
            'fields'   => 'name,formatted_address,formatted_phone_number,opening_hours,rating,user_ratings_total,website',
        ], 'https://maps.googleapis.com/maps/api/place/details/json' );
        $resp = wp_remote_get( $url, [ 'timeout' => 20 ] );
        if ( is_wp_error( $resp ) ) return $resp;
        return json_decode( wp_remote_retrieve_body( $resp ), true );
    }
}
