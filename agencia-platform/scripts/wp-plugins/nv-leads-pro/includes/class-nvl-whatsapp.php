<?php
/**
 * Helpers para enlaces de WhatsApp (wa.me).
 *
 * El plugin no envía mensajes automáticamente para evitar baneo del número y
 * cumplir ToS de WhatsApp. Genera enlaces personalizados que abren WhatsApp Web
 * o la app con el texto pre-rellenado para envío manual con un clic.
 */

if ( ! defined( 'WPINC' ) ) {
    die;
}

class NVL_WhatsApp {

    /**
     * Normaliza un número de teléfono a formato E.164 sin el "+" para wa.me.
     */
    public static function normalize_phone( $phone, $default_country_code = '34' ) {
        if ( empty( $phone ) ) {
            return '';
        }
        // Quitar todo lo que no sea dígito o +.
        $clean = preg_replace( '/[^\d+]/', '', $phone );

        if ( strpos( $clean, '+' ) === 0 ) {
            return substr( $clean, 1 );
        }

        // Si empieza por 00, sustituir por nada (prefijo internacional español).
        if ( strpos( $clean, '00' ) === 0 ) {
            return substr( $clean, 2 );
        }

        // Si tiene 9 dígitos y prefijo país por defecto es España, prepender 34.
        if ( strlen( $clean ) === 9 ) {
            return $default_country_code . $clean;
        }

        return $clean;
    }

    /**
     * Construye un enlace wa.me con el mensaje pre-rellenado.
     */
    public static function build_link( $phone, $message, $default_country_code = '34' ) {
        $number = self::normalize_phone( $phone, $default_country_code );
        if ( ! $number ) {
            return '';
        }
        $url = 'https://wa.me/' . $number . '?text=' . rawurlencode( $message );
        return $url;
    }
}
