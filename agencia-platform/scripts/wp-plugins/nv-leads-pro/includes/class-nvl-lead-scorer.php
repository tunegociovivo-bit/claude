<?php
/**
 * Algoritmo de scoring de leads.
 *
 * Devuelve un score 0-100 y un nivel de urgencia ('critica' | 'alta' | 'media' | 'baja')
 * que indica cómo de "trabajable" es la ficha. También un breakdown por señal.
 *
 * Filosofía:
 *  - Buscamos negocios que TE NECESITAN: posición trabajable, sin web, fichas descuidadas,
 *    rating bajo, valoraciones recientes negativas, mucha competencia mejor posicionada.
 *  - Penalizamos los #1 (no nos van a contratar) y los que están cerrados.
 */

if ( ! defined( 'WPINC' ) ) {
    die;
}

class NVL_Lead_Scorer {

    /**
     * Calcula score 0-100 y urgencia.
     *
     * @param object $lead       Fila de nvl_leads.
     * @param array  $competitors Lista de competidores (cada uno con competitor_rating).
     * @return array { score:int, urgency:string, breakdown:array }
     */
    public static function score( $lead, $competitors = array() ) {
        $b = array(); // breakdown
        $score = 0;

        // Si el negocio está cerrado: directamente score 0 y urgencia 'descartar'.
        if ( $lead->business_status === 'CLOSED_PERMANENTLY' || $lead->business_status === 'CLOSED_TEMPORARILY' ) {
            return array(
                'score'     => 0,
                'urgency'   => 'descartar',
                'breakdown' => array( 'cerrado' => array( 'pts' => 0, 'note' => 'Negocio cerrado, descartar.' ) ),
            );
        }

        /* === POSICIÓN (0-25) === */
        $pos = intval( $lead->position );
        if ( $pos === 1 ) {
            $b['posicion'] = array( 'pts' => 0, 'note' => 'Ya está en posición #1; no tiene incentivo para contratarnos.' );
        } elseif ( $pos >= 4 && $pos <= 15 ) {
            $score += 25;
            $b['posicion'] = array( 'pts' => 25, 'note' => 'Punto dulce (4-15). Mejorable y con potencial real.' );
        } elseif ( $pos >= 2 && $pos <= 3 ) {
            $score += 18;
            $b['posicion'] = array( 'pts' => 18, 'note' => 'Cerca del top. Argumento "te falta empujón" funciona bien.' );
        } elseif ( $pos >= 16 && $pos <= 30 ) {
            $score += 12;
            $b['posicion'] = array( 'pts' => 12, 'note' => 'Lejos pero alcanzable. Esfuerzo medio.' );
        } else {
            $score += 5;
            $b['posicion'] = array( 'pts' => 5, 'note' => 'Posición muy baja, requiere trabajo grande.' );
        }

        /* === RATING / ESTRELLAS (0-20) ===
         * Lo invertimos: rating MÁS BAJO = más urgencia de trabajar la ficha.
         */
        $rating = $lead->rating !== null ? floatval( $lead->rating ) : null;
        if ( $rating === null ) {
            $score += 12;
            $b['rating'] = array( 'pts' => 12, 'note' => 'Sin valoración. Ficha nueva o sin actividad: gran oportunidad.' );
        } elseif ( $rating < 3.0 ) {
            $score += 20;
            $b['rating'] = array( 'pts' => 20, 'note' => 'Rating crítico (<3.0). Necesita gestión de reseñas urgente.' );
        } elseif ( $rating < 3.5 ) {
            $score += 18;
            $b['rating'] = array( 'pts' => 18, 'note' => 'Rating bajo (3.0-3.5). Necesita estrategia de reseñas.' );
        } elseif ( $rating < 4.0 ) {
            $score += 13;
            $b['rating'] = array( 'pts' => 13, 'note' => 'Rating mejorable (3.5-4.0). Oportunidad clara.' );
        } elseif ( $rating < 4.5 ) {
            $score += 8;
            $b['rating'] = array( 'pts' => 8, 'note' => 'Rating decente (4.0-4.5). Margen para optimizar.' );
        } else {
            $score += 3;
            $b['rating'] = array( 'pts' => 3, 'note' => 'Rating excelente (4.5+). Poco margen vía reseñas.' );
        }

        /* === % RESEÑAS POSITIVAS / NEGATIVAS (0-15) ===
         * Si tenemos breakdown, usamos % real; si no, lo derivamos del rating.
         */
        $neg_pct = $lead->negative_pct !== null ? floatval( $lead->negative_pct ) : null;
        if ( $neg_pct === null && $rating !== null ) {
            // Estimación basada en rating.
            if ( $rating < 3.0 )       $neg_pct = 50;
            elseif ( $rating < 3.5 )   $neg_pct = 35;
            elseif ( $rating < 4.0 )   $neg_pct = 20;
            elseif ( $rating < 4.5 )   $neg_pct = 10;
            else                       $neg_pct = 4;
        }
        if ( $neg_pct === null ) {
            $b['reseñas_neg'] = array( 'pts' => 0, 'note' => 'Sin datos de polaridad.' );
        } elseif ( $neg_pct >= 30 ) {
            $score += 15;
            $b['reseñas_neg'] = array( 'pts' => 15, 'note' => sprintf( '%.0f%% reseñas negativas. Crítico, necesita gestión reactiva.', $neg_pct ) );
        } elseif ( $neg_pct >= 15 ) {
            $score += 10;
            $b['reseñas_neg'] = array( 'pts' => 10, 'note' => sprintf( '%.0f%% reseñas negativas. Margen claro.', $neg_pct ) );
        } elseif ( $neg_pct >= 7 ) {
            $score += 5;
            $b['reseñas_neg'] = array( 'pts' => 5, 'note' => sprintf( '%.0f%% reseñas negativas. Mejorable.', $neg_pct ) );
        } else {
            $score += 1;
            $b['reseñas_neg'] = array( 'pts' => 1, 'note' => sprintf( '%.0f%% reseñas negativas. Saludable.', $neg_pct ) );
        }

        /* === CANTIDAD DE RESEÑAS (0-10) === */
        $rev = intval( $lead->reviews_count );
        if ( $rev === 0 ) {
            $score += 10;
            $b['n_reseñas'] = array( 'pts' => 10, 'note' => 'Sin reseñas. Ficha completamente desatendida.' );
        } elseif ( $rev < 10 ) {
            $score += 8;
            $b['n_reseñas'] = array( 'pts' => 8, 'note' => 'Muy pocas reseñas (<10). Oportunidad alta.' );
        } elseif ( $rev < 30 ) {
            $score += 5;
            $b['n_reseñas'] = array( 'pts' => 5, 'note' => 'Pocas reseñas (10-30). Oportunidad media.' );
        } elseif ( $rev < 100 ) {
            $score += 2;
            $b['n_reseñas'] = array( 'pts' => 2, 'note' => 'Volumen aceptable (30-100).' );
        } else {
            $b['n_reseñas'] = array( 'pts' => 0, 'note' => 'Mucho volumen de reseñas (100+). Ficha trabajada.' );
        }

        /* === WEB (0-12) === */
        if ( empty( $lead->website ) ) {
            $score += 12;
            $b['web'] = array( 'pts' => 12, 'note' => 'Sin web. Necesidad obvia, podemos vender pack ficha + web.' );
        } else {
            $b['web'] = array( 'pts' => 0, 'note' => 'Tiene web.' );
        }

        /* === COMPETIDORES MEJOR POSICIONADOS CON PEOR SERVICIO (0-10) === */
        $bonus_comp = 0;
        if ( ! empty( $competitors ) && $rating !== null ) {
            foreach ( $competitors as $c ) {
                if ( $c->competitor_rating !== null && floatval( $c->competitor_rating ) < $rating - 0.3 ) {
                    $bonus_comp = 10;
                    $b['competidor'] = array( 'pts' => 10, 'note' => 'Hay competidores por encima con rating PEOR. Argumento irrefutable.' );
                    break;
                }
            }
        }
        $score += $bonus_comp;
        if ( ! isset( $b['competidor'] ) ) {
            $b['competidor'] = array( 'pts' => 0, 'note' => 'Competidores arriba con rating similar o mejor.' );
        }

        /* === CATEGORÍA / LTV (0-8) ===
         * Sectores con LTV alto para una agencia de marketing local.
         */
        $hi_value_keywords = array(
            'dentist', 'doctor', 'lawyer', 'attorney', 'clinic', 'spa', 'beauty', 'gym',
            'real_estate', 'car_repair', 'plumber', 'electrician', 'roofing',
            'veterinary', 'physical_therapist', 'restaurant',
        );
        $cat = strtolower( (string) $lead->category );
        $cat_bonus = 0;
        foreach ( $hi_value_keywords as $kw ) {
            if ( strpos( $cat, $kw ) !== false ) { $cat_bonus = 8; break; }
        }
        $score += $cat_bonus;
        $b['categoria'] = array(
            'pts'  => $cat_bonus,
            'note' => $cat_bonus ? 'Sector de alto LTV para agencia local.' : 'Sector estándar.',
        );

        /* === Cap a 100 === */
        $score = max( 0, min( 100, $score ) );

        /* === Urgencia: heurística sobre el conjunto === */
        $urgency = 'baja';
        if ( $rating !== null && $rating < 3.5 && $rev >= 5 ) {
            $urgency = 'critica';      // reputación dañada y reciente
        } elseif ( $score >= 70 ) {
            $urgency = 'alta';
        } elseif ( $score >= 45 ) {
            $urgency = 'media';
        }

        return array(
            'score'     => intval( $score ),
            'urgency'   => $urgency,
            'breakdown' => $b,
        );
    }

    /**
     * Calcula % positivas/negativas/neutras a partir de las reseñas devueltas por Place Details.
     * Si tenemos pocas (Google devuelve ~5), las usamos como muestra.
     *
     * @param array $reviews Cada uno con clave 'rating' (1-5).
     * @return array { positive, negative, neutral } en %.
     */
    public static function compute_polarity( $reviews ) {
        if ( empty( $reviews ) || ! is_array( $reviews ) ) {
            return array( 'positive' => null, 'negative' => null, 'neutral' => null );
        }
        $pos = 0; $neg = 0; $neu = 0; $tot = 0;
        foreach ( $reviews as $r ) {
            if ( ! isset( $r['rating'] ) ) continue;
            $rt = intval( $r['rating'] );
            $tot++;
            if ( $rt >= 4 )      $pos++;
            elseif ( $rt <= 2 )  $neg++;
            else                 $neu++;
        }
        if ( $tot === 0 ) {
            return array( 'positive' => null, 'negative' => null, 'neutral' => null );
        }
        return array(
            'positive' => round( ( $pos / $tot ) * 100, 2 ),
            'negative' => round( ( $neg / $tot ) * 100, 2 ),
            'neutral'  => round( ( $neu / $tot ) * 100, 2 ),
        );
    }

    /**
     * Aplica el scoring a un lead concreto leyendo de BD.
     */
    public static function score_and_persist( $lead_id ) {
        global $wpdb;
        $lead = NVL_DB::get_lead( $lead_id );
        if ( ! $lead ) return null;
        $comps  = NVL_DB::get_competitors_for_lead( $lead_id );
        $result = self::score( $lead, $comps );
        $wpdb->update(
            NVL_DB::table( 'leads' ),
            array(
                'score'           => $result['score'],
                'urgency'         => $result['urgency'],
                'score_breakdown' => wp_json_encode( $result['breakdown'] ),
            ),
            array( 'id' => $lead_id )
        );
        return $result;
    }
}
