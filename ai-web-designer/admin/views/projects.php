<?php if ( ! defined( 'ABSPATH' ) ) { exit; }
$projects = get_posts( [
    'post_type'      => AIWD_CPT_Project::POST_TYPE,
    'posts_per_page' => 50,
] );
$statuses = aiwd_project_statuses();
?>
<div class="wrap aiwd-wrap">
    <h1>
        <?php esc_html_e( 'Proyectos', 'ai-web-designer' ); ?>
        <a class="page-title-action" href="<?php echo esc_url( admin_url( 'admin.php?page=aiwd-new' ) ); ?>"><?php esc_html_e( 'Nuevo', 'ai-web-designer' ); ?></a>
    </h1>
    <table class="widefat striped">
        <thead><tr>
            <th><?php esc_html_e( 'Título', 'ai-web-designer' ); ?></th>
            <th><?php esc_html_e( 'Estado', 'ai-web-designer' ); ?></th>
            <th><?php esc_html_e( 'Sector', 'ai-web-designer' ); ?></th>
            <th><?php esc_html_e( 'Autor', 'ai-web-designer' ); ?></th>
            <th><?php esc_html_e( 'Fecha', 'ai-web-designer' ); ?></th>
            <th></th>
        </tr></thead>
        <tbody>
        <?php foreach ( $projects as $p ) :
            $status = get_post_meta( $p->ID, '_aiwd_status', true );
            $sector = wp_get_post_terms( $p->ID, 'aiwd_sector', [ 'fields' => 'names' ] );
        ?>
            <tr>
                <td><strong><?php echo esc_html( $p->post_title ); ?></strong></td>
                <td><?php echo esc_html( $statuses[ $status ] ?? '—' ); ?></td>
                <td><?php echo esc_html( implode( ', ', $sector ) ); ?></td>
                <td><?php echo esc_html( get_the_author_meta( 'display_name', $p->post_author ) ); ?></td>
                <td><?php echo esc_html( get_the_date( '', $p ) ); ?></td>
                <td>
                    <a class="button" href="<?php echo esc_url( admin_url( 'admin.php?page=aiwd-wizard&project_id=' . $p->ID ) ); ?>"><?php esc_html_e( 'Editar', 'ai-web-designer' ); ?></a>
                    <a class="button" href="<?php echo esc_url( rest_url( 'aiwd/v1/project/' . $p->ID . '/proposal.pdf' ) ); ?>" target="_blank"><?php esc_html_e( 'PDF', 'ai-web-designer' ); ?></a>
                    <button class="button aiwd-client-link" data-project="<?php echo esc_attr( $p->ID ); ?>"><?php esc_html_e( 'Enlace cliente', 'ai-web-designer' ); ?></button>
                    <?php $asana_gid = get_post_meta( $p->ID, AIWD_Asana_Sync::META_PROJECT, true ); ?>
                    <?php if ( $asana_gid ) : ?>
                        <a class="button" href="<?php echo esc_url( 'https://app.asana.com/0/' . $asana_gid . '/list' ); ?>" target="_blank">Asana ↗</a>
                    <?php else : ?>
                        <button class="button aiwd-asana-sync" data-project="<?php echo esc_attr( $p->ID ); ?>"><?php esc_html_e( 'Crear en Asana', 'ai-web-designer' ); ?></button>
                        <button class="button aiwd-asana-link" data-project="<?php echo esc_attr( $p->ID ); ?>"><?php esc_html_e( 'Vincular existente', 'ai-web-designer' ); ?></button>
                    <?php endif; ?>
                </td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
</div>
