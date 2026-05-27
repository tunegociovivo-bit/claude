<?php
if ( ! defined( 'WPINC' ) ) { die; }
$f       = NVL_Analytics::funnel();
$score   = NVL_Analytics::score_distribution();
$urg     = NVL_Analytics::urgency_breakdown();
$msgs30  = NVL_Analytics::messages_last_30_days();
$resp30  = NVL_Analytics::responses_last_30_days();
$prov    = NVL_Analytics::top_provinces( 10 );
$cls     = NVL_Analytics::inbox_classification_breakdown();
$rr      = NVL_Analytics::response_rate();
$cr      = NVL_Analytics::client_rate();
?>
<div class="wrap nvl-wrap">
    <h1>Analytics</h1>
    <p class="nvl-subtitle">Métricas globales del pipeline de captación.</p>

    <div class="nvl-stats-grid">
        <div class="nvl-card"><div class="nvl-card-label">Leads totales</div><div class="nvl-card-value"><?php echo (int) $f['total']; ?></div></div>
        <div class="nvl-card"><div class="nvl-card-label">Con teléfono</div><div class="nvl-card-value"><?php echo (int) $f['with_phone']; ?></div></div>
        <div class="nvl-card"><div class="nvl-card-label">Con WhatsApp</div><div class="nvl-card-value"><?php echo (int) $f['with_wa']; ?></div></div>
        <div class="nvl-card"><div class="nvl-card-label">Contactados</div><div class="nvl-card-value"><?php echo (int) $f['contacted']; ?></div></div>
        <div class="nvl-card"><div class="nvl-card-label">Respondieron</div><div class="nvl-card-value"><?php echo (int) $f['responded']; ?> <small>(<?php echo $rr; ?>%)</small></div></div>
        <div class="nvl-card nvl-card-success"><div class="nvl-card-label">Clientes</div><div class="nvl-card-value"><?php echo (int) $f['client']; ?> <small>(<?php echo $cr; ?>%)</small></div></div>
    </div>

    <div class="nvl-detail-grid">
        <div class="nvl-detail-col">
            <h2>Distribución de score</h2>
            <canvas id="nvl-chart-score" height="160"></canvas>
        </div>
        <div class="nvl-detail-col">
            <h2>Nivel de urgencia</h2>
            <canvas id="nvl-chart-urgency" height="160"></canvas>
        </div>
    </div>

    <h2 style="margin-top:1.5rem;">Mensajes enviados y respuestas (últimos 30 días)</h2>
    <canvas id="nvl-chart-time" height="80"></canvas>

    <div class="nvl-detail-grid" style="margin-top:1.5rem;">
        <div class="nvl-detail-col">
            <h2>Top provincias</h2>
            <table class="widefat striped">
                <thead><tr><th>Provincia</th><th>Leads</th><th>Respondieron</th><th>Clientes</th></tr></thead>
                <tbody>
                <?php foreach ( $prov as $p ) : ?>
                    <tr>
                        <td><?php echo esc_html( $p->province ); ?></td>
                        <td><?php echo (int) $p->leads; ?></td>
                        <td><?php echo (int) $p->responded; ?></td>
                        <td><?php echo (int) $p->clients; ?></td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
        </div>
        <div class="nvl-detail-col">
            <h2>Clasificación de respuestas (IA)</h2>
            <table class="widefat striped">
                <thead><tr><th>Tipo</th><th>Total</th></tr></thead>
                <tbody>
                <?php
                $labels_map = array(
                    'interested'   => 'Interesado',
                    'info_request' => 'Pide info',
                    'objection'    => 'Objeción',
                    'positive_no'  => 'No cortés',
                    'opt_out'      => 'Baja',
                    'off_topic'    => 'Off-topic',
                    'auto_reply'   => 'Auto-respuesta',
                );
                foreach ( $labels_map as $k => $lbl ) :
                    $n = isset( $cls[ $k ] ) ? $cls[ $k ] : 0; ?>
                    <tr><td><?php echo esc_html( $lbl ); ?></td><td><strong><?php echo $n; ?></strong></td></tr>
                <?php endforeach; ?>
                </tbody>
            </table>
        </div>
    </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<script>
(function(){
    const scoreData = <?php echo wp_json_encode( $score ); ?>;
    const urgData   = <?php echo wp_json_encode( $urg ); ?>;
    const msgsData  = <?php echo wp_json_encode( $msgs30 ); ?>;
    const respData  = <?php echo wp_json_encode( $resp30 ); ?>;

    new Chart(document.getElementById('nvl-chart-score'), {
        type: 'bar',
        data: {
            labels: Object.keys(scoreData),
            datasets: [{ label: 'Leads', data: Object.values(scoreData), backgroundColor: ['#1f7a1f','#5fa75f','#d6a35f','#c97d3a','#a02828'] }]
        },
        options: { plugins: { legend: { display: false } } }
    });

    const urgLabels = { critica: 'Crítica', alta: 'Alta', media: 'Media', baja: 'Baja', descartar: 'Descartar' };
    new Chart(document.getElementById('nvl-chart-urgency'), {
        type: 'doughnut',
        data: {
            labels: Object.keys(urgData).map(k => urgLabels[k] || k),
            datasets: [{ data: Object.values(urgData), backgroundColor: ['#a02828','#d97706','#2271b1','#6e7785','#999'] }]
        }
    });

    new Chart(document.getElementById('nvl-chart-time'), {
        type: 'line',
        data: {
            labels: Object.keys(msgsData),
            datasets: [
                { label: 'Enviados', data: Object.values(msgsData), borderColor: '#2271b1', fill: false, tension: 0.3 },
                { label: 'Respuestas', data: Object.values(respData), borderColor: '#1f7a1f', fill: false, tension: 0.3 }
            ]
        }
    });
})();
</script>
