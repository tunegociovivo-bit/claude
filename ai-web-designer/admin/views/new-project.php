<?php if ( ! defined( 'ABSPATH' ) ) { exit; }
$presets = AIWD_Presets::all();
?>
<div class="wrap aiwd-wrap">
    <h1><?php esc_html_e( 'Nuevo proyecto web', 'ai-web-designer' ); ?></h1>
    <p class="description"><?php esc_html_e( 'Elige un preset para arrancar pre-rellenado, o empieza en blanco.', 'ai-web-designer' ); ?></p>

    <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="aiwd-form">
        <?php wp_nonce_field( 'aiwd_create_project' ); ?>
        <input type="hidden" name="action" value="aiwd_create_project" />

        <table class="form-table">
            <tr>
                <th><label for="project_title"><?php esc_html_e( 'Nombre del proyecto', 'ai-web-designer' ); ?></label></th>
                <td><input type="text" id="project_title" name="project_title" class="regular-text" required placeholder="<?php esc_attr_e( 'Ej. Restaurante La Buena Mesa', 'ai-web-designer' ); ?>" /></td>
            </tr>
            <tr>
                <th><label for="client_name"><?php esc_html_e( 'Cliente (opcional)', 'ai-web-designer' ); ?></label></th>
                <td><input type="text" id="client_name" name="client_name" class="regular-text" placeholder="<?php esc_attr_e( 'Nombre del cliente', 'ai-web-designer' ); ?>" /></td>
            </tr>
        </table>

        <h2><?php esc_html_e( 'Selecciona un preset', 'ai-web-designer' ); ?></h2>
        <div class="aiwd-presets-grid">
            <label class="aiwd-preset-card">
                <input type="radio" name="preset" value="" checked />
                <h3><?php esc_html_e( 'En blanco', 'ai-web-designer' ); ?></h3>
                <p><?php esc_html_e( 'Rellenar todo manualmente desde cero.', 'ai-web-designer' ); ?></p>
            </label>

            <?php foreach ( $presets as $key => $p ) :
                $colors = $p['palette'] ?? []; ?>
                <label class="aiwd-preset-card">
                    <input type="radio" name="preset" value="<?php echo esc_attr( $key ); ?>" />
                    <h3><?php echo esc_html( $p['name'] ); ?></h3>
                    <p><?php echo esc_html( $p['description'] ?? '' ); ?></p>
                    <div class="aiwd-preset-swatches">
                        <?php foreach ( [ 'primary', 'secondary', 'accent' ] as $sk ) :
                            if ( empty( $colors[ $sk ] ) ) continue; ?>
                            <span style="background:<?php echo esc_attr( $colors[ $sk ] ); ?>" title="<?php echo esc_attr( $colors[ $sk ] ); ?>"></span>
                        <?php endforeach; ?>
                        <small><?php echo esc_html( ( $p['fonts']['heading'] ?? '' ) . ' / ' . ( $p['fonts']['body'] ?? '' ) ); ?></small>
                    </div>
                </label>
            <?php endforeach; ?>
        </div>

        <p style="margin-top:24px;">
            <button class="button button-primary button-hero"><?php esc_html_e( 'Crear proyecto', 'ai-web-designer' ); ?></button>
            <a class="button" href="<?php echo esc_url( admin_url( 'admin.php?page=aiwd-presets' ) ); ?>"><?php esc_html_e( 'Gestionar presets', 'ai-web-designer' ); ?></a>
        </p>
    </form>
</div>
