<?php
/**
 * Helpers de acceso a base de datos.
 */

if ( ! defined( 'WPINC' ) ) {
    die;
}

class NVL_DB {

    public static function table( $name ) {
        global $wpdb;
        return $wpdb->prefix . 'nvl_' . $name;
    }

    /* ------------------- BÚSQUEDAS ------------------- */

    public static function create_search( $data ) {
        global $wpdb;
        $wpdb->insert(
            self::table( 'searches' ),
            array(
                'keyword'         => sanitize_text_field( $data['keyword'] ),
                'location'        => sanitize_text_field( $data['location'] ),
                'scope'           => sanitize_text_field( $data['scope'] ),
                'status'          => 'pending',
                'total_provinces' => isset( $data['total_provinces'] ) ? intval( $data['total_provinces'] ) : 0,
                'created_by'      => get_current_user_id(),
            ),
            array( '%s', '%s', '%s', '%s', '%d', '%d' )
        );
        return $wpdb->insert_id;
    }

    public static function update_search( $id, $data ) {
        global $wpdb;
        $wpdb->update( self::table( 'searches' ), $data, array( 'id' => $id ) );
    }

    public static function get_search( $id ) {
        global $wpdb;
        return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM " . self::table( 'searches' ) . " WHERE id = %d", $id ) );
    }

    public static function get_searches( $args = array() ) {
        global $wpdb;
        $defaults = array(
            'status'  => '',
            'orderby' => 'created_at',
            'order'   => 'DESC',
            'limit'   => 50,
            'offset'  => 0,
        );
        $args = wp_parse_args( $args, $defaults );

        $where = '1=1';
        $params = array();
        if ( ! empty( $args['status'] ) ) {
            $where .= ' AND status = %s';
            $params[] = $args['status'];
        }

        $orderby = preg_replace( '/[^a-z_]/', '', $args['orderby'] );
        $order   = strtoupper( $args['order'] ) === 'ASC' ? 'ASC' : 'DESC';

        $sql = "SELECT * FROM " . self::table( 'searches' ) . " WHERE {$where} ORDER BY {$orderby} {$order} LIMIT %d OFFSET %d";
        $params[] = intval( $args['limit'] );
        $params[] = intval( $args['offset'] );

        return $wpdb->get_results( $wpdb->prepare( $sql, $params ) );
    }

    public static function get_next_pending_search() {
        global $wpdb;
        return $wpdb->get_row( "SELECT * FROM " . self::table( 'searches' ) . " WHERE status IN ('pending','processing') ORDER BY created_at ASC LIMIT 1" );
    }

    public static function delete_search( $id ) {
        global $wpdb;
        // Borrar competidores asociados a leads de esta búsqueda.
        $lead_ids = $wpdb->get_col( $wpdb->prepare( "SELECT id FROM " . self::table( 'leads' ) . " WHERE search_id = %d", $id ) );
        if ( ! empty( $lead_ids ) ) {
            $placeholders = implode( ',', array_fill( 0, count( $lead_ids ), '%d' ) );
            $wpdb->query( $wpdb->prepare( "DELETE FROM " . self::table( 'competitors' ) . " WHERE lead_id IN ($placeholders)", $lead_ids ) );
            $wpdb->query( $wpdb->prepare( "DELETE FROM " . self::table( 'messages' ) . " WHERE lead_id IN ($placeholders)", $lead_ids ) );
        }
        $wpdb->delete( self::table( 'leads' ), array( 'search_id' => $id ), array( '%d' ) );
        $wpdb->delete( self::table( 'searches' ), array( 'id' => $id ), array( '%d' ) );
    }

    /* ------------------- LEADS ------------------- */

    public static function insert_lead( $data ) {
        global $wpdb;
        // Comprobar duplicado por search_id + place_id.
        $existing = $wpdb->get_var( $wpdb->prepare(
            "SELECT id FROM " . self::table( 'leads' ) . " WHERE search_id = %d AND place_id = %s",
            $data['search_id'], $data['place_id']
        ) );
        if ( $existing ) {
            // Actualizamos la posición sólo si es mejor (más baja).
            if ( isset( $data['position'] ) ) {
                $wpdb->query( $wpdb->prepare(
                    "UPDATE " . self::table( 'leads' ) . " SET position = LEAST(position, %d), updated_at = NOW() WHERE id = %d",
                    intval( $data['position'] ), $existing
                ) );
            }
            return intval( $existing );
        }

        // Comprobar si el nombre coincide con un patron de exclusion (clientes existentes).
        $excluded_match = null;
        if ( class_exists( 'NVL_Exclusions' ) ) {
            $excluded_match = NVL_Exclusions::match_lead_name( $data['name'] );
        }

        $wpdb->insert(
            self::table( 'leads' ),
            array(
                'search_id'          => intval( $data['search_id'] ),
                'place_id'           => sanitize_text_field( $data['place_id'] ),
                'name'               => sanitize_text_field( $data['name'] ),
                'formatted_address'  => isset( $data['formatted_address'] ) ? sanitize_text_field( $data['formatted_address'] ) : null,
                'province'           => isset( $data['province'] ) ? sanitize_text_field( $data['province'] ) : null,
                'phone'              => isset( $data['phone'] ) ? sanitize_text_field( $data['phone'] ) : null,
                'international_phone'=> isset( $data['international_phone'] ) ? sanitize_text_field( $data['international_phone'] ) : null,
                'website'            => isset( $data['website'] ) ? esc_url_raw( $data['website'] ) : null,
                'rating'             => isset( $data['rating'] ) ? floatval( $data['rating'] ) : null,
                'reviews_count'      => isset( $data['reviews_count'] ) ? intval( $data['reviews_count'] ) : 0,
                'price_level'        => isset( $data['price_level'] ) ? intval( $data['price_level'] ) : null,
                'category'           => isset( $data['category'] ) ? sanitize_text_field( $data['category'] ) : null,
                'types'              => isset( $data['types'] ) ? wp_json_encode( $data['types'] ) : null,
                'latitude'           => isset( $data['latitude'] ) ? floatval( $data['latitude'] ) : null,
                'longitude'          => isset( $data['longitude'] ) ? floatval( $data['longitude'] ) : null,
                'position'           => isset( $data['position'] ) ? intval( $data['position'] ) : null,
                'gmb_url'            => isset( $data['gmb_url'] ) ? esc_url_raw( $data['gmb_url'] ) : null,
                'business_status'    => isset( $data['business_status'] ) ? sanitize_text_field( $data['business_status'] ) : null,
                'raw_data'           => isset( $data['raw_data'] ) ? wp_json_encode( $data['raw_data'] ) : null,
            )
        );
        $new_id = $wpdb->insert_id;
        if ( $new_id && $excluded_match ) {
            $wpdb->update( self::table( 'leads' ), array(
                'contact_status' => 'excluded',
                'notes'          => 'Excluido por patron: ' . $excluded_match->match_value . ( $excluded_match->reason ? ' (' . $excluded_match->reason . ')' : '' ),
            ), array( 'id' => $new_id ) );
        }
        return $new_id;
    }

    public static function update_lead_details( $lead_id, $data ) {
        global $wpdb;
        $wpdb->update( self::table( 'leads' ), $data, array( 'id' => $lead_id ) );
    }

    public static function get_lead( $id ) {
        global $wpdb;
        return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM " . self::table( 'leads' ) . " WHERE id = %d", $id ) );
    }

    public static function get_leads_by_search( $search_id, $args = array() ) {
        global $wpdb;
        $defaults = array(
            'status'    => '',
            'has_phone' => '',
            'orderby'   => 'position',
            'order'     => 'ASC',
            'limit'     => 200,
            'offset'    => 0,
            'search'    => '',
        );
        $args = wp_parse_args( $args, $defaults );

        $where  = $wpdb->prepare( 'search_id = %d', $search_id );
        if ( ! empty( $args['status'] ) ) {
            $where .= $wpdb->prepare( ' AND contact_status = %s', $args['status'] );
        }
        if ( $args['has_phone'] === 'yes' ) {
            $where .= " AND phone IS NOT NULL AND phone <> ''";
        } elseif ( $args['has_phone'] === 'no' ) {
            $where .= " AND (phone IS NULL OR phone = '')";
        }
        if ( ! empty( $args['search'] ) ) {
            $like = '%' . $wpdb->esc_like( $args['search'] ) . '%';
            $where .= $wpdb->prepare( ' AND (name LIKE %s OR formatted_address LIKE %s)', $like, $like );
        }

        $orderby = preg_replace( '/[^a-z_]/', '', $args['orderby'] );
        $order   = strtoupper( $args['order'] ) === 'DESC' ? 'DESC' : 'ASC';

        $sql = "SELECT * FROM " . self::table( 'leads' ) . " WHERE {$where} ORDER BY {$orderby} {$order} LIMIT %d OFFSET %d";
        return $wpdb->get_results( $wpdb->prepare( $sql, intval( $args['limit'] ), intval( $args['offset'] ) ) );
    }

    public static function count_leads_by_search( $search_id, $status = '' ) {
        global $wpdb;
        if ( $status ) {
            return (int) $wpdb->get_var( $wpdb->prepare(
                "SELECT COUNT(*) FROM " . self::table( 'leads' ) . " WHERE search_id = %d AND contact_status = %s",
                $search_id, $status
            ) );
        }
        return (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM " . self::table( 'leads' ) . " WHERE search_id = %d", $search_id ) );
    }

    /* ------------------- COMPETIDORES ------------------- */

    public static function insert_competitor( $data ) {
        global $wpdb;
        $wpdb->insert( self::table( 'competitors' ), $data );
        return $wpdb->insert_id;
    }

    public static function get_competitors_for_lead( $lead_id ) {
        global $wpdb;
        return $wpdb->get_results( $wpdb->prepare(
            "SELECT * FROM " . self::table( 'competitors' ) . " WHERE lead_id = %d ORDER BY competitor_position ASC",
            $lead_id
        ) );
    }

    public static function clear_competitors_for_lead( $lead_id ) {
        global $wpdb;
        $wpdb->delete( self::table( 'competitors' ), array( 'lead_id' => $lead_id ), array( '%d' ) );
    }

    /* ------------------- PLANTILLAS ------------------- */

    public static function get_templates() {
        global $wpdb;
        return $wpdb->get_results( "SELECT * FROM " . self::table( 'templates' ) . " ORDER BY is_default DESC, name ASC" );
    }

    public static function get_template( $id ) {
        global $wpdb;
        return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM " . self::table( 'templates' ) . " WHERE id = %d", $id ) );
    }

    /**
     * Devuelve una plantilla del pool por defecto. Si hay varias marcadas como
     * is_default=1, escoge una aleatoria — eso permite rotar entre plantillas
     * distintas y reduce el "fingerprinting" de WhatsApp sobre mensajes
     * masivos identicos.
     */
    public static function get_default_template() {
        global $wpdb;
        $defaults = $wpdb->get_results( "SELECT * FROM " . self::table( 'templates' ) . " WHERE is_default = 1" );
        if ( $defaults ) {
            return $defaults[ wp_rand( 0, count( $defaults ) - 1 ) ];
        }
        return $wpdb->get_row( "SELECT * FROM " . self::table( 'templates' ) . " ORDER BY id ASC LIMIT 1" );
    }

    public static function save_template( $data, $id = 0 ) {
        global $wpdb;
        $row = array(
            'name'       => sanitize_text_field( $data['name'] ),
            'body'       => wp_kses_post( $data['body'] ),
            'is_default' => ! empty( $data['is_default'] ) ? 1 : 0,
        );
        if ( $row['is_default'] ) {
            $wpdb->query( "UPDATE " . self::table( 'templates' ) . " SET is_default = 0" );
        }
        if ( $id ) {
            $wpdb->update( self::table( 'templates' ), $row, array( 'id' => $id ) );
            return $id;
        }
        $wpdb->insert( self::table( 'templates' ), $row );
        return $wpdb->insert_id;
    }

    public static function delete_template( $id ) {
        global $wpdb;
        $wpdb->delete( self::table( 'templates' ), array( 'id' => $id ), array( '%d' ) );
    }

    /* ------------------- ESTADÍSTICAS ------------------- */

    public static function dashboard_stats() {
        global $wpdb;
        return array(
            'total_searches'  => (int) $wpdb->get_var( "SELECT COUNT(*) FROM " . self::table( 'searches' ) ),
            'pending_searches'=> (int) $wpdb->get_var( "SELECT COUNT(*) FROM " . self::table( 'searches' ) . " WHERE status IN ('pending','processing')" ),
            'total_leads'     => (int) $wpdb->get_var( "SELECT COUNT(*) FROM " . self::table( 'leads' ) ),
            'leads_with_phone'=> (int) $wpdb->get_var( "SELECT COUNT(*) FROM " . self::table( 'leads' ) . " WHERE phone IS NOT NULL AND phone <> ''" ),
            'contacted'       => (int) $wpdb->get_var( "SELECT COUNT(*) FROM " . self::table( 'leads' ) . " WHERE contact_status = 'contacted'" ),
            'clients'         => (int) $wpdb->get_var( "SELECT COUNT(*) FROM " . self::table( 'leads' ) . " WHERE contact_status = 'client'" ),
        );
    }
}
