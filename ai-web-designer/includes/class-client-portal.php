<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

/**
 * Portal frontend del cliente con acceso vía magic-link.
 *
 * Uso:
 *  - Genera token: AIWD_Client_Portal::generate_token( $project_id );
 *  - Comparte URL: home_url('/briefing/?token=...');
 *  - Renderiza shortcode: [aiwd_briefing]
 */
class AIWD_Client_Portal {

    const TOKEN_META = '_aiwd_client_token';
    const TOKEN_EXP  = '_aiwd_client_token_exp';

    public function register() {
        add_shortcode( 'aiwd_briefing', [ $this, 'shortcode' ] );
        add_action( 'init', [ $this, 'maybe_handle_submit' ] );
        add_action( 'init', [ $this, 'register_rewrite' ] );
    }

    public function register_rewrite() {
        add_rewrite_rule( '^briefing/?$', 'index.php?aiwd_briefing=1', 'top' );
        add_rewrite_tag( '%aiwd_briefing%', '([0-9]+)' );
    }

    public static function generate_token( $project_id, $ttl_days = 30 ) {
        $token = wp_generate_password( 32, false, false );
        update_post_meta( $project_id, self::TOKEN_META, $token );
        update_post_meta( $project_id, self::TOKEN_EXP, time() + ( DAY_IN_SECONDS * (int) $ttl_days ) );
        $url = add_query_arg( [ 'token' => $token ], home_url( '/briefing/' ) );
        do_action( 'aiwd_client_token_generated', $project_id, $token, $url );
        return $token;
    }

    public static function resolve_token( $token ) {
        if ( ! $token ) return 0;
        $q = get_posts( [
            'post_type'   => AIWD_CPT_Project::POST_TYPE,
            'meta_key'    => self::TOKEN_META,
            'meta_value'  => sanitize_text_field( $token ),
            'numberposts' => 1,
            'fields'      => 'ids',
        ] );
        if ( empty( $q ) ) return 0;
        $project_id = (int) $q[0];
        $exp = (int) get_post_meta( $project_id, self::TOKEN_EXP, true );
        if ( $exp && $exp < time() ) return 0;
        return $project_id;
    }

    public function shortcode( $atts ) {
        $token = sanitize_text_field( $_GET['token'] ?? '' );
        $project_id = self::resolve_token( $token );
        if ( ! $project_id ) {
            return '<div class="aiwd-portal-error">' . esc_html__( 'Enlace inválido o caducado.', 'ai-web-designer' ) . '</div>';
        }

        $post = get_post( $project_id );
        $data = AIWD_CPT_Project::get_project_data( $project_id );
        $tones   = aiwd_tones();
        $sectors = aiwd_sectors();
        $saved   = isset( $_GET['saved'] ) ? '<div class="aiwd-portal-ok">' . esc_html__( '✅ Briefing actualizado. ¡Gracias!', 'ai-web-designer' ) . '</div>' : '';

        ob_start();
        ?>
        <div class="aiwd-portal">
            <header>
                <h1><?php echo esc_html( $post->post_title ); ?></h1>
                <p><?php esc_html_e( 'Rellena la información de tu proyecto web. Puedes guardar y volver más tarde con el mismo enlace.', 'ai-web-designer' ); ?></p>
            </header>
            <?php echo $saved; ?>
            <form method="post" enctype="multipart/form-data" class="aiwd-portal-form">
                <input type="hidden" name="aiwd_portal_token" value="<?php echo esc_attr( $token ); ?>" />
                <?php wp_nonce_field( 'aiwd_portal_submit', 'aiwd_portal_nonce' ); ?>

                <fieldset class="aiwd-audio-fieldset">
                    <legend>🎙️ <?php esc_html_e( 'Cuéntanoslo en audio (más rápido)', 'ai-web-designer' ); ?></legend>
                    <p><?php esc_html_e( 'Graba 2-3 minutos hablando de tu negocio (qué hacéis, a quién os dirigís, datos de contacto, qué os diferencia). La IA rellenará el formulario por ti.', 'ai-web-designer' ); ?></p>
                    <div class="aiwd-audio-controls" data-project-id="<?php echo esc_attr( $project_id ); ?>" data-token="<?php echo esc_attr( $token ); ?>" data-endpoint="<?php echo esc_url( rest_url( 'aiwd/v1/project/' . $project_id . '/audio-briefing' ) ); ?>">
                        <button type="button" class="aiwd-rec-start aiwd-portal-btn" style="background:#c0392b">● Grabar</button>
                        <button type="button" class="aiwd-rec-stop aiwd-portal-btn" style="background:#1a6b1a;display:none">■ Parar y enviar</button>
                        <span class="aiwd-rec-status" style="margin-left:10px;color:#444"></span>
                        <p style="margin-top:10px"><?php esc_html_e( '...o sube un archivo de audio existente (MP3, WAV, WEBM, M4A):', 'ai-web-designer' ); ?></p>
                        <input type="file" class="aiwd-rec-upload" accept="audio/*" />
                    </div>
                    <div class="aiwd-transcript" hidden></div>
                </fieldset>

                <fieldset>
                    <legend><?php esc_html_e( 'Sobre el negocio', 'ai-web-designer' ); ?></legend>
                    <label><?php esc_html_e( 'Nombre comercial', 'ai-web-designer' ); ?>
                        <input name="data[business_name]" value="<?php echo esc_attr( $data['briefing']['business_name'] ?? '' ); ?>" />
                    </label>
                    <label><?php esc_html_e( 'Sector', 'ai-web-designer' ); ?>
                        <select name="data[sector]">
                            <?php foreach ( $sectors as $k => $v ) : ?>
                                <option value="<?php echo esc_attr( $k ); ?>" <?php selected( ( $data['briefing']['sector'] ?? '' ), $k ); ?>><?php echo esc_html( $v ); ?></option>
                            <?php endforeach; ?>
                        </select>
                    </label>
                    <label><?php esc_html_e( 'Descripción', 'ai-web-designer' ); ?>
                        <textarea name="data[description]" rows="4"><?php echo esc_textarea( $data['briefing']['description'] ?? '' ); ?></textarea>
                    </label>
                    <label><?php esc_html_e( 'Público objetivo', 'ai-web-designer' ); ?>
                        <textarea name="data[audience]" rows="2"><?php echo esc_textarea( $data['briefing']['audience'] ?? '' ); ?></textarea>
                    </label>
                    <label><?php esc_html_e( 'Tono', 'ai-web-designer' ); ?>
                        <select name="data[tone]">
                            <?php foreach ( $tones as $k => $v ) : ?>
                                <option value="<?php echo esc_attr( $k ); ?>" <?php selected( ( $data['briefing']['tone'] ?? '' ), $k ); ?>><?php echo esc_html( $v ); ?></option>
                            <?php endforeach; ?>
                        </select>
                    </label>
                </fieldset>

                <fieldset>
                    <legend><?php esc_html_e( 'Contacto y dominio', 'ai-web-designer' ); ?></legend>
                    <label><?php esc_html_e( 'Dominio', 'ai-web-designer' ); ?><input type="url" name="data[domain]" value="<?php echo esc_attr( $data['contact']['domain'] ?? '' ); ?>" /></label>
                    <label><?php esc_html_e( 'Email', 'ai-web-designer' ); ?><input type="email" name="data[email]" value="<?php echo esc_attr( $data['contact']['email'] ?? '' ); ?>" /></label>
                    <label><?php esc_html_e( 'Teléfono', 'ai-web-designer' ); ?><input type="text" name="data[phone]" value="<?php echo esc_attr( $data['contact']['phone'] ?? '' ); ?>" /></label>
                    <label><?php esc_html_e( 'WhatsApp', 'ai-web-designer' ); ?><input type="text" name="data[whatsapp]" value="<?php echo esc_attr( $data['contact']['whatsapp'] ?? '' ); ?>" /></label>
                    <label><?php esc_html_e( 'Dirección', 'ai-web-designer' ); ?><input type="text" name="data[address]" value="<?php echo esc_attr( $data['contact']['address'] ?? '' ); ?>" /></label>
                </fieldset>

                <fieldset>
                    <legend><?php esc_html_e( 'Logo y fotos', 'ai-web-designer' ); ?></legend>
                    <label><?php esc_html_e( 'Logo (PNG/SVG)', 'ai-web-designer' ); ?><input type="file" name="aiwd_logo" accept="image/*" /></label>
                    <label><?php esc_html_e( 'Fotos (varias)', 'ai-web-designer' ); ?><input type="file" name="aiwd_photos[]" accept="image/*" multiple /></label>
                </fieldset>

                <fieldset>
                    <legend><?php esc_html_e( 'Comentarios libres', 'ai-web-designer' ); ?></legend>
                    <textarea name="data[notes]" rows="4" placeholder="<?php esc_attr_e( 'Cualquier información extra que nos quieras aportar...', 'ai-web-designer' ); ?>"><?php echo esc_textarea( $data['briefing']['notes'] ?? '' ); ?></textarea>
                </fieldset>

                <p><button type="submit" name="aiwd_portal_submit" value="1" class="aiwd-portal-btn"><?php esc_html_e( 'Guardar briefing', 'ai-web-designer' ); ?></button></p>
            </form>
        </div>
        <style>
            .aiwd-portal { max-width: 760px; margin: 40px auto; padding: 24px; background: #fff; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,.06); font-family: system-ui, sans-serif; }
            .aiwd-portal h1 { margin: 0 0 8px; }
            .aiwd-portal fieldset { border: 1px solid #e2e4e7; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
            .aiwd-portal legend { padding: 0 8px; font-weight: 600; color: #2271b1; }
            .aiwd-portal label { display: block; margin-bottom: 12px; font-size: 14px; }
            .aiwd-portal input, .aiwd-portal textarea, .aiwd-portal select { width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 6px; margin-top: 4px; box-sizing: border-box; }
            .aiwd-portal-btn { background: #2271b1; color: #fff; border: 0; padding: 12px 24px; border-radius: 6px; font-size: 16px; cursor: pointer; }
            .aiwd-portal-ok { background: #d1f4d1; padding: 12px; border-radius: 6px; margin-bottom: 16px; color: #1a6b1a; }
            .aiwd-portal-error { max-width: 600px; margin: 80px auto; padding: 24px; background: #ffd1d1; color: #861a1a; text-align: center; border-radius: 12px; }
            .aiwd-audio-fieldset { background: #f7f7ff; border-color: #c5c5e0; }
            .aiwd-rec-status.recording { color: #c0392b; font-weight: bold; }
            .aiwd-transcript { margin-top: 12px; padding: 12px; background: #f0f6ff; border-radius: 6px; font-size: 13px; }
        </style>
        <script>
        (function () {
            const wrap = document.querySelector('.aiwd-audio-controls');
            if (!wrap) return;
            const endpoint = wrap.dataset.endpoint;
            const token    = wrap.dataset.token;
            const $start = wrap.querySelector('.aiwd-rec-start');
            const $stop  = wrap.querySelector('.aiwd-rec-stop');
            const $status= wrap.querySelector('.aiwd-rec-status');
            const $upload= wrap.querySelector('.aiwd-rec-upload');
            const $trans = document.querySelector('.aiwd-transcript');
            let recorder, chunks = [];

            $start.addEventListener('click', async () => {
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    recorder = new MediaRecorder(stream);
                    chunks = [];
                    recorder.ondataavailable = e => chunks.push(e.data);
                    recorder.onstop = () => {
                        const blob = new Blob(chunks, { type: 'audio/webm' });
                        send(blob);
                        stream.getTracks().forEach(t => t.stop());
                    };
                    recorder.start();
                    $start.style.display = 'none';
                    $stop.style.display  = 'inline-block';
                    $status.textContent  = 'Grabando... habla con calma.';
                    $status.classList.add('recording');
                } catch (err) {
                    alert('No se pudo acceder al micrófono: ' + err.message);
                }
            });

            $stop.addEventListener('click', () => {
                if (recorder && recorder.state === 'recording') recorder.stop();
                $stop.style.display  = 'none';
                $start.style.display = 'inline-block';
                $status.classList.remove('recording');
                $status.textContent  = 'Procesando audio con IA...';
            });

            $upload.addEventListener('change', e => {
                const f = e.target.files[0];
                if (f) { $status.textContent = 'Procesando audio con IA...'; send(f); }
            });

            function send(blob) {
                const fd = new FormData();
                fd.append('audio', blob, 'briefing.webm');
                fd.append('portal_token', token);
                fd.append('lang', 'es');
                fetch(endpoint, { method: 'POST', body: fd })
                    .then(r => r.json())
                    .then(res => {
                        if (res.transcript) {
                            $status.textContent = '✅ ¡Listo! El formulario se ha rellenado abajo. Revisa y completa lo que falte.';
                            $trans.hidden = false;
                            $trans.innerHTML = '<strong>Transcripción:</strong><br>' + escapeHtml(res.transcript);
                            setTimeout(() => location.reload(), 1500);
                        } else {
                            $status.textContent = '❌ ' + (res.message || 'Error procesando audio');
                        }
                    })
                    .catch(err => { $status.textContent = '❌ ' + err.message; });
            }

            function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
        })();
        </script>
        <?php
        return ob_get_clean();
    }

    public function maybe_handle_submit() {
        if ( empty( $_POST['aiwd_portal_submit'] ) ) return;
        if ( ! isset( $_POST['aiwd_portal_nonce'] ) || ! wp_verify_nonce( $_POST['aiwd_portal_nonce'], 'aiwd_portal_submit' ) ) return;

        $token = sanitize_text_field( $_POST['aiwd_portal_token'] ?? '' );
        $project_id = self::resolve_token( $token );
        if ( ! $project_id ) return;

        $payload = aiwd_sanitize_array( $_POST['data'] ?? [] );

        // Reparte por secciones lógicas
        $briefing_keys = [ 'business_name', 'sector', 'description', 'audience', 'tone', 'usp', 'competitors', 'notes' ];
        $contact_keys  = [ 'domain', 'email', 'phone', 'whatsapp', 'address', 'schedule', 'maps_url', 'social' ];

        $briefing = array_intersect_key( $payload, array_flip( $briefing_keys ) );
        $contact  = array_intersect_key( $payload, array_flip( $contact_keys ) );

        AIWD_CPT_Project::save_project_data( $project_id, 'briefing', array_merge( (array) get_post_meta( $project_id, '_aiwd_briefing', true ), $briefing ) );
        AIWD_CPT_Project::save_project_data( $project_id, 'contact',  array_merge( (array) get_post_meta( $project_id, '_aiwd_contact', true ), $contact ) );

        // Adjuntos: logo + fotos
        if ( ! empty( $_FILES['aiwd_logo']['name'] ) ) {
            $id = $this->handle_upload( 'aiwd_logo', $project_id );
            if ( $id ) {
                $brand = (array) get_post_meta( $project_id, '_aiwd_brand', true );
                $brand['logo_id'] = $id;
                AIWD_CPT_Project::save_project_data( $project_id, 'brand', $brand );
            }
        }
        if ( ! empty( $_FILES['aiwd_photos']['name'][0] ) ) {
            $brand = (array) get_post_meta( $project_id, '_aiwd_brand', true );
            $brand['gallery'] = (array) ( $brand['gallery'] ?? [] );
            foreach ( $_FILES['aiwd_photos']['name'] as $i => $name ) {
                $id = $this->handle_upload_indexed( 'aiwd_photos', $i, $project_id );
                if ( $id ) $brand['gallery'][] = $id;
            }
            AIWD_CPT_Project::save_project_data( $project_id, 'brand', $brand );
        }

        do_action( 'aiwd_portal_briefing_saved', $project_id );

        wp_safe_redirect( add_query_arg( [ 'token' => $token, 'saved' => 1 ], remove_query_arg( 'saved' ) ) );
        exit;
    }

    private function handle_upload( $field, $project_id ) {
        require_once ABSPATH . 'wp-admin/includes/file.php';
        require_once ABSPATH . 'wp-admin/includes/media.php';
        require_once ABSPATH . 'wp-admin/includes/image.php';
        $id = media_handle_upload( $field, 0 );
        if ( is_wp_error( $id ) ) return 0;
        update_post_meta( $id, '_aiwd_project_id', $project_id );
        return (int) $id;
    }

    private function handle_upload_indexed( $field, $index, $project_id ) {
        if ( empty( $_FILES[ $field ]['name'][ $index ] ) ) return 0;
        $file = [
            'name'     => $_FILES[ $field ]['name'][ $index ],
            'type'     => $_FILES[ $field ]['type'][ $index ],
            'tmp_name' => $_FILES[ $field ]['tmp_name'][ $index ],
            'error'    => $_FILES[ $field ]['error'][ $index ],
            'size'     => $_FILES[ $field ]['size'][ $index ],
        ];
        $_FILES['aiwd_single'] = $file;
        $id = $this->handle_upload( 'aiwd_single', $project_id );
        unset( $_FILES['aiwd_single'] );
        return $id;
    }
}
