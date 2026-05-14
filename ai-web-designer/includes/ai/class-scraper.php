<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

class AIWD_Scraper {

    /**
     * Extrae info básica desde un dominio: title, description, og:image, logo, colores aproximados.
     */
    public function scrape( $url ) {
        $url = esc_url_raw( $url );
        if ( ! $url ) return new WP_Error( 'aiwd_bad_url', __( 'URL inválida', 'ai-web-designer' ) );

        $resp = wp_remote_get( $url, [
            'timeout'   => 25,
            'user-agent'=> 'Mozilla/5.0 AIWD Scraper',
            'sslverify' => false,
        ] );
        if ( is_wp_error( $resp ) ) return $resp;
        $html = wp_remote_retrieve_body( $resp );
        if ( ! $html ) return new WP_Error( 'aiwd_empty', 'HTML vacío' );

        $result = [
            'title'       => $this->meta( $html, 'title' ),
            'description' => $this->meta_attr( $html, 'name', 'description' ),
            'og_image'    => $this->meta_attr( $html, 'property', 'og:image' ),
            'og_title'    => $this->meta_attr( $html, 'property', 'og:title' ),
            'og_desc'     => $this->meta_attr( $html, 'property', 'og:description' ),
            'favicon'     => $this->link_attr( $html, 'icon' ),
            'logo'        => $this->find_logo( $html, $url ),
            'colors'      => $this->extract_colors_from_css( $html ),
            'phones'      => $this->find_phones( $html ),
            'emails'      => $this->find_emails( $html ),
            'social'      => $this->find_social( $html ),
        ];

        return $result;
    }

    private function meta( $html, $tag ) {
        $pattern = '/<' . preg_quote( $tag, '/' ) . '[^>]*>(.*?)<\/' . preg_quote( $tag, '/' ) . '>/is';
        if ( preg_match( $pattern, $html, $m ) ) {
            return trim( wp_strip_all_tags( $m[1] ) );
        }
        return '';
    }

    private function meta_attr( $html, $attr, $value ) {
        $pattern = '/<meta[^>]*' . preg_quote( $attr, '/' ) . '=["\']' . preg_quote( $value, '/' ) . '["\'][^>]*content=["\']([^"\']+)["\']/i';
        if ( preg_match( $pattern, $html, $m ) ) return trim( $m[1] );
        $pattern2 = '/<meta[^>]*content=["\']([^"\']+)["\'][^>]*' . preg_quote( $attr, '/' ) . '=["\']' . preg_quote( $value, '/' ) . '["\']/i';
        if ( preg_match( $pattern2, $html, $m ) ) return trim( $m[1] );
        return '';
    }

    private function link_attr( $html, $rel ) {
        if ( preg_match( '/<link[^>]*rel=["\'][^"\']*' . preg_quote( $rel, '/' ) . '[^"\']*["\'][^>]*href=["\']([^"\']+)["\']/i', $html, $m ) ) {
            return $m[1];
        }
        return '';
    }

    private function find_logo( $html, $base ) {
        if ( preg_match( '/<img[^>]+(?:class|id|alt)=["\'][^"\']*logo[^"\']*["\'][^>]*src=["\']([^"\']+)["\']/i', $html, $m ) ) {
            return $this->absolute_url( $m[1], $base );
        }
        return '';
    }

    private function absolute_url( $maybe_relative, $base ) {
        if ( preg_match( '#^https?://#', $maybe_relative ) ) return $maybe_relative;
        $parts = wp_parse_url( $base );
        $root  = ( $parts['scheme'] ?? 'https' ) . '://' . ( $parts['host'] ?? '' );
        return $root . '/' . ltrim( $maybe_relative, '/' );
    }

    private function extract_colors_from_css( $html ) {
        $colors = [];
        if ( preg_match_all( '/#[0-9a-fA-F]{6}\b/', $html, $m ) ) {
            $count = array_count_values( $m[0] );
            arsort( $count );
            $colors = array_slice( array_keys( $count ), 0, 6 );
        }
        return $colors;
    }

    private function find_phones( $html ) {
        if ( preg_match_all( '/(\+?\d{1,3}[\s\-]?)?(\(?\d{2,4}\)?[\s\-]?\d{3,4}[\s\-]?\d{3,4})/', $html, $m ) ) {
            return array_values( array_unique( array_filter( $m[0] ) ) );
        }
        return [];
    }

    private function find_emails( $html ) {
        if ( preg_match_all( '/[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/', $html, $m ) ) {
            return array_values( array_unique( $m[0] ) );
        }
        return [];
    }

    private function find_social( $html ) {
        $networks = [ 'instagram' => 'instagram.com', 'facebook' => 'facebook.com', 'linkedin' => 'linkedin.com', 'youtube' => 'youtube.com', 'tiktok' => 'tiktok.com', 'twitter' => 'twitter.com', 'x.com' => 'x.com' ];
        $found = [];
        foreach ( $networks as $name => $host ) {
            if ( preg_match( '#https?://(?:www\.)?' . preg_quote( $host, '#' ) . '/[^"\'\s<>]+#i', $html, $m ) ) {
                $found[ $name ] = $m[0];
            }
        }
        return $found;
    }
}
