<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

$project_id = isset( $_GET['project_id'] ) ? (int) $_GET['project_id'] : 0;
if ( ! $project_id || get_post_type( $project_id ) !== AIWD_CPT_Project::POST_TYPE ) {
    echo '<div class="wrap"><h1>' . esc_html__( 'Selecciona un proyecto', 'ai-web-designer' ) . '</h1>';
    $projects = get_posts( [ 'post_type' => AIWD_CPT_Project::POST_TYPE, 'numberposts' => 50 ] );
    echo '<ul>';
    foreach ( $projects as $p ) {
        echo '<li><a href="' . esc_url( admin_url( 'admin.php?page=aiwd-qa&project_id=' . $p->ID ) ) . '">' . esc_html( $p->post_title ) . '</a></li>';
    }
    echo '</ul></div>';
    return;
}

$qa = new AIWD_QA_Checker();
$results = (array) get_post_meta( $project_id, AIWD_QA_Checker::META_RESULTS, true );
$override = get_post_meta( $project_id, AIWD_QA_Checker::META_OVERRIDE, true );
$summary  = $qa->summary( $project_id );
$checks   = AIWD_QA_Checker::checks();

$groups = [
    'brand'        => __( 'Marca', 'ai-web-designer' ),
    'contact'      => __( 'Contacto', 'ai-web-designer' ),
    'content'      => __( 'Contenido', 'ai-web-designer' ),
    'seo'          => __( 'SEO', 'ai-web-designer' ),
    'legal'        => __( 'Legal', 'ai-web-designer' ),
    'integrations' => __( 'Integraciones', 'ai-web-designer' ),
    'qa'           => __( 'QA manual', 'ai-web-designer' ),
];
?>
<div class="wrap aiwd-wrap aiwd-qa" data-project="<?php echo esc_attr( $project_id ); ?>">
    <h1>
        <?php esc_html_e( 'Auditoría QA', 'ai-web-designer' ); ?>
        — <?php echo esc_html( get_the_title( $project_id ) ); ?>
    </h1>

    <div class="aiwd-qa-summary <?php echo $summary['required_failed'] === 0 ? 'ok' : 'blocked'; ?>">
        <strong><?php echo (int) $summary['passed']; ?>/<?php echo (int) $summary['total']; ?></strong> <?php esc_html_e( 'checks pasados', 'ai-web-designer' ); ?>
        · <?php echo (int) $summary['failed']; ?> <?php esc_html_e( 'fallos', 'ai-web-designer' ); ?>
        · <strong><?php echo (int) $summary['required_failed']; ?></strong> <?php esc_html_e( 'requeridos pendientes', 'ai-web-designer' ); ?>
        <?php if ( $summary['required_failed'] === 0 ) : ?>
            <span class="aiwd-pill" style="background:#d1f4d1;color:#1a6b1a">✅ <?php esc_html_e( 'Listo para publicar', 'ai-web-designer' ); ?></span>
        <?php else : ?>
            <span class="aiwd-pill" style="background:#ffd1d1;color:#861a1a">🚫 <?php esc_html_e( 'Publicación bloqueada', 'ai-web-designer' ); ?></span>
        <?php endif; ?>
    </div>

    <p>
        <button class="button button-primary aiwd-qa-run"><?php esc_html_e( 'Ejecutar checks automáticos', 'ai-web-designer' ); ?></button>
        <button class="button button-primary aiwd-qa-publish" <?php disabled( $summary['required_failed'] !== 0 && empty( $override ) ); ?>><?php esc_html_e( 'Marcar como publicado', 'ai-web-designer' ); ?></button>
        <?php if ( current_user_can( 'manage_options' ) && $summary['required_failed'] !== 0 ) : ?>
            <button class="button aiwd-qa-override"><?php esc_html_e( 'Override (admin)', 'ai-web-designer' ); ?></button>
        <?php endif; ?>
    </p>

    <?php if ( $override ) : ?>
        <div class="notice notice-warning"><p>
            <?php printf(
                esc_html__( '⚠ Override activo por %s — Razón: %s (%s)', 'ai-web-designer' ),
                esc_html( get_userdata( $override['by'] ?? 0 )->display_name ?? '?' ),
                esc_html( $override['reason'] ?? '' ),
                esc_html( $override['at'] ?? '' )
            ); ?>
            <button class="button-link aiwd-qa-override-clear"><?php esc_html_e( 'Quitar override', 'ai-web-designer' ); ?></button>
        </p></div>
    <?php endif; ?>

    <?php foreach ( $groups as $group_key => $group_label ) : ?>
        <h2><?php echo esc_html( $group_label ); ?></h2>
        <table class="widefat striped">
            <tbody>
            <?php foreach ( $checks as $key => $cfg ) :
                if ( ( $cfg['group'] ?? '' ) !== $group_key ) continue;
                $r = $results[ $key ] ?? [ 'status' => 'pending', 'note' => '' ];
                $icon = $r['status'] === 'pass' ? '✅' : ( $r['status'] === 'fail' ? '❌' : '⚪' );
                $req  = ! empty( $cfg['required'] ) ? '<span class="aiwd-pill" style="background:#fffde7;color:#a87f00">requerido</span>' : '';
            ?>
                <tr data-key="<?php echo esc_attr( $key ); ?>" data-type="<?php echo esc_attr( $cfg['type'] ); ?>">
                    <td style="width:40px"><span class="aiwd-qa-icon"><?php echo $icon; ?></span></td>
                    <td><?php echo esc_html( $cfg['label'] ); ?> <?php echo $req; ?></td>
                    <td>
                        <?php if ( $cfg['type'] === 'manual' ) : ?>
                            <select class="aiwd-qa-manual">
                                <option value="pending" <?php selected( $r['status'], 'pending' ); ?>><?php esc_html_e( 'Pendiente', 'ai-web-designer' ); ?></option>
                                <option value="pass"    <?php selected( $r['status'], 'pass' ); ?>>✅ Pass</option>
                                <option value="fail"    <?php selected( $r['status'], 'fail' ); ?>>❌ Fail</option>
                            </select>
                            <input type="text" class="aiwd-qa-note" placeholder="Nota..." value="<?php echo esc_attr( $r['note'] ?? '' ); ?>" />
                        <?php else : ?>
                            <em><?php esc_html_e( 'Automático', 'ai-web-designer' ); ?></em>
                        <?php endif; ?>
                    </td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
    <?php endforeach; ?>
</div>
