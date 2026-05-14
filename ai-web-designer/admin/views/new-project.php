<?php if ( ! defined( 'ABSPATH' ) ) { exit; } ?>
<div class="wrap aiwd-wrap">
    <h1><?php esc_html_e( 'Nuevo proyecto web', 'ai-web-designer' ); ?></h1>
    <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="aiwd-form">
        <?php wp_nonce_field( 'aiwd_create_project' ); ?>
        <input type="hidden" name="action" value="aiwd_create_project" />

        <table class="form-table">
            <tr>
                <th><label for="project_title"><?php esc_html_e( 'Nombre del proyecto', 'ai-web-designer' ); ?></label></th>
                <td><input type="text" id="project_title" name="project_title" class="regular-text" required placeholder="<?php esc_attr_e( 'Ej. Restaurante La Buena Mesa', 'ai-web-designer' ); ?>" /></td>
            </tr>
        </table>

        <p><button class="button button-primary button-hero"><?php esc_html_e( 'Crear y empezar briefing', 'ai-web-designer' ); ?></button></p>
    </form>
</div>
