<?php
if ( ! defined( 'WPINC' ) ) { die; }
$edit_id = isset( $_GET['edit'] ) ? intval( $_GET['edit'] ) : 0;
$editing = $edit_id ? NVL_Sequences::get_sequence( $edit_id ) : null;
$steps   = $edit_id ? NVL_Sequences::get_steps( $edit_id ) : array();
$all     = NVL_Sequences::get_sequences();
?>
<div class="wrap nvl-wrap">
    <h1>Secuencias de follow-up</h1>
    <p class="nvl-subtitle">Cuando enrolas un lead en una secuencia, el plugin envía los pasos automáticamente con los delays que configures. Si el lead responde, la secuencia se detiene sola.</p>

    <?php if ( isset( $_GET['saved'] ) ) : ?><div class="notice notice-success is-dismissible"><p>Secuencia guardada.</p></div><?php endif; ?>
    <?php if ( isset( $_GET['deleted'] ) ) : ?><div class="notice notice-success is-dismissible"><p>Secuencia eliminada.</p></div><?php endif; ?>

    <div class="nvl-detail-grid">
        <div class="nvl-detail-col">
            <h2><?php echo $editing ? 'Editar secuencia' : 'Nueva secuencia'; ?></h2>
            <form method="post">
                <?php wp_nonce_field( 'nvl_save_sequence' ); ?>
                <input type="hidden" name="nvl_action" value="save_sequence">
                <input type="hidden" name="sequence_id" value="<?php echo (int) $edit_id; ?>">

                <p>
                    <label><strong>Nombre</strong></label><br>
                    <input type="text" name="name" required class="regular-text" value="<?php echo $editing ? esc_attr( $editing->name ) : ''; ?>">
                </p>
                <p>
                    <label><strong>Descripción</strong></label><br>
                    <textarea name="description" rows="2" style="width:100%;"><?php echo $editing ? esc_textarea( $editing->description ) : ''; ?></textarea>
                </p>
                <p>
                    <label><input type="checkbox" name="is_active" value="1" <?php checked( $editing ? $editing->is_active : 1 ); ?>> Activa</label>
                    &nbsp;
                    <label><input type="checkbox" name="is_default" value="1" <?php checked( $editing && $editing->is_default ); ?>> Por defecto</label>
                </p>

                <h3>Pasos</h3>
                <div id="nvl-steps">
                    <?php
                    if ( ! empty( $steps ) ) {
                        foreach ( $steps as $i => $s ) : ?>
                            <div class="nvl-step">
                                <div class="nvl-step-head">
                                    <strong>Paso <?php echo $i + 1; ?></strong>
                                    <label>Delay <input type="number" name="steps[<?php echo $i; ?>][delay_days]" min="0" max="60" value="<?php echo (int) $s->delay_days; ?>"> días después del paso anterior</label>
                                    <button type="button" class="button button-link-delete nvl-remove-step">Quitar</button>
                                </div>
                                <textarea name="steps[<?php echo $i; ?>][template_body]" rows="6" style="width:100%;"><?php echo esc_textarea( $s->template_body ); ?></textarea>
                            </div>
                        <?php endforeach;
                    }
                    ?>
                </div>
                <p><button type="button" class="button" id="nvl-add-step">+ Añadir paso</button></p>

                <p class="submit">
                    <button class="button button-primary button-hero">Guardar secuencia</button>
                    <?php if ( $editing ) : ?><a class="button" href="<?php echo esc_url( admin_url( 'admin.php?page=nvl-sequences' ) ); ?>">Cancelar</a><?php endif; ?>
                </p>

                <p><small>Variables disponibles: <code>{{nombre_negocio}}</code>, <code>{{posicion}}</code>, <code>{{provincia}}</code>, <code>{{competidor_top}}</code>, <code>{{keyword}}</code>, <code>{{opener_ia}}</code>, <code>{{rating}}</code>, <code>{{pct_negativas}}</code>.</small></p>
            </form>
        </div>

        <div class="nvl-detail-col">
            <h2>Todas las secuencias</h2>
            <table class="widefat striped">
                <thead><tr><th>Nombre</th><th>Pasos</th><th>Estado</th><th>Acciones</th></tr></thead>
                <tbody>
                    <?php foreach ( $all as $s ) :
                        $n_steps = count( NVL_Sequences::get_steps( $s->id ) ); ?>
                        <tr>
                            <td><strong><?php echo esc_html( $s->name ); ?></strong><?php echo $s->is_default ? ' <small>(por defecto)</small>' : ''; ?>
                                <br><small><?php echo esc_html( $s->description ); ?></small>
                            </td>
                            <td><?php echo $n_steps; ?></td>
                            <td><?php echo $s->is_active ? '✅ Activa' : '⏸ Pausada'; ?></td>
                            <td>
                                <a class="button button-small" href="<?php echo esc_url( admin_url( 'admin.php?page=nvl-sequences&edit=' . $s->id ) ); ?>">Editar</a>
                                <?php $del = wp_nonce_url( admin_url( 'admin.php?page=nvl-sequences&nvl_action=delete_sequence&id=' . $s->id ), 'nvl_delete_sequence_' . $s->id ); ?>
                                <a class="button button-small button-link-delete" href="<?php echo esc_url( $del ); ?>" onclick="return confirm('¿Eliminar secuencia y desuscribir leads?');">Borrar</a>
                            </td>
                        </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
        </div>
    </div>
</div>

<script>
jQuery(function($){
    let idx = $('#nvl-steps .nvl-step').length;
    $('#nvl-add-step').on('click', function(){
        const html = '<div class="nvl-step">' +
            '<div class="nvl-step-head"><strong>Paso ' + (idx+1) + '</strong>' +
            ' <label>Delay <input type="number" name="steps[' + idx + '][delay_days]" min="0" max="60" value="3"> días</label>' +
            ' <button type="button" class="button button-link-delete nvl-remove-step">Quitar</button></div>' +
            '<textarea name="steps[' + idx + '][template_body]" rows="6" style="width:100%;" placeholder="Cuerpo del mensaje (puedes usar variables {{...}})"></textarea>' +
            '</div>';
        $('#nvl-steps').append(html);
        idx++;
    });
    $(document).on('click', '.nvl-remove-step', function(){
        $(this).closest('.nvl-step').remove();
    });
});
</script>

<style>
.nvl-step { border: 1px solid #c3c4c7; border-radius: 6px; padding: 12px; margin-bottom: 10px; background: #fafbfc; }
.nvl-step-head { display: flex; align-items: center; gap: 14px; margin-bottom: 8px; }
.nvl-step-head input[type=number] { width: 70px; }
</style>
