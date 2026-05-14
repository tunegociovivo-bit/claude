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

        <h2><?php esc_html_e( 'Asana', 'ai-web-designer' ); ?></h2>
        <p class="description"><?php printf( esc_html__( 'Genera un Personal Access Token en %s y pégalo aquí.', 'ai-web-designer' ), '<a href="https://app.asana.com/0/my-apps" target="_blank">app.asana.com/0/my-apps</a>' ); ?></p>
        <table class="form-table">
            <tr><th><?php esc_html_e( 'Personal Access Token', 'ai-web-designer' ); ?></th>
                <td><input type="password" name="aiwd_settings[asana_token]" class="regular-text" value="<?php echo esc_attr( $s['asana_token'] ?? '' ); ?>" /></td></tr>
            <tr><th><?php esc_html_e( 'Workspace GID', 'ai-web-designer' ); ?></th>
                <td>
                    <input type="text" name="aiwd_settings[asana_workspace]" value="<?php echo esc_attr( $s['asana_workspace'] ?? '' ); ?>" />
                    <button type="button" class="button" id="aiwd-asana-load-ws"><?php esc_html_e( 'Cargar workspaces', 'ai-web-designer' ); ?></button>
                    <span id="aiwd-asana-ws-result"></span>
                </td></tr>
            <tr><th><?php esc_html_e( 'Team GID (opcional)', 'ai-web-designer' ); ?></th>
                <td><input type="text" name="aiwd_settings[asana_team]" value="<?php echo esc_attr( $s['asana_team'] ?? '' ); ?>" /></td></tr>
            <tr><th><?php esc_html_e( 'Asignado por defecto (user GID)', 'ai-web-designer' ); ?></th>
                <td><input type="text" name="aiwd_settings[asana_default_assignee]" value="<?php echo esc_attr( $s['asana_default_assignee'] ?? '' ); ?>" /></td></tr>
            <tr><th><?php esc_html_e( 'Crear proyecto Asana automáticamente', 'ai-web-designer' ); ?></th>
                <td><label><input type="checkbox" name="aiwd_settings[asana_auto_create]" value="1" <?php checked( ! empty( $s['asana_auto_create'] ) ); ?> /> <?php esc_html_e( 'Al guardar un nuevo proyecto, crear automáticamente el proyecto y las tareas en Asana.', 'ai-web-designer' ); ?></label></td></tr>
            <tr><th><?php esc_html_e( 'Adjuntar PDF de propuesta', 'ai-web-designer' ); ?></th>
                <td><label><input type="checkbox" name="aiwd_settings[asana_attach_pdf]" value="1" <?php checked( ! empty( $s['asana_attach_pdf'] ?? 1 ) ); ?> /> <?php esc_html_e( 'Adjuntar automáticamente el PDF del proyecto a la tarea principal.', 'ai-web-designer' ); ?></label></td></tr>
            <tr><th><?php esc_html_e( 'Webhooks (bidireccional)', 'ai-web-designer' ); ?></th>
                <td>
                    <label><input type="checkbox" name="aiwd_settings[asana_webhooks_enabled]" value="1" <?php checked( ! empty( $s['asana_webhooks_enabled'] ) ); ?> /> <?php esc_html_e( 'Activar webhooks: cuando se cierre una tarea o se comente en Asana, se refleja aquí.', 'ai-web-designer' ); ?></label>
                    <p class="description">
                        <?php esc_html_e( 'URL de webhook (Asana la usa automáticamente):', 'ai-web-designer' ); ?>
                        <code><?php echo esc_html( AIWD_Asana_Webhook::endpoint_url() ); ?></code>
                    </p>
                </td></tr>
            <tr><th><?php esc_html_e( 'Plantilla de tareas (JSON)', 'ai-web-designer' ); ?></th>
                <td>
                    <textarea name="aiwd_settings[asana_task_template]" rows="10" class="large-text code"><?php echo esc_textarea( $s['asana_task_template'] ?? wp_json_encode( AIWD_Asana_Sync::default_template(), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE ) ); ?></textarea>
                    <p class="description"><?php esc_html_e( 'Objeto JSON {clave: "Título de la tarea"}. La clave se usa para mapear estados (briefing, design, seo, legal, qa, approval, publish...).', 'ai-web-designer' ); ?></p>
                </td></tr>
        </table>

        <h2><?php esc_html_e( 'Notificaciones por email', 'ai-web-designer' ); ?></h2>
        <table class="form-table">
            <tr><th><?php esc_html_e( 'Activar notificaciones', 'ai-web-designer' ); ?></th>
                <td><label><input type="checkbox" name="aiwd_settings[notify_enabled]" value="1" <?php checked( ! empty( $s['notify_enabled'] ?? 1 ) ); ?> /> <?php esc_html_e( 'Activar el sistema de notificaciones por email.', 'ai-web-designer' ); ?></label></td></tr>
            <tr><th><?php esc_html_e( 'Nombre del remitente', 'ai-web-designer' ); ?></th>
                <td><input type="text" name="aiwd_settings[notify_from_name]" class="regular-text" value="<?php echo esc_attr( $s['notify_from_name'] ?? get_bloginfo( 'name' ) ); ?>" /></td></tr>
            <tr><th><?php esc_html_e( 'Email del remitente', 'ai-web-designer' ); ?></th>
                <td><input type="email" name="aiwd_settings[notify_from_email]" class="regular-text" value="<?php echo esc_attr( $s['notify_from_email'] ?? get_bloginfo( 'admin_email' ) ); ?>" /></td></tr>
            <tr><th><?php esc_html_e( 'Emails del equipo (csv)', 'ai-web-designer' ); ?></th>
                <td><input type="text" name="aiwd_settings[notify_email_team]" class="regular-text" value="<?php echo esc_attr( $s['notify_email_team'] ?? '' ); ?>" placeholder="diseno@ejemplo.com, cuentas@ejemplo.com" /></td></tr>
            <tr><th><?php esc_html_e( 'Color de marca', 'ai-web-designer' ); ?></th>
                <td><input type="text" name="aiwd_settings[notify_brand_color]" value="<?php echo esc_attr( $s['notify_brand_color'] ?? '#2271b1' ); ?>" /></td></tr>
            <tr><th><?php esc_html_e( 'Logo (URL)', 'ai-web-designer' ); ?></th>
                <td><input type="url" name="aiwd_settings[notify_logo_url]" class="regular-text" value="<?php echo esc_attr( $s['notify_logo_url'] ?? '' ); ?>" /></td></tr>
            <tr><th><?php esc_html_e( 'Firma HTML', 'ai-web-designer' ); ?></th>
                <td><textarea name="aiwd_settings[notify_signature_html]" rows="3" class="large-text code"><?php echo esc_textarea( $s['notify_signature_html'] ?? '' ); ?></textarea></td></tr>
            <tr><th><?php esc_html_e( 'Días para recordatorio de briefing', 'ai-web-designer' ); ?></th>
                <td><input type="number" min="1" max="30" name="aiwd_settings[notify_reminder_days]" value="<?php echo esc_attr( $s['notify_reminder_days'] ?? 3 ); ?>" /></td></tr>
            <tr><th><?php esc_html_e( 'Eventos activos', 'ai-web-designer' ); ?></th>
                <td>
                    <?php
                    $events = (array) ( $s['notify_events'] ?? [] );
                    foreach ( AIWD_Mailer::templates() as $key => $tpl ) :
                        $checked = ! empty( $events[ $key ] );
                    ?>
                        <label style="display:block;margin-bottom:6px">
                            <input type="checkbox" name="aiwd_settings[notify_events][<?php echo esc_attr( $key ); ?>]" value="1" <?php checked( $checked ); ?> />
                            <?php echo esc_html( $tpl['label'] ); ?>
                            <small style="color:#888">(→ <?php echo $tpl['to'] === 'team' ? 'equipo' : 'cliente'; ?>)</small>
                        </label>
                    <?php endforeach; ?>
                </td></tr>
        </table>

        <?php submit_button(); ?>
    </form>
</div>
