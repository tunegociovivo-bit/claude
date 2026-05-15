<?php
/**
 * Vista Editorial - Calendario mensual interactivo v1.0.1
 * 
 * FIXES v1.0.1:
 * - Approve bar muestra contador total + aprobadas
 * - Label de mes se actualiza automáticamente al navegar
 * - Mensajes informativos más claros
 */
if (!defined('ABSPATH')) exit;
?>

<div class="wrap nv-dashboard">
    <div class="nv-header">
        <div class="nv-logo-block">
            <div class="nv-logo">NV</div>
            <div>
                <h1>Editorial · Calendario mensual <span style="font-size:11px;color:#888;font-weight:400;background:#f0f0f0;padding:3px 8px;border-radius:4px;margin-left:6px;">v<?php echo esc_html(NV_DASHBOARD_VERSION); ?></span></h1>
                <p class="nv-subtitle">Revisa, aprueba y envía a Metricool</p>
            </div>
        </div>
        
        <div class="nv-cliente-selector">
            <label>Cliente:</label>
            <select id="nv-cliente-filter" onchange="nvFilterCliente(this.value)">
                <option value="all" <?php selected($cliente_actual, 'all'); ?>>Todos los clientes</option>
                <?php foreach ($clientes as $c): ?>
                    <option value="<?php echo esc_attr($c->slug); ?>" <?php selected($cliente_actual, $c->slug); ?>>
                        <?php echo esc_html($c->name); ?>
                    </option>
                <?php endforeach; ?>
            </select>
        </div>
    </div>
    
    <div class="nv-tabs">
        <a href="?page=nv-dashboard" class="nv-tab">📊 Vista General</a>
        <a href="?page=nv-dashboard-editorial" class="nv-tab active">📅 Editorial</a>
        <a href="<?php echo admin_url('edit.php?post_type=nv_publicacion'); ?>" class="nv-tab">📝 Publicaciones</a>
        <a href="<?php echo admin_url('edit-tags.php?taxonomy=nv_cliente&post_type=nv_publicacion'); ?>" class="nv-tab">👥 Clientes</a>
        <a href="?page=nv-dashboard-settings" class="nv-tab">⚙️ Configuración</a>
    </div>
    
    <div class="nv-legend">
        <span class="nv-tag nv-tag-reel">🎬 Reels</span>
        <span class="nv-tag nv-tag-imagen">📷 Imágenes</span>
        <span class="nv-tag nv-tag-carrusel">🎴 Carruseles</span>
        <span class="nv-tag nv-tag-story">📱 Stories</span>
        <span class="nv-legend-sep"></span>
        <span class="nv-status nv-status-pending">○ Pendiente</span>
        <span class="nv-status nv-status-approved">● Aprobada</span>
        <span class="nv-status nv-status-scheduled">▶ Programada</span>
    </div>
    
    <?php if ($cliente_actual === 'all'): ?>
    <div class="nv-info-box" style="margin-bottom: 16px; padding: 12px 16px;">
        <p style="margin: 0 0 8px;"><strong>👆 Selecciona un cliente</strong> en el dropdown superior para poder aprobar el mes, duplicar o generar con Claude.</p>
        <p style="margin: 0; font-size: 13px; color: #555;">— O usa <strong>Publicación multi-cliente</strong> para crear un mismo post (ej: día de la madre) en varios clientes a la vez.</p>
    </div>
    <?php endif; ?>

    <!-- v1.0.23: Botón multi-cliente — siempre disponible -->
    <div style="margin-bottom: 12px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
        <button class="button button-primary nv-button-gold" onclick="nvAbrirMultiCliente()" title="Crea una misma publicación (con copy adaptado por IA) para varios clientes a la vez. Ideal para fechas estacionales: día de la madre, navidad, black friday...">
            🎯 Publicación multi-cliente
        </button>
        <span style="font-size: 12px; color: #666;">
            o click directo en una fecha vacía del calendario
        </span>
    </div>

    <?php if ($cliente_actual !== 'all'): ?>
    <div style="margin-bottom: 16px; display: flex; gap: 8px; flex-wrap: wrap;">
        <button class="button button-primary nv-button-gold" onclick="nvAbrirGenerarMes()" title="Genera 14 borradores con Claude para un mes en blanco">
            🤖 Generar mes con Claude
        </button>
        <button class="button" onclick="nvDuplicarMes()" title="Duplica todas las publicaciones de un mes a otro manteniendo copy/hashtags/assets">
            📋 Duplicar mes
        </button>
        <button class="button" onclick="nvGenerarImagenesConClaude()" title="Abre claude.ai con prompt para generar imágenes de las publicaciones sin asset">
            🎨 Generar imágenes con Claude
        </button>
        <span style="font-size: 12px; color: #666; align-self: center;">
            Tip: arrastra eventos del calendario para reprogramarlos · click en un día vacío para crear publicación rápida
        </span>
    </div>
    
    <!-- Modal generar mes -->
    <div id="nv-generar-mes-modal" class="nv-modal" style="display:none;">
        <div class="nv-modal-content" style="max-width: 600px;">
            <span class="nv-modal-close" onclick="nvCerrarGenerarMes()">&times;</span>
            <h2 style="margin-top: 0;">🤖 Generar mes con Claude</h2>
            <p style="color: #666; margin-bottom: 18px;">
                Claude generará <strong>todos los borradores del mes</strong> (copy + hashtags + sugerencias visuales)
                basándose en tu brief. Las publicaciones se crean directamente aquí en ~30-60s.
                Coste estimado: ~5-8 céntimos.
            </p>
            
            <label style="display:block; margin-bottom: 12px;">
                <strong>Mes destino</strong>
                <input type="month" id="nv-genmes-mes" class="widefat" style="margin-top: 4px;">
            </label>
            
            <label style="display:block; margin-bottom: 12px;">
                <strong>Número de publicaciones</strong>
                <input type="number" id="nv-genmes-cantidad" class="widefat" value="14" min="1" max="60" style="margin-top: 4px;">
                <span class="description">Sugerido: 14 (3-4 por semana)</span>
            </label>
            
            <label style="display:block; margin-bottom: 12px;">
                <strong>Redes objetivo</strong>
                <div style="display:flex; gap: 12px; flex-wrap: wrap; margin-top: 6px;">
                    <label><input type="checkbox" class="nv-genmes-red" value="facebook" checked> Facebook</label>
                    <label><input type="checkbox" class="nv-genmes-red" value="instagram" checked> Instagram</label>
                    <label><input type="checkbox" class="nv-genmes-red" value="linkedin" checked> LinkedIn</label>
                    <label><input type="checkbox" class="nv-genmes-red" value="tiktok"> TikTok</label>
                    <label><input type="checkbox" class="nv-genmes-red" value="twitter"> X/Twitter</label>
                    <label><input type="checkbox" class="nv-genmes-red" value="google_my_business"> GMB</label>
                </div>
            </label>
            
            <label style="display:block; margin-bottom: 12px;">
                <strong>Mix de tipos sugerido</strong>
                <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 6px;">
                    <label>📷 Imagen <input type="number" id="nv-genmes-mix-imagen" value="6" min="0" max="60" style="width: 60px;"></label>
                    <label>🎴 Carrusel <input type="number" id="nv-genmes-mix-carrusel" value="4" min="0" max="60" style="width: 60px;"></label>
                    <label>🎬 Reel <input type="number" id="nv-genmes-mix-reel" value="3" min="0" max="60" style="width: 60px;"></label>
                    <label>📱 Story <input type="number" id="nv-genmes-mix-story" value="1" min="0" max="60" style="width: 60px;"></label>
                </div>
            </label>
            
            <label style="display:block; margin-bottom: 12px;">
                <strong>Brief del mes</strong>
                <textarea id="nv-genmes-brief" class="widefat" rows="6" placeholder="Ejemplo: este mes queremos foco en automatización con IA y mostrar 2 casos de éxito de clientes (Clínica March, RSAdvocats). Tono profesional pero cercano. Evitar prometer resultados específicos. CTA típico: 'Auditoría gratuita en 2h'."></textarea>
            </label>

            <!-- v1.0.37: opciones visuales -->
            <div style="margin-bottom: 14px; padding: 12px; background: #f7f9fc; border-radius: 4px; border: 1px solid #e0e6ed;">
                <label style="display:flex; align-items:center; gap:8px; font-weight:600; margin-bottom:8px;">
                    <input type="checkbox" id="nv-genmes-generar-imagenes" checked>
                    🎨 Generar imágenes automáticamente para cada publicación
                </label>
                <p style="margin: 0 0 6px; color:#666; font-size:12px;">Tras crear los copys, gpt-image-2 genera una imagen única por post (escena adaptada al tema, prompt creado por la AI como director de arte). 3 en paralelo. Tarda ~30-60s extra por imagen.</p>
                <label style="display:flex; align-items:center; gap:8px; font-size:12px; color:#444;">
                    <span style="margin-left:4px;">Calidad:</span>
                    <select id="nv-genmes-quality" style="padding:2px 6px;">
                        <option value="low">Low (más rápida, ~10s/imagen)</option>
                        <option value="medium" selected>Medium (recomendada, ~30s/imagen)</option>
                        <option value="high">High (lenta, ~60-90s/imagen)</option>
                    </select>
                </label>
            </div>

            <!-- v1.0.53: Slider fidelidad refs (override) en generar-mes -->
            <div style="margin-top: 18px; padding: 12px; background: #f6f7f7; border-radius: 4px;">
                <label style="display:block; font-weight:600; margin-bottom:6px;">📐 Fidelidad a refs visuales</label>
                <div style="display:flex; align-items:center; gap:14px;">
                    <input type="range" id="nv-genmes-fidelity" min="0" max="100" step="5" value="50" style="flex:1;" oninput="document.getElementById('nv-genmes-fidelity-val').textContent = this.value + '%';" />
                    <output id="nv-genmes-fidelity-val" style="font-weight:600; min-width:48px; text-align:right; font-family:monospace;">50%</output>
                    <label style="font-size:12px; color:#666; white-space:nowrap;">
                        <input type="checkbox" id="nv-genmes-fidelity-use-default" checked> usar default del cliente
                    </label>
                </div>
                <p class="description" style="margin:6px 0 0; font-size:11px;">
                    <strong>0%</strong> libertad total · <strong>50%</strong> inspiración suave · <strong>100%</strong> replicación estricta del patrón visual de las refs.
                </p>
            </div>

            <!-- v1.0.59: Sliders por tipo de ref — controla qué % de las publicaciones del lote llevarán refs de cada tipo -->
            <div style="margin-top: 14px; padding: 12px; background: #fff8e8; border:1px solid #f0c97a; border-radius: 4px;">
                <label style="display:block; font-weight:600; margin-bottom:8px;">🎯 Distribución de refs por tipo (lote)</label>
                <p class="description" style="margin:0 0 10px; font-size:11px;">
                    Marca qué <strong>% del lote</strong> debe llevar cada tipo de ref. Ejemplo: si tu cliente tiene fotos de Rochar marcadas como "CEO" y pones <strong>30%</strong>, los <strong>9 posts</strong> (de 30) cuyo copy más relevancia tenga al CEO llevarán a Rochar real. La AI puntúa cada post y asigna por relevancia. Los tipos son independientes — un post puede llevar varios tipos a la vez.
                </p>
                <div id="nv-genmes-percent-targets" style="display:flex; flex-direction:column; gap:8px; font-size:12px;">
                    <?php
                    $pct_types_ui = [
                        'persona_destacada'  => ['👤 CEO / Persona destacada', 'Rochar, director, fundador'],
                        'equipo'             => ['👥 Equipo / Trabajadores',    'Médicos, asistentes, recepción'],
                        'instalaciones'      => ['🏢 Instalaciones / Local',    'Clínica, oficina, recepción'],
                        'pacientes_usuarios' => ['🧑 Paciente / Usuario',        'Clientes en consulta (con consentimiento)'],
                        'productos'          => ['📦 Producto',                  'Catálogo, packaging'],
                    ];
                    foreach ($pct_types_ui as $key => $info) {
                        list($label, $hint) = $info;
                        echo '<div style="display:flex; align-items:center; gap:10px;">';
                        echo '<label style="min-width:230px;" title="' . esc_attr($hint) . '">' . esc_html($label) . '</label>';
                        echo '<input type="range" class="nv-pct-slider" data-type="' . esc_attr($key) . '" min="0" max="100" step="10" value="0" style="flex:1;" />';
                        echo '<output class="nv-pct-output" style="font-weight:600; min-width:40px; text-align:right; font-family:monospace;">0%</output>';
                        echo '</div>';
                    }
                    ?>
                </div>
                <p class="description" style="margin:8px 0 0; font-size:10px; color:#888;">
                    💡 Los sliders solo afectan a tipos que tengan refs subidas en el cliente (mira la ficha del cliente → Imágenes de referencia). Si un tipo está al 0% o no tiene refs, ningún post lo usará.
                </p>
            </div>
            <script>
            // v1.0.59: live-update outputs de los sliders
            (function(){
                document.querySelectorAll('#nv-genmes-percent-targets .nv-pct-slider').forEach(function(s){
                    s.addEventListener('input', function(){
                        var out = s.parentElement.querySelector('.nv-pct-output');
                        if (out) out.textContent = s.value + '%';
                    });
                });
            })();
            </script>

            <!-- v1.0.64: Slider de longitud del copy -->
            <div style="margin-top: 14px; padding: 12px; background: #f0f9ff; border:1px solid #93c5fd; border-radius: 4px;">
                <label style="display:block; font-weight:600; margin-bottom:8px;">📝 Longitud del copy</label>
                <p class="description" style="margin:0 0 10px; font-size:11px;">
                    Controla cuán <strong>largos</strong> son los textos del copy. <strong>0-25</strong> = ultra-directo (~40-100 palabras, IG nativo). <strong>25-50</strong> = corto (~60-180 palabras). <strong>50-75</strong> = medio (~100-300 palabras, default). <strong>75-100</strong> = largo (~200-450 palabras, FB / B2B).
                </p>
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="font-size:11px; color:#555; min-width:50px;">Corto</span>
                    <input type="range" id="nv-genmes-copy-length" min="0" max="100" step="5" value="50" style="flex:1;" />
                    <span style="font-size:11px; color:#555; min-width:50px; text-align:right;">Largo</span>
                    <output id="nv-genmes-copy-length-output" style="font-weight:600; min-width:60px; text-align:right; font-family:monospace; font-size:12px;">Medio</output>
                </div>
                <p class="description" style="margin:8px 0 0; font-size:10px; color:#888;">
                    💡 v1.0.65: nueva curva más agresiva. Para <strong>Clínica March / Aquaking</strong> (B2C IG-first) usa <strong>15-30</strong>. Para <strong>RSAdvocats</strong> (legal, hay que explicar) usa <strong>60-75</strong>. Default 50 = medio.
                </p>
            </div>
            <script>
            (function(){
                var slider = document.getElementById('nv-genmes-copy-length');
                var out = document.getElementById('nv-genmes-copy-length-output');
                function label(v) {
                    v = parseInt(v, 10);
                    if (v <= 15) return 'Ultra-corto';
                    if (v <= 30) return 'Muy corto';
                    if (v <= 50) return 'Corto';
                    if (v <= 70) return 'Medio';
                    if (v <= 85) return 'Largo';
                    return 'Muy largo';
                }
                if (slider && out) {
                    slider.addEventListener('input', function(){ out.textContent = label(slider.value); });
                }
            })();
            </script>

            <!-- v1.0.66: Toggles de overlay (qué textos aparecen en la imagen) -->
            <div style="margin-top: 14px; padding: 12px; background: #f5f3ff; border:1px solid #c4b5fd; border-radius: 4px;">
                <label style="display:block; font-weight:600; margin-bottom:8px;">🎨 Elementos visuales en la imagen</label>
                <p class="description" style="margin:0 0 10px; font-size:11px;">
                    Decide qué textos sobreimpresos aparecen en la imagen generada. <strong>Recomendado: dejar solo logo + titular</strong> para imágenes limpias. Activar dato y CTA solo si quieres una imagen muy "comercial" tipo flyer (ojo: puede sobrecargar visualmente).
                </p>
                <div style="display:flex; flex-direction:column; gap:6px; font-size:13px;">
                    <label><input type="checkbox" class="nv-genmes-img-opt" data-opt="add_logo" checked> 🏷️ <strong>Logo corporativo</strong> (esquina inferior)</label>
                    <label><input type="checkbox" class="nv-genmes-img-opt" data-opt="add_text" checked> 📝 <strong>Titular</strong> grande (TU TRATAMIENTO ES ÚNICO)</label>
                    <label><input type="checkbox" class="nv-genmes-img-opt" data-opt="add_data"> 📊 Dato destacado (línea pequeña debajo del titular)</label>
                    <label><input type="checkbox" class="nv-genmes-img-opt" data-opt="add_cta"> 🚀 CTA visible (AGENDA YA, RESERVA CITA, etc.)</label>
                </div>
                <p class="description" style="margin:8px 0 0; font-size:10px; color:#888;">
                    💡 El copy de Facebook/Instagram se genera siempre — esto solo afecta a los textos sobreimpresos en la imagen. Si desactivas el titular, la imagen sale solo con el logo (estilo editorial puro).
                </p>
            </div>

            <!-- v1.0.53: Análisis de competencia en generar-mes -->
            <div style="margin-top: 12px;">
                <button type="button" class="button" onclick="nvAnalizarCompetenciaGenmes()" style="background:#fef3c7; border-color:#f59e0b; width:100%;">
                    🔍 Analizar competencia y elegir temas (rellena el mix automáticamente)
                </button>
                <span id="nv-genmes-competencia-status" style="display:block; margin-top:6px; font-size:11px; color:#666;"></span>
            </div>

            <div style="display:flex; gap: 8px; flex-direction: column; margin-top: 18px;">
                <button class="button button-primary nv-button-gold" onclick="nvGenerarMesAbrirClaude()">
                    🤖 Generar publicaciones ahora
                </button>
                <button class="button" id="nv-genmes-background" onclick="nvGenerarMesBackground()" style="display:none;">
                    ⏬ Cerrar y trabajar mientras se genera
                </button>
                <button class="button" onclick="nvCerrarGenerarMes()">Cancelar</button>
            </div>
        </div>
    </div>
    <?php endif; ?>

    <!-- v1.0.34: panel de diagnóstico de publicaciones huérfanas -->
    <div id="nv-orfanas-panel" style="display:none; background:#fffbe5; border:1px solid #dba000; border-radius:4px; padding:12px; margin-bottom:12px;">
        <strong style="color:#dba000;">🩺 <span id="nv-orfanas-count">?</span> publicaciones huérfanas detectadas</strong>
        <p style="margin:4px 0 8px; font-size:13px; color:#666;">Posts con estado <code>publish</code> pero sin <code>nv_fecha_publicacion</code> asignada — invisibles al calendario, normalmente residuos de timeouts del hosting durante creación. Recomendado: borrarlas o convertirlas a borrador.</p>
        <details style="margin-bottom:8px;"><summary style="cursor:pointer; font-size:12px;">Ver lista</summary>
            <ul id="nv-orfanas-list" style="margin:6px 0 0 18px; font-size:12px; color:#444; max-height:200px; overflow:auto;"></ul>
        </details>
        <button type="button" class="button" id="nv-orfanas-draft-btn">📄 Convertir a borradores</button>
        <button type="button" class="button button-link-delete" id="nv-orfanas-delete-btn" style="color:#c00;">🗑️ Borrar definitivamente</button>
        <span id="nv-orfanas-status" style="margin-left:10px; font-size:12px;"></span>
    </div>
    <p id="nv-orfanas-trigger" style="text-align:right; font-size:11px; color:#999; margin:0 0 6px;">
        <a href="#" id="nv-orfanas-link" style="color:#999; text-decoration:none;">🩺 Comprobar publicaciones huérfanas</a>
        <span style="margin:0 8px; color:#ddd;">·</span>
        <span style="color:#999;">💡 Tip: arrastra cualquier publicación hacia abajo para ver la papelera y borrarla</span>
    </p>
    <script>
    (function(){
        const restUrl = (window.nvDashboard && window.nvDashboard.restUrl) || '/wp-json/nv/v1/';
        const nonce   = (window.nvDashboard && window.nvDashboard.restNonce) || '';

        function checkOrfanas(showEmpty) {
            fetch(restUrl + 'diagnostico-publicaciones-huerfanas', {
                headers: { 'X-WP-Nonce': nonce }
            }).then(r => r.json()).then(d => {
                const panel = document.getElementById('nv-orfanas-panel');
                const trigger = document.getElementById('nv-orfanas-trigger');
                if (!d || !d.orphans || d.orphans.length === 0) {
                    if (showEmpty) {
                        trigger.innerHTML = '<span style="color:#2ea043;">✓ No hay publicaciones huérfanas (' + (d.total_publish || 0) + ' publicadas en total están OK)</span>';
                    }
                    return;
                }
                trigger.style.display = 'none';
                panel.style.display = 'block';
                document.getElementById('nv-orfanas-count').textContent = d.orphans.length;
                const list = document.getElementById('nv-orfanas-list');
                list.innerHTML = d.orphans.map(o =>
                    '<li>ID ' + o.id + ' · "' + (o.title || '').replace(/[<>]/g, '') + '" · creado ' + (o.date || '?').substr(0, 10) + ' · <a href="' + o.edit_url + '" target="_blank">ver</a></li>'
                ).join('');
                panel.dataset.ids = JSON.stringify(d.orphans.map(o => o.id));
            }).catch(err => {
                console.error('Diagnóstico orfanas falló:', err);
            });
        }

        function repararOrfanas(action) {
            const panel = document.getElementById('nv-orfanas-panel');
            const ids = JSON.parse(panel.dataset.ids || '[]');
            if (!ids.length) return;
            const verb = action === 'delete' ? 'borrar definitivamente' : 'convertir a borrador';
            if (!confirm('¿Confirmas que quieres ' + verb + ' las ' + ids.length + ' publicaciones huérfanas?')) return;

            const status = document.getElementById('nv-orfanas-status');
            status.innerHTML = '<span style="color:#0073aa;">⏳ Procesando…</span>';

            fetch(restUrl + 'reparar-publicaciones-huerfanas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': nonce },
                body: JSON.stringify({ ids: ids, action: action })
            }).then(r => r.json()).then(d => {
                if (d && d.success) {
                    status.innerHTML = '<span style="color:#2ea043;">✓ ' + (d.count || 0) + ' procesadas. Recargando…</span>';
                    setTimeout(() => location.reload(), 1500);
                } else {
                    status.innerHTML = '<span style="color:#c00;">❌ ' + ((d && d.message) || 'Error desconocido') + '</span>';
                }
            }).catch(err => {
                status.innerHTML = '<span style="color:#c00;">❌ ' + err.message + '</span>';
            });
        }

        // Comprobar al cargar la página (silencioso si no hay huérfanas)
        document.addEventListener('DOMContentLoaded', function(){
            checkOrfanas(false);
        });

        // Botón explícito
        document.addEventListener('click', function(e){
            if (e.target && e.target.id === 'nv-orfanas-link') {
                e.preventDefault();
                checkOrfanas(true);
            }
            if (e.target && e.target.id === 'nv-orfanas-draft-btn') repararOrfanas('convert_to_draft');
            if (e.target && e.target.id === 'nv-orfanas-delete-btn') repararOrfanas('delete');
        });
    })();
    </script>

    <div id="nv-calendar"></div>
    
    <div class="nv-approve-bar" id="nv-approve-bar">
        <div class="nv-approve-info">
            <p class="nv-approve-title">Listo para enviar a Metricool</p>
            <p class="nv-approve-subtitle">
                <span id="nv-approved-count">0</span> de 
                <span id="nv-total-count">0</span> publicaciones aprobadas para 
                <strong id="nv-mes-label">cargando...</strong>
            </p>
        </div>
        <button class="button button-primary nv-button-gold" id="nv-approve-month-btn" onclick="nvApproveMonth()">
            ✅ Aprobar mes y generar CSV
        </button>
    </div>
    
    <!-- Modal preview publicación -->
    <div id="nv-preview-modal" class="nv-modal" style="display:none">
        <div class="nv-modal-content">
            <span class="nv-modal-close" onclick="nvClosePreview()">&times;</span>
            <div id="nv-preview-body"></div>
        </div>
    </div>

    <!-- v1.0.23: Modal multi-cliente -->
    <div id="nv-multi-cliente-modal" class="nv-modal" style="display:none">
        <div class="nv-modal-content" style="max-width: 720px;">
            <span class="nv-modal-close" onclick="nvCerrarMultiCliente()">&times;</span>
            <h2 style="margin-top: 0;">🎯 Publicación multi-cliente</h2>
            <p style="color: #666; margin-bottom: 18px;">
                Crea la misma publicación en varios clientes a la vez. La IA adaptará el copy al brief de marca de cada uno.
            </p>

            <table class="form-table">
                <tr>
                    <th><label for="nv-mc-fecha">Fecha</label></th>
                    <td>
                        <input type="date" id="nv-mc-fecha" required>
                        <input type="time" id="nv-mc-hora" value="12:00" required style="margin-left:8px;">
                    </td>
                </tr>
                <tr>
                    <th><label for="nv-mc-tipo">Tipo de contenido</label></th>
                    <td>
                        <select id="nv-mc-tipo">
                            <option value="imagen">🖼️ Imagen / Post</option>
                            <option value="reel">🎬 Reel</option>
                            <option value="carrusel">🎠 Carrusel</option>
                            <option value="story">📱 Story</option>
                            <option value="video">📹 Vídeo</option>
                        </select>
                    </td>
                </tr>
                <tr>
                    <th>Redes sociales</th>
                    <td>
                        <label style="margin-right:14px;"><input type="checkbox" class="nv-mc-red" value="facebook" checked> Facebook</label>
                        <label style="margin-right:14px;"><input type="checkbox" class="nv-mc-red" value="instagram" checked> Instagram</label>
                        <label style="margin-right:14px;"><input type="checkbox" class="nv-mc-red" value="linkedin"> LinkedIn</label>
                        <label style="margin-right:14px;"><input type="checkbox" class="nv-mc-red" value="twitter"> Twitter/X</label>
                        <label style="margin-right:14px;"><input type="checkbox" class="nv-mc-red" value="tiktok"> TikTok</label>
                    </td>
                </tr>
                <tr>
                    <th><label for="nv-mc-tema">Tema / brief</label></th>
                    <td>
                        <textarea id="nv-mc-tema" rows="3" style="width:100%; max-width:560px;" placeholder="Ej: Día de la madre — felicitación cálida y emotiva, no comercial. Llamada a apreciar a las madres."></textarea>
                        <p class="description">Este brief lo recibirá la IA. Cuanto más concreto, mejor adaptación por cliente.</p>
                    </td>
                </tr>
                <tr>
                    <th>Clientes</th>
                    <td>
                        <div style="margin-bottom:6px;">
                            <a href="#" onclick="nvMultiClienteToggleAll(true); return false;" style="font-size:12px;">✓ Todos</a>
                            ·
                            <a href="#" onclick="nvMultiClienteToggleAll(false); return false;" style="font-size:12px;">✗ Ninguno</a>
                        </div>
                        <div id="nv-mc-clientes-list" style="border:1px solid #ddd; border-radius:4px; padding:10px; max-height:240px; overflow-y:auto;">
                            <?php
                            $todos_clientes = get_terms(['taxonomy' => 'nv_cliente', 'hide_empty' => false, 'orderby' => 'name']);
                            if (!empty($todos_clientes) && !is_wp_error($todos_clientes)):
                                foreach ($todos_clientes as $cl):
                                    $brief = class_exists('NV_Cliente_Meta') ? NV_Cliente_Meta::get_brand_brief($cl->term_id) : '';
                                    $brief_warn = empty($brief) ? ' <span title="Sin brief de marca — la calidad del copy puede ser menor" style="color:#dba000;">⚠️</span>' : '';
                            ?>
                                <label style="display:block; padding:4px 0;">
                                    <input type="checkbox" class="nv-mc-cliente" value="<?php echo esc_attr($cl->slug); ?>">
                                    <strong><?php echo esc_html($cl->name); ?></strong>
                                    <small style="color:#888; font-family:monospace;">(<?php echo esc_html($cl->slug); ?>)</small>
                                    <?php echo $brief_warn; ?>
                                </label>
                            <?php endforeach; else: ?>
                                <em>No hay clientes registrados.</em>
                            <?php endif; ?>
                        </div>
                    </td>
                </tr>
                <tr>
                    <th></th>
                    <td>
                        <label><input type="checkbox" id="nv-mc-skip" checked> Saltar clientes que ya tengan publicación en esta fecha exacta</label>
                    </td>
                </tr>
                <tr>
                    <th>Imagen</th>
                    <td>
                        <label style="display:block; margin-bottom:6px;">
                            <input type="checkbox" id="nv-mc-generate-image" checked>
                            ✨ <strong>Generar también la imagen</strong> (gpt-image-2 server-side, sin refs Drive)
                        </label>
                        <label style="display:block; margin-left:24px; font-size:13px;">
                            Calidad:
                            <select id="nv-mc-image-quality" style="margin-left:6px;">
                                <option value="low">low ($0.006/img)</option>
                                <option value="medium" selected>medium ($0.05/img)</option>
                                <option value="high">high ($0.21/img)</option>
                            </select>
                        </label>
                        <p class="description" style="margin-top:6px;">
                            v1.0.26: las imágenes se generan en una <strong>fase 2 separada</strong> (3 en paralelo,
                            cada una su propia petición HTTP) para evitar timeouts del hosting. Verás el progreso
                            en tiempo real. Si una falla, las demás siguen.
                            <br>Si el resultado no convence, usa el widget Claude de cada publicación para
                            regenerar con refs Drive.
                        </p>
                    </td>
                </tr>
                <tr id="nv-mc-img-style-row">
                    <th>🎨 Estilo de imagen</th>
                    <td>
                        <p class="description" style="margin:0 0 8px;">
                            Estos overlays se aplican <strong>por encima</strong> de la imagen generada por la IA
                            (post-procesado server-side con PHP/GD). Los textos los escribe Anthropic adaptados a
                            la marca; el logo y la fuente vienen del cliente
                            (Editorial → Clientes → editar → 🎨 Branding).
                        </p>
                        <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px 18px; margin-top:6px;">
                            <label><input type="checkbox" class="nv-mc-img-opt" data-opt="add_logo" checked> 🏷️ Añadir logo corporativo</label>
                            <label><input type="checkbox" class="nv-mc-img-opt" data-opt="add_text" checked> 📝 Añadir titular sobre la imagen</label>
                            <label><input type="checkbox" class="nv-mc-img-opt" data-opt="add_data"> 📊 Añadir dato destacado (cifra/hito)</label>
                            <label><input type="checkbox" class="nv-mc-img-opt" data-opt="add_cta"> 🚀 Añadir CTA visible (botón)</label>
                            <label><input type="checkbox" class="nv-mc-img-opt" data-opt="tone_emotivo"> 💛 Tipo emotivo (cálido, humano)</label>
                            <label><input type="checkbox" class="nv-mc-img-opt" data-opt="tone_comercial"> 🛒 Tipo comercial (producto, oferta)</label>
                        </div>
                    </td>
                </tr>

                <!-- v1.0.53: Slider fidelidad refs (override puntual) -->
                <tr>
                    <th><label for="nv-mc-fidelity">📐 Fidelidad a refs</label></th>
                    <td>
                        <div style="display:flex; align-items:center; gap:14px; max-width:560px;">
                            <input type="range" id="nv-mc-fidelity" min="0" max="100" step="5" value="50" style="flex:1;" oninput="document.getElementById('nv-mc-fidelity-val').textContent = this.value + '%';" />
                            <output id="nv-mc-fidelity-val" style="font-weight:600; min-width:48px; text-align:right; font-family:monospace;">50%</output>
                            <label style="font-size:12px; color:#666; white-space:nowrap;">
                                <input type="checkbox" id="nv-mc-fidelity-use-default" checked> usar default por cliente
                            </label>
                        </div>
                        <p class="description" style="margin-top:6px;">
                            <strong>0%</strong> ignora las refs (libertad total) · <strong>50%</strong> inspiración suave · <strong>100%</strong> replicación estricta del patrón.
                            Si está marcado <em>usar default por cliente</em>, cada cliente usará su propio default configurado en su ficha. Desmárcalo para forzar el valor del slider para todos en este lanzamiento.
                        </p>
                    </td>
                </tr>

                <!-- v1.0.59: Forzar tipos de refs en multi-cliente -->
                <tr>
                    <th>🎯 Forzar refs</th>
                    <td>
                        <p class="description" style="margin:0 0 8px;">
                            Marca qué <strong>tipo de imagen</strong> debe aparecer en TODOS los posts del lote. Solo se usa si el cliente tiene refs de ese tipo subidas en su ficha. Si dejas todo desmarcado, se usa el heurístico automático.
                        </p>
                        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:6px 18px; margin-top:6px;">
                            <label><input type="checkbox" class="nv-mc-forced-type" data-type="persona_destacada"> 👤 CEO / Persona destacada</label>
                            <label><input type="checkbox" class="nv-mc-forced-type" data-type="equipo"> 👥 Equipo / Trabajadores</label>
                            <label><input type="checkbox" class="nv-mc-forced-type" data-type="instalaciones"> 🏢 Local / Clínica</label>
                            <label><input type="checkbox" class="nv-mc-forced-type" data-type="pacientes_usuarios"> 🧑 Paciente / Usuario</label>
                            <label><input type="checkbox" class="nv-mc-forced-type" data-type="productos"> 📦 Producto</label>
                        </div>
                    </td>
                </tr>

                <!-- v1.0.53: Análisis de competencia -->
                <tr>
                    <th>🔍 Competencia</th>
                    <td>
                        <button type="button" class="button" id="nv-mc-analizar-competencia" onclick="nvAnalizarCompetenciaMulti()" style="background:#fef3c7; border-color:#f59e0b;">
                            🔍 Analizar competencia y elegir temas
                        </button>
                        <span id="nv-mc-competencia-status" style="margin-left:10px; font-size:12px; color:#666;"></span>
                        <p class="description" style="margin-top:6px;">
                            La IA analizará los competidores configurados en cada cliente seleccionado (o los buscará en web si no hay)
                            y te propondrá una lista de temas. Selecciona los que te interesen y se usarán como brief para generar las publicaciones.
                            <em>El campo "Tema/brief" se rellenará automáticamente con los temas seleccionados.</em>
                        </p>
                    </td>
                </tr>

            </table>

            <div id="nv-mc-progress" style="margin:14px 0; min-height:24px;"></div>

            <div style="display:flex; gap:8px; justify-content:space-between; padding-top:12px; border-top:1px solid #eee;">
                <button type="button" class="button" id="nv-mc-background" onclick="nvMultiClienteBackground()" style="display:none;">
                    ⏬ Cerrar y trabajar mientras se genera
                </button>
                <div style="display:flex; gap:8px; margin-left:auto;">
                    <button type="button" class="button" onclick="nvCerrarMultiCliente()">Cancelar</button>
                    <button type="button" class="button button-primary nv-button-gold" id="nv-mc-go" onclick="nvLanzarMultiCliente()">
                        🚀 Generar publicaciones
                    </button>
                </div>
            </div>
        </div>
    </div>

</div>

<script>
window.nvCliente = '<?php echo esc_js($cliente_actual); ?>';
window.nvCurrentMonth = '<?php echo date('Y-m'); ?>';
window.nvAvataresUrls = <?php echo wp_json_encode(array_filter(preg_split('/\R/', (string) get_option('nv_dashboard_avatares_urls', '')))); ?>;
window.nvSiteUrl = <?php echo wp_json_encode(home_url('/')); ?>;
window.nvRestBase = <?php echo wp_json_encode(rest_url('nv/v1/')); ?>;
</script>
