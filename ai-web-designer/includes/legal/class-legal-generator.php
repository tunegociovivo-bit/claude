<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

class AIWD_Legal_Generator {

    private $claude;

    public function __construct() {
        $this->claude = new AIWD_Claude_Client();
    }

    public function generate( $project_id, array $types = [ 'privacy', 'cookies', 'terms' ] ) {
        $data = AIWD_CPT_Project::get_project_data( $project_id );
        $country = $data['legal']['country'] ?? 'ES';
        $b = $data['briefing'] ?? [];
        $c = $data['contact']  ?? [];

        $context = wp_json_encode( [
            'country'      => $country,
            'business'     => $b['business_name'] ?? '',
            'domain'       => $c['domain'] ?? home_url(),
            'email'        => $c['email'] ?? '',
            'address'      => $c['address'] ?? '',
            'sector'       => $b['sector'] ?? '',
        ] );

        $created = [];
        foreach ( $types as $type ) {
            $title = $this->title_for( $type );
            $instruction = $this->instruction_for( $type );
            $resp = $this->claude->messages(
                [ [ 'role' => 'user', 'content' => "Datos del negocio:\n$context\n\n$instruction\n\nDevuelve HTML limpio (sin <html>/<body>)." ] ],
                "Eres abogado especializado en RGPD/LSSI y normativa local. Genera textos legales completos, correctos y adaptados al país indicado.",
                [ 'max_tokens' => 6000 ]
            );
            if ( is_wp_error( $resp ) ) continue;
            $html = ( new AIWD_Claude_Client() )->extract_text( $resp );

            $page_id = wp_insert_post( [
                'post_type'   => 'page',
                'post_status' => 'draft',
                'post_title'  => $title,
                'post_content'=> wp_kses_post( $html ),
            ] );
            if ( ! is_wp_error( $page_id ) ) {
                update_post_meta( $page_id, '_aiwd_legal_type', $type );
                update_post_meta( $page_id, '_aiwd_project_id', $project_id );
                $created[ $type ] = $page_id;
            }
        }
        return $created;
    }

    private function title_for( $type ) {
        return [
            'privacy' => __( 'Política de privacidad', 'ai-web-designer' ),
            'cookies' => __( 'Política de cookies', 'ai-web-designer' ),
            'terms'   => __( 'Aviso legal', 'ai-web-designer' ),
        ][ $type ] ?? ucfirst( $type );
    }

    private function instruction_for( $type ) {
        return [
            'privacy' => 'Redacta una política de privacidad completa, conforme RGPD/LOPDGDD/normativa local.',
            'cookies' => 'Redacta una política de cookies detallada con categorías (técnicas, analíticas, marketing) y duración.',
            'terms'   => 'Redacta el aviso legal completo (titularidad, condiciones, propiedad intelectual, responsabilidad).',
        ][ $type ] ?? "Redacta el documento legal '$type'.";
    }

    public function cookie_banner_html() {
        return '<div id="aiwd-cookie-banner" style="position:fixed;bottom:0;left:0;right:0;background:#111;color:#fff;padding:16px;z-index:9999;display:flex;justify-content:space-between;align-items:center;gap:12px;">
            <span>' . esc_html__( 'Usamos cookies para mejorar tu experiencia. Puedes aceptar o rechazar las opcionales.', 'ai-web-designer' ) . '</span>
            <span>
                <button class="aiwd-cb-config" style="background:transparent;color:#fff;border:1px solid #fff;padding:6px 12px;">' . esc_html__( 'Configurar', 'ai-web-designer' ) . '</button>
                <button class="aiwd-cb-reject" style="background:#444;color:#fff;border:0;padding:6px 12px;">' . esc_html__( 'Rechazar', 'ai-web-designer' ) . '</button>
                <button class="aiwd-cb-accept" style="background:#0d6efd;color:#fff;border:0;padding:6px 12px;">' . esc_html__( 'Aceptar', 'ai-web-designer' ) . '</button>
            </span>
        </div>';
    }
}
