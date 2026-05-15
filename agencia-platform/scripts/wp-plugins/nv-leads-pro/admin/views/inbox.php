<?php
if ( ! defined( 'WPINC' ) ) { die; }
$cls    = isset( $_GET['cls'] ) ? sanitize_text_field( wp_unslash( $_GET['cls'] ) ) : '';
$msgs   = NVL_Inbox::get_messages( array( 'classification' => $cls, 'limit' => 100 ) );
$counts = NVL_Inbox::counts();
$labels = array(
    'interested'   => '🟢 Interesado',
    'info_request' => '🔵 Pide info',
    'objection'    => '🟡 Objeción',
    'positive_no'  => '⚪ No cortés',
    'opt_out'      => '🚫 Baja',
    'off_topic'    => '⚫ Off-topic',
    'auto_reply'   => '🤖 Auto',
);
?>
<div class="wrap nvl-wrap">
    <h1>Bandeja de respuestas</h1>
    <p class="nvl-subtitle">Mensajes recibidos de leads tras el envío de prospección. Las secuencias se paran automáticamente al recibir respuesta.</p>

    <div class="nvl-stats-grid">
        <div class="nvl-card"><div class="nvl-card-label">Total</div><div class="nvl-card-value"><?php echo (int) $counts['total']; ?></div></div>
        <div class="nvl-card"><div class="nvl-card-label">Sin leer</div><div class="nvl-card-value"><?php echo (int) $counts['unread']; ?></div></div>
        <div class="nvl-card nvl-card-success"><div class="nvl-card-label">Interesados</div><div class="nvl-card-value"><?php echo (int) $counts['interested']; ?></div></div>
        <div class="nvl-card"><div class="nvl-card-label">Piden info</div><div class="nvl-card-value"><?php echo (int) $counts['info_request']; ?></div></div>
        <div class="nvl-card"><div class="nvl-card-label">Objeciones</div><div class="nvl-card-value"><?php echo (int) $counts['objection']; ?></div></div>
        <div class="nvl-card"><div class="nvl-card-label">Bajas</div><div class="nvl-card-value"><?php echo (int) $counts['opt_out']; ?></div></div>
    </div>

    <ul class="subsubsub">
        <li><a class="<?php echo $cls === '' ? 'current' : ''; ?>" href="<?php echo esc_url( admin_url( 'admin.php?page=nvl-inbox' ) ); ?>">Todos</a> |</li>
        <?php foreach ( $labels as $k => $lbl ) : ?>
            <li><a class="<?php echo $cls === $k ? 'current' : ''; ?>" href="<?php echo esc_url( admin_url( 'admin.php?page=nvl-inbox&cls=' . $k ) ); ?>"><?php echo esc_html( $lbl ); ?></a> |</li>
        <?php endforeach; ?>
    </ul>

    <table class="widefat fixed striped">
        <thead>
            <tr>
                <th>Lead</th>
                <th>Teléfono</th>
                <th>Mensaje</th>
                <th>Clasificación</th>
                <th>Recibido</th>
                <th></th>
            </tr>
        </thead>
        <tbody>
        <?php if ( empty( $msgs ) ) : ?>
            <tr><td colspan="6">No hay mensajes que mostrar. <?php if ( $cls === '' ) : ?>Cuando un lead responda por WhatsApp, su mensaje aparecerá aquí (configura el webhook de Evolution en Ajustes).<?php endif; ?></td></tr>
        <?php else : foreach ( $msgs as $m ) : ?>
            <tr<?php echo $m->is_read ? '' : ' style="font-weight:600;background:#fff8d6;"'; ?>>
                <td>
                    <?php if ( $m->lead_id ) : ?>
                        <a href="<?php echo esc_url( admin_url( 'admin.php?page=nvl-lead-detail&id=' . $m->lead_id ) ); ?>"><?php echo esc_html( $m->lead_name ); ?></a>
                    <?php else : ?>
                        <em>Lead desconocido</em>
                    <?php endif; ?>
                </td>
                <td><code><?php echo esc_html( $m->phone_normalized ); ?></code></td>
                <td>
                    <div style="max-width:480px;white-space:pre-wrap;font-family:inherit;"><?php echo esc_html( mb_substr( $m->message_text, 0, 300 ) ); ?></div>
                    <?php if ( $m->classification_reason ) : ?>
                        <small style="color:#666;">↳ <?php echo esc_html( $m->classification_reason ); ?></small>
                    <?php endif; ?>
                </td>
                <td><?php echo isset( $labels[ $m->classification ] ) ? esc_html( $labels[ $m->classification ] ) : esc_html( $m->classification ); ?></td>
                <td><?php echo esc_html( mysql2date( 'd/m H:i', $m->received_at ) ); ?></td>
                <td>
                    <?php if ( ! $m->is_read ) : ?>
                        <a class="button button-small" href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin.php?page=nvl-inbox&nvl_action=inbox_mark_read&id=' . $m->id ), 'nvl_inbox_read_' . $m->id ) ); ?>">Marcar leído</a>
                    <?php endif; ?>
                </td>
            </tr>
        <?php endforeach; endif; ?>
        </tbody>
    </table>
</div>
