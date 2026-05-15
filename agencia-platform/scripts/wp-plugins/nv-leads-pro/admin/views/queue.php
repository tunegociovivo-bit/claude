<?php
if ( ! defined( 'WPINC' ) ) { die; }
$status   = isset( $_GET['status'] ) ? sanitize_text_field( wp_unslash( $_GET['status'] ) ) : '';
$msgs     = NVL_Send_Queue::get_messages( array( 'status' => $status, 'limit' => 100, 'orderby' => 'scheduled_at', 'order' => 'ASC' ) );
$stats    = NVL_Send_Queue::stats();
$settings = get_option( 'nvl_settings', array() );
$paused   = ! empty( $settings['send_paused'] );
$limit    = isset( $settings['daily_limit'] ) ? intval( $settings['daily_limit'] ) : 80;
$evo_ok   = ( new NVL_Evolution_API() )->is_configured();
?>
<div class="wrap nvl-wrap">
    <h1>Cola de envío WhatsApp</h1>

    <?php if ( ! $evo_ok ) : ?>
        <div class="notice notice-warning"><p>Evolution API no está configurada. Ve a <a href="<?php echo esc_url( admin_url( 'admin.php?page=nvl-settings' ) ); ?>">Ajustes</a> para configurarla.</p></div>
    <?php endif; ?>

    <div class="nvl-stats-grid">
        <div class="nvl-card">
            <div class="nvl-card-label">En cola</div>
            <div class="nvl-card-value"><?php echo (int) $stats['queued']; ?></div>
        </div>
        <div class="nvl-card">
            <div class="nvl-card-label">Enviados hoy</div>
            <div class="nvl-card-value"><?php echo (int) $stats['sent_today']; ?> <small>/ <?php echo $limit; ?></small></div>
        </div>
        <div class="nvl-card">
            <div class="nvl-card-label">Enviados (total)</div>
            <div class="nvl-card-value"><?php echo (int) $stats['sent_total']; ?></div>
        </div>
        <div class="nvl-card">
            <div class="nvl-card-label">Fallidos</div>
            <div class="nvl-card-value"><?php echo (int) $stats['failed']; ?></div>
        </div>
        <div class="nvl-card">
            <div class="nvl-card-label">Próximo envío</div>
            <div class="nvl-card-value" style="font-size:18px;">
                <?php echo $stats['next_scheduled'] ? esc_html( mysql2date( 'd/m H:i', $stats['next_scheduled'] ) ) : '—'; ?>
            </div>
        </div>
        <div class="nvl-card <?php echo $paused ? '' : 'nvl-card-success'; ?>">
            <div class="nvl-card-label">Estado del motor</div>
            <div class="nvl-card-value" style="font-size:18px;">
                <?php echo $paused ? '⏸ Pausado' : '▶ Activo'; ?>
            </div>
        </div>
    </div>

    <p>
        <?php if ( $paused ) : ?>
            <a href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin.php?page=nvl-queue&nvl_action=queue_resume' ), 'nvl_queue_action' ) ); ?>" class="button button-primary">▶ Reanudar envíos</a>
        <?php else : ?>
            <a href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin.php?page=nvl-queue&nvl_action=queue_pause' ), 'nvl_queue_action' ) ); ?>" class="button">⏸ Pausar envíos</a>
        <?php endif; ?>
        <?php if ( $stats['failed'] > 0 ) : ?>
            <a href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin.php?page=nvl-queue&nvl_action=queue_retry_failed' ), 'nvl_queue_action' ) ); ?>" class="button" onclick="return confirm('¿Reintentar todos los mensajes fallidos?');">↻ Reintentar fallidos</a>
        <?php endif; ?>
    </p>

    <ul class="subsubsub">
        <li><a href="<?php echo esc_url( admin_url( 'admin.php?page=nvl-queue' ) ); ?>" class="<?php echo $status === '' ? 'current' : ''; ?>">Todos</a> |</li>
        <li><a href="<?php echo esc_url( admin_url( 'admin.php?page=nvl-queue&status=queued' ) ); ?>" class="<?php echo $status === 'queued' ? 'current' : ''; ?>">En cola (<?php echo $stats['queued']; ?>)</a> |</li>
        <li><a href="<?php echo esc_url( admin_url( 'admin.php?page=nvl-queue&status=sent' ) ); ?>" class="<?php echo $status === 'sent' ? 'current' : ''; ?>">Enviados</a> |</li>
        <li><a href="<?php echo esc_url( admin_url( 'admin.php?page=nvl-queue&status=failed' ) ); ?>" class="<?php echo $status === 'failed' ? 'current' : ''; ?>">Fallidos (<?php echo $stats['failed']; ?>)</a></li>
    </ul>

    <table class="wp-list-table widefat fixed striped">
        <thead>
            <tr>
                <th>Lead</th>
                <th>Teléfono</th>
                <th>Programado</th>
                <th>Estado</th>
                <th>Vista previa del mensaje</th>
                <th>Intentos</th>
                <th>Acciones</th>
            </tr>
        </thead>
        <tbody>
            <?php if ( empty( $msgs ) ) : ?>
                <tr><td colspan="7">Cola vacía.</td></tr>
            <?php else : foreach ( $msgs as $m ) : ?>
                <tr>
                    <td>
                        <?php if ( $m->lead_id ) : ?>
                            <a href="<?php echo esc_url( admin_url( 'admin.php?page=nvl-lead-detail&id=' . $m->lead_id ) ); ?>"><strong><?php echo esc_html( $m->lead_name ); ?></strong></a>
                        <?php else : ?>
                            <?php echo esc_html( $m->lead_name ); ?>
                        <?php endif; ?>
                    </td>
                    <td><code><?php echo esc_html( $m->phone_normalized ); ?></code></td>
                    <td><?php echo esc_html( mysql2date( 'd/m/Y H:i', $m->scheduled_at ) ); ?></td>
                    <td><span class="nvl-pill nvl-pill-<?php echo esc_attr( $m->status ); ?>"><?php echo esc_html( $m->status ); ?></span></td>
                    <td><small><?php echo esc_html( mb_substr( $m->rendered_message, 0, 90 ) ); ?>…</small>
                        <?php if ( $m->last_error ) : ?><br><small style="color:#a00;">⚠ <?php echo esc_html( $m->last_error ); ?></small><?php endif; ?>
                    </td>
                    <td><?php echo (int) $m->send_attempts; ?></td>
                    <td>
                        <?php if ( in_array( $m->status, array( 'queued', 'failed' ), true ) ) : ?>
                            <a class="button button-small" href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin.php?page=nvl-queue&nvl_action=send_now&id=' . $m->id ), 'nvl_send_now_' . $m->id ) ); ?>" onclick="return confirm('¿Enviar ahora ignorando la ventana horaria?');">Enviar ahora</a>
                        <?php endif; ?>
                        <a class="button button-small button-link-delete" href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin.php?page=nvl-queue&nvl_action=queue_delete&id=' . $m->id ), 'nvl_queue_delete_' . $m->id ) ); ?>" onclick="return confirm('¿Borrar este mensaje de la cola?');">Borrar</a>
                    </td>
                </tr>
            <?php endforeach; endif; ?>
        </tbody>
    </table>
</div>

<style>
.nvl-pill-queued  { background: #fff4cc; color: #7a5d00; }
.nvl-pill-sending { background: #ddebf6; color: #205493; }
.nvl-pill-sent    { background: #d6f0d6; color: #1f7a1f; }
.nvl-pill-failed  { background: #fad3d3; color: #a02828; }
</style>
