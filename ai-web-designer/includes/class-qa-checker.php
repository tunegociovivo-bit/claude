<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

/**
 * Motor de QA del proyecto. Define checks automáticos (verificables por el
 * plugin) y manuales (verificados por el equipo). Los checks marcados como
 * required impiden marcar el proyecto como 'published' si no pasan, salvo
 * que un admin haga override.
 *
 * Estado persistido en meta:
 *   _aiwd_qa_results : [ key => [ status, checked_at, checked_by, note ] ]
 *   _aiwd_qa_override : [ by, reason, at ]
 */
class AIWD_QA_Checker {

    const META_RESULTS  = '_aiwd_qa_results';
    const META_OVERRIDE = '_aiwd_qa_override';

    public function register() {
        add_filter( 'aiwd_can_publish', [ $this, 'can_publish' ], 10, 2 );
    }

    /**
     * Catálogo de checks. type: 'auto' | 'manual'. required: bloquea publicación si false.
     */
    public static function checks() {
        return [
            'has_logo'           => [ 'label' => __( 'Logo subido', 'ai-web-designer' ),                 'type' => 'auto',   'required' => true,  'group' => 'brand' ],
            'has_palette'        => [ 'label' => __( 'Paleta de colores completa', 'ai-web-designer' ), 'type' => 'auto',   'required' => true,  'group' => 'brand' ],
            'has_typography'     => [ 'label' => __( 'Tipografías definidas', 'ai-web-designer' ),      'type' => 'auto',   'required' => false, 'group' => 'brand' ],
            'has_domain'         => [ 'label' => __( 'Dominio configurado', 'ai-web-designer' ),        'type' => 'auto',   'required' => true,  'group' => 'contact' ],
            'has_email_phone'    => [ 'label' => __( 'Email y teléfono', 'ai-web-designer' ),           'type' => 'auto',   'required' => true,  'group' => 'contact' ],
            'has_hero'           => [ 'label' => __( 'Hero con titular y CTA', 'ai-web-designer' ),     'type' => 'auto',   'required' => true,  'group' => 'content' ],
            'has_about'          => [ 'label' => __( 'Sección sobre nosotros', 'ai-web-designer' ),     'type' => 'auto',   'required' => false, 'group' => 'content' ],
            'min_pages'          => [ 'label' => __( 'Mínimo 4 páginas creadas', 'ai-web-designer' ),   'type' => 'auto',   'required' => true,  'group' => 'content' ],
            'min_gallery'        => [ 'label' => __( 'Al menos 3 fotos en galería', 'ai-web-designer' ),'type' => 'auto',   'required' => false, 'group' => 'content' ],
            'has_meta_seo'       => [ 'label' => __( 'Meta title y description', 'ai-web-designer' ),   'type' => 'auto',   'required' => true,  'group' => 'seo' ],
            'has_schema_type'    => [ 'label' => __( 'Schema.org configurado', 'ai-web-designer' ),     'type' => 'auto',   'required' => true,  'group' => 'seo' ],
            'has_keywords'       => [ 'label' => __( 'Keywords definidas', 'ai-web-designer' ),         'type' => 'auto',   'required' => false, 'group' => 'seo' ],
            'has_privacy'        => [ 'label' => __( 'Política de privacidad', 'ai-web-designer' ),     'type' => 'auto',   'required' => true,  'group' => 'legal' ],
            'has_cookies'        => [ 'label' => __( 'Política de cookies', 'ai-web-designer' ),        'type' => 'auto',   'required' => true,  'group' => 'legal' ],
            'has_legal_notice'   => [ 'label' => __( 'Aviso legal', 'ai-web-designer' ),                'type' => 'auto',   'required' => true,  'group' => 'legal' ],
            'has_ga4'            => [ 'label' => __( 'GA4 ID configurado', 'ai-web-designer' ),         'type' => 'auto',   'required' => false, 'group' => 'integrations' ],
            'mobile_tested'      => [ 'label' => __( 'Probado en móvil (real)', 'ai-web-designer' ),    'type' => 'manual', 'required' => true,  'group' => 'qa' ],
            'forms_tested'       => [ 'label' => __( 'Formulario de contacto probado', 'ai-web-designer' ), 'type' => 'manual', 'required' => true, 'group' => 'qa' ],
            'speed_ok'           => [ 'label' => __( 'PageSpeed > 80 mobile', 'ai-web-designer' ),      'type' => 'manual', 'required' => false, 'group' => 'qa' ],
            'links_ok'           => [ 'label' => __( 'Sin enlaces rotos', 'ai-web-designer' ),          'type' => 'manual', 'required' => true,  'group' => 'qa' ],
            'cookies_banner'     => [ 'label' => __( 'Banner de cookies visible y funcional', 'ai-web-designer' ), 'type' => 'manual', 'required' => true, 'group' => 'qa' ],
            'dns_ok'             => [ 'label' => __( 'DNS apuntando al dominio', 'ai-web-designer' ),   'type' => 'manual', 'required' => true,  'group' => 'qa' ],
            'client_reviewed'    => [ 'label' => __( 'Revisado y aprobado por cliente', 'ai-web-designer' ), 'type' => 'manual', 'required' => true, 'group' => 'qa' ],
        ];
    }

    public function run_all( $project_id ) {
        $data = AIWD_CPT_Project::get_project_data( $project_id );
        $current = (array) get_post_meta( $project_id, self::META_RESULTS, true );
        $out = [];
        foreach ( self::checks() as $key => $cfg ) {
            if ( $cfg['type'] === 'auto' ) {
                $status = $this->run_auto( $key, $data, $project_id ) ? 'pass' : 'fail';
                $out[ $key ] = [
                    'status'     => $status,
                    'checked_at' => current_time( 'mysql' ),
                    'checked_by' => 0,
                    'note'       => '',
                ];
            } else {
                $out[ $key ] = $current[ $key ] ?? [ 'status' => 'pending', 'checked_at' => '', 'checked_by' => 0, 'note' => '' ];
            }
        }
        update_post_meta( $project_id, self::META_RESULTS, $out );
        return $out;
    }

    public function set_manual( $project_id, $key, $status, $note = '' ) {
        $checks = self::checks();
        if ( empty( $checks[ $key ] ) || $checks[ $key ]['type'] !== 'manual' ) return false;
        $current = (array) get_post_meta( $project_id, self::META_RESULTS, true );
        $current[ $key ] = [
            'status'     => in_array( $status, [ 'pass','fail','pending' ], true ) ? $status : 'pending',
            'checked_at' => current_time( 'mysql' ),
            'checked_by' => get_current_user_id(),
            'note'       => sanitize_text_field( $note ),
        ];
        update_post_meta( $project_id, self::META_RESULTS, $current );
        $this->maybe_complete_asana_qa( $project_id );
        return true;
    }

    private function run_auto( $key, $data, $project_id ) {
        switch ( $key ) {
            case 'has_logo':        return ! empty( $data['brand']['logo_id'] );
            case 'has_palette':     return ! empty( $data['brand']['color_primary'] ) && ! empty( $data['brand']['color_secondary'] ) && ! empty( $data['brand']['color_accent'] );
            case 'has_typography':  return ! empty( $data['brand']['font_heading'] ) && ! empty( $data['brand']['font_body'] );
            case 'has_domain':      return ! empty( $data['contact']['domain'] );
            case 'has_email_phone': return ! empty( $data['contact']['email'] ) && ! empty( $data['contact']['phone'] );
            case 'has_hero':        return ! empty( $data['content']['hero_headline'] ) && ! empty( $data['content']['cta'] );
            case 'has_about':       return ! empty( $data['content']['about'] );
            case 'min_pages':       return count( (array) get_post_meta( $project_id, '_aiwd_built_pages', true ) ) >= 4;
            case 'min_gallery':     return count( (array) ( $data['brand']['gallery'] ?? [] ) ) >= 3;
            case 'has_meta_seo':    return ! empty( $data['seo']['meta_title'] ) && ! empty( $data['seo']['meta_description'] );
            case 'has_schema_type': return ! empty( $data['seo']['schema_type'] );
            case 'has_keywords':    return ! empty( $data['seo']['keywords'] );
            case 'has_privacy':     return $this->has_legal_page( $project_id, 'privacy' );
            case 'has_cookies':     return $this->has_legal_page( $project_id, 'cookies' );
            case 'has_legal_notice':return $this->has_legal_page( $project_id, 'terms' );
            case 'has_ga4':         return ! empty( $data['design']['ga4'] );
        }
        return false;
    }

    private function has_legal_page( $project_id, $type ) {
        $q = get_posts( [
            'post_type'   => 'page',
            'meta_query'  => [
                [ 'key' => '_aiwd_project_id', 'value' => $project_id ],
                [ 'key' => '_aiwd_legal_type', 'value' => $type ],
            ],
            'numberposts' => 1,
            'fields'      => 'ids',
            'post_status' => 'any',
        ] );
        return ! empty( $q );
    }

    public function summary( $project_id ) {
        $results = (array) get_post_meta( $project_id, self::META_RESULTS, true );
        $checks  = self::checks();
        $total = $passed = $failed = $required_failed = 0;
        foreach ( $checks as $key => $cfg ) {
            $total++;
            $status = $results[ $key ]['status'] ?? 'pending';
            if ( $status === 'pass' ) $passed++;
            elseif ( $status === 'fail' ) {
                $failed++;
                if ( ! empty( $cfg['required'] ) ) $required_failed++;
            } elseif ( $status === 'pending' && ! empty( $cfg['required'] ) ) {
                $required_failed++;
            }
        }
        return compact( 'total', 'passed', 'failed', 'required_failed' );
    }

    public function can_publish( $allowed, $project_id ) {
        if ( get_post_meta( $project_id, self::META_OVERRIDE, true ) ) return $allowed;
        $summary = $this->summary( $project_id );
        return $summary['required_failed'] === 0 ? $allowed : false;
    }

    public function override( $project_id, $reason ) {
        if ( ! current_user_can( 'manage_options' ) ) return false;
        update_post_meta( $project_id, self::META_OVERRIDE, [
            'by'     => get_current_user_id(),
            'reason' => sanitize_text_field( $reason ),
            'at'     => current_time( 'mysql' ),
        ] );
        return true;
    }

    public function clear_override( $project_id ) {
        delete_post_meta( $project_id, self::META_OVERRIDE );
    }

    private function maybe_complete_asana_qa( $project_id ) {
        $summary = $this->summary( $project_id );
        if ( $summary['required_failed'] === 0 ) {
            $sync = new AIWD_Asana_Sync();
            $sync->complete_task( $project_id, 'qa', 'QA completo: todos los checks requeridos OK.' );
            do_action( 'aiwd_qa_passed', $project_id );
        }
    }
}
