<?php
if ( ! defined( 'WPINC' ) ) { die; }
$id   = isset( $_GET['id'] ) ? intval( $_GET['id'] ) : 0;
$lead = NVL_DB::get_lead( $id );
if ( ! $lead ) {
    echo '<div class="wrap"><h1>Lead no encontrado</h1></div>';
    return;
}
$search    = NVL_DB::get_search( $lead->search_id );
$comps     = NVL_DB::get_competitors_for_lead( $id );
$templates = NVL_DB::get_templates();
$default   = NVL_DB::get_default_template();
$body      = $default ? $default->body : '';
$rendered  = $body ? NVL_Template_Engine::render( $body, $id ) : '';
$settings  = get_option( 'nvl_settings', array() );
$cc        = isset( $settings['whatsapp_country_code'] ) ? $settings['whatsapp_country_code'] : '34';
$wa_link   = $lead->phone ? NVL_WhatsApp::build_link( $lead->phone, $rendered, $cc ) : '';

$score_breakdown = $lead->score_breakdown ? json_decode( $lead->score_breakdown, true ) : array();
$score_class = 'score-low';
if ( $lead->score >= 70 ) $score_class = 'score-high';
elseif ( $lead->score >= 45 ) $score_class = 'score-mid';

$conversation = class_exists( 'NVL_Inbox' ) ? NVL_Inbox::get_lead_conversation( $lead->id ) : array();
$enrolment    = class_exists( 'NVL_Sequences' ) ? NVL_Sequences::get_active_enrolment( $lead->id ) : null;
$sequences    = class_exists( 'NVL_Sequences' ) ? NVL_Sequences::get_sequences() : array();
?>
<div class="wrap nvl-wrap">
    <h1><?php echo esc_html( $lead->name ); ?>
        <small style="color:#666;font-weight:normal;">— posición #<?php echo (int) $lead->position; ?> en <?php echo esc_html( $lead->province ); ?></small>
        &nbsp;
        <span class="nvl-score nvl-<?php echo $score_class; ?>" style="font-size:18px;vertical-align:middle;">Score <?php echo $lead->score !== null ? intval( $lead->score ) : '—'; ?></span>
        <span class="nvl-urg nvl-urg-<?php echo esc_attr( $lead->urgency ); ?>" style="vertical-align:middle;"><?php echo esc_html( $lead->urgency ?: '—' ); ?></span>
    </h1>

    <?php if ( isset( $_GET['updated'] ) ) : ?>
        <div class="notice notice-success is-dismissible"><p>Lead actualizado.</p></div>
    <?php endif; ?>

    <p>
        <a href="<?php echo esc_url( admin_url( 'admin.php?page=nvl-search-detail&id=' . $lead->search_id ) ); ?>" class="button">← Volver a la búsqueda</a>
        <?php if ( $lead->gmb_url ) : ?>
            <a href="<?php echo esc_url( $lead->gmb_url ); ?>" target="_blank" rel="noopener" class="button">Abrir ficha de Google</a>
        <?php endif; ?>
        <?php if ( $lead->website ) : ?>
            <a href="<?php echo esc_url( $lead->website ); ?>" target="_blank" rel="noopener" class="button">Web del negocio</a>
        <?php endif; ?>
    </p>

    <div class="nvl-detail-grid">
        <div class="nvl-detail-col">
            <h2>Datos del lead</h2>
            <table class="widefat striped">
                <tbody>
                    <tr><th>Dirección</th><td><?php echo esc_html( $lead->formatted_address ); ?></td></tr>
                    <tr><th>Provincia</th><td><?php echo esc_html( $lead->province ); ?></td></tr>
                    <tr><th>Teléfono</th><td><?php echo $lead->phone ? '<code>' . esc_html( $lead->phone ) . '</code>' : '<em>No disponible</em>'; ?></td></tr>
                    <tr><th>Internacional</th><td><?php echo $lead->international_phone ? '<code>' . esc_html( $lead->international_phone ) . '</code>' : '—'; ?></td></tr>
                    <tr><th>Web</th><td><?php echo $lead->website ? '<a href="' . esc_url( $lead->website ) . '" target="_blank" rel="noopener">' . esc_html( $lead->website ) . '</a>' : '—'; ?></td></tr>
                    <tr><th>Valoración</th><td>
                        <?php if ( $lead->rating !== null ) :
                            $r = floatval( $lead->rating );
                            $rounded = (int) round( $r );
                            echo str_repeat( '★', $rounded ) . str_repeat( '☆', max( 0, 5 - $rounded ) );
                            echo ' &nbsp;<strong>' . esc_html( number_format( $r, 1 ) ) . '</strong> &nbsp;<small>(' . intval( $lead->reviews_count ) . ' reseñas)</small>';
                        else: echo '—'; endif; ?>
                    </td></tr>
                    <tr><th>Polaridad reseñas</th><td>
                        <?php if ( $lead->positive_pct !== null ) : ?>
                            <span style="color:#1f7a1f;">▲ <?php echo number_format( floatval( $lead->positive_pct ), 0 ); ?>% positivas</span>&nbsp;
                            <span style="color:#888;">▬ <?php echo number_format( floatval( $lead->neutral_pct ), 0 ); ?>% neutras</span>&nbsp;
                            <span style="color:#a02828;">▼ <?php echo number_format( floatval( $lead->negative_pct ), 0 ); ?>% negativas</span>
                            <small style="display:block;color:#666;">Basado en las 5 reseñas más relevantes según Google.</small>
                        <?php else : ?><em>Sin datos (activa "Enriquecer con Place Details" en Ajustes).</em><?php endif; ?>
                    </td></tr>
                    <tr><th>WhatsApp activo</th><td>
                        <?php if ( $lead->has_whatsapp === '1' || $lead->has_whatsapp === 1 ) echo '✅ Sí';
                        elseif ( $lead->has_whatsapp === '0' || $lead->has_whatsapp === 0 ) echo '❌ El número no está en WhatsApp';
                        else echo '<em>Sin comprobar todavía</em>'; ?>
                    </td></tr>
                    <tr><th>Categoría</th><td><?php echo esc_html( $lead->category ); ?></td></tr>
                    <tr><th>Place ID</th><td><code><?php echo esc_html( $lead->place_id ); ?></code></td></tr>
                </tbody>
            </table>

            <h2 style="margin-top:1.5rem;">Competidores por encima</h2>
            <?php if ( $lead->position == 1 ) : ?>
                <p style="color:#0a0;"><strong>Este negocio ya está en la posición #1.</strong> No hay competidores que mencionarle.</p>
            <?php elseif ( empty( $comps ) ) : ?>
                <p>No se registraron competidores para este lead.</p>
            <?php else : ?>
                <table class="widefat striped">
                    <thead><tr><th>#</th><th>Nombre</th><th>Rating</th><th>Reseñas</th></tr></thead>
                    <tbody>
                    <?php foreach ( $comps as $c ) : ?>
                        <tr>
                            <td><strong>#<?php echo (int) $c->competitor_position; ?></strong></td>
                            <td><?php echo esc_html( $c->competitor_name ); ?></td>
                            <td><?php echo $c->competitor_rating ? esc_html( number_format( floatval( $c->competitor_rating ), 1 ) ) . ' ★' : '—'; ?></td>
                            <td><?php echo (int) $c->competitor_reviews; ?></td>
                        </tr>
                    <?php endforeach; ?>
                    </tbody>
                </table>
            <?php endif; ?>
        </div>

        <div class="nvl-detail-col">
            <h2>Estado de contacto</h2>
            <form method="post">
                <?php wp_nonce_field( 'nvl_update_lead' ); ?>
                <input type="hidden" name="nvl_action" value="update_lead_status">
                <input type="hidden" name="lead_id" value="<?php echo (int) $lead->id; ?>">
                <select name="contact_status">
                    <?php foreach ( array(
                        'pending'   => 'Pendiente',
                        'contacted' => 'Contactado',
                        'responded' => 'Respondió',
                        'client'    => 'Cliente',
                        'discarded' => 'Descartado',
                    ) as $k => $label ) : ?>
                        <option value="<?php echo esc_attr( $k ); ?>" <?php selected( $lead->contact_status, $k ); ?>><?php echo esc_html( $label ); ?></option>
                    <?php endforeach; ?>
                </select>
                <p>
                    <label><strong>Notas internas</strong></label>
                    <textarea name="notes" rows="4" style="width:100%;"><?php echo esc_textarea( $lead->notes ); ?></textarea>
                </p>
                <button class="button button-primary">Guardar</button>
            </form>

            <h2 style="margin-top:1.5rem;">Mensaje WhatsApp</h2>
            <?php if ( ! $lead->phone ) : ?>
                <div class="notice notice-warning inline"><p>Este lead no tiene teléfono. Activa "Place Details" en Ajustes si quieres enriquecer las fichas con número de contacto.</p></div>
            <?php endif; ?>

            <label><strong>Plantilla:</strong></label>
            <select id="nvl-template-select">
                <?php foreach ( $templates as $t ) : ?>
                    <option value="<?php echo (int) $t->id; ?>" <?php selected( $default && $default->id == $t->id ); ?> data-body="<?php echo esc_attr( $t->body ); ?>">
                        <?php echo esc_html( $t->name ); ?><?php echo $t->is_default ? ' (por defecto)' : ''; ?>
                    </option>
                <?php endforeach; ?>
            </select>

            <p><label><strong>Mensaje personalizado (puedes editarlo antes de enviar):</strong></label></p>
            <textarea id="nvl-rendered" rows="12" style="width:100%; font-family: monospace;"><?php echo esc_textarea( $rendered ); ?></textarea>

            <?php
            $evo_configured = ( new NVL_Evolution_API() )->is_configured();
            $queue_msg = isset( $_GET['queue_msg'] ) ? sanitize_text_field( wp_unslash( $_GET['queue_msg'] ) ) : '';
            ?>
            <?php if ( $queue_msg ) : ?>
                <div class="notice notice-info inline"><p><?php echo esc_html( $queue_msg ); ?></p></div>
            <?php endif; ?>

            <p>
                <?php if ( $lead->phone ) : ?>
                    <a id="nvl-wa-btn" href="<?php echo esc_url( $wa_link ); ?>" target="_blank" rel="noopener" class="button button-hero">
                        📱 Enviar manual (wa.me)
                    </a>
                <?php else : ?>
                    <button class="button button-hero" disabled>📱 Enviar manual (sin teléfono)</button>
                <?php endif; ?>
                <button id="nvl-copy-btn" class="button button-hero">Copiar mensaje</button>
            </p>

            <hr style="margin: 1.2rem 0;">

            <h2>Envío automatizado (Evolution API)</h2>
            <?php if ( ! $evo_configured ) : ?>
                <div class="notice notice-warning inline"><p>Configura Evolution API en <a href="<?php echo esc_url( admin_url( 'admin.php?page=nvl-settings' ) ); ?>">Ajustes</a> para activar el envío automatizado.</p></div>
            <?php elseif ( ! $lead->phone ) : ?>
                <div class="notice notice-warning inline"><p>Este lead no tiene teléfono; no se puede encolar.</p></div>
            <?php elseif ( $enrolment ) : ?>
                <div class="notice notice-info inline"><p>El lead está en una secuencia activa (paso #<?php echo intval( $enrolment->current_step_index ) + 1; ?>). Si responde, la secuencia se detendrá sola.</p></div>
            <?php else : ?>
                <form method="post" onsubmit="document.getElementById('nvl-cm').value = document.getElementById('nvl-rendered').value;" style="display:inline;">
                    <?php wp_nonce_field( 'nvl_enqueue_lead' ); ?>
                    <input type="hidden" name="nvl_action" value="enqueue_lead">
                    <input type="hidden" name="lead_id" value="<?php echo (int) $lead->id; ?>">
                    <input type="hidden" name="custom_message" id="nvl-cm" value="">
                    <button class="button button-hero">⚡ Encolar mensaje único</button>
                </form>
                <form method="post" style="display:inline; margin-left:8px;">
                    <?php wp_nonce_field( 'nvl_enroll_sequence' ); ?>
                    <input type="hidden" name="nvl_action" value="enroll_sequence">
                    <input type="hidden" name="lead_id" value="<?php echo (int) $lead->id; ?>">
                    <select name="sequence_id">
                        <?php foreach ( $sequences as $s ) : ?>
                            <option value="<?php echo (int) $s->id; ?>" <?php selected( $s->is_default ); ?>><?php echo esc_html( $s->name ); ?></option>
                        <?php endforeach; ?>
                    </select>
                    <button class="button button-primary button-hero">🚀 Enrolar en secuencia</button>
                </form>
                <p><small>"Encolar mensaje único" envía sólo el mensaje que ves arriba. "Enrolar en secuencia" envía ese mensaje + los follow-ups programados automáticamente, parando si responde.</small></p>
            <?php endif; ?>

            <?php if ( ! empty( $score_breakdown ) ) : ?>
                <hr style="margin: 1.2rem 0;">
                <h2>Desglose del score (<?php echo intval( $lead->score ); ?>/100)</h2>
                <table class="widefat striped">
                    <thead><tr><th>Señal</th><th style="width:60px;">+pts</th><th>Detalle</th></tr></thead>
                    <tbody>
                        <?php foreach ( $score_breakdown as $signal => $info ) : ?>
                            <tr>
                                <td><strong><?php echo esc_html( ucfirst( str_replace( '_', ' ', $signal ) ) ); ?></strong></td>
                                <td><strong><?php echo intval( $info['pts'] ); ?></strong></td>
                                <td><?php echo esc_html( $info['note'] ); ?></td>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            <?php endif; ?>

            <?php if ( ! empty( $conversation ) ) : ?>
                <hr style="margin: 1.2rem 0;">
                <h2>Conversación (<?php echo count( $conversation ); ?> mensaje<?php echo count( $conversation ) === 1 ? '' : 's'; ?>)</h2>
                <div class="nvl-conversation">
                    <?php foreach ( $conversation as $c ) : ?>
                        <div class="nvl-msg-in">
                            <div class="nvl-msg-bubble">
                                <div><?php echo nl2br( esc_html( $c->message_text ) ); ?></div>
                                <small style="color:#666;"><?php echo esc_html( mysql2date( 'd/m H:i', $c->received_at ) ); ?>
                                    <?php if ( $c->classification ) : ?>· <strong><?php echo esc_html( $c->classification ); ?></strong><?php endif; ?>
                                </small>
                            </div>
                        </div>
                    <?php endforeach; ?>
                </div>
            <?php endif; ?>

            <p><small>Variables disponibles para plantillas: <code>{{nombre_negocio}}</code>, <code>{{competidor_top}}</code>, <code>{{posicion}}</code>, <code>{{provincia}}</code>, <code>{{keyword}}</code>, <code>{{rating}}</code>, <code>{{resenas}}</code> y más.</small></p>
        </div>
    </div>
</div>

<script>
jQuery(function($){
    var leadId   = <?php echo (int) $lead->id; ?>;
    var phone    = <?php echo wp_json_encode( $lead->phone ); ?>;
    var country  = <?php echo wp_json_encode( $cc ); ?>;

    function normalizePhone(p) {
        if (!p) return '';
        var clean = (p || '').replace(/[^\d+]/g, '');
        if (clean.indexOf('+') === 0) return clean.substring(1);
        if (clean.indexOf('00') === 0) return clean.substring(2);
        if (clean.length === 9) return country + clean;
        return clean;
    }

    function rebuildLink() {
        var msg = $('#nvl-rendered').val();
        var n   = normalizePhone(phone);
        if (!n) return;
        $('#nvl-wa-btn').attr('href', 'https://wa.me/' + n + '?text=' + encodeURIComponent(msg));
    }

    $('#nvl-rendered').on('input', rebuildLink);

    $('#nvl-template-select').on('change', function(){
        var body = $(this).find(':selected').data('body') || '';
        // Pedir al backend que renderice las variables.
        $.post(ajaxurl, { action: 'nvl_render_preview', lead_id: leadId, body: body, _wpnonce: <?php echo wp_json_encode( wp_create_nonce( 'nvl_render' ) ); ?> }, function(resp){
            if (resp && resp.success) {
                $('#nvl-rendered').val(resp.data.rendered);
                rebuildLink();
            }
        });
    });

    $('#nvl-copy-btn').on('click', function(e){
        e.preventDefault();
        var el = $('#nvl-rendered')[0];
        el.select();
        document.execCommand('copy');
        $(this).text('¡Copiado!');
        setTimeout(function(){ $('#nvl-copy-btn').text('Copiar mensaje'); }, 1500);
    });
});
</script>
