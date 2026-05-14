<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

/**
 * Gestión cifrada de API keys y otros secretos.
 *
 * Las claves sensibles se guardan en option separado 'aiwd_secrets' cifrado con
 * AES-256-CBC. La clave de cifrado deriva de LOGGED_IN_KEY + LOGGED_IN_SALT de
 * wp-config.php (así no hace falta gestionar una clave extra y queda atada al sitio).
 *
 * Para el resto del código, aiwd_get_option() detecta automáticamente si la
 * clave pedida es un secreto y la descifra.
 */
class AIWD_Secrets {

    const OPTION    = 'aiwd_secrets';
    const CIPHER    = 'aes-256-cbc';
    const PREFIX    = 'aiwd_enc_v1:';

    public static function secret_keys() {
        return apply_filters( 'aiwd_secret_keys', [
            'claude_api_key',
            'image_api_key',
            'remove_bg_api_key',
            'whisper_api_key',
            'gmb_api_key',
            'maps_api_key',
            'asana_token',
        ] );
    }

    public static function is_secret( $key ) {
        return in_array( $key, self::secret_keys(), true );
    }

    private static function derive_key() {
        $raw = '';
        if ( defined( 'LOGGED_IN_KEY' ) )  $raw .= LOGGED_IN_KEY;
        if ( defined( 'LOGGED_IN_SALT' ) ) $raw .= LOGGED_IN_SALT;
        if ( ! $raw && defined( 'AUTH_KEY' ) ) $raw = AUTH_KEY;
        if ( ! $raw ) $raw = wp_salt( 'auth' );
        return hash( 'sha256', $raw, true );
    }

    public static function encrypt( $plain ) {
        if ( $plain === '' || $plain === null ) return '';
        if ( ! function_exists( 'openssl_encrypt' ) ) return $plain;
        $iv  = random_bytes( openssl_cipher_iv_length( self::CIPHER ) );
        $enc = openssl_encrypt( (string) $plain, self::CIPHER, self::derive_key(), OPENSSL_RAW_DATA, $iv );
        if ( $enc === false ) return $plain;
        return self::PREFIX . base64_encode( $iv . $enc );
    }

    public static function decrypt( $value ) {
        if ( ! is_string( $value ) || strpos( $value, self::PREFIX ) !== 0 ) return $value;
        if ( ! function_exists( 'openssl_decrypt' ) ) return '';
        $raw = base64_decode( substr( $value, strlen( self::PREFIX ) ), true );
        if ( $raw === false ) return '';
        $ivlen = openssl_cipher_iv_length( self::CIPHER );
        $iv  = substr( $raw, 0, $ivlen );
        $ct  = substr( $raw, $ivlen );
        $dec = openssl_decrypt( $ct, self::CIPHER, self::derive_key(), OPENSSL_RAW_DATA, $iv );
        return $dec === false ? '' : $dec;
    }

    public static function get( $key, $default = '' ) {
        $all = get_option( self::OPTION, [] );
        if ( empty( $all[ $key ] ) ) return $default;
        return self::decrypt( $all[ $key ] );
    }

    public static function set( $key, $value ) {
        $all = get_option( self::OPTION, [] );
        $all[ $key ] = self::encrypt( $value );
        update_option( self::OPTION, $all, false );
    }

    /**
     * Migra cualquier clave secreta presente en aiwd_settings a aiwd_secrets cifrada.
     */
    public static function migrate_from_settings() {
        $settings = get_option( 'aiwd_settings', [] );
        if ( ! is_array( $settings ) ) return;
        $moved = false;
        foreach ( self::secret_keys() as $key ) {
            if ( ! empty( $settings[ $key ] ) ) {
                self::set( $key, $settings[ $key ] );
                $settings[ $key ] = '';
                $moved = true;
            }
        }
        if ( $moved ) {
            update_option( 'aiwd_settings', $settings );
        }
    }

    /**
     * Hook: cuando se guardan los settings desde la UI, mover automáticamente
     * los campos secretos a aiwd_secrets cifrados.
     */
    public static function intercept_settings_save( $new_value, $old_value ) {
        if ( ! is_array( $new_value ) ) return $new_value;
        foreach ( self::secret_keys() as $key ) {
            if ( ! empty( $new_value[ $key ] ) ) {
                self::set( $key, $new_value[ $key ] );
                $new_value[ $key ] = '';
                do_action( 'aiwd_secret_updated', $key );
            } else {
                // Si el campo viene vacío, no tocar la cifrada existente.
                $new_value[ $key ] = '';
            }
        }
        return $new_value;
    }
}

add_filter( 'pre_update_option_aiwd_settings', [ 'AIWD_Secrets', 'intercept_settings_save' ], 10, 2 );
