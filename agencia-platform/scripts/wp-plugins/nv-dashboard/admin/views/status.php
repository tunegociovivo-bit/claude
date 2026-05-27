<?php
/**
 * NV Dashboard — Vista "Estado del plugin" (v1.0.47)
 *
 * Muestra información esencial para debugging:
 *   - Versión actual del plugin
 *   - Versión guardada en BD (detecta mismatches tras upgrade fallido)
 *   - Lista de TODAS las rutas REST registradas
 *   - Botón "🔄 Refrescar permalinks" para forzar re-registro de rutas
 *   - Health check público (link directo)
 */
if (!defined('ABSPATH')) exit;

global $wp_rest_server;
$current_version = defined('NV_DASHBOARD_VERSION') ? NV_DASHBOARD_VERSION : 'unknown';
$stored_version  = get_option('nv_dashboard_installed_version', 'no guardada');
$mismatch        = ($current_version !== $stored_version);

// Recolectar rutas REST nv/v1
$nv_routes = [];
if ($wp_rest_server) {
    foreach ($wp_rest_server->get_routes() as $route => $endpoints) {
        if (strpos($route, '/nv/v1/') === 0) {
            $methods = [];
            foreach ($endpoints as $ep) {
                if (isset($ep['methods'])) {
                    foreach ($ep['methods'] as $m => $on) {
                        if ($on) $methods[] = $m;
                    }
                }
            }
            $nv_routes[$route] = array_unique($methods);
        }
    }
}
ksort($nv_routes);

// Endpoints clave que DEBEN existir en v1.0.47+ (para verificar instalación correcta)
$expected_endpoints = [
    '/nv/v1/health'                            => 'GET',
    '/nv/v1/publicaciones-multi-cliente'       => 'POST',
    '/nv/v1/generar-imagen-publicacion/(?P<id>\d+)' => 'POST',
    '/nv/v1/test-imagen-publicacion/(?P<id>\d+)'    => 'GET',
    '/nv/v1/analizar-web-cliente'              => 'POST',
    '/nv/v1/publicacion/(?P<id>\d+)'           => 'DELETE',
];
$missing = [];
foreach ($expected_endpoints as $route => $method) {
    if (!isset($nv_routes[$route])) {
        $missing[$route] = $method;
    }
}
?>
<div class="wrap nv-dashboard">
    <h1>🔧 Estado del plugin
        <span style="font-size:11px; color:#888; font-weight:400; background:#f0f0f0; padding:3px 8px; border-radius:4px; margin-left:6px;">v<?php echo esc_html($current_version); ?></span>
    </h1>

    <?php if (!empty($missing)): ?>
    <div class="notice notice-error" style="margin-top: 14px;">
        <p><strong>⚠️ Faltan <?php echo count($missing); ?> rutas REST esperadas.</strong> Esto causa errores tipo "rest_no_route" al usar el plugin. Pulsa <strong>Refrescar permalinks</strong> abajo.</p>
        <ul style="font-family:monospace; font-size:12px; margin-left: 20px;">
            <?php foreach ($missing as $r => $m): ?>
                <li><?php echo esc_html($m . ' ' . $r); ?></li>
            <?php endforeach; ?>
        </ul>
    </div>
    <?php else: ?>
    <div class="notice notice-success" style="margin-top: 14px;">
        <p><strong>✓ Todas las rutas REST esperadas están registradas correctamente.</strong></p>
    </div>
    <?php endif; ?>

    <?php if ($mismatch): ?>
    <div class="notice notice-warning">
        <p><strong>⚠️ Mismatch de versiones detectado.</strong> Versión del código: <code><?php echo esc_html($current_version); ?></code> · Versión guardada en BD: <code><?php echo esc_html($stored_version); ?></code>. Esto suele pasar tras actualizar el plugin sin desactivar/reactivar. Pulsa <strong>Refrescar permalinks</strong> abajo.</p>
    </div>
    <?php endif; ?>

    <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 18px;">

        <!-- ─── Card: Información del plugin ─── -->
        <div style="background:#fff; border:1px solid #ddd; border-radius:4px; padding:18px;">
            <h2 style="margin-top:0;">📦 Información</h2>
            <table class="widefat striped" style="margin-top:8px;">
                <tbody>
                    <tr><td><strong>Versión del código</strong></td><td><code><?php echo esc_html($current_version); ?></code></td></tr>
                    <tr><td><strong>Versión en BD</strong></td><td><code><?php echo esc_html($stored_version); ?></code> <?php echo $mismatch ? '<span style="color:#c00;">← mismatch</span>' : '<span style="color:#2ea043;">✓</span>'; ?></td></tr>
                    <tr><td><strong>PHP</strong></td><td><code><?php echo esc_html(PHP_VERSION); ?></code></td></tr>
                    <tr><td><strong>WordPress</strong></td><td><code><?php echo esc_html(get_bloginfo('version')); ?></code></td></tr>
                    <tr><td><strong>memory_limit</strong></td><td><code><?php echo esc_html(ini_get('memory_limit')); ?></code></td></tr>
                    <tr><td><strong>max_execution_time</strong></td><td><code><?php echo esc_html(ini_get('max_execution_time')); ?>s</code> <?php echo (int) ini_get('max_execution_time') >= 300 ? '<span style="color:#2ea043;">✓</span>' : '<span style="color:#c00;">⚠️ debería ser ≥300</span>'; ?></td></tr>
                    <tr><td><strong>GD + FreeType</strong></td><td><?php echo (extension_loaded('gd') && function_exists('imagettftext')) ? '<span style="color:#2ea043;">✓ disponibles</span>' : '<span style="color:#c00;">❌ falta</span>'; ?></td></tr>
                </tbody>
            </table>
        </div>

        <!-- ─── Card: Acciones ─── -->
        <div style="background:#fff; border:1px solid #ddd; border-radius:4px; padding:18px;">
            <h2 style="margin-top:0;">⚙️ Acciones</h2>
            <p style="font-size:13px; color:#555;">Refresca los permalinks de WordPress para re-registrar todas las rutas REST. Esto soluciona errores "rest_no_route" que aparecen tras actualizar el plugin.</p>
            <form method="post">
                <?php wp_nonce_field('nv_flush_permalinks'); ?>
                <button type="submit" name="nv_flush_permalinks" value="1" class="button button-primary nv-button-gold" style="background:#D2A039; border-color:#D2A039;">
                    🔄 Refrescar permalinks
                </button>
            </form>

            <hr style="margin:20px 0;">

            <h3>🔗 Health check público</h3>
            <p style="font-size:13px; color:#555;">Verifica desde cualquier navegador (sin login) que el plugin está cargado:</p>
            <p>
                <a href="<?php echo esc_url(rest_url('nv/v1/health')); ?>" target="_blank" class="button">
                    🩺 Abrir /wp-json/nv/v1/health
                </a>
            </p>
        </div>
    </div>

    <!-- ─── Card: Rutas REST registradas ─── -->
    <div style="background:#fff; border:1px solid #ddd; border-radius:4px; padding:18px; margin-top: 18px;">
        <h2 style="margin-top:0;">🛣️ Rutas REST registradas (<?php echo count($nv_routes); ?>)</h2>
        <p style="font-size:13px; color:#555;">Todas las rutas que el plugin expone bajo <code>/wp-json/nv/v1/</code>. Si una falta, el frontend devolverá <code>rest_no_route 404</code>.</p>
        <table class="widefat striped" style="margin-top:8px;">
            <thead>
                <tr><th>Ruta</th><th style="width: 200px;">Métodos</th></tr>
            </thead>
            <tbody>
                <?php foreach ($nv_routes as $route => $methods): ?>
                <tr>
                    <td><code style="font-size:11px;"><?php echo esc_html($route); ?></code></td>
                    <td>
                        <?php foreach ($methods as $m): ?>
                            <span style="display:inline-block; padding:2px 6px; background:<?php echo $m === 'GET' ? '#d1fae5' : ($m === 'POST' ? '#dbeafe' : ($m === 'DELETE' ? '#fee2e2' : '#fef3c7')); ?>; border-radius:3px; font-size:11px; font-family:monospace; margin-right:4px;"><?php echo esc_html($m); ?></span>
                        <?php endforeach; ?>
                    </td>
                </tr>
                <?php endforeach; ?>
            </tbody>
        </table>
    </div>

    <!-- ─── Card: Reparador wp-config.php (v1.0.49) ─── -->
    <div style="background:#fff; border:1px solid #ddd; border-radius:4px; padding:18px; margin-top: 18px;">
        <h2 style="margin-top:0;">🛠️ Reparador de <code>wp-config.php</code></h2>
        <p style="font-size:13px; color:#555;">
            Detecta y elimina <strong>defines duplicados</strong> en wp-config.php (ej: <code>WP_CACHE</code> definido 2 veces),
            que generan warnings y rompen <code>wp_redirect()</code>.
            <br><strong>Seguridad</strong>: hace backup automático antes de tocar nada, valida que el resultado sea PHP válido,
            escritura atómica con rollback automático si algo falla.
        </p>

        <div style="display:flex; gap:8px; margin: 12px 0;">
            <button type="button" class="button" id="nv-wpconfig-analyze">🔍 Analizar wp-config.php</button>
            <button type="button" class="button button-primary" id="nv-wpconfig-fix" disabled style="background:#dc2626; border-color:#dc2626; color:#fff;">🛠️ Aplicar corrección (con backup)</button>
            <span id="nv-wpconfig-status" style="margin-left:8px; align-self:center; font-size:12px; color:#666;"></span>
        </div>

        <div id="nv-wpconfig-result" style="display:none; padding:12px; background:#f7f9fc; border-left:3px solid #0073aa; border-radius:4px; font-size:13px;"></div>
    </div>
</div>

<script>
(function(){
    const $analyze = document.getElementById('nv-wpconfig-analyze');
    const $fix = document.getElementById('nv-wpconfig-fix');
    const $status = document.getElementById('nv-wpconfig-status');
    const $result = document.getElementById('nv-wpconfig-result');
    const restUrl = '<?php echo esc_js(rest_url('nv/v1/')); ?>';
    const nonce = '<?php echo esc_js(wp_create_nonce('wp_rest')); ?>';

    function escHtml(s) {
        return String(s || '').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
    }

    $analyze.addEventListener('click', async () => {
        $analyze.disabled = true;
        $fix.disabled = true;
        $status.style.color = '#0073aa';
        $status.textContent = '⏳ Analizando…';
        $result.style.display = 'none';
        try {
            const r = await fetch(restUrl + 'wp-config-analyze', { headers: { 'X-WP-Nonce': nonce } });
            const data = await r.json();
            if (!r.ok || data.code) throw new Error(data.message || 'HTTP ' + r.status);

            const dups = data.duplicates || [];
            if (!data.writable) {
                $result.innerHTML = '<div style="color:#c00;"><strong>❌ wp-config.php existe pero NO es escribible</strong><br>Cambia permisos en el hosting o edita el archivo manualmente.</div>';
                $status.style.color = '#c00';
                $status.textContent = '❌ No escribible';
            } else if (dups.length === 0) {
                $result.innerHTML = '<div style="color:#2ea043;"><strong>✓ wp-config.php está limpio</strong> — no hay defines duplicados.</div>';
                $status.style.color = '#2ea043';
                $status.textContent = '✓ Limpio';
            } else {
                let html = '<strong>📍 Archivo:</strong> <code>' + escHtml(data.path) + '</code><br>';
                html += '<strong>⚠️ Encontrados ' + dups.length + ' constante(s) con defines duplicados:</strong><br><br>';
                dups.forEach(d => {
                    html += '<div style="margin-bottom: 12px; padding: 10px; background:#fff; border:1px solid #f59e0b; border-radius:4px;">';
                    html += '<strong>' + escHtml(d.constant) + '</strong> (' + d.count + ' definiciones)<br>';
                    html += '<div style="margin-top: 6px;"><span style="color:#2ea043;">✓ Mantener:</span><br><code style="display:block; padding:4px; background:#f0f0f0; font-size:11px;">línea ' + d.will_keep.line + ': ' + escHtml(d.will_keep.text) + '</code></div>';
                    html += '<div style="margin-top: 6px;"><span style="color:#dc2626;">✗ Eliminar:</span><br>';
                    d.will_remove.forEach(occ => {
                        html += '<code style="display:block; padding:4px; background:#fee2e2; font-size:11px;">línea ' + occ.line + ': ' + escHtml(occ.text) + '</code>';
                    });
                    html += '</div></div>';
                });
                html += '<div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #ddd; color:#555; font-size:12px;">⬇️ Pulsa <strong>Aplicar corrección</strong> abajo para hacer backup y aplicar estos cambios.</div>';
                $result.innerHTML = html;
                $status.style.color = '#dc2626';
                $status.textContent = '⚠️ ' + dups.length + ' duplicado(s) encontrado(s)';
                $fix.disabled = false;
            }
            $result.style.display = 'block';
        } catch (err) {
            $status.style.color = '#c00';
            $status.textContent = '❌ ' + err.message;
        } finally {
            $analyze.disabled = false;
        }
    });

    $fix.addEventListener('click', async () => {
        if (!confirm('¿Aplicar la corrección a wp-config.php?\n\n• Se hará un backup automático en wp-content/uploads/nv-backups/\n• Si la validación falla, NO se tocará el archivo\n• Si algo sale mal después, podrás restaurar desde el backup')) {
            return;
        }
        $fix.disabled = true;
        $analyze.disabled = true;
        $status.style.color = '#0073aa';
        $status.textContent = '⏳ Aplicando con backup…';
        try {
            const r = await fetch(restUrl + 'wp-config-fix', {
                method: 'POST',
                headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' },
                body: '{}',
            });
            const data = await r.json();
            if (!r.ok || data.code) throw new Error(data.message || 'HTTP ' + r.status);

            if (!data.changed) {
                $result.innerHTML = '<div style="color:#2ea043;">✓ ' + escHtml(data.message) + '</div>';
                $status.style.color = '#2ea043';
                $status.textContent = '✓ Sin cambios necesarios';
            } else {
                let html = '<div style="color:#2ea043; padding: 12px; background:#d1fae5; border-radius:4px;">';
                html += '<strong>✓ ' + escHtml(data.message) + '</strong><br>';
                html += '<div style="margin-top: 8px; font-size:12px;">📦 Backup: <code>' + escHtml(data.backup_file) + '</code></div>';
                html += '<div style="margin-top: 4px; font-size:12px;">🗑️ Líneas eliminadas:</div>';
                (data.removed_lines || []).forEach(l => {
                    html += '<code style="display:block; padding:3px 6px; background:#fff; margin: 2px 0; font-size:11px;">línea ' + l.line + ': ' + escHtml(l.text) + '</code>';
                });
                html += '<div style="margin-top:8px; font-size:12px;">⚡ Recarga cualquier página de WP para verificar que los warnings han desaparecido.</div>';
                html += '</div>';
                $result.innerHTML = html;
                $status.style.color = '#2ea043';
                $status.textContent = '✓ Corregido';
            }
        } catch (err) {
            $status.style.color = '#c00';
            $status.textContent = '❌ ' + err.message;
            $result.innerHTML = '<div style="color:#c00;"><strong>Error:</strong> ' + escHtml(err.message) + '<br>El archivo wp-config.php NO ha sido modificado.</div>';
            $result.style.display = 'block';
        } finally {
            $analyze.disabled = false;
        }
    });
})();
</script>

<!-- v1.0.54: Diagnóstico de pre-requisitos para pipeline de reels -->
<div style="margin-top: 32px; padding: 20px; background: #fff; border: 1px solid #ddd; border-radius: 6px;">
    <h2 style="margin: 0 0 8px; font-size: 18px;">🎬 Pre-requisitos para pipeline de reels (v1.0.54+)</h2>
    <p style="margin: 0 0 14px; color: #555; font-size: 13px;">
        Antes de empezar la integración del pipeline completo de reels (Seedance + ElevenLabs + ffmpeg),
        verificamos que el hosting tiene todo lo necesario. Si falta algo crítico (ffmpeg, exec functions),
        el render se externalizará a Railway.
    </p>
    <button type="button" id="nv-reel-prereq-btn" class="button button-primary">🔍 Verificar pre-requisitos</button>
    <span id="nv-reel-prereq-status" style="margin-left: 10px; font-size: 13px; color: #666;"></span>
    <pre id="nv-reel-prereq-out" style="display:none; margin-top: 14px; padding: 12px; background: #1a1a1a; color: #c8e6c9; border-radius: 4px; font-size: 11px; max-height: 500px; overflow: auto; white-space: pre-wrap;"></pre>
</div>

<script>
(function(){
    const btn = document.getElementById('nv-reel-prereq-btn');
    const status = document.getElementById('nv-reel-prereq-status');
    const out = document.getElementById('nv-reel-prereq-out');
    if (!btn) return;
    const restUrl = (window.nvDashboard && window.nvDashboard.restUrl) || '/wp-json/nv/v1/';
    const nonce   = (window.nvDashboard && window.nvDashboard.restNonce) || '';

    btn.addEventListener('click', async () => {
        btn.disabled = true;
        status.textContent = '⏳ Verificando…';
        out.style.display = 'none';
        try {
            const r = await fetch(restUrl + 'reel-prereq-check', {
                headers: { 'X-WP-Nonce': nonce },
            });
            const data = await r.json();
            const verdict = data.verdict;
            if (verdict === 'ok') {
                status.innerHTML = '<span style="color:#2ea043; font-weight:600;">✓ Hosting compatible. Podemos arrancar el pipeline server-side.</span>';
            } else {
                status.innerHTML = '<span style="color:#c80; font-weight:600;">⚠️ ' + (data.recommendation || 'Hay problemas críticos') + '</span>';
            }
            out.textContent = JSON.stringify(data, null, 2);
            out.style.display = 'block';
        } catch (err) {
            status.innerHTML = '<span style="color:#c00;">❌ ' + err.message + '</span>';
        } finally {
            btn.disabled = false;
        }
    });
})();
</script>
