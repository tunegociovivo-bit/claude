<?php
if ( ! defined( 'WPINC' ) ) { die; }
$tab        = isset( $_GET['tab'] ) ? sanitize_text_field( wp_unslash( $_GET['tab'] ) ) : 'clients';
$exclusions = NVL_Exclusions::get_exclusions();
$optouts    = NVL_Exclusions::get_optouts();
?>
<div class="wrap nvl-wrap">
    <h1>Exclusiones</h1>
    <p class="nvl-subtitle">Negocios y telefonos que NO se deben contactar nunca.</p>

    <?php if ( isset( $_GET['saved'] ) ) : ?>
        <div class="notice notice-success is-dismissible"><p>Entrada añadida correctamente.</p></div>
    <?php endif; ?>
    <?php if ( isset( $_GET['deleted'] ) ) : ?>
        <div class="notice notice-success is-dismissible"><p>Entrada eliminada.</p></div>
    <?php endif; ?>
    <?php if ( isset( $_GET['excl_error'] ) ) : ?>
        <div class="notice notice-error"><p><?php echo esc_html( wp_unslash( $_GET['excl_error'] ) ); ?></p></div>
    <?php endif; ?>

    <h2 class="nav-tab-wrapper">
        <a href="<?php echo esc_url( admin_url( 'admin.php?page=nvl-exclusions&tab=clients' ) ); ?>" class="nav-tab <?php echo $tab === 'clients' ? 'nav-tab-active' : ''; ?>">
            Clientes existentes (<?php echo count( $exclusions ); ?>)
        </a>
        <a href="<?php echo esc_url( admin_url( 'admin.php?page=nvl-exclusions&tab=optouts' ) ); ?>" class="nav-tab <?php echo $tab === 'optouts' ? 'nav-tab-active' : ''; ?>">
            Opt-outs / No contactar (<?php echo count( $optouts ); ?>)
        </a>
    </h2>

    <?php if ( $tab === 'clients' ) : ?>
        <div class="nvl-detail-grid" style="margin-top:1.2rem;">
            <div class="nvl-detail-col">
                <h2>Añadir patron de exclusion</h2>
                <p>Define una palabra o frase que aparezca en el nombre de la ficha de tu cliente actual. Si la encontramos en una busqueda, ese negocio se marcara como excluido y no recibira ningun mensaje.</p>

                <form method="post">
                    <?php wp_nonce_field( 'nvl_add_exclusion' ); ?>
                    <input type="hidden" name="nvl_action" value="add_exclusion">
                    <p>
                        <label><strong>Patron de nombre</strong></label><br>
                        <input type="text" name="match_value" class="regular-text" required placeholder="Ej: Masajes Bambú Madrid">
                        <p class="description">Lo comparamos sin distinguir mayusculas/minusculas. Por defecto en modo "contiene".</p>
                    </p>
                    <p>
                        <label><strong>Modo</strong></label><br>
                        <label><input type="radio" name="match_mode" value="contains" checked> Contiene (recomendado, mas flexible)</label><br>
                        <label><input type="radio" name="match_mode" value="exact"> Exacto (solo si el nombre es identico)</label>
                    </p>
                    <p>
                        <label><strong>Motivo / nota interna</strong></label><br>
                        <input type="text" name="reason" class="regular-text" placeholder="Ej: cliente desde 2024">
                    </p>
                    <p>
                        <button class="button button-primary">Añadir a exclusiones</button>
                    </p>
                </form>
            </div>
            <div class="nvl-detail-col">
                <h2>Patrones actuales</h2>
                <?php if ( empty( $exclusions ) ) : ?>
                    <p><em>No hay patrones de exclusion. Cuando los añadas, los negocios que coincidan se marcaran como "excluidos" automaticamente al hacer una busqueda.</em></p>
                <?php else : ?>
                    <table class="widefat striped">
                        <thead><tr><th>Patron</th><th>Modo</th><th>Motivo</th><th></th></tr></thead>
                        <tbody>
                            <?php foreach ( $exclusions as $e ) : ?>
                                <tr>
                                    <td><strong><?php echo esc_html( $e->match_value ); ?></strong></td>
                                    <td><?php echo esc_html( $e->match_mode ); ?></td>
                                    <td><?php echo esc_html( $e->reason ); ?></td>
                                    <td>
                                        <?php $del = wp_nonce_url( admin_url( 'admin.php?page=nvl-exclusions&tab=clients&nvl_action=delete_exclusion&id=' . $e->id ), 'nvl_del_exclusion_' . $e->id ); ?>
                                        <a href="<?php echo esc_url( $del ); ?>" class="button button-small button-link-delete" onclick="return confirm('¿Eliminar este patron?');">Borrar</a>
                                    </td>
                                </tr>
                            <?php endforeach; ?>
                        </tbody>
                    </table>
                <?php endif; ?>
            </div>
        </div>
    <?php else : ?>
        <div class="nvl-detail-grid" style="margin-top:1.2rem;">
            <div class="nvl-detail-col">
                <h2>Añadir telefono a opt-outs</h2>
                <p>Telefonos a los que el plugin no enviara mensajes nunca. Cuando un lead responde con "baja" o similar, su telefono se añade aqui automaticamente.</p>

                <form method="post">
                    <?php wp_nonce_field( 'nvl_add_optout' ); ?>
                    <input type="hidden" name="nvl_action" value="add_optout">
                    <p>
                        <label><strong>Telefono</strong></label><br>
                        <input type="text" name="phone" class="regular-text" required placeholder="Ej: 34666123456 o +34 666 12 34 56">
                        <p class="description">Se normaliza automaticamente (sin +, sin espacios).</p>
                    </p>
                    <p>
                        <label><strong>Motivo</strong></label><br>
                        <input type="text" name="reason" class="regular-text" placeholder="Ej: pidio baja por email">
                    </p>
                    <p>
                        <button class="button button-primary">Añadir a opt-outs</button>
                    </p>
                </form>
            </div>
            <div class="nvl-detail-col">
                <h2>Telefonos en opt-outs</h2>
                <?php if ( empty( $optouts ) ) : ?>
                    <p><em>No hay opt-outs registrados. Cuando un lead pida baja se añadiran automaticamente.</em></p>
                <?php else : ?>
                    <table class="widefat striped">
                        <thead><tr><th>Telefono</th><th>Origen</th><th>Motivo</th><th>Fecha</th><th></th></tr></thead>
                        <tbody>
                            <?php foreach ( $optouts as $o ) : ?>
                                <tr>
                                    <td><code><?php echo esc_html( $o->phone_normalized ); ?></code></td>
                                    <td><small><?php echo esc_html( $o->source ); ?></small></td>
                                    <td><?php echo esc_html( $o->reason ); ?></td>
                                    <td><small><?php echo esc_html( mysql2date( 'd/m/Y H:i', $o->created_at ) ); ?></small></td>
                                    <td>
                                        <?php $del = wp_nonce_url( admin_url( 'admin.php?page=nvl-exclusions&tab=optouts&nvl_action=delete_optout&id=' . $o->id ), 'nvl_del_optout_' . $o->id ); ?>
                                        <a href="<?php echo esc_url( $del ); ?>" class="button button-small button-link-delete" onclick="return confirm('¿Eliminar opt-out?');">Borrar</a>
                                    </td>
                                </tr>
                            <?php endforeach; ?>
                        </tbody>
                    </table>
                <?php endif; ?>
            </div>
        </div>
    <?php endif; ?>
</div>
