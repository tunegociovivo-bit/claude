<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

/**
 * Generador de propuesta comercial PDF para un proyecto.
 *
 * Usa Dompdf si está disponible (Composer); si no, exporta un HTML descargable
 * preparado para imprimir como PDF desde el navegador.
 */
class AIWD_PDF_Proposal {

    public function build( $project_id ) {
        $post = get_post( $project_id );
        if ( ! $post ) return new WP_Error( 'aiwd_no_project', 'Proyecto no encontrado' );

        $data = AIWD_CPT_Project::get_project_data( $project_id );
        $blueprint = get_post_meta( $project_id, '_aiwd_design_blueprint', true );

        $html = $this->render_html( $post, $data, $blueprint );

        if ( class_exists( '\\Dompdf\\Dompdf' ) ) {
            $dompdf = new \Dompdf\Dompdf( [ 'isRemoteEnabled' => true, 'defaultFont' => 'sans-serif' ] );
            $dompdf->loadHtml( $html, 'UTF-8' );
            $dompdf->setPaper( 'A4', 'portrait' );
            $dompdf->render();
            return [ 'mime' => 'application/pdf', 'body' => $dompdf->output(), 'filename' => sanitize_file_name( 'propuesta-' . $post->post_name . '.pdf' ) ];
        }

        return [ 'mime' => 'text/html', 'body' => $html, 'filename' => sanitize_file_name( 'propuesta-' . $post->post_name . '.html' ) ];
    }

    public function stream( $project_id ) {
        $r = $this->build( $project_id );
        if ( is_wp_error( $r ) ) return $r;
        nocache_headers();
        header( 'Content-Type: ' . $r['mime'] );
        header( 'Content-Disposition: attachment; filename="' . $r['filename'] . '"' );
        echo $r['body'];
        exit;
    }

    private function render_html( $post, $data, $blueprint ) {
        $b = $data['briefing'] ?? [];
        $c = $data['contact']  ?? [];
        $br= $data['brand']    ?? [];
        $color = $br['color_primary'] ?? '#2271b1';

        $logo_html = '';
        if ( ! empty( $br['logo_id'] ) ) {
            $url = wp_get_attachment_image_url( (int) $br['logo_id'], 'medium' );
            if ( $url ) $logo_html = '<img src="' . esc_url( $url ) . '" style="max-height:60px" />';
        }

        $pages_list = '';
        if ( is_array( $blueprint ) && ! empty( $blueprint['pages'] ) ) {
            foreach ( $blueprint['pages'] as $p ) {
                $sections = array_map( fn( $s ) => $s['type'] ?? '?', $p['sections'] ?? [] );
                $pages_list .= '<li><strong>' . esc_html( $p['title'] ?? '' ) . '</strong> · ' . esc_html( implode( ', ', $sections ) ) . '</li>';
            }
        }

        $sector_labels = aiwd_sectors();
        $tone_labels   = aiwd_tones();

        ob_start(); ?>
        <!doctype html>
        <html lang="es"><head><meta charset="utf-8">
        <title>Propuesta · <?php echo esc_html( $post->post_title ); ?></title>
        <style>
            body { font-family: 'Helvetica', Arial, sans-serif; color: #1d2327; margin: 0; padding: 40px; line-height: 1.5; }
            h1, h2, h3 { color: <?php echo esc_attr( $color ); ?>; }
            h1 { font-size: 32px; margin: 0 0 8px; }
            h2 { font-size: 20px; border-bottom: 2px solid <?php echo esc_attr( $color ); ?>; padding-bottom: 4px; margin-top: 30px; }
            .cover { text-align: center; padding: 60px 0; border-bottom: 4px solid <?php echo esc_attr( $color ); ?>; margin-bottom: 30px; }
            .pill { display: inline-block; background: <?php echo esc_attr( $color ); ?>; color: #fff; padding: 4px 10px; border-radius: 12px; font-size: 12px; }
            table { width: 100%; border-collapse: collapse; margin: 12px 0; }
            td, th { padding: 8px; border-bottom: 1px solid #e2e4e7; text-align: left; }
            th { background: #f6f7f7; }
            ul { padding-left: 20px; }
            .footer { margin-top: 50px; padding-top: 16px; border-top: 1px solid #e2e4e7; font-size: 12px; color: #6c757d; text-align: center; }
        </style>
        </head><body>

        <section class="cover">
            <?php echo $logo_html; ?>
            <h1><?php echo esc_html( $post->post_title ); ?></h1>
            <p class="pill"><?php esc_html_e( 'Propuesta de diseño web', 'ai-web-designer' ); ?></p>
            <p><?php echo esc_html( date_i18n( 'd/m/Y' ) ); ?></p>
        </section>

        <h2><?php esc_html_e( 'Resumen del proyecto', 'ai-web-designer' ); ?></h2>
        <table>
            <tr><th><?php esc_html_e( 'Negocio', 'ai-web-designer' ); ?></th><td><?php echo esc_html( $b['business_name'] ?? '' ); ?></td></tr>
            <tr><th><?php esc_html_e( 'Sector', 'ai-web-designer' ); ?></th><td><?php echo esc_html( $sector_labels[ $b['sector'] ?? '' ] ?? '—' ); ?></td></tr>
            <tr><th><?php esc_html_e( 'Tono', 'ai-web-designer' ); ?></th><td><?php echo esc_html( $tone_labels[ $b['tone'] ?? '' ] ?? '—' ); ?></td></tr>
            <tr><th><?php esc_html_e( 'Público', 'ai-web-designer' ); ?></th><td><?php echo esc_html( $b['audience'] ?? '' ); ?></td></tr>
            <tr><th><?php esc_html_e( 'Dominio', 'ai-web-designer' ); ?></th><td><?php echo esc_html( $c['domain'] ?? '' ); ?></td></tr>
        </table>

        <h2><?php esc_html_e( 'Descripción', 'ai-web-designer' ); ?></h2>
        <p><?php echo nl2br( esc_html( $b['description'] ?? '' ) ); ?></p>

        <h2><?php esc_html_e( 'Estructura propuesta del sitio', 'ai-web-designer' ); ?></h2>
        <?php if ( $pages_list ) : ?>
            <ul><?php echo $pages_list; ?></ul>
        <?php else : ?>
            <p><?php esc_html_e( 'Genera el diseño desde el wizard para incluir la estructura aquí.', 'ai-web-designer' ); ?></p>
        <?php endif; ?>

        <h2><?php esc_html_e( 'Identidad visual', 'ai-web-designer' ); ?></h2>
        <table>
            <tr><th><?php esc_html_e( 'Color primario', 'ai-web-designer' ); ?></th><td><span style="display:inline-block;width:16px;height:16px;background:<?php echo esc_attr( $br['color_primary'] ?? '' ); ?>;border:1px solid #ccc;vertical-align:middle"></span> <?php echo esc_html( $br['color_primary'] ?? '' ); ?></td></tr>
            <tr><th><?php esc_html_e( 'Color secundario', 'ai-web-designer' ); ?></th><td><?php echo esc_html( $br['color_secondary'] ?? '' ); ?></td></tr>
            <tr><th><?php esc_html_e( 'Color acento', 'ai-web-designer' ); ?></th><td><?php echo esc_html( $br['color_accent'] ?? '' ); ?></td></tr>
            <tr><th><?php esc_html_e( 'Tipografía titulares', 'ai-web-designer' ); ?></th><td><?php echo esc_html( $br['font_heading'] ?? '' ); ?></td></tr>
            <tr><th><?php esc_html_e( 'Tipografía cuerpo', 'ai-web-designer' ); ?></th><td><?php echo esc_html( $br['font_body'] ?? '' ); ?></td></tr>
        </table>

        <h2><?php esc_html_e( 'Datos de contacto', 'ai-web-designer' ); ?></h2>
        <table>
            <tr><th>Email</th><td><?php echo esc_html( $c['email'] ?? '' ); ?></td></tr>
            <tr><th>Teléfono</th><td><?php echo esc_html( $c['phone'] ?? '' ); ?></td></tr>
            <tr><th>WhatsApp</th><td><?php echo esc_html( $c['whatsapp'] ?? '' ); ?></td></tr>
            <tr><th>Dirección</th><td><?php echo esc_html( $c['address'] ?? '' ); ?></td></tr>
        </table>

        <div class="footer">
            <?php printf( esc_html__( 'Propuesta generada con AI Web Designer · %s', 'ai-web-designer' ), esc_html( get_bloginfo( 'name' ) ) ); ?>
        </div>

        </body></html>
        <?php
        return ob_get_clean();
    }
}
