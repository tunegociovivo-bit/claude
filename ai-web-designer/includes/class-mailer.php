<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

/**
 * Sistema central de email con plantillas HTML, placeholders y branding agencia.
 *
 * Settings esperados (en aiwd_settings):
 *   notify_enabled         (bool)
 *   notify_from_name       (string)
 *   notify_from_email      (string)
 *   notify_brand_color     (hex)
 *   notify_logo_url        (url)
 *   notify_signature_html  (html)
 *   notify_events          (array, ej: ['client_briefing'=>1,'design_generated'=>1,...])
 *   notify_email_team      (string, csv emails)
 */
class AIWD_Mailer {

    public static function is_enabled() {
        return (int) aiwd_get_option( 'notify_enabled', 1 ) === 1;
    }

    public static function event_enabled( $event ) {
        $events = (array) aiwd_get_option( 'notify_events', [] );
        return ! empty( $events[ $event ] );
    }

    public static function from() {
        $name  = aiwd_get_option( 'notify_from_name',  get_bloginfo( 'name' ) );
        $email = aiwd_get_option( 'notify_from_email', get_bloginfo( 'admin_email' ) );
        return [ $name, $email ];
    }

    public static function team_emails() {
        $raw = (string) aiwd_get_option( 'notify_email_team', '' );
        $list = array_filter( array_map( 'trim', explode( ',', $raw ) ) );
        if ( ! $list ) {
            $list = [ get_bloginfo( 'admin_email' ) ];
        }
        return array_values( array_filter( $list, 'is_email' ) );
    }

    public static function send( $to, $subject, $body_html, $replace = [] ) {
        if ( ! self::is_enabled() ) return false;
        if ( ! $to ) return false;

        list( $from_name, $from_email ) = self::from();

        $replace = array_merge( [
            '{site_name}'   => get_bloginfo( 'name' ),
            '{site_url}'    => home_url(),
            '{admin_url}'   => admin_url( 'admin.php?page=aiwd-dashboard' ),
            '{date}'        => date_i18n( get_option( 'date_format' ) ),
        ], $replace );

        $subject = strtr( $subject, $replace );
        $body    = self::wrap_html( strtr( $body_html, $replace ) );

        $headers = [
            'Content-Type: text/html; charset=UTF-8',
            sprintf( 'From: %s <%s>', $from_name, $from_email ),
        ];

        $result = wp_mail( $to, $subject, $body, $headers );
        aiwd_log( 'mail.send', [ 'to' => $to, 'subject' => $subject, 'ok' => $result ] );
        return $result;
    }

    public static function wrap_html( $inner_html ) {
        $color = aiwd_get_option( 'notify_brand_color', '#2271b1' );
        $logo  = aiwd_get_option( 'notify_logo_url', '' );
        $signature = aiwd_get_option( 'notify_signature_html', '<p>— ' . esc_html( get_bloginfo( 'name' ) ) . '</p>' );

        $logo_html = $logo ? '<img src="' . esc_url( $logo ) . '" style="max-height:48px;display:block;margin:0 auto 16px" alt="" />' : '';

        return '<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7f7;font-family:Helvetica,Arial,sans-serif;color:#1d2327">
            <table cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden">
                <tr><td style="background:' . esc_attr( $color ) . ';padding:20px;text-align:center">' . $logo_html . '</td></tr>
                <tr><td style="padding:28px;line-height:1.55;font-size:15px">' . $inner_html . '<hr style="border:none;border-top:1px solid #e2e4e7;margin:24px 0">' . wp_kses_post( $signature ) . '</td></tr>
            </table>
            <p style="text-align:center;font-size:11px;color:#888;margin-top:12px">{date} · {site_name}</p>
            </body></html>';
    }

    /**
     * Plantillas por evento. Cada una devuelve [ subject, html ].
     */
    public static function templates() {
        return [
            'client_briefing' => [
                'label'   => __( 'Onboarding cliente (envío de magic-link)', 'ai-web-designer' ),
                'to'      => 'client',
                'subject' => __( 'Bienvenido — Empecemos con tu web ({project_name})', 'ai-web-designer' ),
                'html'    => '<h2>¡Bienvenido a tu proyecto web!</h2>
                              <p>Hola{client_name_label}, estamos listos para empezar con <strong>{project_name}</strong>.</p>
                              <p>Para que podamos avanzar, rellena el briefing en este enlace personal (válido 30 días):</p>
                              <p style="text-align:center;margin:24px 0"><a href="{magic_link}" style="background:{brand_color};color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;display:inline-block">Rellenar mi briefing</a></p>
                              <p>Si tienes dudas, responde directamente a este email.</p>',
            ],
            'client_briefing_completed' => [
                'label'   => __( 'Cliente completó el briefing → diseñador', 'ai-web-designer' ),
                'to'      => 'team',
                'subject' => __( '✅ Briefing completado — {project_name}', 'ai-web-designer' ),
                'html'    => '<h2>Briefing completado</h2>
                              <p>El cliente ha guardado el briefing de <strong>{project_name}</strong>.</p>
                              <p><a href="{project_url}">Abrir el proyecto</a></p>',
            ],
            'section_comment' => [
                'label'   => __( 'Comentario en sección del proyecto', 'ai-web-designer' ),
                'to'      => 'team',
                'subject' => __( '💬 Nuevo comentario en {project_name} — {section}', 'ai-web-designer' ),
                'html'    => '<h2>Nuevo comentario</h2>
                              <p>En <strong>{project_name}</strong>, sección <em>{section}</em>:</p>
                              <blockquote style="border-left:3px solid {brand_color};padding-left:12px;color:#444">{body}</blockquote>
                              <p><a href="{project_url}">Abrir el proyecto</a></p>',
            ],
            'design_generated' => [
                'label'   => __( 'Diseño generado por Claude', 'ai-web-designer' ),
                'to'      => 'team',
                'subject' => __( '🎨 Diseño generado — {project_name}', 'ai-web-designer' ),
                'html'    => '<h2>Diseño listo para revisión</h2>
                              <p>Se acaba de generar el diseño de <strong>{project_name}</strong>.</p>
                              <p><a href="{project_url}">Revisar</a></p>',
            ],
            'section_approved' => [
                'label'   => __( 'Sección aprobada', 'ai-web-designer' ),
                'to'      => 'team',
                'subject' => __( '👍 Sección aprobada — {project_name} ({section})', 'ai-web-designer' ),
                'html'    => '<h2>Sección aprobada</h2>
                              <p>En <strong>{project_name}</strong> se aprobó la sección <em>{section}</em>.</p>
                              <p><a href="{project_url}">Ver detalle</a></p>',
            ],
            'qa_passed' => [
                'label'   => __( 'QA completado (todos los checks OK)', 'ai-web-designer' ),
                'to'      => 'team',
                'subject' => __( '✅ QA completo — {project_name} listo para publicar', 'ai-web-designer' ),
                'html'    => '<h2>QA superado</h2>
                              <p>El proyecto <strong>{project_name}</strong> ha pasado todos los checks requeridos.</p>
                              <p><a href="{project_url}">Marcar como publicado</a></p>',
            ],
            'project_published' => [
                'label'   => __( 'Proyecto publicado', 'ai-web-designer' ),
                'to'      => 'team',
                'subject' => __( '🚀 Web publicada — {project_name}', 'ai-web-designer' ),
                'html'    => '<h2>Web publicada</h2>
                              <p><strong>{project_name}</strong> está oficialmente entregada.</p>
                              <p>Buen trabajo equipo.</p>',
            ],
            'briefing_reminder' => [
                'label'   => __( 'Recordatorio al cliente: briefing pendiente', 'ai-web-designer' ),
                'to'      => 'client',
                'subject' => __( 'Recordatorio: tu briefing de {project_name} sigue pendiente', 'ai-web-designer' ),
                'html'    => '<h2>Te esperamos para empezar</h2>
                              <p>Hola{client_name_label}, no hemos recibido aún tu briefing para <strong>{project_name}</strong>. Es rápido y nos permite arrancar:</p>
                              <p style="text-align:center;margin:24px 0"><a href="{magic_link}" style="background:{brand_color};color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;display:inline-block">Rellenar ahora</a></p>',
            ],
        ];
    }

    public static function send_event( $event, array $vars = [], $to_override = '' ) {
        if ( ! self::event_enabled( $event ) ) return false;
        $templates = self::templates();
        $tpl = $templates[ $event ] ?? null;
        if ( ! $tpl ) return false;

        $vars['{brand_color}'] = aiwd_get_option( 'notify_brand_color', '#2271b1' );

        if ( $to_override ) {
            $to = $to_override;
        } elseif ( ( $tpl['to'] ?? '' ) === 'team' ) {
            $to = self::team_emails();
        } else {
            $to = $vars['{client_email}'] ?? '';
        }
        if ( ! $to ) return false;

        return self::send( $to, $tpl['subject'], $tpl['html'], $vars );
    }
}
