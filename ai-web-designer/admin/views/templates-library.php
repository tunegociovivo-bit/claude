<?php if ( ! defined( 'ABSPATH' ) ) { exit; } ?>
<div class="wrap aiwd-wrap">
    <h1><?php esc_html_e( 'Librería de plantillas', 'ai-web-designer' ); ?></h1>
    <p class="description"><?php esc_html_e( 'Plantillas base por sector. La IA las adapta a la marca de cada proyecto.', 'ai-web-designer' ); ?></p>
    <div class="aiwd-templates-grid">
        <?php
        $lib = AIWD_Template_Library::all();
        foreach ( $lib as $key => $tpl ) : ?>
            <div class="aiwd-template-card">
                <h3><?php echo esc_html( $tpl['name'] ); ?></h3>
                <p><?php echo esc_html( $tpl['description'] ); ?></p>
                <code><?php echo esc_html( $key ); ?></code>
            </div>
        <?php endforeach; ?>
    </div>
</div>
