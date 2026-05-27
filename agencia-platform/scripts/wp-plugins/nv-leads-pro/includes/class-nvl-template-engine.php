<?php
/**
 * Motor de plantillas.
 */

if ( ! defined( 'WPINC' ) ) {
    die;
}

class NVL_Template_Engine {

    public static function available_variables() {
        return array(
            'nombre_negocio'     => 'Nombre de la ficha de GMB del lead.',
            'direccion'          => 'Direccion formateada del lead.',
            'provincia'          => 'Provincia del lead.',
            'telefono'           => 'Telefono del lead.',
            'web'                => 'Sitio web del lead.',
            'rating'             => 'Valoracion media (0-5).',
            'rating_estrellas'   => 'Estrellas visuales (ej: estrellas).',
            'resenas'            => 'Numero de reseñas.',
            'pct_positivas'     => '% reseñas positivas.',
            'pct_negativas'     => '% reseñas negativas.',
            'posicion'           => 'Posicion en el ranking.',
            'keyword'            => 'Palabra clave de la busqueda.',
            'competidor_top'     => 'Primer competidor por encima.',
            'competidor_top2'    => 'Segundo competidor por encima.',
            'competidor_top3'    => 'Tercer competidor por encima.',
            'competidores_lista' => 'Lista de competidores separada por comas.',
            'score'              => 'Score del lead (0-100).',
            'urgencia'           => 'Nivel de urgencia.',
            'opener_ia'          => 'Frase personalizada generada por IA.',
        );
    }

    public static function render( $template_body, $lead_id ) {
        $lead = NVL_DB::get_lead( $lead_id );
        if ( ! $lead ) return $template_body;
        $search      = NVL_DB::get_search( $lead->search_id );
        $competitors = NVL_DB::get_competitors_for_lead( $lead_id );
        $comp_names  = array_map( function( $c ) { return $c->competitor_name; }, $competitors );

        $stars = '';
        if ( $lead->rating !== null ) {
            $rounded = (int) round( floatval( $lead->rating ) );
            $stars   = str_repeat( 'estrella', $rounded ) . str_repeat( 'vacio', max( 0, 5 - $rounded ) );
        }

        $opener_ia = '';
        if ( ! empty( $lead->ai_opener ) ) {
            $opener_ia = $lead->ai_opener;
        } else {
            $settings = get_option( 'nvl_settings', array() );
            if ( ! empty( $settings['ai_enabled_opener'] ) && class_exists( 'NVL_AI_Client' ) ) {
                $ai = new NVL_AI_Client();
                if ( $ai->is_configured() ) {
                    $ctx = array(
                        'competitor_top' => isset( $comp_names[0] ) ? $comp_names[0] : '',
                        'keyword'        => $search ? $search->keyword : '',
                    );
                    $r = $ai->generate_opener( $lead, $ctx );
                    if ( ! is_wp_error( $r ) ) {
                        $opener_ia = trim( $r );
                        NVL_DB::update_lead_details( $lead_id, array(
                            'ai_opener'              => $opener_ia,
                            'ai_opener_generated_at' => current_time( 'mysql' ),
                        ) );
                    }
                }
            }
        }

        $vars = array(
            'nombre_negocio'     => $lead->name,
            'direccion'          => $lead->formatted_address,
            'provincia'          => $lead->province,
            'telefono'           => $lead->phone,
            'web'                => $lead->website,
            'rating'             => $lead->rating !== null ? number_format( floatval( $lead->rating ), 1, ',', '' ) : '',
            'rating_estrellas'   => $stars,
            'resenas'            => $lead->reviews_count,
            'pct_positivas'     => $lead->positive_pct !== null ? number_format( floatval( $lead->positive_pct ), 0 ) . '%' : '',
            'pct_negativas'     => $lead->negative_pct !== null ? number_format( floatval( $lead->negative_pct ), 0 ) . '%' : '',
            'posicion'           => $lead->position,
            'keyword'            => $search ? $search->keyword : '',
            'competidor_top'     => isset( $comp_names[0] ) ? $comp_names[0] : '',
            'competidor_top2'    => isset( $comp_names[1] ) ? $comp_names[1] : '',
            'competidor_top3'    => isset( $comp_names[2] ) ? $comp_names[2] : '',
            'competidores_lista' => implode( ', ', $comp_names ),
            'score'              => $lead->score,
            'urgencia'           => $lead->urgency,
            'opener_ia'          => $opener_ia,
        );

        $body = $template_body;
        foreach ( $vars as $key => $value ) {
            $body = str_replace( '{{' . $key . '}}', (string) $value, $body );
        }
        $body = preg_replace( "/\n[ \t]*\n[ \t]*\n+/", "\n\n", $body );
        return trim( $body );
    }
}
