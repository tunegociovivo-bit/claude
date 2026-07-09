<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

$statuses = aiwd_project_statuses();
$projects = get_posts( [
    'post_type'      => AIWD_CPT_Project::POST_TYPE,
    'posts_per_page' => 200,
    'orderby'        => 'modified',
    'order'          => 'DESC',
] );

// Agrupa por estado
$by_status = [];
foreach ( $statuses as $key => $label ) $by_status[ $key ] = [];
foreach ( $projects as $p ) {
    $status = get_post_meta( $p->ID, '_aiwd_status', true ) ?: 'draft';
    if ( ! isset( $by_status[ $status ] ) ) $by_status[ $status ] = [];
    $by_status[ $status ][] = $p;
}

$qa = new AIWD_QA_Checker();
?>
<div class="wrap aiwd-wrap aiwd-kanban-wrap">
    <h1>
        <?php esc_html_e( 'Kanban de proyectos', 'ai-web-designer' ); ?>
        <a class="page-title-action" href="<?php echo esc_url( admin_url( 'admin.php?page=aiwd-new' ) ); ?>"><?php esc_html_e( 'Nuevo', 'ai-web-designer' ); ?></a>
    </h1>
    <p class="description"><?php esc_html_e( 'Arrastra una tarjeta entre columnas para cambiar el estado del proyecto.', 'ai-web-designer' ); ?></p>

    <div class="aiwd-kanban">
        <?php foreach ( $statuses as $key => $label ) :
            $count = count( $by_status[ $key ] ?? [] ); ?>
            <div class="aiwd-col" data-status="<?php echo esc_attr( $key ); ?>">
                <h3><?php echo esc_html( $label ); ?> <span class="aiwd-col-count"><?php echo (int) $count; ?></span></h3>
                <div class="aiwd-col-body">
                    <?php foreach ( $by_status[ $key ] ?? [] as $p ) :
                        $sum    = $qa->summary( $p->ID );
                        $author = get_userdata( $p->post_author );
                        $client = wp_get_post_terms( $p->ID, 'aiwd_client', [ 'fields' => 'names' ] );
                        $days   = (int) round( ( time() - strtotime( $p->post_date_gmt . ' UTC' ) ) / DAY_IN_SECONDS );
                        $asana_gid = get_post_meta( $p->ID, AIWD_Asana_Sync::META_PROJECT, true );
                    ?>
                        <div class="aiwd-card-kanban" data-project="<?php echo esc_attr( $p->ID ); ?>">
                            <div class="aiwd-card-title"><a href="<?php echo esc_url( admin_url( 'admin.php?page=aiwd-wizard&project_id=' . $p->ID ) ); ?>"><?php echo esc_html( $p->post_title ); ?></a></div>
                            <div class="aiwd-card-meta">
                                <?php if ( $client ) : ?><span class="aiwd-tag">👤 <?php echo esc_html( $client[0] ); ?></span><?php endif; ?>
                                <span class="aiwd-tag">🧑‍💻 <?php echo esc_html( $author->display_name ?? '—' ); ?></span>
                                <span class="aiwd-tag">📅 <?php echo (int) $days; ?>d</span>
                            </div>
                            <div class="aiwd-card-qa">
                                <?php if ( $sum['required_failed'] === 0 ) : ?>
                                    <span class="aiwd-qa-ok">✅ QA OK</span>
                                <?php else : ?>
                                    <span class="aiwd-qa-pending"><?php echo (int) $sum['required_failed']; ?> req. pend.</span>
                                <?php endif; ?>
                                <?php if ( $asana_gid ) : ?><a class="aiwd-tag" href="https://app.asana.com/0/<?php echo esc_attr( $asana_gid ); ?>/list" target="_blank">Asana ↗</a><?php endif; ?>
                            </div>
                        </div>
                    <?php endforeach; ?>
                </div>
            </div>
        <?php endforeach; ?>
    </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.2/Sortable.min.js" defer></script>
<script>
document.addEventListener('DOMContentLoaded', () => {
    function attach() {
        if (typeof Sortable === 'undefined') return setTimeout(attach, 100);
        document.querySelectorAll('.aiwd-col-body').forEach(col => {
            Sortable.create(col, {
                group: 'aiwd-kanban',
                animation: 150,
                onAdd: e => {
                    const projectId = e.item.dataset.project;
                    const newStatus = e.to.closest('.aiwd-col').dataset.status;
                    fetch(AIWD.rest_url + 'project/' + projectId + '/status', {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': AIWD.nonce },
                        body: JSON.stringify({ status: newStatus }),
                    })
                        .then(r => r.json())
                        .then(res => {
                            if (!res.ok) {
                                alert('🚫 ' + (res.message || 'No permitido'));
                                location.reload();
                            } else {
                                // Update counts
                                document.querySelectorAll('.aiwd-col').forEach(c => {
                                    const n = c.querySelectorAll('.aiwd-card-kanban').length;
                                    c.querySelector('.aiwd-col-count').textContent = n;
                                });
                            }
                        });
                },
            });
        });
    }
    attach();
});
</script>
