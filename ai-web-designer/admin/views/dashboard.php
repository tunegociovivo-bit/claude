<?php if ( ! defined( 'ABSPATH' ) ) { exit; } ?>
<div class="wrap aiwd-wrap">
    <h1><?php esc_html_e( 'AI Web Designer · Dashboard', 'ai-web-designer' ); ?></h1>
    <p class="description"><?php esc_html_e( 'Genera webs completas en Elementor con la ayuda de Claude. Empieza creando un proyecto o continúa uno existente.', 'ai-web-designer' ); ?></p>

    <div class="aiwd-cards">
        <a class="aiwd-card" href="<?php echo esc_url( admin_url( 'admin.php?page=aiwd-new' ) ); ?>">
            <span class="dashicons dashicons-plus-alt"></span>
            <h2><?php esc_html_e( 'Nuevo proyecto', 'ai-web-designer' ); ?></h2>
            <p><?php esc_html_e( 'Inicia un briefing guiado paso a paso.', 'ai-web-designer' ); ?></p>
        </a>
        <a class="aiwd-card" href="<?php echo esc_url( admin_url( 'admin.php?page=aiwd-projects' ) ); ?>">
            <span class="dashicons dashicons-portfolio"></span>
            <h2><?php esc_html_e( 'Proyectos', 'ai-web-designer' ); ?></h2>
            <p><?php esc_html_e( 'Listado, estado y versiones.', 'ai-web-designer' ); ?></p>
        </a>
        <a class="aiwd-card" href="<?php echo esc_url( admin_url( 'admin.php?page=aiwd-templates' ) ); ?>">
            <span class="dashicons dashicons-layout"></span>
            <h2><?php esc_html_e( 'Plantillas', 'ai-web-designer' ); ?></h2>
            <p><?php esc_html_e( 'Bibliotecas por sector y bloques.', 'ai-web-designer' ); ?></p>
        </a>
        <a class="aiwd-card" href="<?php echo esc_url( admin_url( 'admin.php?page=aiwd-settings' ) ); ?>">
            <span class="dashicons dashicons-admin-generic"></span>
            <h2><?php esc_html_e( 'Ajustes', 'ai-web-designer' ); ?></h2>
            <p><?php esc_html_e( 'API de Claude, generadores de imágenes e integraciones.', 'ai-web-designer' ); ?></p>
        </a>
    </div>

    <h2><?php esc_html_e( 'Proyectos recientes', 'ai-web-designer' ); ?></h2>
    <?php
    $projects = get_posts( [
        'post_type'      => AIWD_CPT_Project::POST_TYPE,
        'posts_per_page' => 10,
        'orderby'        => 'date',
        'order'          => 'DESC',
    ] );
    if ( $projects ) :
        $statuses = aiwd_project_statuses();
    ?>
    <table class="widefat striped">
        <thead><tr>
            <th><?php esc_html_e( 'Proyecto', 'ai-web-designer' ); ?></th>
            <th><?php esc_html_e( 'Estado', 'ai-web-designer' ); ?></th>
            <th><?php esc_html_e( 'Última actualización', 'ai-web-designer' ); ?></th>
            <th><?php esc_html_e( 'Acciones', 'ai-web-designer' ); ?></th>
        </tr></thead>
        <tbody>
        <?php foreach ( $projects as $p ) :
            $status = get_post_meta( $p->ID, '_aiwd_status', true );
        ?>
            <tr>
                <td><strong><?php echo esc_html( $p->post_title ); ?></strong></td>
                <td><?php echo esc_html( $statuses[ $status ] ?? '—' ); ?></td>
                <td><?php echo esc_html( get_the_modified_date( '', $p ) ); ?></td>
                <td>
                    <a class="button" href="<?php echo esc_url( admin_url( 'admin.php?page=aiwd-wizard&project_id=' . $p->ID ) ); ?>"><?php esc_html_e( 'Editar', 'ai-web-designer' ); ?></a>
                </td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
    <?php else : ?>
        <p><?php esc_html_e( 'Aún no hay proyectos. Crea el primero.', 'ai-web-designer' ); ?></p>
    <?php endif; ?>
</div>
