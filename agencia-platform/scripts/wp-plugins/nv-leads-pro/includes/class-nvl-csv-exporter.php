<?php
/**
 * Exportacion de leads a CSV.
 */

if ( ! defined( 'WPINC' ) ) {
    die;
}

class NVL_CSV_Exporter {

    public static function export_search() {
        if ( ! current_user_can( 'manage_options' ) ) {
            wp_die( 'No tienes permisos.' );
        }
        $search_id = isset( $_GET['search_id'] ) ? intval( $_GET['search_id'] ) : 0;
        $search = NVL_DB::get_search( $search_id );
        if ( ! $search ) {
            wp_die( 'Busqueda no encontrada.' );
        }
        $leads = NVL_DB::get_leads_by_search( $search_id, array( 'limit' => 5000 ) );

        $filename = 'leads-' . sanitize_title( $search->keyword ) . '-' . $search->id . '-' . date( 'Ymd' ) . '.csv';
        header( 'Content-Type: text/csv; charset=utf-8' );
        header( 'Content-Disposition: attachment; filename=' . $filename );

        $out = fopen( 'php://output', 'w' );
        fprintf( $out, chr( 0xEF ) . chr( 0xBB ) . chr( 0xBF ) );

        fputcsv( $out, array(
            'ID', 'Nombre', 'Provincia', 'Direccion', 'Telefono', 'Web',
            'Rating', 'Reseñas', 'Pct positivas', 'Pct negativas', 'Posicion',
            'Score', 'Urgencia', 'Estado', 'GMB URL', 'Place ID', 'Categoria',
            'Competidor 1', 'Competidor 2', 'Competidor 3',
        ) );

        foreach ( $leads as $lead ) {
            $comps = NVL_DB::get_competitors_for_lead( $lead->id );
            $c = array( '', '', '' );
            foreach ( array_slice( $comps, 0, 3 ) as $i => $cc ) {
                $c[ $i ] = $cc->competitor_name;
            }
            fputcsv( $out, array(
                $lead->id, $lead->name, $lead->province, $lead->formatted_address,
                $lead->phone, $lead->website, $lead->rating, $lead->reviews_count,
                $lead->positive_pct, $lead->negative_pct, $lead->position,
                $lead->score, $lead->urgency, $lead->contact_status, $lead->gmb_url, $lead->place_id, $lead->category,
                $c[0], $c[1], $c[2],
            ) );
        }
        fclose( $out );
        exit;
    }
}
