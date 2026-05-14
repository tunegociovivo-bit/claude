<?php if ( ! defined( 'ABSPATH' ) ) { exit; }
$enabled = ! empty( aiwd_get_option( 'enable_agency_mode' ) );
?>
<div class="wrap aiwd-wrap">
    <h1><?php esc_html_e( 'Agencia / Multi-cliente', 'ai-web-designer' ); ?></h1>
    <?php if ( ! $enabled ) : ?>
        <div class="notice notice-warning"><p><?php esc_html_e( 'Activa el modo agencia en Ajustes para gestionar varios clientes.', 'ai-web-designer' ); ?></p></div>
    <?php endif; ?>

    <h2><?php esc_html_e( 'Resumen de clientes', 'ai-web-designer' ); ?></h2>
    <?php
    $terms = get_terms( [ 'taxonomy' => 'aiwd_client', 'hide_empty' => false ] );
    if ( $terms && ! is_wp_error( $terms ) ) : ?>
        <table class="widefat striped">
            <thead><tr><th><?php esc_html_e( 'Cliente', 'ai-web-designer' ); ?></th><th><?php esc_html_e( 'Proyectos', 'ai-web-designer' ); ?></th></tr></thead>
            <tbody>
            <?php foreach ( $terms as $t ) : ?>
                <tr><td><?php echo esc_html( $t->name ); ?></td><td><?php echo (int) $t->count; ?></td></tr>
            <?php endforeach; ?>
            </tbody>
        </table>
    <?php else : ?>
        <p><?php esc_html_e( 'No hay clientes registrados todavía.', 'ai-web-designer' ); ?></p>
    <?php endif; ?>
</div>
