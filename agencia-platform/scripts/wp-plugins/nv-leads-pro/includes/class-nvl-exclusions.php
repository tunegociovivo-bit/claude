<?php
/**
 * Gestion de exclusiones (clientes existentes) y opt-outs (no contactar).
 *
 * Exclusiones: patrones de nombre. Si el nombre del lead coincide con un
 * patron, el lead se guarda con contact_status='excluded' y nunca se envia.
 *
 * Opt-outs: telefonos normalizados a los que nunca volver a contactar.
 * Se rellena automaticamente cuando la IA clasifica una respuesta como
 * 'opt_out' o se puede añadir manualmente.
 */

if ( ! defined( 'WPINC' ) ) {
    die;
}

class NVL_Exclusions {

    /* ============ EXCLUSIONES (clientes existentes) ============ */

    public static function get_exclusions() {
        global $wpdb;
        return $wpdb->get_results( "SELECT * FROM " . NVL_DB::table( 'exclusions' ) . " ORDER BY id DESC" );
    }

    public static function add_exclusion( $match_value, $reason = '', $match_type = 'name', $match_mode = 'contains' ) {
        global $wpdb;
        $match_value = trim( (string) $match_value );
        if ( $match_value === '' ) {
            return new WP_Error( 'invalid', 'El patron no puede estar vacio.' );
        }
        if ( ! in_array( $match_mode, array( 'contains', 'exact' ), true ) ) {
            $match_mode = 'contains';
        }
        $wpdb->insert( NVL_DB::table( 'exclusions' ), array(
            'match_type'  => sanitize_text_field( $match_type ),
            'match_value' => sanitize_text_field( $match_value ),
            'match_mode'  => $match_mode,
            'reason'      => sanitize_text_field( $reason ),
        ) );
        return $wpdb->insert_id;
    }

    public static function delete_exclusion( $id ) {
        global $wpdb;
        $wpdb->delete( NVL_DB::table( 'exclusions' ), array( 'id' => intval( $id ) ), array( '%d' ) );
    }

    /**
     * Comprueba si un nombre de lead coincide con algun patron de exclusion.
     *
     * @param string $name
     * @return object|null Fila de exclusiones si hay match, null si no.
     */
    public static function match_lead_name( $name ) {
        global $wpdb;
        $name_l = mb_strtolower( trim( (string) $name ) );
        if ( $name_l === '' ) return null;

        $rows = $wpdb->get_results( "SELECT * FROM " . NVL_DB::table( 'exclusions' ) . " WHERE match_type = 'name'" );
        foreach ( $rows as $r ) {
            $val_l = mb_strtolower( $r->match_value );
            if ( $r->match_mode === 'exact' ) {
                if ( $name_l === $val_l ) return $r;
            } else {
                if ( mb_strpos( $name_l, $val_l ) !== false ) return $r;
            }
        }
        return null;
    }

    /* ============ OPT-OUTS (no contactar nunca) ============ */

    public static function get_optouts() {
        global $wpdb;
        return $wpdb->get_results( "SELECT * FROM " . NVL_DB::table( 'optouts' ) . " ORDER BY id DESC" );
    }

    public static function add_optout( $phone, $reason = '', $source = 'manual', $lead_id = null ) {
        global $wpdb;
        $phone = preg_replace( '/\D/', '', (string) $phone );
        if ( $phone === '' ) {
            return new WP_Error( 'invalid', 'El telefono no puede estar vacio.' );
        }
        // No duplicar.
        $existing = $wpdb->get_var( $wpdb->prepare(
            "SELECT id FROM " . NVL_DB::table( 'optouts' ) . " WHERE phone_normalized = %s",
            $phone
        ) );
        if ( $existing ) return intval( $existing );

        $wpdb->insert( NVL_DB::table( 'optouts' ), array(
            'phone_normalized' => $phone,
            'lead_id'          => $lead_id ? intval( $lead_id ) : null,
            'reason'           => sanitize_text_field( $reason ),
            'source'           => sanitize_text_field( $source ),
        ) );
        return $wpdb->insert_id;
    }

    public static function delete_optout( $id ) {
        global $wpdb;
        $wpdb->delete( NVL_DB::table( 'optouts' ), array( 'id' => intval( $id ) ), array( '%d' ) );
    }

    public static function is_phone_optout( $phone ) {
        global $wpdb;
        $phone = preg_replace( '/\D/', '', (string) $phone );
        if ( $phone === '' ) return false;

        // Probar tal cual y con/sin prefijo 34.
        $candidates = array( $phone );
        if ( strpos( $phone, '34' ) === 0 ) {
            $candidates[] = substr( $phone, 2 );
        } else if ( strlen( $phone ) === 9 ) {
            $candidates[] = '34' . $phone;
        }
        $placeholders = implode( ',', array_fill( 0, count( $candidates ), '%s' ) );
        $found = $wpdb->get_var( $wpdb->prepare(
            "SELECT id FROM " . NVL_DB::table( 'optouts' ) . " WHERE phone_normalized IN ($placeholders) LIMIT 1",
            $candidates
        ) );
        return $found ? true : false;
    }
}
