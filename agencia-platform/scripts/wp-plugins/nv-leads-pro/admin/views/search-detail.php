<?php
if ( ! defined( 'WPINC' ) ) { die; }
$id     = isset( $_GET['id'] ) ? intval( $_GET['id'] ) : 0;
$search = NVL_DB::get_search( $id );
if ( ! $search ) {
    echo '<div class="wrap"><h1>Busqueda no encontrada</h1></div>';
    return;
}
$status     = isset( $_GET['status'] ) ? sanitize_text_field( wp_unslash( $_GET['status'] ) ) : '';
$has_phone  = isset( $_GET['phone'] ) ? sanitize_text_field( wp_unslash( $_GET['phone'] ) ) : '';
$q          = isset( $_GET['q'] ) ? sanitize_text_field( wp_unslash( $_GET['q'] ) ) : '';
$orderby    = isset( $_GET['orderby'] ) && in_array( $_GET['orderby'], array( 'position', 'score', 'rating', 'reviews_count' ), true ) ? $_GET['orderby'] : 'score';
$order      = isset( $_GET['order'] ) && strtoupper( $_GET['order'] ) === 'ASC' ? 'ASC' : 'DESC';
$leads      = NVL_DB::get_leads_by_search( $id, array( 'status' => $status, 'has_phone' => $has_phone, 'search' => $q, 'orderby' => $orderby, 'order' => $order ) );
$sequences  = class_exists( 'NVL_Sequences' ) ? NVL_Sequences::get_sequences() : array();
$templates_for_bulk = NVL_DB::get_templates();
$evo_configured = ( new NVL_Evolution_API() )->is_configured();
$pct        = $search->total_provinces > 0 ? round( ( $search->processed_provinces / $search->total_provinces ) * 100 ) : 0;
$enq_ok   = isset( $_GET['enq_ok'] )   ? intval( $_GET['enq_ok'] )   : -1;
$enq_skip = isset( $_GET['enq_skip'] ) ? intval( $_GET['enq_skip'] ) : -1;
?>
<div class="wrap nvl-wrap">
    <h1>
        <?php echo esc_html( $search->keyword ); ?>
        <span style="color:#666;font-weight:normal;">- <?php echo esc_html( $search->location ); ?></span>
    </h1>

    <p>
        <a href="<?php echo esc_url( admin_url( 'admin.php?page=nvl-searches' ) ); ?>" class="button">Volver</a>
        <a href="<?php echo esc_url( admin_url( 'admin-post.php?action=nvl_export_csv&search_id=' . $id ) ); ?>" class="button">Exportar CSV</a>
        <?php if ( in_array( $search->status, array( 'pending', 'processing' ), true ) ) : ?>
            <a href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin.php?page=nvl-search-detail&id=' . $id . '&nvl_action=run_cron_now' ), 'nvl_run_cron' ) ); ?>" class="button">Forzar siguiente lote</a>
        <?php endif; ?>
    </p>

    <div class="nvl-search-status">
        <div>
            <strong>Estado:</strong> <span class="nvl-status nvl-status-<?php echo esc_attr( $search->status ); ?>"><?php echo esc_html( $search->status ); ?></span>
            &nbsp; <strong>Progreso:</strong> <?php echo intval( $search->processed_provinces ) . ' / ' . intval( $search->total_provinces ); ?>
            <?php if ( $search->current_province ) : ?>(<?php echo esc_html( $search->current_province ); ?>)<?php endif; ?>
            &nbsp; <strong>Leads:</strong> <?php echo (int) $search->total_results; ?>
        </div>
        <?php if ( in_array( $search->status, array( 'pending', 'processing' ), true ) ) : ?>
            <div class="nvl-progress"><div class="nvl-progress-bar" style="width: <?php echo intval( $pct ); ?>%;"></div></div>
            <script>setTimeout(function(){ window.location.reload(); }, 30000);</script>
        <?php endif; ?>
    </div>

    <?php if ( $enq_ok >= 0 ) : ?>
        <div class="notice notice-success is-dismissible"><p><strong><?php echo $enq_ok; ?> leads encolados.</strong>
        <?php if ( $enq_skip > 0 ) : ?> <?php echo $enq_skip; ?> omitidos.<?php endif; ?>
        <a href="<?php echo esc_url( admin_url( 'admin.php?page=nvl-queue' ) ); ?>">Ver cola</a></p></div>
    <?php endif; ?>

    <form method="get" class="nvl-filters">
        <input type="hidden" name="page" value="nvl-search-detail">
        <input type="hidden" name="id" value="<?php echo (int) $id; ?>">
        <input type="search" name="q" value="<?php echo esc_attr( $q ); ?>" placeholder="Buscar...">
        <select name="status">
            <option value="">Cualquier estado</option>
            <option value="pending"   <?php selected( $status, 'pending' ); ?>>Pendiente</option>
            <option value="contacted" <?php selected( $status, 'contacted' ); ?>>Contactado</option>
            <option value="responded" <?php selected( $status, 'responded' ); ?>>Respondio</option>
            <option value="client"    <?php selected( $status, 'client' ); ?>>Cliente</option>
            <option value="discarded" <?php selected( $status, 'discarded' ); ?>>Descartado</option>
        </select>
        <select name="phone">
            <option value="">Con o sin telefono</option>
            <option value="yes" <?php selected( $has_phone, 'yes' ); ?>>Solo con telefono</option>
            <option value="no"  <?php selected( $has_phone, 'no' ); ?>>Sin telefono</option>
        </select>
        <button class="button">Filtrar</button>
    </form>

    <form method="post" id="nvl-bulk-form">
        <?php wp_nonce_field( 'nvl_bulk_enqueue' ); ?>
        <input type="hidden" name="search_id" value="<?php echo (int) $id; ?>">

        <?php if ( $evo_configured ) : ?>
            <div class="nvl-bulk-actions">
                <label><strong>Plantilla:</strong></label>
                <select name="template_id">
                    <?php foreach ( $templates_for_bulk as $t ) : ?>
                        <option value="<?php echo (int) $t->id; ?>" <?php selected( $t->is_default ); ?>><?php echo esc_html( $t->name ); ?></option>
                    <?php endforeach; ?>
                </select>
                <button type="submit" name="nvl_action" value="bulk_enqueue" class="button" onclick="return confirm('Encolar mensaje unico?');">Encolar mensaje unico</button>

                &nbsp;|&nbsp;

                <label><strong>Secuencia:</strong></label>
                <select name="sequence_id">
                    <?php foreach ( $sequences as $s ) : ?>
                        <option value="<?php echo (int) $s->id; ?>" <?php selected( $s->is_default ); ?>><?php echo esc_html( $s->name ); ?></option>
                    <?php endforeach; ?>
                </select>
                <button type="submit" name="nvl_action" value="bulk_enroll_sequence" class="button button-primary" onclick="return confirm('Enrolar en secuencia completa?');">Enrolar en secuencia</button>
            </div>
        <?php endif; ?>

        <table class="wp-list-table widefat fixed striped nvl-leads-table">
            <thead>
                <tr>
                    <?php if ( $evo_configured ) : ?><th style="width:30px;"><input type="checkbox" id="nvl-check-all"></th><?php endif; ?>
                    <th style="width:60px;">Score</th>
                    <th style="width:80px;">Urgencia</th>
                    <th style="width:50px;">#</th>
                    <th>Negocio</th>
                    <th>Provincia</th>
                    <th>Tel.</th>
                    <th>Rating/Res.</th>
                    <th>% neg.</th>
                    <th>Competidores</th>
                    <th>Estado</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
            <?php if ( empty( $leads ) ) : ?>
                <tr><td colspan="<?php echo $evo_configured ? 12 : 11; ?>">Aun no hay leads. Si la busqueda sigue en proceso, espera.</td></tr>
            <?php else : foreach ( $leads as $lead ) :
                $comps = NVL_DB::get_competitors_for_lead( $lead->id );
                $score_class = 'score-low';
                if ( $lead->score >= 70 ) $score_class = 'score-high';
                elseif ( $lead->score >= 45 ) $score_class = 'score-mid';
            ?>
                <tr>
                    <?php if ( $evo_configured ) : ?>
                        <td><?php if ( $lead->phone ) : ?><input type="checkbox" name="lead_ids[]" value="<?php echo (int) $lead->id; ?>" class="nvl-row-check"><?php endif; ?></td>
                    <?php endif; ?>
                    <td><span class="nvl-score nvl-<?php echo $score_class; ?>"><?php echo $lead->score !== null ? intval( $lead->score ) : '-'; ?></span></td>
                    <td><span class="nvl-urg nvl-urg-<?php echo esc_attr( $lead->urgency ); ?>"><?php echo esc_html( $lead->urgency ? $lead->urgency : '-' ); ?></span></td>
                    <td><strong><?php echo intval( $lead->position ); ?></strong></td>
                    <td>
                        <a href="<?php echo esc_url( admin_url( 'admin.php?page=nvl-lead-detail&id=' . $lead->id ) ); ?>"><strong><?php echo esc_html( $lead->name ); ?></strong></a><br>
                        <small><?php echo esc_html( $lead->formatted_address ); ?></small>
                    </td>
                    <td><?php echo esc_html( $lead->province ); ?></td>
                    <td><?php echo $lead->phone ? '<code>' . esc_html( $lead->phone ) . '</code>' : '<span style="color:#999;">-</span>'; ?></td>
                    <td>
                        <?php if ( $lead->rating !== null ) : ?>
                            <strong><?php echo esc_html( number_format( floatval( $lead->rating ), 1 ) ); ?></strong> est.<br>
                            <small><?php echo (int) $lead->reviews_count; ?> res.</small>
                        <?php else : echo '-'; endif; ?>
                    </td>
                    <td>
                        <?php if ( $lead->negative_pct !== null ) : ?>
                            <span class="<?php echo $lead->negative_pct >= 25 ? 'nvl-neg-high' : ''; ?>"><?php echo number_format( floatval( $lead->negative_pct ), 0 ); ?>%</span>
                        <?php else : echo '-'; endif; ?>
                    </td>
                    <td>
                        <?php if ( $lead->position == 1 ) : ?>
                            <span style="color:#0a0;">#1</span>
                        <?php elseif ( $comps ) : foreach ( $comps as $c ) : ?>
                            <span class="nvl-comp-chip">#<?php echo (int) $c->competitor_position; ?> <?php echo esc_html( $c->competitor_name ); ?></span>
                        <?php endforeach; else : echo '-'; endif; ?>
                    </td>
                    <td><span class="nvl-pill nvl-pill-<?php echo esc_attr( $lead->contact_status ); ?>"><?php echo esc_html( $lead->contact_status ); ?></span></td>
                    <td><a class="button button-small" href="<?php echo esc_url( admin_url( 'admin.php?page=nvl-lead-detail&id=' . $lead->id ) ); ?>">Abrir</a></td>
                </tr>
            <?php endforeach; endif; ?>
            </tbody>
        </table>
    </form>

    <script>
    jQuery(function($){
        $('#nvl-check-all').on('change', function(){
            $('.nvl-row-check').prop('checked', this.checked);
        });
    });
    </script>
</div>
