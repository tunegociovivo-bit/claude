<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

class AIWD_Image_Generator {

    public function generate( $prompt, array $opts = [] ) {
        $provider = aiwd_get_option( 'image_provider', 'openai' );
        $key      = aiwd_get_option( 'image_api_key' );
        if ( empty( $key ) ) {
            return new WP_Error( 'aiwd_no_key', __( 'Falta API key del proveedor de imágenes.', 'ai-web-designer' ) );
        }
        switch ( $provider ) {
            case 'openai':     return $this->generate_openai( $prompt, $key, $opts );
            case 'stability':  return $this->generate_stability( $prompt, $key, $opts );
            case 'replicate':  return $this->generate_replicate( $prompt, $key, $opts );
            case 'flux':       return $this->generate_flux( $prompt, $key, $opts );
            default:           return new WP_Error( 'aiwd_provider', __( 'Proveedor no soportado.', 'ai-web-designer' ) );
        }
    }

    private function generate_openai( $prompt, $key, $opts ) {
        $body = [
            'model'  => $opts['model']  ?? 'gpt-image-1',
            'prompt' => $prompt,
            'size'   => $opts['size']   ?? '1536x1024',
            'n'      => $opts['n']      ?? 1,
        ];
        $resp = wp_remote_post( 'https://api.openai.com/v1/images/generations', [
            'timeout' => 120,
            'headers' => [
                'Authorization' => 'Bearer ' . $key,
                'Content-Type'  => 'application/json',
            ],
            'body'    => wp_json_encode( $body ),
        ] );
        if ( is_wp_error( $resp ) ) return $resp;
        $data = json_decode( wp_remote_retrieve_body( $resp ), true );
        return $this->process_image_data( $data );
    }

    private function generate_stability( $prompt, $key, $opts ) {
        $resp = wp_remote_post( 'https://api.stability.ai/v2beta/stable-image/generate/core', [
            'timeout' => 120,
            'headers' => [ 'Authorization' => 'Bearer ' . $key, 'Accept' => 'application/json' ],
            'body'    => [ 'prompt' => $prompt, 'aspect_ratio' => $opts['aspect'] ?? '16:9' ],
        ] );
        if ( is_wp_error( $resp ) ) return $resp;
        $data = json_decode( wp_remote_retrieve_body( $resp ), true );
        $b64  = $data['image'] ?? '';
        if ( ! $b64 ) return new WP_Error( 'aiwd_no_image', 'Sin imagen' );
        return [ $this->save_b64_to_media( $b64, 'aiwd-img.png' ) ];
    }

    private function generate_replicate( $prompt, $key, $opts ) {
        return new WP_Error( 'aiwd_todo', 'Replicate aún no implementado en esta versión.' );
    }

    private function generate_flux( $prompt, $key, $opts ) {
        $resp = wp_remote_post( 'https://api.bfl.ai/v1/flux-pro', [
            'timeout' => 120,
            'headers' => [ 'x-key' => $key, 'Content-Type' => 'application/json' ],
            'body'    => wp_json_encode( [ 'prompt' => $prompt, 'width' => 1536, 'height' => 1024 ] ),
        ] );
        if ( is_wp_error( $resp ) ) return $resp;
        $data = json_decode( wp_remote_retrieve_body( $resp ), true );
        $url  = $data['result']['sample'] ?? '';
        if ( ! $url ) return new WP_Error( 'aiwd_no_image', 'Sin imagen' );
        return [ $this->save_url_to_media( $url ) ];
    }

    private function process_image_data( $data ) {
        $ids = [];
        foreach ( $data['data'] ?? [] as $item ) {
            if ( ! empty( $item['url'] ) ) {
                $ids[] = $this->save_url_to_media( $item['url'] );
            } elseif ( ! empty( $item['b64_json'] ) ) {
                $ids[] = $this->save_b64_to_media( $item['b64_json'], 'aiwd-img.png' );
            }
        }
        return $ids;
    }

    public function save_url_to_media( $url ) {
        require_once ABSPATH . 'wp-admin/includes/file.php';
        require_once ABSPATH . 'wp-admin/includes/media.php';
        require_once ABSPATH . 'wp-admin/includes/image.php';

        $tmp = download_url( $url, 60 );
        if ( is_wp_error( $tmp ) ) return 0;
        $file = [ 'name' => 'aiwd-' . wp_generate_uuid4() . '.png', 'tmp_name' => $tmp ];
        $id = media_handle_sideload( $file, 0 );
        if ( is_wp_error( $id ) ) {
            @unlink( $tmp );
            return 0;
        }
        update_post_meta( $id, '_aiwd_ai_generated', 1 );
        return (int) $id;
    }

    public function save_b64_to_media( $b64, $filename = 'aiwd.png' ) {
        $upload = wp_upload_dir();
        $path   = trailingslashit( $upload['path'] ) . wp_generate_uuid4() . '-' . sanitize_file_name( $filename );
        file_put_contents( $path, base64_decode( $b64 ) );
        require_once ABSPATH . 'wp-admin/includes/image.php';
        $id = wp_insert_attachment( [
            'post_mime_type' => 'image/png',
            'post_title'     => sanitize_file_name( $filename ),
            'post_status'    => 'inherit',
        ], $path );
        if ( ! is_wp_error( $id ) && $id ) {
            $meta = wp_generate_attachment_metadata( $id, $path );
            wp_update_attachment_metadata( $id, $meta );
            update_post_meta( $id, '_aiwd_ai_generated', 1 );
            return (int) $id;
        }
        return 0;
    }

    public function remove_background( $attachment_id ) {
        $key = aiwd_get_option( 'remove_bg_api_key' );
        if ( ! $key ) return new WP_Error( 'aiwd_no_key', 'Falta API Key Remove.bg' );
        $path = get_attached_file( $attachment_id );
        if ( ! $path ) return new WP_Error( 'aiwd_no_file', 'Archivo no encontrado' );

        $resp = wp_remote_post( 'https://api.remove.bg/v1.0/removebg', [
            'timeout' => 60,
            'headers' => [ 'X-Api-Key' => $key ],
            'body'    => [ 'image_file_b64' => base64_encode( file_get_contents( $path ) ), 'size' => 'auto' ],
        ] );
        if ( is_wp_error( $resp ) ) return $resp;
        $body = wp_remote_retrieve_body( $resp );
        file_put_contents( $path, $body );
        return $attachment_id;
    }
}
