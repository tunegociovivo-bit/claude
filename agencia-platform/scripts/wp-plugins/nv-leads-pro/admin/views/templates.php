<?php
if ( ! defined( 'WPINC' ) ) { die; }
$edit_id   = isset( $_GET['edit'] ) ? intval( $_GET['edit'] ) : 0;
$editing   = $edit_id ? NVL_DB::get_template( $edit_id ) : null;
$templates = NVL_DB::get_templates();
$vars      = NVL_Template_Engine::available_variables();
?>
<div class="wrap nvl-wrap">
    <h1>Plantillas de mensaje</h1>

    <?php if ( isset( $_GET['saved'] ) ) : ?>
        <div class="notice notice-success is-dismissible"><p>Plantilla guardada.</p></div>
    <?php endif; ?>
    <?php if ( isset( $_GET['deleted'] ) ) : ?>
        <div class="notice notice-success is-dismissible"><p>Plantilla eliminada.</p></div>
    <?php endif; ?>

    <div class="nvl-detail-grid">
        <div class="nvl-detail-col">
            <h2><?php echo $editing ? 'Editar plantilla' : 'Nueva plantilla'; ?></h2>
            <form method="post">
                <?php wp_nonce_field( 'nvl_save_template' ); ?>
                <input type="hidden" name="nvl_action" value="save_template">
                <input type="hidden" name="template_id" value="<?php echo (int) $edit_id; ?>">

                <p>
                    <label><strong>Nombre</strong></label><br>
                    <input type="text" name="name" required class="regular-text" value="<?php echo $editing ? esc_attr( $editing->name ) : ''; ?>">
                </p>
                <p>
                    <label><strong>Mensaje</strong></label><br>
                    <textarea name="body" rows="14" required style="width:100%; font-family: monospace;"><?php echo $editing ? esc_textarea( $editing->body ) : ''; ?></textarea>
                </p>
                <p>
                    <label><input type="checkbox" name="is_default" value="1" <?php checked( $editing && $editing->is_default ); ?>> Marcar como plantilla por defecto</label>
                </p>
                <p>
                    <button class="button button-primary">Guardar plantilla</button>
                    <?php if ( $editing ) : ?>
                        <a class="button" href="<?php echo esc_url( admin_url( 'admin.php?page=nvl-templates' ) ); ?>">Cancelar</a>
                    <?php endif; ?>
                </p>
            </form>
        </div>

        <div class="nvl-detail-col">
            <h2>Variables disponibles</h2>
            <p>Usa estas variables en el cuerpo del mensaje. Se sustituirán automáticamente por los datos de cada lead.</p>
            <table class="widefat striped">
                <thead><tr><th>Variable</th><th>Descripción</th></tr></thead>
                <tbody>
                    <?php foreach ( $vars as $k => $desc ) : ?>
                        <tr>
                            <td><code>{{<?php echo esc_html( $k ); ?>}}</code></td>
                            <td><?php echo esc_html( $desc ); ?></td>
                        </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
        </div>
    </div>

    <h2 style="margin-top:2rem;">Todas las plantillas</h2>
    <table class="widefat striped">
        <thead><tr><th>Nombre</th><th>Por defecto</th><th>Vista previa</th><th>Acciones</th></tr></thead>
        <tbody>
            <?php foreach ( $templates as $t ) : ?>
                <tr>
                    <td><strong><?php echo esc_html( $t->name ); ?></strong></td>
                    <td><?php echo $t->is_default ? '✅' : '—'; ?></td>
                    <td><small><?php echo esc_html( mb_substr( wp_strip_all_tags( $t->body ), 0, 140 ) ); ?>…</small></td>
                    <td>
                        <a class="button button-small" href="<?php echo esc_url( admin_url( 'admin.php?page=nvl-templates&edit=' . $t->id ) ); ?>">Editar</a>
                        <?php $del = wp_nonce_url( admin_url( 'admin.php?page=nvl-templates&nvl_action=delete_template&id=' . $t->id ), 'nvl_delete_template_' . $t->id ); ?>
                        <a class="button button-small button-link-delete" href="<?php echo esc_url( $del ); ?>" onclick="return confirm('¿Eliminar plantilla?');">Borrar</a>
                    </td>
                </tr>
            <?php endforeach; ?>
        </tbody>
    </table>
</div>
