<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

function aiwd_get_option( $key, $default = '' ) {
    $options = get_option( 'aiwd_settings', [] );
    return $options[ $key ] ?? $default;
}

function aiwd_update_option( $key, $value ) {
    $options = get_option( 'aiwd_settings', [] );
    $options[ $key ] = $value;
    update_option( 'aiwd_settings', $options );
}

function aiwd_sanitize_array( $array ) {
    if ( ! is_array( $array ) ) {
        return [];
    }
    $clean = [];
    foreach ( $array as $key => $value ) {
        $sk = sanitize_key( $key );
        if ( is_array( $value ) ) {
            $clean[ $sk ] = aiwd_sanitize_array( $value );
        } else {
            $clean[ $sk ] = is_string( $value ) ? wp_kses_post( $value ) : $value;
        }
    }
    return $clean;
}

function aiwd_log( $msg, $context = [] ) {
    if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
        error_log( '[AIWD] ' . ( is_string( $msg ) ? $msg : wp_json_encode( $msg ) ) . ' ' . wp_json_encode( $context ) );
    }
}

function aiwd_current_user_can_manage() {
    return current_user_can( 'manage_options' ) || current_user_can( 'aiwd_manage_projects' );
}

function aiwd_project_statuses() {
    return [
        'draft'    => __( 'Borrador', 'ai-web-designer' ),
        'briefing' => __( 'Briefing en curso', 'ai-web-designer' ),
        'review'   => __( 'En revisión', 'ai-web-designer' ),
        'approved' => __( 'Aprobado', 'ai-web-designer' ),
        'published'=> __( 'Publicado', 'ai-web-designer' ),
    ];
}

function aiwd_sectors() {
    return [
        'restaurant' => __( 'Restaurante / Hostelería', 'ai-web-designer' ),
        'legal'      => __( 'Abogados / Asesoría', 'ai-web-designer' ),
        'clinic'     => __( 'Clínica / Salud', 'ai-web-designer' ),
        'ecommerce'  => __( 'Ecommerce', 'ai-web-designer' ),
        'portfolio'  => __( 'Portfolio / Creativos', 'ai-web-designer' ),
        'real_estate'=> __( 'Inmobiliaria', 'ai-web-designer' ),
        'education'  => __( 'Educación / Cursos', 'ai-web-designer' ),
        'beauty'     => __( 'Belleza / Estética', 'ai-web-designer' ),
        'construction'=> __( 'Construcción / Reformas', 'ai-web-designer' ),
        'tech'       => __( 'Tecnología / SaaS', 'ai-web-designer' ),
        'nonprofit'  => __( 'ONG / Asociación', 'ai-web-designer' ),
        'other'      => __( 'Otro', 'ai-web-designer' ),
    ];
}

function aiwd_tones() {
    return [
        'professional' => __( 'Profesional', 'ai-web-designer' ),
        'friendly'     => __( 'Cercano / Amigable', 'ai-web-designer' ),
        'luxury'       => __( 'Lujo / Premium', 'ai-web-designer' ),
        'fun'          => __( 'Divertido / Casual', 'ai-web-designer' ),
        'technical'    => __( 'Técnico / Experto', 'ai-web-designer' ),
        'inspirational'=> __( 'Inspiracional', 'ai-web-designer' ),
    ];
}
