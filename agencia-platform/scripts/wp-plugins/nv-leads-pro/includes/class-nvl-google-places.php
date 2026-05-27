<?php
/**
 * Cliente de Google Places API (New v1).
 *
 * Docs: https://developers.google.com/maps/documentation/places/web-service/text-search
 *       https://developers.google.com/maps/documentation/places/web-service/place-details
 *
 * Esta version usa la Places API "New" (places.googleapis.com/v1) y mapea la
 * respuesta al formato esperado por el resto del plugin (compatible con la
 * estructura legacy: place_id, name, formatted_address, rating, etc.).
 */

if ( ! defined( 'WPINC' ) ) {
    die;
}

class NVL_Google_Places {

    const ENDPOINT_SEARCH_NEW  = 'https://places.googleapis.com/v1/places:searchText';
    const ENDPOINT_DETAILS_NEW = 'https://places.googleapis.com/v1/places/';

    private $api_key;
    private $settings;

    public function __construct( $api_key = null ) {
        $this->settings = get_option( 'nvl_settings', array() );
        $this->api_key  = $api_key ? $api_key : ( isset( $this->settings['google_api_key'] ) ? $this->settings['google_api_key'] : '' );
    }

    public function has_api_key() {
        return ! empty( $this->api_key );
    }

    /**
     * Text Search.
     *
     * @param string $keyword
     * @param string $location
     * @param array  $opts  lat, lng, radius_m
     * @return array|WP_Error Lista de resultados en formato legacy.
     */
    public function text_search( $keyword, $location, $opts = array() ) {
        if ( ! $this->has_api_key() ) {
            return new WP_Error( 'no_api_key', 'No se ha configurado la API key de Google Places.' );
        }

        $query = trim( $keyword . ' en ' . $location );

        $body = array(
            'textQuery'    => $query,
            'languageCode' => isset( $this->settings['language'] ) ? $this->settings['language'] : 'es',
            'regionCode'   => 'ES',
            'pageSize'     => 20,
        );

        if ( ! empty( $opts['lat'] ) && ! empty( $opts['lng'] ) ) {
            $body['locationBias'] = array(
                'circle' => array(
                    'center' => array(
                        'latitude'  => floatval( $opts['lat'] ),
                        'longitude' => floatval( $opts['lng'] ),
                    ),
                    'radius' => isset( $opts['radius_m'] ) ? intval( $opts['radius_m'] ) : 50000,
                ),
            );
        }

        $field_mask = implode( ',', array(
            'places.id',
            'places.displayName',
            'places.formattedAddress',
            'places.rating',
            'places.userRatingCount',
            'places.priceLevel',
            'places.types',
            'places.location',
            'places.businessStatus',
            'places.googleMapsUri',
            'places.websiteUri',
            'places.nationalPhoneNumber',
            'places.internationalPhoneNumber',
            'nextPageToken',
        ) );

        $all = array();
        $page_token = null;
        $max_pages  = 3;

        for ( $page = 0; $page < $max_pages; $page++ ) {
            if ( $page_token ) {
                $body['pageToken'] = $page_token;
                // El nuevo endpoint tambien requiere un pequeño delay para que pageToken sea valido.
                sleep( 2 );
            }

            $resp = wp_remote_post( self::ENDPOINT_SEARCH_NEW, array(
                'timeout' => 30,
                'headers' => array(
                    'Content-Type'     => 'application/json',
                    'X-Goog-Api-Key'   => $this->api_key,
                    'X-Goog-FieldMask' => $field_mask,
                ),
                'body' => wp_json_encode( $body ),
            ) );

            if ( is_wp_error( $resp ) ) return $resp;

            $code = (int) wp_remote_retrieve_response_code( $resp );
            $raw  = wp_remote_retrieve_body( $resp );
            $data = json_decode( $raw, true );

            if ( $code >= 400 ) {
                $msg = 'HTTP ' . $code;
                if ( is_array( $data ) && isset( $data['error']['message'] ) ) {
                    $msg = $data['error']['message'];
                }
                return new WP_Error( 'places_error', $msg, $data );
            }

            if ( ! is_array( $data ) ) {
                return new WP_Error( 'invalid_response', 'Respuesta invalida de Google Places (New).' );
            }

            if ( ! empty( $data['places'] ) && is_array( $data['places'] ) ) {
                foreach ( $data['places'] as $p ) {
                    $all[] = self::map_place_to_legacy( $p );
                }
            }

            $page_token = isset( $data['nextPageToken'] ) ? $data['nextPageToken'] : null;
            if ( ! $page_token ) break;
        }

        return $all;
    }

    /**
     * Place Details.
     */
    public function place_details( $place_id ) {
        if ( ! $this->has_api_key() ) {
            return new WP_Error( 'no_api_key', 'No se ha configurado la API key.' );
        }

        $field_mask = implode( ',', array(
            'id', 'displayName', 'formattedAddress', 'nationalPhoneNumber',
            'internationalPhoneNumber', 'websiteUri', 'googleMapsUri',
            'businessStatus', 'regularOpeningHours', 'rating', 'userRatingCount',
            'types', 'location', 'addressComponents', 'priceLevel',
            'editorialSummary', 'reviews',
        ) );

        $url = self::ENDPOINT_DETAILS_NEW . rawurlencode( $place_id );

        $resp = wp_remote_get( $url, array(
            'timeout' => 30,
            'headers' => array(
                'X-Goog-Api-Key'   => $this->api_key,
                'X-Goog-FieldMask' => $field_mask,
            ),
        ) );

        if ( is_wp_error( $resp ) ) return $resp;

        $code = (int) wp_remote_retrieve_response_code( $resp );
        $data = json_decode( wp_remote_retrieve_body( $resp ), true );

        if ( $code >= 400 ) {
            $msg = 'HTTP ' . $code;
            if ( is_array( $data ) && isset( $data['error']['message'] ) ) {
                $msg = $data['error']['message'];
            }
            return new WP_Error( 'details_error', $msg, $data );
        }

        if ( ! is_array( $data ) ) {
            return new WP_Error( 'invalid_response', 'Respuesta invalida de Place Details (New).' );
        }

        return self::map_details_to_legacy( $data );
    }

    /**
     * Adapta una entrada de la respuesta nueva al formato que el resto del plugin espera.
     */
    private static function map_place_to_legacy( $p ) {
        $out = array(
            'place_id'           => isset( $p['id'] ) ? $p['id'] : '',
            'name'               => isset( $p['displayName']['text'] ) ? $p['displayName']['text'] : '',
            'formatted_address'  => isset( $p['formattedAddress'] ) ? $p['formattedAddress'] : '',
            'rating'             => isset( $p['rating'] ) ? floatval( $p['rating'] ) : null,
            'user_ratings_total' => isset( $p['userRatingCount'] ) ? intval( $p['userRatingCount'] ) : 0,
            'price_level'        => isset( $p['priceLevel'] ) ? self::price_level_to_int( $p['priceLevel'] ) : null,
            'types'              => isset( $p['types'] ) ? $p['types'] : array(),
            'business_status'    => isset( $p['businessStatus'] ) ? $p['businessStatus'] : null,
        );
        if ( isset( $p['location']['latitude'] ) ) {
            $out['geometry'] = array(
                'location' => array(
                    'lat' => floatval( $p['location']['latitude'] ),
                    'lng' => floatval( $p['location']['longitude'] ),
                ),
            );
        }
        return $out;
    }

    private static function map_details_to_legacy( $p ) {
        $out = self::map_place_to_legacy( $p );

        if ( ! empty( $p['nationalPhoneNumber'] ) )      $out['formatted_phone_number'] = $p['nationalPhoneNumber'];
        if ( ! empty( $p['internationalPhoneNumber'] ) ) $out['international_phone_number'] = $p['internationalPhoneNumber'];
        if ( ! empty( $p['websiteUri'] ) )               $out['website'] = $p['websiteUri'];
        if ( ! empty( $p['googleMapsUri'] ) )            $out['url'] = $p['googleMapsUri'];

        if ( ! empty( $p['reviews'] ) && is_array( $p['reviews'] ) ) {
            $reviews = array();
            foreach ( $p['reviews'] as $r ) {
                $reviews[] = array(
                    'rating'                  => isset( $r['rating'] ) ? intval( $r['rating'] ) : null,
                    'text'                    => isset( $r['text']['text'] ) ? $r['text']['text'] : ( isset( $r['originalText']['text'] ) ? $r['originalText']['text'] : '' ),
                    'author_name'             => isset( $r['authorAttribution']['displayName'] ) ? $r['authorAttribution']['displayName'] : '',
                    'time'                    => isset( $r['publishTime'] ) ? $r['publishTime'] : null,
                    'relative_time_description'=> isset( $r['relativePublishTimeDescription'] ) ? $r['relativePublishTimeDescription'] : '',
                );
            }
            $out['reviews'] = $reviews;
        }
        return $out;
    }

    private static function price_level_to_int( $level ) {
        $map = array(
            'PRICE_LEVEL_FREE'      => 0,
            'PRICE_LEVEL_INEXPENSIVE'=> 1,
            'PRICE_LEVEL_MODERATE'  => 2,
            'PRICE_LEVEL_EXPENSIVE' => 3,
            'PRICE_LEVEL_VERY_EXPENSIVE' => 4,
        );
        return isset( $map[ $level ] ) ? $map[ $level ] : null;
    }

    public function test_api_key() {
        $r = $this->text_search( 'restaurante', 'Madrid', array() );
        if ( is_wp_error( $r ) ) return $r;
        return count( $r );
    }
}
