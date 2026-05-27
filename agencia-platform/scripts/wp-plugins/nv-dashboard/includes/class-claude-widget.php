<?php
/**
 * NV Claude Widget
 *
 * Añade un metabox en la pantalla de edición de cada publicación que permite
 * a David escribir una orden de revisión y abrir Claude.ai en una pestaña
 * nueva con todo el contexto de la publicación pre-rellenado.
 *
 * Modo Opción B: el widget construye una URL claude.ai/new?q=... con el
 * mensaje completo y la orden, sin pasar por Make ni Asana.
 *
 * @package NV_Dashboard
 * @since 1.0.4
 */

if (!defined('ABSPATH')) {
    exit;
}

class NV_Claude_Widget {

    /**
     * Bootstrap
     */
    public static function init() {
        add_action('add_meta_boxes', [__CLASS__, 'register_metabox']);
        add_action('admin_enqueue_scripts', [__CLASS__, 'enqueue_assets']);
    }

    /**
     * Registrar el metabox solo en el CPT nv_publicacion
     */
    public static function register_metabox() {
        add_meta_box(
            'nv_claude_widget',
            '🤖 Pedir revisión a Claude',
            [__CLASS__, 'render_metabox'],
            'nv_publicacion',
            'side',
            'high'
        );
    }

    /**
     * Cargar CSS y JS solo en la pantalla de edición de publicaciones
     */
    public static function enqueue_assets($hook) {
        // Solo en post.php y post-new.php
        if (!in_array($hook, ['post.php', 'post-new.php'], true)) {
            return;
        }

        // Solo si es una publicación nv_publicacion
        global $post;
        if (!$post || $post->post_type !== 'nv_publicacion') {
            return;
        }

        wp_enqueue_style(
            'nv-claude-widget-css',
            NV_DASHBOARD_URL . 'admin/css/claude-widget.css',
            [],
            NV_DASHBOARD_VERSION
        );

        wp_enqueue_script(
            'nv-claude-widget-js',
            NV_DASHBOARD_URL . 'admin/js/claude-widget.js',
            ['jquery'],
            NV_DASHBOARD_VERSION,
            true
        );

        // v1.0.72: en la pantalla post.php el script global `nv-dashboard-js`
        // no se carga (su enqueue solo dispara en hooks `nv-dashboard*` / `nv_publicacion`
        // pero `post.php` no encaja). Por tanto window.nvDashboard.restUrl/restNonce
        // tampoco existirian y "Adaptar formato" / "Editar en Claude" fallarian.
        // Localizamos directamente sobre claude-widget.js los datos minimos.
        wp_localize_script('nv-claude-widget-js', 'nvDashboard', [
            'restUrl'   => rest_url('nv/v1/'),
            'restNonce' => wp_create_nonce('wp_rest'),
            'adminUrl'  => admin_url(),
            'siteUrl'   => home_url('/'),
        ]);

        // Pasar contexto completo de la publicación al JS
        wp_localize_script('nv-claude-widget-js', 'nvClaudeWidget', self::build_context($post->ID));
    }

    /**
     * Construye el array de contexto que se inyecta al JS
     */
    private static function build_context($post_id) {
        $post = get_post($post_id);
        if (!$post) {
            return [];
        }

        // Cliente (term completo para sacar slug)
        $clientes_terms = wp_get_post_terms($post_id, 'nv_cliente', ['fields' => 'all']);
        $cliente = !empty($clientes_terms) && !is_wp_error($clientes_terms) ? $clientes_terms[0]->name : '(sin cliente)';
        $cliente_slug = !empty($clientes_terms) && !is_wp_error($clientes_terms) ? $clientes_terms[0]->slug : '';

        // Campos ACF principales
        $fecha = function_exists('get_field') ? get_field('nv_fecha_publicacion', $post_id) : '';
        $tipo = function_exists('get_field') ? get_field('nv_tipo', $post_id) : '';
        $redes = function_exists('get_field') ? get_field('nv_redes', $post_id) : [];
        $copy = function_exists('get_field') ? get_field('nv_copy', $post_id) : '';
        $hashtags = function_exists('get_field') ? get_field('nv_hashtags', $post_id) : '';
        $asset_url = function_exists('get_field') ? get_field('nv_asset_url', $post_id) : '';
        $assets_extras = function_exists('get_field') ? get_field('nv_assets_extras', $post_id) : '';
        $primer_comentario = function_exists('get_field') ? get_field('nv_first_comment', $post_id) : '';
        $auto_publish = function_exists('get_field') ? get_field('nv_auto_publish', $post_id) : false;
        $estado = function_exists('get_field') ? get_field('nv_estado', $post_id) : '';

        // URL de edición
        $edit_url = get_edit_post_link($post_id, '');

        return [
            'postId'           => $post_id,
            'titulo'           => get_the_title($post_id),
            'cliente'          => $cliente,
            'clienteSlug'      => $cliente_slug,           // v1.0.17
            'fecha'            => $fecha,
            'tipo'             => $tipo,
            'redes'            => is_array($redes) ? $redes : [],
            'copy'              => $copy,
            'hashtags'         => $hashtags,
            'assetUrl'         => $asset_url,
            'assetsExtras'     => $assets_extras,
            'primerComentario' => $primer_comentario,
            'autoPublish'      => (bool) $auto_publish,
            'estado'           => $estado,
            'editUrl'          => $edit_url,
            'siteUrl'          => home_url('/'),
            // v1.0.7: nonce para registrar revisiones
            'restNonce'        => wp_create_nonce('wp_rest'),
            'restUrl'          => rest_url('nv/v1/'),
            // v1.0.20: API token para que el Claude externo pueda autenticar
            // las llamadas al proxy y otros endpoints. Es el mismo que se ve en
            // NV Dashboard → Configuración. Rotable desde admin.
            'apiToken'         => function_exists('nv_dashboard_get_api_token') ? nv_dashboard_get_api_token() : '',
        ];
    }

    /**
     * Renderiza el HTML del metabox en la sidebar de edición
     */
    public static function render_metabox($post) {
        // Cargar historial de revisiones existente
        $hist_raw = get_post_meta($post->ID, '_nv_revisiones_historial', true);
        $hist = $hist_raw ? json_decode($hist_raw, true) : [];
        if (!is_array($hist)) $hist = [];
        $total_revs = count($hist);
        ?>
        <div class="nv-claude-widget">
            <p class="description">
                Escribe lo que quieres que Claude revise o cambie de esta publicación.
                Al pulsar el botón se abrirá una pestaña nueva en Claude con todo el contexto cargado.
            </p>

            <!-- v1.0.7: Botones revisión rápida -->
            <div class="nv-claude-quick-actions">
                <span class="nv-claude-quick-label">⚡ Acciones rápidas:</span>
                <div class="nv-claude-quick-grid">
                    <button type="button" class="nv-claude-quick-btn" data-tipo="copy" data-prompt="Mejora el copy de esta publicación. Hazlo más enganchador desde la primera línea, mantén el tono profesional pero cercano de Negocio Vivo y conserva el CTA al final.">✍️ Mejorar copy</button>
                    <button type="button" class="nv-claude-quick-btn" data-tipo="copy" data-prompt="Reescribe el copy en un tono más casual y cercano, como si lo escribiera un amigo experto. Mantén el mensaje principal pero quítale corporativismo.">😊 Más casual</button>
                    <button type="button" class="nv-claude-quick-btn" data-tipo="copy" data-prompt="Reescribe el copy en un tono más corporate y autoritario, enfocado a B2B. Mantén el mensaje pero suena a CEO de agencia premium.">💼 Más corporate</button>
                    <button type="button" class="nv-claude-quick-btn" data-tipo="copy" data-prompt="Acorta el copy a la mitad manteniendo la idea principal y el CTA. Que sea más directo y punchy.">📏 Acortar mitad</button>
                    <button type="button" class="nv-claude-quick-btn" data-tipo="hashtags" data-prompt="Genera 10 hashtags optimizados para esta publicación: 5 de alcance medio (10k-100k), 3 nicho específico, 2 muy específicos de marca. Mezcla español e inglés según convenga.">#️⃣ +10 hashtags</button>
                    <button type="button" class="nv-claude-quick-btn" data-tipo="copy" data-prompt="Genera 3 variantes alternativas del copy con distintos enfoques (uno educativo, uno emocional, uno urgencia/escasez). Mantén el mismo CTA.">🔀 3 variantes</button>
                </div>
            </div>

            <label for="nv-claude-tipo-revision" style="display:block; margin: 14px 0 4px;">
                <strong>Tipo de revisión</strong>
            </label>
            <select id="nv-claude-tipo-revision" class="widefat">
                <option value="imagen">🖼️ Cambiar imagen</option>
                <option value="video">🎬 Cambiar / editar vídeo</option>
                <option value="copy">✍️ Mejorar copy</option>
                <option value="hashtags">#️⃣ Mejorar hashtags</option>
                <option value="estrategia">🎯 Revisar estrategia</option>
                <option value="otro">💬 Otro</option>
            </select>

            <label for="nv-claude-orden" style="display:block; margin: 10px 0 4px;">
                <strong>Orden para Claude</strong>
            </label>
            <textarea
                id="nv-claude-orden"
                class="widefat"
                rows="6"
                placeholder="Ejemplo: regenera la imagen sin banda negra, manteniendo mi avatar y dejando texto en la zona limpia superior"
            ></textarea>

            <div class="nv-claude-actions" style="margin-top: 12px; display:flex; gap:8px; flex-direction: column;">
                <button
                    type="button"
                    id="nv-claude-open"
                    class="button button-primary button-hero"
                    style="background: linear-gradient(135deg, #D2A039 0%, #b8862a 100%); border-color: #b8862a; text-shadow: none; box-shadow: 0 2px 4px rgba(0,0,0,0.15); width: 100%;"
                >
                    🤖 Abrir en Claude
                </button>
                <button
                    type="button"
                    id="nv-claude-preview"
                    class="button"
                    style="width: 100%;"
                >
                    👁 Previsualizar mensaje
                </button>
            </div>

            <!-- v1.0.71: Adaptar a otro formato (regenera con IA en otro ratio) -->
            <div class="nv-adaptar-formato-widget" style="margin-top:16px; padding:12px; background:#eff6ff; border:1px solid #bfdbfe; border-radius:4px;">
                <strong style="display:block; margin-bottom:6px;">📐 Adaptar a otro formato</strong>
                <p style="font-size:11px; color:#666; margin:0 0 8px;">Regenera la imagen con IA usando el mismo prompt en otro aspect ratio. Útil para reciclar un Reel como Story o un Imagen feed como cuadrado.</p>
                <select id="nv-cw-adaptar-tipo" style="width:100%; margin-bottom:6px;">
                    <option value="imagen">📷 Imagen feed (4:5)</option>
                    <option value="reel">🎬 Reel (9:16)</option>
                    <option value="carrusel">🎴 Carrusel (1:1)</option>
                    <option value="story">📱 Story (9:16)</option>
                    <option value="video">🎥 Video (16:9)</option>
                </select>
                <select id="nv-cw-adaptar-quality" style="width:100%; margin-bottom:6px;">
                    <option value="low">Calidad baja (rápido)</option>
                    <option value="medium" selected>Calidad media</option>
                    <option value="high">Calidad alta (lento)</option>
                </select>
                <button type="button" id="nv-cw-adaptar-go" class="button button-primary" style="width:100%; background:#2563eb; border-color:#1d4ed8;" data-pid="<?php echo esc_attr((int) $post->ID); ?>">▶️ Regenerar imagen en este formato</button>
                <div id="nv-cw-adaptar-status" style="margin-top:8px; font-size:12px;"></div>
            </div>

            <div id="nv-claude-preview-box" class="nv-claude-preview-box" style="display:none;">
                <div class="nv-claude-preview-header">
                    <strong>Mensaje que se enviará</strong>
                    <span class="nv-claude-char-count">0 caracteres</span>
                </div>
                <pre id="nv-claude-preview-content"></pre>
            </div>

            <!-- v1.0.7: Historial de revisiones -->
            <div class="nv-claude-history">
                <div class="nv-claude-history-header" id="nv-claude-history-toggle">
                    <span><strong>📚 Historial de revisiones</strong> <span id="nv-claude-history-count">(<?php echo $total_revs; ?>)</span></span>
                    <span class="nv-claude-history-arrow">▼</span>
                </div>
                <div class="nv-claude-history-body" id="nv-claude-history-body" style="display:none;">
                    <?php if (empty($hist)): ?>
                        <p class="nv-claude-history-empty">No hay revisiones registradas todavía.</p>
                    <?php else: ?>
                        <ul class="nv-claude-history-list">
                            <?php foreach ($hist as $rev): ?>
                                <li class="nv-claude-history-item">
                                    <div class="nv-claude-history-meta">
                                        <span class="nv-claude-history-tipo"><?php echo esc_html(strtoupper($rev['tipo'] ?? 'OTRO')); ?></span>
                                        <span class="nv-claude-history-time"><?php echo esc_html($rev['timestamp'] ?? ''); ?></span>
                                        <span class="nv-claude-history-user"><?php echo esc_html($rev['usuario_nombre'] ?? ''); ?></span>
                                    </div>
                                    <div class="nv-claude-history-orden"><?php echo esc_html($rev['orden'] ?? ''); ?></div>
                                </li>
                            <?php endforeach; ?>
                        </ul>
                    <?php endif; ?>
                </div>
            </div>

            <p class="description" style="margin-top: 10px; font-size: 11px;">
                <strong>💡 Cómo funciona:</strong> el botón abre Claude.ai con el mensaje pre-rellenado. Solo tienes que pulsar enviar en Claude.
            </p>
        </div>
        <?php
    }
}
