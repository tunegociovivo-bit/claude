<?php if ( ! defined( 'ABSPATH' ) ) { exit; }
$s = get_option( 'aiwd_settings', [] );
?>
<div class="wrap aiwd-wrap">
    <h1><?php esc_html_e( 'Ajustes — AI Web Designer', 'ai-web-designer' ); ?></h1>
    <form method="post" action="options.php">
        <?php settings_fields( 'aiwd_settings_group' ); ?>

        <h2><?php esc_html_e( 'Claude API', 'ai-web-designer' ); ?></h2>
        <table class="form-table">
            <tr><th><?php esc_html_e( 'API Key', 'ai-web-designer' ); ?></th>
                <td><input type="password" name="aiwd_settings[claude_api_key]" class="regular-text" value="<?php echo esc_attr( $s['claude_api_key'] ?? '' ); ?>" /></td></tr>
            <tr><th><?php esc_html_e( 'Modelo', 'ai-web-designer' ); ?></th>
                <td><select name="aiwd_settings[claude_model]">
                    <?php foreach ( [ 'claude-opus-4-7','claude-sonnet-4-6','claude-haiku-4-5-20251001' ] as $m ) : ?>
                        <option value="<?php echo esc_attr( $m ); ?>" <?php selected( ( $s['claude_model'] ?? '' ), $m ); ?>><?php echo esc_html( $m ); ?></option>
                    <?php endforeach; ?>
                </select></td></tr>
            <tr><th><?php esc_html_e( 'Endpoint Claude Design', 'ai-web-designer' ); ?></th>
                <td><input type="url" name="aiwd_settings[claude_design_endpoint]" class="regular-text" value="<?php echo esc_attr( $s['claude_design_endpoint'] ?? '' ); ?>" placeholder="https://api.anthropic.com/v1/messages" /></td></tr>
        </table>

        <h2><?php esc_html_e( 'Generación de imágenes', 'ai-web-designer' ); ?></h2>
        <table class="form-table">
            <tr><th><?php esc_html_e( 'Proveedor', 'ai-web-designer' ); ?></th>
                <td><select name="aiwd_settings[image_provider]">
                    <?php foreach ( [ 'openai' => 'OpenAI / DALL·E', 'stability' => 'Stability AI', 'flux' => 'Flux', 'replicate' => 'Replicate', 'midjourney' => 'Midjourney (vía proxy)' ] as $k => $v ) : ?>
                        <option value="<?php echo esc_attr( $k ); ?>" <?php selected( ( $s['image_provider'] ?? '' ), $k ); ?>><?php echo esc_html( $v ); ?></option>
                    <?php endforeach; ?>
                </select></td></tr>
            <tr><th><?php esc_html_e( 'API Key imágenes', 'ai-web-designer' ); ?></th>
                <td><input type="password" name="aiwd_settings[image_api_key]" class="regular-text" value="<?php echo esc_attr( $s['image_api_key'] ?? '' ); ?>" /></td></tr>
            <tr><th><?php esc_html_e( 'API Key Remove.bg', 'ai-web-designer' ); ?></th>
                <td><input type="password" name="aiwd_settings[remove_bg_api_key]" class="regular-text" value="<?php echo esc_attr( $s['remove_bg_api_key'] ?? '' ); ?>" /></td></tr>
        </table>

        <h2><?php esc_html_e( 'Defaults', 'ai-web-designer' ); ?></h2>
        <table class="form-table">
            <tr><th><?php esc_html_e( 'País por defecto', 'ai-web-designer' ); ?></th><td><input type="text" name="aiwd_settings[default_country]" value="<?php echo esc_attr( $s['default_country'] ?? 'ES' ); ?>" /></td></tr>
            <tr><th><?php esc_html_e( 'Idioma por defecto', 'ai-web-designer' ); ?></th><td><input type="text" name="aiwd_settings[default_language]" value="<?php echo esc_attr( $s['default_language'] ?? 'es_ES' ); ?>" /></td></tr>
            <tr><th><?php esc_html_e( 'Modo agencia (multi-cliente)', 'ai-web-designer' ); ?></th><td><label><input type="checkbox" name="aiwd_settings[enable_agency_mode]" value="1" <?php checked( ! empty( $s['enable_agency_mode'] ) ); ?> /> <?php esc_html_e( 'Activar', 'ai-web-designer' ); ?></label></td></tr>
            <tr><th><?php esc_html_e( 'Multi-idioma (WPML/Polylang)', 'ai-web-designer' ); ?></th><td><label><input type="checkbox" name="aiwd_settings[enable_multilang]" value="1" <?php checked( ! empty( $s['enable_multilang'] ) ); ?> /> <?php esc_html_e( 'Activar', 'ai-web-designer' ); ?></label></td></tr>
            <tr><th><?php esc_html_e( 'Tracking de costes IA', 'ai-web-designer' ); ?></th><td><label><input type="checkbox" name="aiwd_settings[cost_tracking]" value="1" <?php checked( ! empty( $s['cost_tracking'] ) ); ?> /> <?php esc_html_e( 'Activar', 'ai-web-designer' ); ?></label></td></tr>
        </table>

        <h2><?php esc_html_e( 'Integraciones', 'ai-web-designer' ); ?></h2>
        <table class="form-table">
            <tr><th><?php esc_html_e( 'Google Business API Key', 'ai-web-designer' ); ?></th><td><input type="password" name="aiwd_settings[gmb_api_key]" class="regular-text" value="<?php echo esc_attr( $s['gmb_api_key'] ?? '' ); ?>" /></td></tr>
            <tr><th><?php esc_html_e( 'Google Maps API Key', 'ai-web-designer' ); ?></th><td><input type="password" name="aiwd_settings[maps_api_key]" class="regular-text" value="<?php echo esc_attr( $s['maps_api_key'] ?? '' ); ?>" /></td></tr>
        </table>

        <?php submit_button(); ?>
    </form>
</div>
