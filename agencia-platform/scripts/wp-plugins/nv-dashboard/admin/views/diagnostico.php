<?php
/**
 * NV Dashboard — Vista de diagnóstico (v1.0.41)
 *
 * Permite introducir el ID de una publicación y ver:
 *   - Datos del post (cliente, brand_colors, fuente, logo)
 *   - Metas guardadas (headline_lines, headline, dato, cta, image_prompt)
 *   - _nv_overlay_debug (qué fuente de texto usó el último render)
 *   - Estado del entorno PHP (memory_limit, max_execution_time, GD, FreeType)
 *   - Si la API key de OpenAI está configurada
 *
 * Llama al endpoint REST /test-imagen-publicacion/{id} con nonce.
 * NO ejecuta gpt-image-2 — solo lee estado interno.
 */
if (!defined('ABSPATH')) exit;
?>
<div class="wrap nv-dashboard">
    <h1>🩺 Diagnóstico de generación de imagen
        <span style="font-size:11px; color:#888; font-weight:400; background:#f0f0f0; padding:3px 8px; border-radius:4px; margin-left:6px;">v<?php echo esc_html(NV_DASHBOARD_VERSION); ?></span>
    </h1>

    <p style="color:#444; max-width: 720px;">
        Introduce el ID de una publicación que dio problemas (lo encuentras en la URL de edición:
        <code>post.php?post=<strong>15547</strong>&action=edit</code>).
        El diagnóstico no llama a OpenAI — solo lee el estado interno guardado en WordPress
        para saber por qué la imagen salió sin texto, sin logo, o con un fallo concreto.
    </p>

    <div style="background:#fff; border:1px solid #ddd; border-radius:4px; padding:18px; margin-top:14px; max-width: 900px;">
        <div style="display:flex; gap:8px; align-items:center; margin-bottom:12px;">
            <label for="nv-diag-id" style="font-weight:600;">ID de la publicación:</label>
            <input type="number" id="nv-diag-id" placeholder="15547" style="width:120px; padding:6px;" min="1" />
            <button type="button" class="button button-primary nv-button-gold" id="nv-diag-run">🩺 Ejecutar diagnóstico</button>
            <button type="button" class="button" id="nv-diag-copy" style="display:none;">📋 Copiar JSON</button>
            <span id="nv-diag-status" style="margin-left:8px; color:#666; font-size:12px;"></span>
        </div>

        <div id="nv-diag-summary" style="display:none; background:#f7f9fc; border-left:3px solid #0073aa; padding:12px; margin-bottom:12px; font-size:13px;"></div>

        <pre id="nv-diag-output" style="display:none; background:#1e1e1e; color:#d4d4d4; padding:14px; border-radius:4px; max-height:600px; overflow:auto; font-size:11px; line-height:1.5; font-family: Menlo, Monaco, Consolas, monospace;"></pre>
    </div>

    <div style="margin-top:18px; max-width: 900px; background:#fffbe5; border-left:3px solid #dba000; padding:12px; font-size:13px;">
        <strong>💡 Cómo interpretar el resultado:</strong>
        <ul style="margin:8px 0 0 18px;">
            <li><code>meta.headline_lines_parsed_count</code> = 0 y <code>meta.headline_plain</code> vacío → la AI no devolvió texto, debería haber actuado el fallback. Mira <code>meta.overlay_debug</code> para ver si se activó.</li>
            <li><code>img_opts.add_text</code> = false → la opción de texto estaba desmarcada al generar. Activa el checkbox "📝 Texto headline" la próxima vez.</li>
            <li><code>brand_colors</code> con todos defaults (#1F2937 / #2563EB) → no has configurado los colores corporativos del cliente. Editorial → Clientes → editar → 🎨 Branding.</li>
            <li><code>logo.exists</code> = false → el logo del cliente no está subido o no existe en disco.</li>
            <li><code>php.max_execution_time</code> &lt; 90 → riesgo alto de timeout del hosting. Pide subir a 300s.</li>
            <li><code>openai_key_configured</code> = false → falta API key. Configuración → OpenAI API key.</li>
        </ul>
    </div>
</div>

<script>
(function(){
    const $id = document.getElementById('nv-diag-id');
    const $run = document.getElementById('nv-diag-run');
    const $copy = document.getElementById('nv-diag-copy');
    const $status = document.getElementById('nv-diag-status');
    const $output = document.getElementById('nv-diag-output');
    const $summary = document.getElementById('nv-diag-summary');

    let lastJson = '';

    $run.addEventListener('click', async () => {
        const id = parseInt($id.value, 10);
        if (!id || id < 1) {
            $status.textContent = '⚠️ Introduce un ID numérico válido.';
            $status.style.color = '#c00';
            return;
        }
        $status.style.color = '#0073aa';
        $status.textContent = '⏳ Ejecutando…';
        $output.style.display = 'none';
        $summary.style.display = 'none';
        $copy.style.display = 'none';

        try {
            const r = await fetch(window.nvDashboard.restUrl + 'test-imagen-publicacion/' + id, {
                method: 'GET',
                headers: { 'X-WP-Nonce': window.nvDashboard.restNonce },
            });
            const ctype = (r.headers.get('content-type') || '').toLowerCase();
            if (!ctype.includes('json')) {
                const txt = await r.text();
                throw new Error('Respuesta no-JSON (HTTP ' + r.status + '): ' + txt.replace(/<[^>]+>/g, ' ').substr(0, 300));
            }
            const data = await r.json();
            if (!r.ok || data.code) throw new Error(data.message || 'HTTP ' + r.status);

            lastJson = JSON.stringify(data, null, 2);
            $output.textContent = lastJson;
            $output.style.display = 'block';
            $copy.style.display = 'inline-block';

            // Resumen rápido
            const d = data.diag || {};
            const meta = d.meta || {};
            const lines = meta.headline_lines_parsed_count || 0;
            const hasPlain = (meta.headline_plain || '').length > 0;
            const debug = (() => { try { return JSON.parse(meta.overlay_debug || '{}'); } catch(e) { return {}; } })();
            const summary = [];

            summary.push('<strong>Cliente:</strong> ' + (d.cliente ? d.cliente.name + ' (' + d.cliente.slug + ')' : '⚠️ NINGUNO'));
            summary.push('<strong>Texto disponible:</strong> ' + (lines > 0 ? `headline_lines (${lines} líneas) ✓` : (hasPlain ? 'headline plain ✓' : '❌ NINGUNO — debería disparar fallback')));
            summary.push('<strong>add_text:</strong> ' + (d.img_opts && d.img_opts.add_text ? '✓ activado' : '❌ DESACTIVADO (checkbox del modal)'));
            summary.push('<strong>Último render:</strong> ' + (debug.source || debug.fallback_used || '(no info — la imagen quizás no se generó tras v1.0.39)'));
            summary.push('<strong>Logo:</strong> ' + (d.logo && d.logo.exists ? '✓ existe' : '⚠️ no subido o no existe en disco'));
            summary.push('<strong>Fuente:</strong> ' + (d.font && d.font.exists ? '✓ existe' : 'usando Poppins-Bold por defecto'));
            summary.push('<strong>Brand colors:</strong> ' + (d.brand_colors ? `primary ${d.brand_colors.primary} · accent ${d.brand_colors.accent} · text ${d.brand_colors.text_on_primary} · source: ${d.brand_colors.source}` : 'no disponibles'));
            summary.push('<strong>OpenAI key:</strong> ' + (d.openai_key_configured ? '✓ configurada' : '❌ falta'));
            summary.push('<strong>PHP max_execution_time:</strong> ' + (d.php && d.php.max_execution_time ? d.php.max_execution_time + 's ' + (parseInt(d.php.max_execution_time) >= 300 ? '✓' : '⚠️ debería ser ≥300') : '?'));

            $summary.innerHTML = summary.join('<br>');
            $summary.style.display = 'block';

            $status.style.color = '#2ea043';
            $status.textContent = '✓ Diagnóstico completado';
        } catch (err) {
            $status.style.color = '#c00';
            $status.textContent = '❌ ' + err.message;
            $output.textContent = err.message;
            $output.style.display = 'block';
        }
    });

    $copy.addEventListener('click', () => {
        if (!lastJson) return;
        navigator.clipboard.writeText(lastJson).then(() => {
            $copy.textContent = '✓ Copiado';
            setTimeout(() => { $copy.textContent = '📋 Copiar JSON'; }, 2000);
        });
    });

    $id.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') $run.click();
    });

    // Pre-rellenar si viene ?post= en la URL
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('post')) {
        $id.value = urlParams.get('post');
        $run.click();
    }
})();
</script>
