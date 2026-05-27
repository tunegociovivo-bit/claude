/**
 * NV Dashboard - JavaScript principal v1.0.1
 * 
 * FIXES v1.0.1:
 * - Cálculo correcto del mes (usa día 15 del mes mostrado, no el primer día visible)
 * - Mensajes de error más claros y útiles
 * - Validación previa antes de disparar webhook (muestra cuántas hay aprobadas)
 */

(function($) {
    'use strict';
    
    // Inicializar al cargar
    $(document).ready(function() {
        if (document.getElementById('nv-calendar')) {
            initCalendar();
        }
        // v1.0.6: cargar stats granulares si están en la página
        if (document.getElementById('nv-granular-stats')) {
            loadGranularStats();
        }
    });
    
    /**
     * Inicializa el calendario FullCalendar
     */
    function initCalendar() {
        const calendarEl = document.getElementById('nv-calendar');
        if (!calendarEl || typeof FullCalendar === 'undefined') {
            console.warn('FullCalendar no disponible');
            return;
        }
        
        const calendar = new FullCalendar.Calendar(calendarEl, {
            initialView: 'dayGridMonth',
            locale: 'es',
            firstDay: 1,
            height: 'auto',
            // v1.0.6: drag & drop reprogramar
            editable: !(window.nvDashboard && window.nvDashboard.canEdit === false),
            eventStartEditable: true,
            eventDurationEditable: false,
            headerToolbar: {
                left: 'prev,next today',
                center: 'title',
                right: 'dayGridMonth,listMonth'
            },
            buttonText: {
                today: 'Hoy',
                month: 'Mes',
                list: 'Lista'
            },
            events: function(fetchInfo, successCallback, failureCallback) {
                loadEvents(fetchInfo.startStr, fetchInfo.endStr, successCallback, failureCallback);
            },
            eventClick: function(info) {
                showPreview(info.event.extendedProps);
                info.jsEvent.preventDefault();
            },
            // v1.0.24: click en una fecha vacía → abre modal multi-cliente
            // pre-rellenado con esa fecha y, si hay cliente filtrado, marcando
            // solo ese cliente.
            dateClick: function(info) {
                if (typeof window.nvAbrirMultiClienteParaFecha === 'function') {
                    window.nvAbrirMultiClienteParaFecha(info.dateStr);
                }
            },
            // v1.0.6: handler drag & drop
            eventDrop: function(info) {
                handleEventDrop(info);
            },
            eventDidMount: function(info) {
                const props = info.event.extendedProps;
                if (props.tipo) {
                    info.el.classList.add('fc-event-' + props.tipo);
                }
                if (props.aprobado) {
                    info.el.classList.add('fc-event-approved');
                }
                if (props.estado === 'programado' || props.estado === 'publicado') {
                    info.el.classList.add('fc-event-scheduled');
                }

                // v1.0.45: punto rojo pulsante para publicaciones sin imagen.
                // Inyección directa al DOM para evitar problemas de especificidad CSS.
                if (props.has_featured_image === false) {
                    info.el.classList.add('nv-event-no-image');
                    // Insertar el badge sin destruir el contenido existente
                    if (!info.el.querySelector('.nv-no-image-badge')) {
                        const badge = document.createElement('span');
                        badge.className = 'nv-no-image-badge';
                        badge.title = 'Falta imagen — pulsa para terminar la publicación';
                        badge.textContent = '⚠';
                        info.el.appendChild(badge);
                    }
                }

                // v1.0.14: Botón de aprobación rápida en cada evento
                // Solo se inserta si el usuario puede editar
                const canEdit = !(window.nvDashboard && window.nvDashboard.canEdit === false);
                if (canEdit && props.id) {
                    addApproveButtonToEvent(info, props);
                }
            },
            datesSet: function(info) {
                // Cuando cambia el mes visible, actualiza el label del approve bar
                updateMonthLabel();
            }
        });
        
        calendar.render();
        window.nvCalendarInstance = calendar;
        updateApprovedCount();
        updateMonthLabel();
    }
    
    /**
     * Calcula el mes correcto (YYYY-MM) del mes mostrado en el calendario
     * FIX v1.0.1: usar día 15 del mes en lugar de currentStart 
     * (currentStart puede ser un día del mes anterior si la semana empieza domingo/lunes)
     */
    function getCurrentDisplayedMonth() {
        if (!window.nvCalendarInstance) {
            return new Date().toISOString().substring(0, 7);
        }
        // currentStart suele ser el inicio de la 1ª semana visible (puede ser mes anterior)
        // Sumamos 15 días para asegurarnos de estar en el mes mostrado
        const start = window.nvCalendarInstance.view.currentStart;
        const middle = new Date(start.getTime() + 15 * 24 * 60 * 60 * 1000);
        const yyyy = middle.getFullYear();
        const mm = String(middle.getMonth() + 1).padStart(2, '0');
        return `${yyyy}-${mm}`;
    }
    
    /**
     * Actualiza el label de mes en el approve bar
     */
    function updateMonthLabel() {
        const el = document.getElementById('nv-mes-label');
        if (!el) return;
        const mes = getCurrentDisplayedMonth();
        const [yyyy, mm] = mes.split('-');
        const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
        el.textContent = meses[parseInt(mm)-1] + ' ' + yyyy;
    }
    
    /**
     * Carga eventos desde la API
     */
    function loadEvents(from, to, successCallback, failureCallback) {
        const params = new URLSearchParams({
            from: from.split('T')[0],
            to: to.split('T')[0],
        });
        
        if (window.nvCliente && window.nvCliente !== 'all') {
            params.append('cliente', window.nvCliente);
        }
        
        fetch(nvDashboard.restUrl + 'publicaciones?' + params.toString(), {
            headers: { 'X-WP-Nonce': nvDashboard.restNonce }
        })
        .then(r => r.json())
        .then(data => {
            const events = data.map(p => ({
                id: p.id,
                title: getTipoIcon(p.tipo) + ' ' + p.titulo,
                start: p.fecha,
                allDay: false,
                extendedProps: p,
                // v1.0.44: marcar en amarillo las que no tienen contenido visual
                classNames: !p.has_featured_image ? ['nv-event-no-image'] : [],
            }));
            successCallback(events);
            
            window.nvCurrentMonthData = data;
            updateApprovedCount();
        })
        .catch(err => {
            console.error('Error cargando publicaciones:', err);
            failureCallback(err);
        });
    }
    
    /**
     * Iconos por tipo
     */
    function getTipoIcon(tipo) {
        return {
            'reel': '🎬',
            'imagen': '📷',
            'carrusel': '🎴',
            'story': '📱'
        }[tipo] || '📝';
    }
    
    /**
     * Actualizar contador de aprobadas
     * FIX v1.0.1: filtra por mes mostrado, no por todo el rango cargado
     */
    function updateApprovedCount() {
        if (!window.nvCurrentMonthData) return;
        
        const mesActual = getCurrentDisplayedMonth();
        
        // Filtrar publicaciones del mes mostrado
        const publicacionesDelMes = window.nvCurrentMonthData.filter(p => {
            if (!p.fecha) return false;
            return p.fecha.substring(0, 7) === mesActual;
        });
        
        const approved = publicacionesDelMes.filter(p => p.aprobado).length;
        const total = publicacionesDelMes.length;
        
        const elApproved = document.getElementById('nv-approved-count');
        if (elApproved) elApproved.textContent = approved;
        
        const elTotal = document.getElementById('nv-total-count');
        if (elTotal) elTotal.textContent = total;
        
        const btn = document.getElementById('nv-approve-month-btn');
        if (btn) {
            btn.disabled = approved === 0;
            if (approved === 0) {
                btn.style.opacity = '0.5';
                btn.style.cursor = 'not-allowed';
            } else {
                btn.style.opacity = '1';
                btn.style.cursor = 'pointer';
            }
        }
    }
    
    /**
     * Mostrar preview de publicación
     */
    window.showPreview = function(props) {
        const modal = document.getElementById('nv-preview-modal');
        const body = document.getElementById('nv-preview-body');
        
        // v1.0.13 FIX: detectar imagen vs video por la EXTENSIÓN REAL del archivo,
        // no por el tipo de publicación. Si la URL acaba en .jpg/.png/.webp es <img>.
        // Si acaba en .mp4/.webm/.mov es <video>. Esto soluciona el caso de los
        // reels/videos cuyo asset es un storyboard frame en JPG.
        const url = props.asset_url || '';
        const urlClean = url.toLowerCase().split('?')[0].split('#')[0];
        const ext = urlClean.split('.').pop();
        const isVideoFile = ['mp4', 'webm', 'mov', 'm4v', 'ogv'].includes(ext);
        const isImageFile = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'].includes(ext);
        const isReelOrVideo = props.tipo === 'reel' || props.tipo === 'video';
        
        let assetHtml = '';
        if (url) {
            if (isVideoFile) {
                assetHtml = `<video src="${url}" controls style="width:100%; height:auto; object-fit:cover; max-height:600px; border-radius:8px;"></video>`;
            } else if (isImageFile) {
                // Si la publicación es reel/video pero el asset es imagen → es un storyboard frame
                const badge = isReelOrVideo
                    ? `<div style="background:#fff7e0; border-left:3px solid #D2A039; padding:8px 12px; margin-bottom:8px; border-radius:4px; font-size:12px; color:#8a6d1f;">
                        📸 <strong>Storyboard frame</strong> · Esta imagen es la referencia visual del ${props.tipo}.
                        Edita el ${props.tipo} real en CapCut/Premiere usando esta como guía.
                       </div>`
                    : '';
                assetHtml = `${badge}<img src="${url}" alt="${escapeHtml(props.titulo || '')}" style="width:100%; height:auto; border-radius:8px;" />`;
            } else {
                // Tipo desconocido — mostrar link
                assetHtml = `<p style="color:#888;">Asset disponible: <a href="${url}" target="_blank" rel="noopener">abrir archivo</a></p>`;
            }
        }
        
        const redesHtml = (props.redes || []).map(r => {
            const colors = {
                'instagram': 'background:#FBEAF0;color:#72243E',
                'facebook': 'background:#E6F1FB;color:#0C447C',
                'linkedin': 'background:#E1F5EE;color:#085041',
                'tiktok': 'background:#0A0A0A;color:#fff'
            };
            return `<span style="${colors[r] || ''}; padding:4px 10px; border-radius:4px; font-size:12px; margin-right:4px">${r}</span>`;
        }).join('');
        
        body.innerHTML = `
            <h2 style="margin-top:0">${props.titulo}</h2>
            <p style="color:#666; font-size:13px">
                ${getTipoIcon(props.tipo)} ${props.tipo.toUpperCase()} · 
                ${new Date(props.fecha).toLocaleString('es-ES')} · 
                ${props.cliente_nombre || ''}
            </p>
            <div class="nv-preview-grid">
                <div class="nv-preview-asset">${assetHtml || '<p style="color:#888">Sin asset</p>'}</div>
                <div class="nv-preview-meta">
                    <p><strong>Redes:</strong></p>
                    <p>${redesHtml || '<em>ninguna</em>'}</p>
                    
                    <p style="margin-top:16px"><strong>Copy:</strong></p>
                    <div class="nv-preview-copy">${escapeHtml(props.copy || '')}</div>
                    
                    ${props.hashtags ? `
                        <p style="margin-top:12px"><strong>Hashtags:</strong></p>
                        <p style="color:#0C447C; font-size:13px">${escapeHtml(props.hashtags)}</p>
                    ` : ''}
                    
                    <p style="margin-top:16px">
                        <a href="${props.edit_url}" class="button button-primary">Editar publicación</a>
                        ${url && isImageFile && props.id ? `
                            <button type="button" class="button" id="nv-reaplicar-overlay-btn" data-pid="${props.id}" style="margin-left:6px; background:#fef3c7; border-color:#f59e0b;" title="Re-aplica el texto sobre la imagen actual usando los colores brand actuales del cliente. NO regenera la imagen (no gasta API).">🔄 Re-aplicar texto</button>
                            <button type="button" class="button" id="nv-adaptar-formato-btn" data-pid="${props.id}" data-tipo="${props.tipo || ''}" style="margin-left:6px; background:#dbeafe; border-color:#2563eb;" title="Regenera la imagen con IA en otro formato (reel, story, cuadrado, etc.).">📐 Adaptar formato</button>
                            <span id="nv-reaplicar-overlay-status" style="margin-left:8px; font-size:12px; color:#666;"></span>
                            <div id="nv-adaptar-formato-box" style="display:none; margin-top:10px; padding:10px; background:#eff6ff; border:1px solid #bfdbfe; border-radius:4px;">
                                <label style="font-size:13px; font-weight:600; display:block; margin-bottom:6px;">Nuevo formato:</label>
                                <select id="nv-adaptar-formato-tipo" style="min-width:240px;">
                                    <option value="imagen">📷 Imagen feed (4:5)</option>
                                    <option value="reel">🎬 Reel (9:16)</option>
                                    <option value="carrusel">🎴 Carrusel (1:1)</option>
                                    <option value="story">📱 Story (9:16)</option>
                                    <option value="video">🎥 Video (16:9)</option>
                                </select>
                                <label style="font-size:12px; margin-left:12px;">Calidad:
                                    <select id="nv-adaptar-formato-quality" style="margin-left:4px;">
                                        <option value="low">Baja</option>
                                        <option value="medium" selected>Media</option>
                                        <option value="high">Alta</option>
                                    </select>
                                </label>
                                <button type="button" class="button button-primary" id="nv-adaptar-formato-go" style="margin-left:8px;">▶️ Regenerar</button>
                                <span id="nv-adaptar-formato-status" style="margin-left:8px; font-size:12px;"></span>
                                <p style="margin:6px 0 0; font-size:11px; color:#666;">⚠️ Lanza una nueva llamada al modelo de IA (cuesta API). El tipo de publicación se actualizará automáticamente.</p>
                            </div>
                        ` : ''}
                    </p>
                    
                    <p style="font-size:13px; color:#666; margin-top:12px">
                        Estado: <strong>${props.estado}</strong> · 
                        Aprobado: ${props.aprobado ? '✅' : '⏳'}
                    </p>
                </div>
            </div>
        `;

        // v1.0.50: handler del botón "🔄 Re-aplicar texto"
        const reaplicarBtn = document.getElementById('nv-reaplicar-overlay-btn');
        if (reaplicarBtn) {
            reaplicarBtn.addEventListener('click', async () => {
                const pid = reaplicarBtn.dataset.pid;
                const status = document.getElementById('nv-reaplicar-overlay-status');
                if (!window.nvReaplicarOverlayForPost) {
                    if (status) status.innerHTML = '<span style="color:#c00;">⚠️ Recarga la página (helper no cargado)</span>';
                    return;
                }
                reaplicarBtn.disabled = true;
                if (status) status.innerHTML = '⏳ Re-aplicando con colores actuales del cliente…';
                const res = await window.nvReaplicarOverlayForPost(pid);
                reaplicarBtn.disabled = false;
                if (res.ok && res.data && res.data.composited) {
                    const colors = res.data.brand_colors_used || {};
                    if (status) {
                        status.innerHTML = '✅ Texto re-aplicado · colores: '
                            + (colors.primary ? `<span style="display:inline-block; width:12px; height:12px; background:${colors.primary}; border:1px solid #ccc; border-radius:2px; vertical-align:middle;"></span> ${colors.primary} ` : '')
                            + (colors.accent ? `<span style="display:inline-block; width:12px; height:12px; background:${colors.accent}; border:1px solid #ccc; border-radius:2px; vertical-align:middle;"></span> ${colors.accent} ` : '')
                            + (colors.text_on_primary ? `<span style="display:inline-block; width:12px; height:12px; background:${colors.text_on_primary}; border:1px solid #ccc; border-radius:2px; vertical-align:middle;"></span> ${colors.text_on_primary} ` : '')
                            + ` · source=${colors.source || '?'}`;
                    }
                    // Refrescar la imagen del modal con cache-buster
                    const img = body.querySelector('img');
                    if (img && res.data.asset_url) {
                        img.src = res.data.asset_url;
                    }
                    // Refrescar calendario en background
                    if (window.nvCalendarInstance) {
                        setTimeout(() => window.nvCalendarInstance.refetchEvents(), 600);
                    }
                } else if (res.ok && !res.data.composited) {
                    if (status) status.innerHTML = '<span style="color:#c80;">⚠️ No se compuso. ' + (res.data.overlay_warnings || []).join(' · ') + '</span>';
                } else {
                    const err = res.error || {};
                    if (err.type === 'no_pre_overlay_backup') {
                        if (status) status.innerHTML = '<span style="color:#c80;">⚠️ ' + err.message + '</span>';
                    } else {
                        if (status) status.innerHTML = '<span style="color:#c00;">❌ ' + (err.message || 'Error') + '</span>';
                    }
                }
            });
        }

        // v1.0.71: handler del botón "📐 Adaptar formato"
        const adaptarBtn = document.getElementById('nv-adaptar-formato-btn');
        const adaptarBox = document.getElementById('nv-adaptar-formato-box');
        if (adaptarBtn && adaptarBox) {
            // Pre-seleccionar el tipo actual en el desplegable
            const tipoSelect = document.getElementById('nv-adaptar-formato-tipo');
            if (tipoSelect && adaptarBtn.dataset.tipo) {
                tipoSelect.value = adaptarBtn.dataset.tipo;
            }
            adaptarBtn.addEventListener('click', () => {
                adaptarBox.style.display = adaptarBox.style.display === 'none' ? 'block' : 'none';
            });
            const goBtn = document.getElementById('nv-adaptar-formato-go');
            if (goBtn) {
                goBtn.addEventListener('click', async () => {
                    const pid = adaptarBtn.dataset.pid;
                    const tipoTarget = tipoSelect ? tipoSelect.value : '';
                    const qSelect = document.getElementById('nv-adaptar-formato-quality');
                    const quality = qSelect ? qSelect.value : 'medium';
                    const statusEl = document.getElementById('nv-adaptar-formato-status');
                    if (!window.nvAdaptarFormatoForPost) {
                        if (statusEl) statusEl.innerHTML = '<span style="color:#c00;">⚠️ Recarga la página (helper no cargado)</span>';
                        return;
                    }
                    goBtn.disabled = true;
                    if (statusEl) statusEl.innerHTML = '⏳ Generando con IA en el nuevo formato (15-60s)…';
                    const res = await window.nvAdaptarFormatoForPost(pid, { tipo_target: tipoTarget, quality: quality });
                    goBtn.disabled = false;
                    if (res.ok) {
                        if (statusEl) statusEl.innerHTML = '✅ Adaptado a ' + res.data.tipo_final + ' (' + res.data.width + '×' + res.data.height + ')';
                        const img = body.querySelector('img');
                        if (img && res.data.asset_url) img.src = res.data.asset_url;
                        if (window.nvCalendarInstance) {
                            setTimeout(() => window.nvCalendarInstance.refetchEvents(), 600);
                        }
                    } else {
                        const err = res.error || {};
                        if (err.type === 'gateway_timeout') {
                            if (statusEl) statusEl.innerHTML = '<span style="color:#c80;">⏳ ' + err.message + '</span>';
                        } else {
                            if (statusEl) statusEl.innerHTML = '<span style="color:#c00;">❌ ' + (err.message || 'Error') + '</span>';
                        }
                    }
                });
            }
        }

        modal.style.display = 'flex';
    };
    
    window.nvClosePreview = function() {
        document.getElementById('nv-preview-modal').style.display = 'none';
    };
    
    /**
     * Filtrar por cliente
     */
    window.nvFilterCliente = function(slug) {
        window.location.href = '?page=nv-dashboard-editorial&cliente=' + slug;
    };
    
    /**
     * Aprobar mes y disparar webhook
     * FIX v1.0.1: usa getCurrentDisplayedMonth() y mensajes claros
     */
    window.nvApproveMonth = function() {
        if (!window.nvCurrentMonthData) {
            alert('⚠️ Datos del calendario no cargados.\n\nEspera a que cargue el calendario y vuelve a intentarlo.');
            return;
        }
        
        // Mes mostrado actualmente en el calendario
        const mes = getCurrentDisplayedMonth();
        const [yyyy, mm] = mes.split('-');
        const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
        const mesLabel = meses[parseInt(mm)-1] + ' ' + yyyy;
        
        // Filtrar publicaciones DEL MES MOSTRADO Y APROBADAS
        const aprobadasDelMes = window.nvCurrentMonthData.filter(p => {
            if (!p.fecha || !p.aprobado) return false;
            return p.fecha.substring(0, 7) === mes;
        });
        
        if (aprobadasDelMes.length === 0) {
            const totalDelMes = window.nvCurrentMonthData.filter(p => {
                return p.fecha && p.fecha.substring(0, 7) === mes;
            }).length;
            
            const totalAprobadasGlobal = window.nvCurrentMonthData.filter(p => p.aprobado).length;
            
            let mensaje = `⚠️ No hay publicaciones aprobadas para ${mesLabel}.\n\n`;
            
            if (totalDelMes === 0) {
                mensaje += `❌ No hay NINGUNA publicación con fecha en ${mesLabel}.\n\n`;
                mensaje += `→ Solución: ve a "Publicaciones" y verifica las fechas, o cambia el mes en el calendario con las flechas ◀ ▶`;
            } else if (totalAprobadasGlobal === 0) {
                mensaje += `Hay ${totalDelMes} publicaciones en ${mesLabel} pero NINGUNA marcada como aprobada.\n\n`;
                mensaje += `→ Solución: edita cada publicación y activa el checkbox "✅ Aprobar para Metricool"`;
            } else {
                mensaje += `Hay ${totalDelMes} publicaciones en ${mesLabel}.\n`;
                mensaje += `Hay ${totalAprobadasGlobal} aprobadas en otros meses.\n\n`;
                mensaje += `→ Solución: marca como aprobadas las publicaciones de ${mesLabel} concretamente`;
            }
            
            alert(mensaje);
            return;
        }
        
        // Determinar cliente
        const cliente = window.nvCliente !== 'all' ? window.nvCliente : aprobadasDelMes[0].cliente;
        
        if (!cliente) {
            alert('⚠️ Selecciona un cliente específico en el dropdown superior antes de aprobar.');
            return;
        }
        
        // Confirmación
        const cliente_nombre = aprobadasDelMes[0].cliente_nombre || cliente;
        if (!confirm(
            `¿Aprobar y enviar ${aprobadasDelMes.length} publicaciones?\n\n` +
            `📊 Cliente: ${cliente_nombre}\n` +
            `📅 Mes: ${mesLabel}\n` +
            `📝 Publicaciones:\n` +
            aprobadasDelMes.slice(0, 5).map(p => `  • ${p.titulo}`).join('\n') +
            (aprobadasDelMes.length > 5 ? `\n  ... y ${aprobadasDelMes.length - 5} más` : '') +
            `\n\nEsto generará un CSV listo para subir a Metricool y enviará un email a tunegociovivo@gmail.com.`
        )) {
            return;
        }
        
        const btn = document.getElementById('nv-approve-month-btn');
        btn.disabled = true;
        btn.textContent = '⏳ Generando CSV...';
        
        fetch(nvDashboard.restUrl + 'aprobar-mes', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-WP-Nonce': nvDashboard.restNonce
            },
            body: JSON.stringify({ cliente, mes })
        })
        .then(r => r.json().then(data => ({ status: r.status, data })))
        .then(({ status, data }) => {
            if (status >= 200 && status < 300 && data.success) {
                alert(
                    `✅ ¡Listo! ${data.count} publicaciones aprobadas\n\n` +
                    `📥 CSV: ${data.csv_url}\n\n` +
                    (data.webhook_disparado 
                        ? '📧 Webhook disparado a Make.\nEn 5-10 segundos recibirás el email con el CSV adjunto.'
                        : '⚠️ Webhook Make no configurado.\nVe a Configuración y pega la URL del webhook.')
                );
                
                if (window.nvCalendarInstance) {
                    window.nvCalendarInstance.refetchEvents();
                }
            } else {
                let errMsg = '❌ Error al procesar:\n\n';
                errMsg += data.message || data.code || 'Error desconocido';
                if (data.data && data.data.status) {
                    errMsg += `\n(HTTP ${data.data.status})`;
                }
                alert(errMsg);
            }
        })
        .catch(err => {
            alert('❌ Error de red: ' + err.message);
        })
        .finally(() => {
            btn.disabled = false;
            btn.textContent = '✅ Aprobar mes y generar CSV';
        });
    };
    
    /**
     * Helper escapar HTML
     */
    function escapeHtml(s) {
        if (!s) return '';
        return s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
    
    // ======================================================================
    // v1.0.6 — Sprint 1
    // ======================================================================
    
    /**
     * Handler drag & drop: reprograma la publicación a la nueva fecha
     */
    function handleEventDrop(info) {
        const postId = info.event.id;
        const fechaNueva = info.event.start;
        if (!postId || !fechaNueva) {
            info.revert();
            return;
        }
        
        // Mantener la hora original (FullCalendar puede ponerla a 00:00)
        const yyyy = fechaNueva.getFullYear();
        const mm = String(fechaNueva.getMonth() + 1).padStart(2, '0');
        const dd = String(fechaNueva.getDate()).padStart(2, '0');
        const fechaIso = `${yyyy}-${mm}-${dd}`;
        
        fetch(nvDashboard.restUrl + 'reprogramar/' + postId, {
            method: 'POST',
            headers: {
                'X-WP-Nonce': nvDashboard.restNonce,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ nueva_fecha: fechaIso })
        })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                // Mini toast
                showToast(`✅ Reprogramada a ${fechaIso}`);
            } else {
                alert('❌ Error: ' + (data.message || 'desconocido'));
                info.revert();
            }
        })
        .catch(err => {
            alert('❌ Error de red: ' + err.message);
            info.revert();
        });
    }
    
    function showToast(msg) {
        let toast = document.getElementById('nv-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'nv-toast';
            toast.style.cssText = 'position:fixed;bottom:30px;right:30px;background:#1e1e1e;color:#fff;padding:14px 20px;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.3);z-index:99999;font-size:13px;border-left:3px solid #D2A039;transition:opacity 0.3s;';
            document.body.appendChild(toast);
        }
        toast.textContent = msg;
        toast.style.opacity = '1';
        setTimeout(() => { toast.style.opacity = '0'; }, 2500);
    }
    
    /**
     * Carga stats granulares y las pinta como barritas horizontales
     */
    function loadGranularStats() {
        const wrap = document.getElementById('nv-granular-stats');
        if (!wrap) return;
        const cliente = wrap.dataset.cliente || 'all';
        
        const params = new URLSearchParams();
        if (cliente && cliente !== 'all') params.append('cliente', cliente);
        
        fetch(nvDashboard.restUrl + 'stats-granulares?' + params.toString(), {
            headers: { 'X-WP-Nonce': nvDashboard.restNonce }
        })
        .then(r => r.json())
        .then(data => {
            renderGranularBars('nv-granular-redes', data.por_red, redIcon);
            renderGranularBars('nv-granular-tipos', data.por_tipo, tipoIcon);
        })
        .catch(err => {
            const r = document.getElementById('nv-granular-redes');
            if (r) r.innerHTML = '<span style="color:#c00">Error: ' + err.message + '</span>';
        });
    }
    
    function redIcon(red) {
        return ({
            facebook: '📘', instagram: '📷', linkedin: '💼',
            twitter: '🐦', tiktok: '🎵', youtube: '📺',
            google_my_business: '🏪', pinterest: '📌', bluesky: '🦋'
        })[red] || '🌐';
    }
    function tipoIcon(tipo) {
        return ({
            reel: '🎬', imagen: '📷', carrusel: '🎴', story: '📱', video: '🎥'
        })[tipo] || '📄';
    }
    
    function renderGranularBars(containerId, data, iconFn) {
        const c = document.getElementById(containerId);
        if (!c) return;
        const entries = Object.entries(data).filter(([k, v]) => v > 0);
        if (entries.length === 0) {
            c.innerHTML = '<span style="color:#888;font-size:12px;">Sin datos</span>';
            return;
        }
        const max = Math.max(...entries.map(([,v]) => v));
        const html = entries.sort((a,b)=>b[1]-a[1]).map(([k,v]) => {
            const pct = Math.round((v / max) * 100);
            const label = k.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            return `
                <div class="nv-granular-row">
                    <span class="nv-granular-icon">${iconFn(k)}</span>
                    <span class="nv-granular-label">${label}</span>
                    <span class="nv-granular-bar"><span class="nv-granular-fill" style="width:${pct}%"></span></span>
                    <span class="nv-granular-value">${v}</span>
                </div>
            `;
        }).join('');
        c.innerHTML = html;
    }
    
    /**
     * Duplicar mes: muestra prompt y llama endpoint
     */
    window.nvDuplicarMes = function() {
        const cliente = window.nvCliente || 'all';
        if (cliente === 'all') {
            alert('Selecciona un cliente específico antes de duplicar mes (no se puede duplicar para "Todos los clientes").');
            return;
        }
        
        const mesActual = getCurrentDisplayedMonth();
        const mesOrigen = prompt('¿Qué mes quieres duplicar? (formato YYYY-MM)\n\nEjemplo: 2026-05 para duplicar mayo', mesActual);
        if (!mesOrigen || !/^\d{4}-\d{2}$/.test(mesOrigen)) return;
        
        // Sugerir mes siguiente
        const [yyyy, mm] = mesOrigen.split('-').map(Number);
        const nextMm = mm === 12 ? 1 : mm + 1;
        const nextYyyy = mm === 12 ? yyyy + 1 : yyyy;
        const sugerido = `${nextYyyy}-${String(nextMm).padStart(2,'0')}`;
        
        const mesDestino = prompt(`¿A qué mes quieres copiar? (formato YYYY-MM)\n\nSe sugiere: ${sugerido}`, sugerido);
        if (!mesDestino || !/^\d{4}-\d{2}$/.test(mesDestino)) return;
        
        if (mesOrigen === mesDestino) {
            alert('El mes origen y destino son el mismo. Operación cancelada.');
            return;
        }
        
        if (!confirm(`Vas a duplicar todas las publicaciones del cliente "${cliente}" del mes ${mesOrigen} al mes ${mesDestino}.\n\nLas duplicadas mantendrán copy/hashtags/assets pero se crearán como BORRADOR (no aprobadas).\n\n¿Continuar?`)) return;
        
        fetch(nvDashboard.restUrl + 'duplicar-mes', {
            method: 'POST',
            headers: {
                'X-WP-Nonce': nvDashboard.restNonce,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                cliente: cliente,
                mes_origen: mesOrigen,
                mes_destino: mesDestino,
            })
        })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                alert(`✅ ${data.duplicadas} publicaciones duplicadas de ${mesOrigen} a ${mesDestino}.\n\nRecarga el calendario y navega al mes destino para verlas.`);
                if (window.nvCalendarInstance) window.nvCalendarInstance.refetchEvents();
            } else {
                alert('❌ Error: ' + (data.message || 'desconocido'));
            }
        })
        .catch(err => alert('❌ Error de red: ' + err.message));
    };
    
    // ======================================================================
    // v1.0.7 — Generador de mes con Claude (Sprint 2)
    // ======================================================================
    
    window.nvAbrirGenerarMes = function() {
        const cliente = window.nvCliente || 'all';
        if (cliente === 'all') {
            alert('Selecciona un cliente específico antes de generar.');
            return;
        }
        
        // Pre-rellenar mes destino sugerido (siguiente al actual mostrado)
        const mesActual = getCurrentDisplayedMonth();
        const [yyyy, mm] = mesActual.split('-').map(Number);
        const nextMm = mm === 12 ? 1 : mm + 1;
        const nextYyyy = mm === 12 ? yyyy + 1 : yyyy;
        const sugerido = `${nextYyyy}-${String(nextMm).padStart(2,'0')}`;
        const inp = document.getElementById('nv-genmes-mes');
        if (inp && !inp.value) inp.value = sugerido;
        
        document.getElementById('nv-generar-mes-modal').style.display = 'flex';
    };
    
    window.nvCerrarGenerarMes = function() {
        const m = document.getElementById('nv-generar-mes-modal');
        if (m) m.style.display = 'none';
    };
    
    /**
     * v1.0.9: Llama al endpoint /generar-mes-ai en LOTES de 5 publicaciones
     * para evitar timeouts del servidor PHP. Cada lote es una request independiente
     * que cabe en el max_execution_time típico de hostings compartidos (30s).
     *
     * - Genera coherencia entre lotes pasando los títulos ya creados como contexto
     * - Detecta respuestas HTML (típico de timeouts/504) y muestra error claro
     * - Actualiza progreso en tiempo real lote a lote
     */
    window.nvGenerarMesAbrirClaude = async function() {
        const cliente = window.nvCliente || 'all';
        if (cliente === 'all') {
            alert('Selecciona un cliente específico antes.');
            return;
        }
        
        const mes = document.getElementById('nv-genmes-mes').value;
        const cantidad = parseInt(document.getElementById('nv-genmes-cantidad').value || '14', 10);
        const brief = document.getElementById('nv-genmes-brief').value.trim();
        const redes = Array.from(document.querySelectorAll('.nv-genmes-red:checked')).map(c => c.value);
        const mix = {
            imagen: parseInt(document.getElementById('nv-genmes-mix-imagen').value || '0', 10),
            carrusel: parseInt(document.getElementById('nv-genmes-mix-carrusel').value || '0', 10),
            reel: parseInt(document.getElementById('nv-genmes-mix-reel').value || '0', 10),
            story: parseInt(document.getElementById('nv-genmes-mix-story').value || '0', 10),
        };
        
        if (!mes || !/^\d{4}-\d{2}$/.test(mes)) { alert('Mes inválido (formato YYYY-MM)'); return; }
        if (!brief) { alert('Escribe un brief para que Claude tenga contexto'); return; }
        if (redes.length === 0) { alert('Selecciona al menos una red'); return; }
        if (cantidad < 1 || cantidad > 60) { alert('Cantidad fuera de rango (1-60)'); return; }

        // v1.0.37: opciones de generación de imagen
        const generarImagenes = document.getElementById('nv-genmes-generar-imagenes')?.checked ?? true;
        const imageQuality = document.getElementById('nv-genmes-quality')?.value || 'medium';

        // v1.0.53: fidelidad refs (override puntual)
        const fidelityUseDefaultMes = document.getElementById('nv-genmes-fidelity-use-default')?.checked ?? true;
        const fidelityValueMes = parseInt(document.getElementById('nv-genmes-fidelity')?.value || '50', 10);
        const refsFidelityOverrideMes = fidelityUseDefaultMes ? null : fidelityValueMes;

        // v1.0.59: percent_targets desde sliders por tipo
        const percentTargets = {};
        document.querySelectorAll('#nv-genmes-percent-targets .nv-pct-slider').forEach(function(s) {
            const t = s.getAttribute('data-type');
            const v = parseInt(s.value || '0', 10);
            if (t && v > 0) percentTargets[t] = v;
        });

        // v1.0.64: longitud objetivo del copy (0-100, slider del modal). Default 50 = medio.
        const copyLengthSliderEl = document.getElementById('nv-genmes-copy-length');
        const copyLengthValue = copyLengthSliderEl ? parseInt(copyLengthSliderEl.value || '50', 10) : 50;

        // v1.0.66: toggles de elementos visuales sobreimpresos en la imagen.
        // Defaults: logo+titular ON, dato+CTA OFF (imagen limpia editorial por defecto).
        const overlayOpts = {
            add_logo: true,
            add_text: true,
            add_data: false,
            add_cta:  false,
        };
        document.querySelectorAll('.nv-genmes-img-opt').forEach(function(cb){
            const opt = cb.getAttribute('data-opt');
            if (opt && overlayOpts.hasOwnProperty(opt)) overlayOpts[opt] = !!cb.checked;
        });
        
        // Configuración de chunking
        const CHUNK_SIZE = 5;
        const total_chunks = Math.ceil(cantidad / CHUNK_SIZE);
        
        // Bloquear botones y mostrar loading
        const $modal = document.getElementById('nv-generar-mes-modal');
        const $btn = $modal.querySelector('button.button-primary');
        const $cancel = $modal.querySelector('button.button:not(.button-primary)');
        const labelOriginal = $btn.textContent;
        $btn.disabled = true;
        if ($cancel) $cancel.disabled = true;
        $btn.textContent = '⏳ Generando…';
        // v1.0.39: mostrar botón "Cerrar y trabajar"
        if (window.nvShowBackgroundButton) window.nvShowBackgroundButton('mes', true);
        
        // Crear/mostrar barra de progreso
        let $progress = document.getElementById('nv-genmes-progress');
        if (!$progress) {
            $progress = document.createElement('div');
            $progress.id = 'nv-genmes-progress';
            $progress.style.cssText = 'margin-top:14px; padding: 14px; background: #1e1e1e; color: #fff; border-radius: 6px; font-size: 13px;';
            $btn.parentNode.appendChild($progress);
        }
        
        // Inyectar keyframes spinner si no existen
        if (!document.getElementById('nv-spinner-style')) {
            const s = document.createElement('style');
            s.id = 'nv-spinner-style';
            s.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
            document.head.appendChild(s);
        }
        
        const startTime = Date.now();
        let yaGeneradas = [];   // títulos para coherencia entre lotes
        let totalCreadas = 0;
        let totalCosteUsd = 0;
        let totalTokensIn = 0;
        let totalTokensOut = 0;
        let modeloUsado = '';
        let chunksOk = 0;
        let chunksFallidos = 0;
        let ultimoError = null;
        const idsCreados = []; // v1.0.37: IDs para Fase 2 imagen
        
        const renderProgress = (chunkActual, mensajeExtra) => {
            const secs = Math.floor((Date.now() - startTime) / 1000);
            $progress.innerHTML = `
                <div style="display:flex; align-items:center; gap:10px;">
                    <div style="width:18px; height:18px; border:2px solid #D2A039; border-top-color:transparent; border-radius:50%; animation: spin 0.8s linear infinite;"></div>
                    <div style="flex:1;">
                        <strong>Lote ${chunkActual}/${total_chunks} · ${totalCreadas} de ${cantidad} publicaciones creadas</strong><br>
                        <small style="color:#aaa;">Tiempo: ${secs}s · ${mensajeExtra || 'Llamando a Claude…'}</small>
                    </div>
                </div>
                <div style="margin-top:10px; height:6px; background:#333; border-radius:3px; overflow:hidden;">
                    <div style="height:100%; width:${(totalCreadas / cantidad * 100).toFixed(0)}%; background:linear-gradient(90deg,#D2A039,#b8862a); transition:width 0.3s;"></div>
                </div>`;
        };
        
        // Helper: parsea respuesta detectando HTML (típico timeout 502/504)
        const safeParseResponse = async (response) => {
            const ct = (response.headers.get('content-type') || '').toLowerCase();
            const text = await response.text();
            
            // Si content-type no es JSON o el body empieza con < o <!DOCTYPE
            if (!ct.includes('json') || /^\s*<(!DOCTYPE|html|body|head)/i.test(text)) {
                // Probable timeout del servidor o página de error del hosting
                throw new Error(
                    `El servidor respondió con HTML en lugar de JSON (HTTP ${response.status}). ` +
                    `Probablemente la request superó el max_execution_time del hosting. ` +
                    `Cambia a Haiku 4.5 en Configuración (3x más rápido) o pide al hosting subir max_execution_time a 120s.`
                );
            }
            
            try {
                return JSON.parse(text);
            } catch (e) {
                throw new Error('JSON inválido del servidor: ' + text.substring(0, 150));
            }
        };
        
        // Bucle secuencial de chunks
        for (let chunk_index = 0; chunk_index < total_chunks; chunk_index++) {
            renderProgress(chunk_index + 1, 'Llamando a Claude…');
            
            try {
                const response = await fetch(nvDashboard.restUrl + 'generar-mes-ai', {
                    method: 'POST',
                    headers: {
                        'X-WP-Nonce': nvDashboard.restNonce,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                    },
                    body: JSON.stringify({
                        cliente: cliente,
                        mes: mes,
                        cantidad: cantidad,
                        redes: redes,
                        mix: mix,
                        brief: brief,
                        chunk_size: CHUNK_SIZE,
                        chunk_index: chunk_index,
                        total_chunks: total_chunks,
                        ya_generadas: yaGeneradas,
                        // v1.0.59: opciones de imagen
                        generar_imagenes: generarImagenes,
                        image_quality: imageQuality,
                        refs_fidelity: refsFidelityOverrideMes,
                        percent_targets: percentTargets,
                        // v1.0.64: longitud del copy (0-100)
                        copy_length: copyLengthValue,
                        // v1.0.66: qué elementos visuales sobreimpresos llevar en la imagen
                        overlay_opts: overlayOpts,
                    })
                });
                
                const data = await safeParseResponse(response);
                
                if (!response.ok || data.code) {
                    chunksFallidos++;
                    ultimoError = data.message || data.code || `HTTP ${response.status}`;
                    // Continuar con siguiente lote en lugar de abortar (puede recuperarse)
                    renderProgress(chunk_index + 1, `⚠️ Lote ${chunk_index + 1} falló: ${ultimoError}. Continuando…`);
                    await new Promise(r => setTimeout(r, 1500));
                    continue;
                }
                
                // Éxito de este chunk
                chunksOk++;
                totalCreadas += data.creadas || 0;
                if (data.publicaciones && Array.isArray(data.publicaciones)) {
                    data.publicaciones.forEach(p => {
                        if (p.titulo) yaGeneradas.push(p.titulo);
                        if (p.id) idsCreados.push(p.id); // v1.0.37
                    });
                }
                if (data.tokens) {
                    totalTokensIn += data.tokens.input || 0;
                    totalTokensOut += data.tokens.output || 0;
                    totalCosteUsd += data.tokens.coste_estimado_usd || 0;
                }
                if (data.modelo) modeloUsado = data.modelo;
                
                renderProgress(chunk_index + 1, `Lote ${chunk_index + 1} OK (${data.duracion_seg}s)`);
                
            } catch (err) {
                chunksFallidos++;
                ultimoError = err.message;
                renderProgress(chunk_index + 1, `❌ Lote ${chunk_index + 1}: ${err.message.substring(0, 100)}`);
                // Pequeña pausa antes de reintentar siguiente lote
                await new Promise(r => setTimeout(r, 2000));
            }
        }
        
        // ─── FASE 2 (v1.0.37): generar imágenes en paralelo, 3 a la vez ───
        let imgsOk = 0, imgsFail = 0;
        const imgErrors = [];
        const imgUrlsByPostId = {};

        if (generarImagenes && idsCreados.length > 0) {
            const eta2 = Math.ceil(idsCreados.length / 3) * (imageQuality === 'low' ? 12 : (imageQuality === 'high' ? 75 : 35));
            $progress.innerHTML = `
                <div style="display:flex; align-items:center; gap:10px;">
                    <div style="width:18px; height:18px; border:2px solid #D2A039; border-top-color:transparent; border-radius:50%; animation: spin 0.8s linear infinite;"></div>
                    <div style="flex:1;">
                        <strong>Fase 2/2 · Generando imágenes (${idsCreados.length} posts, 3 en paralelo)</strong><br>
                        <small style="color:#aaa;">Calidad ${imageQuality} · ETA: ~${eta2}s</small>
                    </div>
                </div>
                <div id="nv-genmes-img-progress" style="margin-top:10px; height:6px; background:#333; border-radius:3px; overflow:hidden;">
                    <div id="nv-genmes-img-bar" style="height:100%; width:0%; background:linear-gradient(90deg,#D2A039,#b8862a); transition:width 0.3s;"></div>
                </div>
                <div id="nv-genmes-img-status" style="margin-top:8px; font-size:12px; color:#aaa;">0 / ${idsCreados.length}</div>`;

            const queue = idsCreados.slice();
            let done = 0;

            const updateImgProgress = () => {
                const pct = Math.round((done / idsCreados.length) * 100);
                const bar = document.getElementById('nv-genmes-img-bar');
                const st = document.getElementById('nv-genmes-img-status');
                if (bar) bar.style.width = pct + '%';
                if (st) st.textContent = `${done} / ${idsCreados.length} · ✓ ${imgsOk} OK · ${imgsFail > 0 ? '⚠️ ' + imgsFail + ' fallidas' : ''}`;
            };

            const imgWorker = async () => {
                while (queue.length > 0) {
                    const pid = queue.shift();
                    if (!pid) return;
                    // v1.0.40: usar helper con retry automático + parseo inteligente
                    const result = window.nvGenerateImageForPost
                        ? await window.nvGenerateImageForPost(pid, {
                            quality: imageQuality,
                            ...(refsFidelityOverrideMes !== null ? { refs_fidelity: refsFidelityOverrideMes } : {}),
                        })
                        : { ok: false, error: { type: 'no_helper', message: 'Helper no disponible (recarga la página)' } };
                    if (result.ok) {
                        imgsOk++;
                        if (result.data && result.data.image_url) imgUrlsByPostId[pid] = result.data.image_url;
                    } else {
                        imgErrors.push({ id: pid, error: result.error.message, type: result.error.type });
                        imgsFail++;
                    }
                    done++;
                    updateImgProgress();
                }
            };

            const workers = [];
            for (let i = 0; i < Math.min(3, idsCreados.length); i++) workers.push(imgWorker());
            await Promise.all(workers);
        }

        // Final: restaurar UI
        $btn.disabled = false;
        if ($cancel) $cancel.disabled = false;
        $btn.textContent = labelOriginal;
        // v1.0.39: ocultar botón "Cerrar y trabajar"
        if (window.nvShowBackgroundButton) window.nvShowBackgroundButton('mes', false);
        
        const totalSecs = Math.floor((Date.now() - startTime) / 1000);
        const costeStr = totalCosteUsd > 0 ? '$' + totalCosteUsd.toFixed(4) : 'n/a';
        
        if (totalCreadas === 0) {
            // Todo falló
            $progress.innerHTML = `
                <div style="color:#ff6b6b;">
                    <strong>❌ No se creó ninguna publicación</strong><br>
                    <small style="color:#aaa; display:block; margin-top:6px;">${ultimoError || 'Error desconocido'}</small>
                </div>`;
            return;
        }
        
        // Hubo creación parcial o total
        const colorTitulo = chunksFallidos > 0 ? '#ffa657' : '#5dd180';
        const imgSummary = generarImagenes
            ? `<br><small style="color:${imgsFail > 0 ? '#ffa657' : '#5dd180'};">🎨 Imágenes: ${imgsOk} OK${imgsFail > 0 ? ` · ⚠️ ${imgsFail} fallidas` : ''}</small>`
            : '';
        $progress.innerHTML = `
            <div style="color:${colorTitulo};">
                <strong>${chunksFallidos > 0 ? '⚠️' : '✅'} ${totalCreadas} de ${cantidad} publicaciones creadas en ${totalSecs}s</strong>
                ${imgSummary}
                ${chunksFallidos > 0 ? `<br><small style="color:#ffa657;">⚠️ ${chunksFallidos}/${total_chunks} lotes fallaron: ${ultimoError || ''}</small>` : ''}
            </div>
            <div style="margin-top:8px; color:#888; font-size:11px;">
                Modelo: ${modeloUsado || '?'} · Tokens: ${totalTokensIn} in / ${totalTokensOut} out · Coste total: ${costeStr} USD
            </div>
            ${imgErrors.length > 0 ? `<details style="margin-top:8px; color:#ffa657;"><summary style="cursor:pointer; font-size:11px;">Ver errores de imágenes (${imgErrors.length})</summary><ul style="margin:4px 0 0 18px; font-size:11px; color:#ccc;">${imgErrors.slice(0, 10).map(e => `<li>Post ${e.id}: ${(e.error || '').substr(0, 200)}</li>`).join('')}${imgErrors.length > 10 ? `<li>… y ${imgErrors.length - 10} más</li>` : ''}</ul></details>` : ''}
            <div style="margin-top:12px; display:flex; gap:8px;">
                <button class="button button-primary" onclick="nvCerrarGenerarMes(); if(window.nvCalendarInstance) { window.nvCalendarInstance.refetchEvents(); window.nvCalendarInstance.gotoDate('${mes}-15'); }">
                    Ver en calendario →
                </button>
                ${chunksFallidos > 0 ? `<button class="button" onclick="nvGenerarMesAbrirClaude()">Reintentar lotes fallidos</button>` : ''}
            </div>`;
    };
    
    // ======================================================================
    // v1.0.12 — Generación de imágenes vía conversación principal Claude
    // ======================================================================
    
    /**
     * URL de la conversación principal de Claude donde David tiene todo el
     * contexto de desarrollo del plugin y los aprendizajes históricos sobre
     * generación visual (qué prompts funcionan, qué imágenes se aprobaron, etc.)
     */
    const NV_CHAT_URL = 'https://claude.ai/chat/abfcb377-9c55-4143-8ebd-69727a3f3cad';
    
    /**
     * Construye un prompt detallado con todas las publicaciones sin asset y
     * lo muestra en un modal con botones de COPIAR + ABRIR conversación.
     *
     * Flujo:
     *   1. Pulsa botón → se llama al endpoint /publicaciones-sin-asset
     *   2. Modal muestra el prompt completo en textarea
     *   3. Usuario pulsa "Copiar prompt"
     *   4. Usuario pulsa "Abrir conversación principal" → se abre esta misma
     *      conversación en pestaña nueva
     *   5. Usuario pega (Ctrl+V) y envía
     *   6. Claude (con contexto histórico completo) genera y sube las imágenes
     *      usando el endpoint /subir-imagen-post/{id}
     */
    window.nvGenerarImagenesConClaude = async function() {
        const cliente = window.nvCliente || 'all';
        const mes = (typeof getCurrentDisplayedMonth === 'function')
            ? getCurrentDisplayedMonth()
            : window.nvCurrentMonth;
        
        if (cliente === 'all') {
            alert('Selecciona un cliente específico antes de generar imágenes.');
            return;
        }
        
        // Pedir lista de publicaciones sin asset
        const params = new URLSearchParams({ cliente: cliente, mes: mes });
        let data;
        try {
            const r = await fetch(nvDashboard.restUrl + 'publicaciones-sin-asset?' + params.toString(), {
                headers: { 'X-WP-Nonce': nvDashboard.restNonce }
            });
            data = await r.json();
        } catch (err) {
            alert('Error consultando publicaciones: ' + err.message);
            return;
        }
        
        if (!data || !data.publicaciones || data.publicaciones.length === 0) {
            alert(`No hay publicaciones sin asset en ${mes} para "${cliente}".\n\nO bien todas tienen ya imagen, o no hay publicaciones en ese mes.`);
            return;
        }
        
        const pubs = data.publicaciones;
        const siteUrl = (window.nvSiteUrl || '').replace(/\/$/, '');
        const restBase = window.nvRestBase || nvDashboard.restUrl;

        // v1.0.15: Pedir configuración del cliente (modelo de imagen + OpenAI key si procede)
        // v1.0.16: detectar HTTP errors (no solo errores de red) y mostrar warning visible
        let cfg;
        let cfgError = null;
        try {
            const r = await fetch(nvDashboard.restUrl + 'cliente-config/' + encodeURIComponent(cliente), {
                headers: { 'X-WP-Nonce': nvDashboard.restNonce }
            });
            if (!r.ok) {
                cfgError = `HTTP ${r.status} en /cliente-config/${cliente} — ¿plugin v1.0.16+ instalado?`;
                cfg = { modelo: 'seedream-v4-5-edit', openai_required: false, openai_key: '' };
            } else {
                cfg = await r.json();
                // Detectar respuestas REST de error que devuelven 200 pero con `code`
                if (cfg && cfg.code && cfg.message) {
                    cfgError = 'Error REST: ' + cfg.message;
                    cfg = { modelo: 'seedream-v4-5-edit', openai_required: false, openai_key: '' };
                }
            }
        } catch (err) {
            cfgError = 'Error de red al leer cliente-config: ' + err.message;
            cfg = { modelo: 'seedream-v4-5-edit', openai_required: false, openai_key: '' };
        }

        if (cfgError) {
            // Aviso visible al usuario antes de continuar — para no dar error silencioso
            const cont = confirm(
                '⚠️ No pude leer la configuración de modelo de imagen para "' + cliente + '".\n\n' +
                cfgError + '\n\n' +
                'Voy a usar Seedream V4.5 Edit como fallback. ¿Continuar?\n\n' +
                '(Cancelar = abortar para que revises la instalación del plugin)'
            );
            if (!cont) return;
        }

        // Si el cliente requiere OpenAI key y no hay, avisar al usuario
        if (cfg.openai_required && !cfg.openai_key) {
            const goSettings = confirm(
                'Este cliente está configurado para usar GPT-Image-2 (OpenAI directo), pero no hay API key de OpenAI guardada.\n\n' +
                '¿Quieres ir a Configuración para añadirla ahora?'
            );
            if (goSettings) {
                window.location.href = nvDashboard.adminUrl + 'admin.php?page=nv-dashboard-settings';
            }
            return;
        }

        // Construir prompt asumiendo que llega a TU conversación con
        // todo el contexto previo (avatares en /home/claude/static_refs_fresh.json,
        // app password actualizada en memoria, aprendizajes históricos, etc.)
        const lines = [];
        lines.push('🎨 GENERACIÓN VISUAL DESDE NV DASHBOARD PLUGIN');
        lines.push('');
        lines.push('Hola Claude. He pulsado el botón "Generar imágenes con Claude" del plugin.');
        lines.push(`Necesito que generes y subas las imágenes de ${pubs.length} publicaciones del mes ${mes} para el cliente "${pubs[0].cliente_nombre}" (slug: ${cliente}).`);
        lines.push('');

        // v1.0.15: Bloque de modelo configurado
        lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        lines.push('🤖 MODELO DE IMAGEN CONFIGURADO PARA ESTE CLIENTE');
        lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        lines.push('');
        const mInfo = cfg.modelo_info || {};
        lines.push(`Modelo:    ${cfg.modelo}${mInfo.label ? ' (' + mInfo.label + ')' : ''}`);
        if (mInfo.provider) lines.push(`Provider:  ${mInfo.provider}`);
        if (mInfo.endpoint) lines.push(`Endpoint:  ${mInfo.endpoint}`);
        if (mInfo.auth) lines.push(`Auth:      ${mInfo.auth}`);
        if (cfg.override_per_cliente) {
            lines.push(`(Este cliente tiene override; el default global es ${cfg.modelo_default_global || 'seedream-v4-5-edit'})`);
        }
        if (cfg.openai_required) {
            const apiToken = (nvDashboard && nvDashboard.apiToken) ? nvDashboard.apiToken : '{NV_API_TOKEN_NO_DISPONIBLE}';
            const siteRoot = (nvDashboard && nvDashboard.siteUrl) ? nvDashboard.siteUrl.replace(/\/$/, '') : (window.location.origin || '');
            lines.push('');
            lines.push('🔒 LA OPENAI KEY NO ESTÁ EN ESTE PROMPT POR SEGURIDAD.');
            lines.push('');
            lines.push('Para llamar a OpenAI, USA EL PROXY del plugin (gestiona la key server-side):');
            lines.push('');
            lines.push('   POST ' + siteRoot + '/wp-json/nv/v1/openai-image-proxy/{POST_ID}');
            lines.push('   Authorization: Bearer ' + apiToken);
            lines.push('   Content-Type: application/json');
            lines.push('   Body JSON:');
            lines.push('     {');
            lines.push('       "operation": "edit",                ← "edit" si retocas foto real | "generate" desde cero');
            lines.push('       "prompt": "...",                    ← descripción de los cambios o de la escena');
            lines.push('       "size": "1024x1536",                ← 4:5 vertical | "1024x1024" cuadrado | "1536x1024" horizontal');
            lines.push('       "quality": "high",                  ← "low" $0.006 / "medium" $0.053 / "high" $0.211');
            lines.push('       "n": 1,');
            lines.push('       "image_urls": ["https://..."],     ← solo si operation=edit; URLs de las refs Drive ya hosteadas');
            lines.push('       "upload_to_post": true              ← true = sube a Media Library + asocia featured + nv_asset_url');
            lines.push('     }');
            lines.push('');
            lines.push('   Devuelve: { success, images: [{ b64_json, attachment_id, asset_url }] }');
            lines.push('   (Si upload_to_post=true ya queda asociada al post — no hace falta /actualizar-publicacion)');
            lines.push('');
            lines.push('   Este Bearer también vale para los demás /wp-json/nv/v1/* (subir-imagen-post,');
            lines.push('   actualizar-publicacion, registrar-revision, etc.).');
        }
        lines.push('');

        // v1.0.19: Bloque scope — clarifica marketing legítimo, no deepfake
        lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        lines.push('📜 CONTEXTO Y SCOPE DEL TRABAJO');
        lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        lines.push('');
        lines.push('David Díaz Ríos es CEO de Negocio Vivo, agencia de marketing digital');
        lines.push('contratada por el cliente. Las personas que aparezcan en las refs son');
        lines.push('CEOs/equipos del cliente, posando voluntariamente para material de feed.');
        lines.push('Hay consentimiento expreso documentado y relación contractual vigente.');
        lines.push('');
        lines.push('FLUJO POR DEFECTO = EDICIÓN, NO SÍNTESIS:');
        lines.push('  - Toma UNA foto real de Drive como base de la composición.');
        lines.push('  - Aplica edits sobre ella (color, encuadre, recorte, fondo, overlay');
        lines.push('    de copy/marca, iluminación). SIN regenerar el rostro.');
        lines.push('  - operation="edit" en el proxy con esa foto en image_urls.');
        lines.push('');
        lines.push('Solo usa operation="generate" para escenas SIN persona identificable');
        lines.push('(detalles de manos, instalaciones, productos). Esto evita ambigüedad ética.');
        lines.push('');

        // v1.0.21: Bloque refs Drive con tres ramas según drive_mode
        if (cfg.refs_drive) {
            const refs = cfg.refs_drive;
            const driveMode = refs.drive_mode || 'pending';

            if (driveMode === 'no_drive_refs') {
                lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                lines.push('📁 REFS VISUALES — NO APLICA PARA ESTE CLIENTE');
                lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                lines.push('');
                lines.push('David ha marcado este cliente como "no usa Drive refs".');
                lines.push('Genera todas las imágenes con operation="generate" (sin foto base),');
                lines.push('basándote en la sugerencia visual de cada publicación.');
                lines.push('NO pares a preguntar por refs — esta decisión está tomada.');
                lines.push('');
            } else if (driveMode === 'configured' && refs.cliente_folder && refs.cliente_folder.root_id) {
                const cf = refs.cliente_folder;
                lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                lines.push('🚨 REFS VISUALES — REGLA CRÍTICA');
                lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                lines.push('');
                lines.push('Fuente canónica ÚNICA para imágenes de referencia: Google Drive,');
                lines.push('carpeta REFS NV (root ID: ' + (refs.root_folder_id || '') + ').');
                lines.push('');
                lines.push('PROHIBIDO usar Asana, web del cliente, Slack u otras fuentes como');
                lines.push('sustituto. Asana es material operativo del briefing, NO archivo');
                lines.push('permanente de refs.');
                lines.push('');
                lines.push('Subcarpeta raíz del cliente:');
                lines.push('  ID: ' + cf.root_id);

                const typed = cf.subfolders_v2 && cf.subfolders_v2.length ? cf.subfolders_v2 : null;
                if (typed) {
                    lines.push('');
                    lines.push('Sub-niveles (con tipo semántico — usa el más adecuado):');
                    typed.forEach(function(sf) {
                        lines.push('  • [' + sf.type + '] ' + sf.name + ' → ' + sf.id);
                    });
                } else if (cf.subfolders && Object.keys(cf.subfolders).length > 0) {
                    lines.push('');
                    lines.push('Sub-niveles:');
                    for (const name in cf.subfolders) {
                        if (Object.prototype.hasOwnProperty.call(cf.subfolders, name)) {
                            lines.push('  • ' + name + ': ' + cf.subfolders[name]);
                        }
                    }
                }
                lines.push('');
                lines.push('Workflow: Google Drive MCP download_file_content → host temporal');
                lines.push('(tmpfiles.org/dl/) → reference_images en Seedream / image= en gpt-image-2 edits.');
                lines.push('');
                lines.push('Selección por tipo: persona_destacada para CEO/figura visible · equipo');
                lines.push('para mensaje coral · pacientes_usuarios SOLO con consentimiento RGPD ·');
                lines.push('instalaciones para escenas en local · productos para producto · logo_brand');
                lines.push('para overlays.');
                lines.push('');
                lines.push('NUNCA pedir a David que vuelva a subir fotos — ya están en Drive.');
                lines.push('');
            } else {
                lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                lines.push('⚠️ CLIENTE SIN CONFIGURAR DRIVE REFS — PARAR');
                lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                lines.push('');
                lines.push('drive_mode = "' + driveMode + '". El cliente no tiene Drive refs configurados.');
                lines.push('PARAR. Avisar a David: NV Dashboard → Editorial → Clientes → editar este cliente.');
                lines.push('NO improvisar refs externas.');
                lines.push('');
            }
        }

        lines.push('Usa todo el contexto que tienes de nuestras conversaciones previas:');
        lines.push('- Las 10 fotos avatar en /home/claude/static_refs_fresh.json (URLs HTTPS tmpfiles)');
        lines.push('- Aprendizajes de Post 02 / Post 05 que aprobamos antes');
        lines.push('- Reglas de framing (espacio negativo arriba para texto, micro-expresiones, etc.)');
        lines.push('- Mi app password WP actualizada (en tu memoria persistente)');
        lines.push('- Freepik API key (en tu memoria persistente, solo si el modelo es Freepik)');
        lines.push('');
        lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        lines.push('🎯 LO QUE QUIERO QUE HAGAS');
        lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        lines.push('');
        lines.push('1. ANTES DE GENERAR NADA: muéstrame en una tabla las ' + pubs.length + ' publicaciones con título + tipo + sugerencia visual planeada (1 línea cada una). Espera mi OK.');
        lines.push('');
        lines.push('2. Cuando te diga "adelante", para cada publicación:');
        if (cfg.modelo === 'gpt-image-2') {
            lines.push('   a) Genera con GPT-Image-2 vía OpenAI directo (key arriba)');
            lines.push('      - size: 1024x1536 para vertical 4:5/9:16, 1024x1024 para cuadrado, 1536x1024 para horizontal 16:9');
            lines.push('      - quality: "high" para piezas finales, "medium" para drafts si presupuesto');
            lines.push('      - Construye prompt rico desde copy + sugerencia visual del campo "primer_comentario"');
            lines.push('      - GPT-Image-2 NO usa reference_images al estilo Seedream — pasa la descripción del estilo y de los personajes textualmente en el prompt');
            lines.push('      - Ventaja clave: renderiza texto perfecto, úsalo si el copy lleva texto en la imagen');
        } else if (cliente === 'negocio-vivo') {
            lines.push('   a) Genera con Seedream V4.5 Edit + reference_images (las 10 fotos del JSON)');
            lines.push('      - aspect_ratio: traditional_3_4 (imagen/carrusel) | social_story_9_16 (reel/story) | widescreen_16_9 (video)');
            lines.push('      - Construye prompt rico: "Spanish businessman late forties + grey-streaked hair quiff + DARK BLACK PATCH on goatee + athletic build" + escena específica del copy + "Hyperrealism Sony A7R V 85mm f/1.4 ISO 400, visible skin pores, NOT retouched" + framing en mitad inferior con espacio negativo arriba');
            lines.push('      - enable_safety_checker: true');
        } else {
            lines.push(`   a) Genera con ${mInfo.label || cfg.modelo} (${mInfo.provider || 'Freepik'})`);
            lines.push('      - Compose prompt desde el copy + sugerencia visual del campo "primer_comentario"');
            lines.push('      - aspect_ratio según tipo (4:5 imagen/carrusel, 9:16 reel/story, 16:9 video)');
        }
        lines.push('   b) Una vez tengas la imagen (URL o base64), súbela a WordPress con:');
        lines.push('');
        lines.push(`      POST ${restBase}subir-imagen-post/{POST_ID}`);
        lines.push('      Authorization: Bearer ' + ((nvDashboard && nvDashboard.apiToken) ? nvDashboard.apiToken : '{NV_API_TOKEN_NO_DISPONIBLE}'));
        lines.push('      Body JSON: { "image_url": "URL_FREEPIK" }  o  { "base64": "...", "mime": "image/jpeg", "filename": "post-{ID}.jpg" }');
        lines.push('');
        lines.push('      (Si en lugar de Freepik estás usando gpt-image-2, mejor llama directo al');
        lines.push('       proxy /openai-image-proxy/{POST_ID} con upload_to_post=true — te ahorras');
        lines.push('       este paso.)');
        lines.push('');
        lines.push('3. ITERATIVO: Tras subir cada imagen, muéstrame mini-preview con el thumbnail. Si te digo "rehacer la 3" la regeneras con ajuste.');
        lines.push('');
        lines.push('4. PARA REELS/VIDEOS: NO intentes generar video real (caro y lento). Genera UNA imagen storyboard frame que represente el momento clave del reel, en formato 9:16. Esa imagen me sirve de referencia visual al editar el video real en CapCut.');
        lines.push('');
        lines.push('5. CALIDAD > VELOCIDAD: prefiero que tardes más con buenos resultados que entregar 14 imágenes mediocres. Si una sale mal, reintenta hasta 3 veces antes de marcar como "no conseguida".');
        lines.push('');
        lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        lines.push(`📝 PUBLICACIONES (${pubs.length})`);
        lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        lines.push('');
        
        pubs.forEach((p, idx) => {
            lines.push(`▸▸ ${idx + 1}/${pubs.length} — POST_ID = ${p.id}`);
            lines.push(`   Título: ${p.titulo}`);
            lines.push(`   Tipo: ${p.tipo || 'imagen'} · Redes: ${(p.redes || []).join(', ')}`);
            if (p.fecha) lines.push(`   Fecha programada: ${p.fecha}`);
            if (p.sugerencia_visual) {
                lines.push(`   Sugerencia visual (primer_comentario): ${p.sugerencia_visual}`);
            }
            if (p.copy) {
                // Copy completo (no truncado) para que tengas contexto real
                const copyLimpio = p.copy.replace(/\s+/g, ' ').trim();
                lines.push(`   Copy completo: ${copyLimpio}`);
            }
            if (p.hashtags) {
                lines.push(`   Hashtags: ${p.hashtags.substring(0, 200)}`);
            }
            lines.push('');
        });
        
        lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        lines.push('Cuando estés listo, muéstrame la tabla del paso 1. Espera mi OK antes de generar.');
        
        const message = lines.join('\n');
        
        // Mostrar modal con el prompt + botones
        nvMostrarModalPromptImagenes(message, pubs.length, mes, cliente);
    };
    
    /**
     * Modal con el prompt en textarea + botones Copiar + Abrir conversación
     */
    function nvMostrarModalPromptImagenes(prompt, numPubs, mes, cliente) {
        // Eliminar modal anterior si existe
        const old = document.getElementById('nv-prompt-imagenes-modal');
        if (old) old.remove();
        
        const modal = document.createElement('div');
        modal.id = 'nv-prompt-imagenes-modal';
        modal.className = 'nv-modal';
        modal.style.display = 'block';
        
        modal.innerHTML = `
            <div class="nv-modal-content" style="max-width: 760px;">
                <span class="nv-modal-close" onclick="document.getElementById('nv-prompt-imagenes-modal').remove()">&times;</span>
                <h2 style="margin-top: 0;">🎨 Generar imágenes con Claude</h2>
                <p style="color: #555; margin-bottom: 12px;">
                    He preparado un prompt con las <strong>${numPubs} publicaciones sin imagen</strong> de ${mes} (${cliente}).
                </p>
                
                <div style="background: #fffbe6; border-left: 3px solid #D2A039; padding: 10px 14px; border-radius: 4px; margin-bottom: 14px; font-size: 13px;">
                    <strong>Cómo funciona:</strong>
                    <ol style="margin: 6px 0 0 18px; padding: 0;">
                        <li>Pulsa <strong>Copiar prompt</strong></li>
                        <li>Pulsa <strong>Abrir conversación principal</strong> (te lleva a tu chat de desarrollo NV Dashboard)</li>
                        <li>Pega (Ctrl+V) en el input de Claude y envía</li>
                        <li>Claude tiene todo el contexto histórico de imágenes anteriores y va a iterar contigo</li>
                    </ol>
                </div>
                
                <textarea id="nv-prompt-textarea" readonly
                          style="width:100%; height: 280px; font-family: monospace; font-size: 11px; line-height: 1.5; padding: 10px; border: 1px solid #ccd; border-radius: 4px; resize: vertical;"
                ></textarea>
                
                <div style="display:flex; gap: 8px; flex-wrap: wrap; margin-top: 14px;">
                    <button class="button" onclick="nvCopiarPrompt(this)">
                        📋 Copiar prompt
                    </button>
                    <button class="button button-primary nv-button-gold" onclick="nvAbrirConversacionPrincipal()">
                        🚀 Abrir conversación principal →
                    </button>
                    <button class="button" onclick="document.getElementById('nv-prompt-imagenes-modal').remove()" style="margin-left:auto;">
                        Cerrar
                    </button>
                </div>
                
                <p style="color: #888; font-size: 11px; margin-top: 10px; margin-bottom: 0;">
                    <strong>${prompt.length}</strong> caracteres · <strong>${numPubs}</strong> publicaciones
                </p>
            </div>
        `;
        document.body.appendChild(modal);
        
        // Inyectar texto sin escapar (es solo texto plano, no HTML)
        document.getElementById('nv-prompt-textarea').value = prompt;
    }
    
    /**
     * Copia el contenido del textarea al portapapeles
     */
    window.nvCopiarPrompt = function(btn) {
        const ta = document.getElementById('nv-prompt-textarea');
        if (!ta) return;
        ta.select();
        ta.setSelectionRange(0, 99999);
        
        const labelOriginal = btn.textContent;
        
        // Intentar Clipboard API moderna
        const fallback = () => {
            try {
                document.execCommand('copy');
                btn.textContent = '✓ Copiado al portapapeles';
                btn.style.background = '#d4edda';
                setTimeout(() => {
                    btn.textContent = labelOriginal;
                    btn.style.background = '';
                }, 2000);
            } catch (e) {
                btn.textContent = '⚠️ Selecciónalo y Ctrl+C manual';
            }
        };
        
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(ta.value)
                .then(() => {
                    btn.textContent = '✓ Copiado al portapapeles';
                    btn.style.background = '#d4edda';
                    setTimeout(() => {
                        btn.textContent = labelOriginal;
                        btn.style.background = '';
                    }, 2000);
                })
                .catch(fallback);
        } else {
            fallback();
        }
    };
    
    /**
     * Abre la conversación principal de Claude en pestaña nueva
     */
    window.nvAbrirConversacionPrincipal = function() {
        window.open('https://claude.ai/chat/abfcb377-9c55-4143-8ebd-69727a3f3cad', '_blank', 'noopener,noreferrer');
    };

    // ===========================================================
    // v1.0.14: APROBACIÓN RÁPIDA INLINE (botón en cada evento)
    // ===========================================================

    /**
     * Inserta un botón de aprobación rápida sobre el evento del calendario.
     * Click → toggle del campo nv_aprobar_metricool sin recargar.
     */
    function addApproveButtonToEvent(info, props) {
        // Evitar duplicados si FullCalendar re-monta el mismo evento
        if (info.el.querySelector('.nv-approve-btn')) return;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'nv-approve-btn';
        btn.dataset.postId = props.id;
        btn.dataset.aprobado = props.aprobado ? '1' : '0';
        btn.innerHTML = props.aprobado ? '✓' : '○';
        btn.title = props.aprobado
            ? 'Aprobada — click para desaprobar'
            : 'Pendiente — click para aprobar';
        btn.setAttribute('aria-label', btn.title);

        btn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();  // No abrir preview
            toggleAprobacion(props.id, btn, info.event);
        });

        info.el.appendChild(btn);
    }

    /**
     * Toggle del campo nv_aprobar_metricool via REST API.
     * Optimistic UI: cambia visual inmediatamente y revierte si falla.
     */
    function toggleAprobacion(postId, btn, fcEvent) {
        const yaAprobado = btn.dataset.aprobado === '1';
        const nuevoEstado = !yaAprobado;

        // Optimistic UI
        btn.classList.add('nv-approve-btn-loading');
        btn.disabled = true;
        const originalHTML = btn.innerHTML;
        btn.innerHTML = '<span class="nv-approve-spinner"></span>';

        const url = window.nvDashboard.restUrl + 'actualizar-publicacion/' + postId;
        const headers = {
            'Content-Type': 'application/json',
            'X-WP-Nonce': window.nvDashboard.restNonce,
        };

        fetch(url, {
            method: 'POST',
            credentials: 'same-origin',
            headers: headers,
            body: JSON.stringify({ nv_aprobar_metricool: nuevoEstado ? '1' : '' })
        })
        .then(r => {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        })
        .then(data => {
            if (!data || !data.success) throw new Error('respuesta inválida');

            // Aplicar nuevo estado visual
            btn.dataset.aprobado = nuevoEstado ? '1' : '0';
            btn.innerHTML = nuevoEstado ? '✓' : '○';
            btn.title = nuevoEstado
                ? 'Aprobada — click para desaprobar'
                : 'Pendiente — click para aprobar';
            btn.setAttribute('aria-label', btn.title);
            btn.classList.remove('nv-approve-btn-loading');
            btn.disabled = false;

            // Actualizar prop interna del evento FC para mantener consistencia
            if (fcEvent) {
                fcEvent.setExtendedProp('aprobado', nuevoEstado);
                if (nuevoEstado) {
                    fcEvent.el && fcEvent.el.classList && fcEvent.el.classList.add('fc-event-approved');
                }
            }

            // Marca toda la card del evento con clase aprobada
            const eventEl = btn.closest('.fc-event');
            if (eventEl) {
                if (nuevoEstado) eventEl.classList.add('fc-event-approved');
                else eventEl.classList.remove('fc-event-approved');
            }

            // Actualizar el contador del approve bar (si está en pantalla)
            // y el cache del mes actual si existe
            if (Array.isArray(window.nvCurrentMonthData)) {
                const idx = window.nvCurrentMonthData.findIndex(p => String(p.id) === String(postId));
                if (idx !== -1) {
                    window.nvCurrentMonthData[idx].aprobado = nuevoEstado;
                }
            }
            if (typeof updateApprovedCount === 'function') {
                try { updateApprovedCount(); } catch (_) {}
            }

            // Toast feedback
            mostrarToastAprobacion(nuevoEstado);
        })
        .catch(err => {
            console.error('Error toggle aprobación:', err);
            // Revertir UI
            btn.innerHTML = originalHTML;
            btn.classList.remove('nv-approve-btn-loading');
            btn.disabled = false;
            alert('Error al actualizar la aprobación. Inténtalo de nuevo.');
        });
    }

    /**
     * Pequeño toast de feedback (sin librerías)
     */
    function mostrarToastAprobacion(aprobado) {
        let toast = document.getElementById('nv-approve-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'nv-approve-toast';
            toast.className = 'nv-approve-toast';
            document.body.appendChild(toast);
        }
        toast.textContent = aprobado ? '✓ Aprobada' : '○ Aprobación retirada';
        toast.classList.remove('nv-approve-toast-error');
        toast.classList.add('nv-approve-toast-show');
        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => {
            toast.classList.remove('nv-approve-toast-show');
        }, 2000);
    }

    // ─────────────────────────────────────────────────────────────────────
    // v1.0.23: Publicación multi-cliente
    // ─────────────────────────────────────────────────────────────────────

    window.nvAbrirMultiCliente = function() {
        const modal = document.getElementById('nv-multi-cliente-modal');
        if (!modal) return;
        // Pre-rellenar fecha con próximo domingo si está vacía (caso uso típico = fechas estacionales)
        const fechaInput = document.getElementById('nv-mc-fecha');
        if (fechaInput && !fechaInput.value) {
            const d = new Date();
            const days = (7 - d.getDay()) % 7 || 7; // próximo domingo
            d.setDate(d.getDate() + days);
            fechaInput.value = d.toISOString().substr(0, 10);
        }
        // Reset progress
        const prog = document.getElementById('nv-mc-progress');
        if (prog) prog.innerHTML = '';
        const goBtn = document.getElementById('nv-mc-go');
        if (goBtn) goBtn.disabled = false;
        modal.style.display = 'flex';
    };

    /**
     * v1.0.24: abrir modal multi-cliente pre-rellenado con una fecha específica
     * y, si hay un cliente filtrado en el dashboard, marcando solo ese cliente.
     * Llamado desde el dateClick de FullCalendar.
     */
    window.nvAbrirMultiClienteParaFecha = function(fechaISO) {
        const modal = document.getElementById('nv-multi-cliente-modal');
        if (!modal) return;

        // Fecha exacta clicada (formato YYYY-MM-DD)
        const fechaInput = document.getElementById('nv-mc-fecha');
        if (fechaInput && fechaISO) fechaInput.value = fechaISO;

        // Si hay un cliente filtrado en el dashboard (no "all"), marcar solo ese
        const clienteFiltro = (window.nvCliente && window.nvCliente !== 'all') ? window.nvCliente : null;
        const checkboxes = document.querySelectorAll('.nv-mc-cliente');
        if (clienteFiltro) {
            // Marcar SOLO el filtrado, desmarcar el resto
            checkboxes.forEach(cb => {
                cb.checked = (cb.value === clienteFiltro);
            });
        }
        // Si filtro es 'all', no tocamos los checkboxes (dejamos los que ya estuvieran)

        // Reset progress
        const prog = document.getElementById('nv-mc-progress');
        if (prog) prog.innerHTML = '';
        const goBtn = document.getElementById('nv-mc-go');
        if (goBtn) goBtn.disabled = false;

        modal.style.display = 'flex';
    };

    window.nvCerrarMultiCliente = function() {
        const modal = document.getElementById('nv-multi-cliente-modal');
        if (modal) modal.style.display = 'none';
    };

    window.nvMultiClienteToggleAll = function(checked) {
        document.querySelectorAll('.nv-mc-cliente').forEach(cb => { cb.checked = checked; });
    };

    window.nvLanzarMultiCliente = async function() {
        const fecha = document.getElementById('nv-mc-fecha').value;
        const hora = document.getElementById('nv-mc-hora').value || '12:00';
        const tipo = document.getElementById('nv-mc-tipo').value;
        const tema = document.getElementById('nv-mc-tema').value.trim();
        const skipExisting = document.getElementById('nv-mc-skip').checked;
        const redes = Array.from(document.querySelectorAll('.nv-mc-red:checked')).map(cb => cb.value);
        const clientes = Array.from(document.querySelectorAll('.nv-mc-cliente:checked')).map(cb => cb.value);
        // v1.0.25: imagen
        const generateImage = document.getElementById('nv-mc-generate-image').checked;
        const imageQuality = document.getElementById('nv-mc-image-quality').value;
        // v1.0.27: opciones de estilo de imagen
        const imgOpts = {};
        document.querySelectorAll('.nv-mc-img-opt').forEach(cb => {
            imgOpts[cb.dataset.opt] = cb.checked;
        });
        // v1.0.53: fidelidad refs (override solo si "usar default" está desmarcado)
        const fidelityUseDefault = document.getElementById('nv-mc-fidelity-use-default')?.checked ?? true;
        const fidelityValue = parseInt(document.getElementById('nv-mc-fidelity')?.value || '50', 10);
        const refsFidelityOverride = fidelityUseDefault ? null : fidelityValue;
        const prog = document.getElementById('nv-mc-progress');
        const goBtn = document.getElementById('nv-mc-go');

        // Validación
        if (!fecha || !hora) { prog.innerHTML = '<span style="color:#c00;">⚠️ Selecciona fecha y hora.</span>'; return; }
        if (!tema) { prog.innerHTML = '<span style="color:#c00;">⚠️ Escribe un tema/brief.</span>'; return; }
        if (clientes.length === 0) { prog.innerHTML = '<span style="color:#c00;">⚠️ Selecciona al menos un cliente.</span>'; return; }
        if (redes.length === 0) { prog.innerHTML = '<span style="color:#c00;">⚠️ Marca al menos una red social.</span>'; return; }

        const fechaStr = fecha + ' ' + hora + (hora.length === 5 ? ':00' : '');

        goBtn.disabled = true;
        // v1.0.39: mostrar botón "Cerrar y trabajar mientras se genera"
        if (window.nvShowBackgroundButton) window.nvShowBackgroundButton('mc', true);
        // v1.0.26: arquitectura en dos fases para evitar timeouts del servidor
        // Fase 1: solo copy + crear posts. v1.0.32: ahora N peticiones HTTP paralelas
        //         (1 por cliente, 3 a la vez) para que ninguna petición individual supere
        //         el timeout del hosting (típicamente 60-90s). Antes era una sola petición
        //         grande que sumaba todo.
        // Fase 2: imagen por post en paralelo (cada una su propia petición HTTP, sin cambio)
        const fase2Activa = generateImage;
        const eta = Math.ceil(clientes.length / 3) * 15 + (fase2Activa ? Math.ceil(clientes.length / 3) * 35 : 0);
        prog.innerHTML = '<span style="color:#0073aa;">⏳ Fase 1/2: creando ' + clientes.length + ' publicacion' + (clientes.length === 1 ? '' : 'es') + ' con copy IA (3 en paralelo). Tiempo estimado total: ~' + eta + 's.</span>'
            + '<div id="nv-mc-fase1-progress" style="margin-top:10px; font-size:13px;"></div>';

        try {
            // ─── FASE 1: peticiones HTTP independientes por cliente ─────────────
            const created = [];
            const skipped = [];
            const errors  = [];
            const fase1Box = document.getElementById('nv-mc-fase1-progress');
            let f1Done = 0, f1Ok = 0, f1Fail = 0;

            const f1UpdateProgress = () => {
                if (!fase1Box) return;
                fase1Box.innerHTML = '<strong>' + f1Done + ' / ' + clientes.length + '</strong> clientes procesados · '
                    + '<span style="color:#2ea043;">' + f1Ok + ' OK</span>'
                    + (f1Fail > 0 ? ' · <span style="color:#c00;">' + f1Fail + ' fallidos</span>' : '');
            };
            f1UpdateProgress();

            const f1BodyBase = {
                fecha: fechaStr,
                tipo: tipo,
                redes: redes,
                tema: tema,
                skip_existing: skipExisting,
                generate_image: false,
                add_logo:       imgOpts.add_logo,
                add_text:       imgOpts.add_text,
                add_data:       imgOpts.add_data,
                add_cta:        imgOpts.add_cta,
                tone_emotivo:   imgOpts.tone_emotivo,
                tone_comercial: imgOpts.tone_comercial,
                // v1.0.53: solo enviar refs_fidelity si NO es "usar default por cliente"
                ...(refsFidelityOverride !== null ? { refs_fidelity: refsFidelityOverride } : {}),
                // v1.0.59: forzar tipos de refs si el usuario marcó checkboxes
                forced_types: Array.from(document.querySelectorAll('.nv-mc-forced-type:checked')).map(c => c.getAttribute('data-type')).filter(Boolean),
            };

            const f1Queue = clientes.slice();

            async function fase1Worker() {
                while (f1Queue.length > 0) {
                    const slug = f1Queue.shift();
                    if (!slug) return;
                    try {
                        const r = await fetch(nvDashboard.restUrl + 'publicaciones-multi-cliente', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-WP-Nonce': nvDashboard.restNonce,
                            },
                            body: JSON.stringify(Object.assign({}, f1BodyBase, { cliente_slugs: [slug] })),
                        });

                        const ctype = r.headers.get('content-type') || '';
                        if (!ctype.includes('json')) {
                            const txt = await r.text();
                            const snippet = txt.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').substr(0, 160);
                            errors.push({ cliente_slug: slug, error: 'HTTP ' + r.status + ': ' + snippet });
                            f1Fail++;
                        } else {
                            const data = await r.json();
                            if (!r.ok || !data || data.code) {
                                errors.push({ cliente_slug: slug, error: (data && data.message) ? data.message : ('HTTP ' + r.status) });
                                f1Fail++;
                            } else {
                                if (data.created && data.created.length) {
                                    data.created.forEach(c => created.push(c));
                                    f1Ok++;
                                } else if (data.skipped && data.skipped.length) {
                                    data.skipped.forEach(s => skipped.push(s));
                                    f1Ok++; // saltado cuenta como procesado
                                } else if (data.errors && data.errors.length) {
                                    data.errors.forEach(e => errors.push(e));
                                    f1Fail++;
                                } else {
                                    errors.push({ cliente_slug: slug, error: 'Respuesta inesperada del servidor' });
                                    f1Fail++;
                                }
                            }
                        }
                    } catch (err) {
                        errors.push({ cliente_slug: slug, error: 'Red: ' + err.message });
                        f1Fail++;
                    }
                    f1Done++;
                    f1UpdateProgress();
                }
            }

            const fase1Concurrency = 3;
            const f1Workers = [];
            for (let i = 0; i < Math.min(fase1Concurrency, clientes.length); i++) {
                f1Workers.push(fase1Worker());
            }
            await Promise.all(f1Workers);

            // Si TODOS fallaron en fase 1 con timeout, abortar y avisar
            if (created.length === 0 && f1Fail >= clientes.length) {
                let html = '<span style="color:#c00;">❌ <strong>Todos los clientes fallaron en Fase 1.</strong> Causas probables:</span>';
                html += '<ul style="margin:6px 0 0 18px; font-size:13px; color:#c00;">';
                errors.slice(0, 5).forEach(e => {
                    html += '<li>' + (e.cliente_slug || '?') + ': ' + (e.error || '').substr(0, 200) + '</li>';
                });
                if (errors.length > 5) html += '<li>… y ' + (errors.length - 5) + ' más</li>';
                html += '</ul>';
                html += '<p style="margin-top:10px;">Sugerencias:<br>• Si ves "Request Timeout" → tu hosting corta &lt;60s. Llámales y pide que suban <code>max_execution_time</code> a 300s y el timeout del proxy/loadbalancer también.<br>• Si ves "Anthropic error" → verifica la key en Configuración.<br>• Si ves "memory" → quita logos enormes de los clientes (Editorial → Clientes → editar → 🎨 Branding) o reduce imágenes de referencia.</p>';
                prog.innerHTML = html;
                goBtn.disabled = false;
                if (window.nvShowBackgroundButton) window.nvShowBackgroundButton('mc', false);
                return;
            }

            // ─── FASE 2: generar imagen por post (peticiones HTTP independientes) ────
            const imagesByPostId = {}; // post_id → { url, error, attachment_id }
            if (fase2Activa && created.length > 0) {
                prog.innerHTML = '<span style="color:#0073aa;">⏳ Fase 1 OK · Fase 2/2: generando imágenes en paralelo (3 a la vez)…</span>'
                    + '<div id="nv-mc-img-progress" style="margin-top:10px; font-size:13px;"></div>';
                const progBox = document.getElementById('nv-mc-img-progress');
                let done = 0, ok = 0, fail = 0;

                const updateProgressLine = () => {
                    if (!progBox) return;
                    progBox.innerHTML = '<strong>' + done + ' / ' + created.length + '</strong> imágenes procesadas · '
                        + '<span style="color:#2ea043;">' + ok + ' OK</span> · '
                        + (fail > 0 ? '<span style="color:#c00;">' + fail + ' fallidas</span>' : '0 fallidas');
                };
                updateProgressLine();

                const concurrency = 3;
                const queue = created.slice();

                async function worker() {
                    while (queue.length > 0) {
                        const c = queue.shift();
                        if (!c) return;
                        // v1.0.40: usar helper con retry automático + parseo inteligente
                        const result = window.nvGenerateImageForPost
                            ? await window.nvGenerateImageForPost(c.post_id, {
                                quality: imageQuality,
                                add_logo:       imgOpts.add_logo,
                                add_text:       imgOpts.add_text,
                                add_data:       imgOpts.add_data,
                                add_cta:        imgOpts.add_cta,
                                tone_emotivo:   imgOpts.tone_emotivo,
                                tone_comercial: imgOpts.tone_comercial,
                                // v1.0.53: pasar override de fidelidad si está configurado
                                ...(refsFidelityOverride !== null ? { refs_fidelity: refsFidelityOverride } : {}),
                            })
                            : { ok: false, error: { type: 'no_helper', message: 'Helper no disponible (recarga la página)' } };
                        if (result.ok) {
                            const idata = result.data;
                            if (idata.success && idata.asset_url) {
                                imagesByPostId[c.post_id] = { url: idata.asset_url, attachment_id: idata.attachment_id };
                                ok++;
                            } else {
                                imagesByPostId[c.post_id] = { error: (idata && idata.message) ? idata.message : 'Respuesta inesperada' };
                                fail++;
                            }
                        } else {
                            imagesByPostId[c.post_id] = { error: result.error.message, type: result.error.type };
                            fail++;
                        }
                        done++;
                        updateProgressLine();
                    }
                }

                const workers = [];
                for (let i = 0; i < Math.min(concurrency, created.length); i++) {
                    workers.push(worker());
                }
                await Promise.all(workers);
            }

            // ─── Render resumen final ──────────────────────────────────────
            const okImgs = Object.values(imagesByPostId).filter(x => x.url).length;
            const errImgs = Object.values(imagesByPostId).filter(x => x.error).length;

            let html = '<div style="border:1px solid #2ea043; background:#f0f9ee; border-radius:4px; padding:12px; margin-bottom:8px;">';
            html += '<strong style="color:#2ea043;">✅ Operación completada</strong><br>';
            html += '<span style="font-size:12px; color:#444;">Creadas: ' + created.length + ' · Saltadas: ' + skipped.length + ' · Errores creación: ' + errors.length;
            if (fase2Activa && created.length > 0) html += ' · Imágenes OK: ' + okImgs + ' · Imágenes fallidas: ' + errImgs;
            html += '</span></div>';

            if (created.length) {
                html += '<details open style="margin-bottom:6px;"><summary style="cursor:pointer; font-weight:600;">📝 Creadas (' + created.length + ')</summary><div style="margin:8px 0 0 0; display:grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap:8px;">';
                created.forEach(c => {
                    const aiTag = c.ai_used ? '<span style="color:#2ea043;" title="Copy generado por IA">✨ copy</span>' : (c.ai_error ? '<span style="color:#dba000;" title="' + (c.ai_error || '').replace(/"/g, '&quot;') + '">⚠️ sin copy</span>' : '<span style="color:#888;">vacío</span>');
                    const imgInfo = imagesByPostId[c.post_id];
                    let imgBlock = '';
                    if (imgInfo && imgInfo.url) {
                        imgBlock = '<div style="aspect-ratio:1/1; background:#f0f0f0 url(\'' + imgInfo.url + '\') center/cover no-repeat; border-radius:4px; margin-bottom:6px;"></div>';
                    } else if (imgInfo && imgInfo.error) {
                        imgBlock = '<div data-pid="' + c.post_id + '" class="nv-failed-img" style="aspect-ratio:1/1; background:#fff5f5; border:1px dashed #c00; border-radius:4px; margin-bottom:6px; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:8px; font-size:11px; color:#c00; text-align:center; gap:6px;">'
                                + '<div>⚠️ Imagen falló:</div>'
                                + '<div style="word-break:break-word; max-height:80px; overflow:auto;">' + (imgInfo.error || '').substr(0, 400).replace(/[<>]/g, '') + '</div>'
                                + '<button type="button" class="button button-small nv-retry-img" data-pid="' + c.post_id + '" style="margin-top:auto;">🔄 Reintentar</button>'
                                + '</div>';
                    } else if (fase2Activa) {
                        imgBlock = '<div style="aspect-ratio:1/1; background:#f7f9fc; border:1px dashed #aaa; border-radius:4px; margin-bottom:6px; display:flex; align-items:center; justify-content:center; font-size:11px; color:#888;">sin imagen</div>';
                    }
                    html += '<div style="border:1px solid #ddd; border-radius:4px; padding:8px; font-size:12px; background:#fff;">';
                    html += imgBlock;
                    html += '<div style="font-weight:600; margin-bottom:2px;">' + (c.cliente_name || c.cliente_slug) + '</div>';
                    html += '<div><a href="' + c.edit_url + '" target="_blank">Editar</a> · ' + aiTag + '</div>';
                    html += '</div>';
                });
                html += '</div></details>';
            }
            if (skipped.length) {
                html += '<details style="margin-bottom:6px;"><summary style="cursor:pointer; color:#666;">⏭️ Saltadas (' + skipped.length + ')</summary><ul style="margin:6px 0 0 18px; font-size:13px; color:#666;">';
                skipped.forEach(s => {
                    html += '<li>' + (s.cliente_name || s.cliente_slug) + ' · ya existía publicación en esa fecha';
                    if (s.existing_post_id) html += ' (ID ' + s.existing_post_id + ')';
                    html += '</li>';
                });
                html += '</ul></details>';
            }
            if (errors.length) {
                html += '<details open><summary style="cursor:pointer; color:#c00; font-weight:600;">❌ Errores creación (' + errors.length + ')</summary><ul style="margin:6px 0 0 18px; font-size:13px; color:#c00;">';
                errors.forEach(e => {
                    html += '<li>' + (e.cliente_slug || '?') + ': ' + (e.error || 'error desconocido') + '</li>';
                });
                html += '</ul></details>';
            }

            html += '<div style="margin-top:12px; padding-top:10px; border-top:1px solid #eee;">';
            html += '<button type="button" class="button button-primary" onclick="nvCerrarMultiCliente(); location.reload();">Cerrar y recargar calendario</button>';
            html += '</div>';

            prog.innerHTML = html;
            // v1.0.39: ocultar botón "Cerrar y trabajar"
            if (window.nvShowBackgroundButton) window.nvShowBackgroundButton('mc', false);

            // v1.0.40: enganchar botones "🔄 Reintentar" en tarjetas con imagen fallida
            prog.querySelectorAll('.nv-retry-img').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.preventDefault();
                    const pid = btn.dataset.pid;
                    const card = prog.querySelector('.nv-failed-img[data-pid="' + pid + '"]');
                    if (!card) return;
                    const oldHtml = card.innerHTML;
                    card.innerHTML = '<div style="color:#0073aa;">🔄 Reintentando…</div>';
                    const result = window.nvGenerateImageForPost
                        ? await window.nvGenerateImageForPost(pid, {
                            quality: imageQuality,
                            add_logo:       imgOpts.add_logo,
                            add_text:       imgOpts.add_text,
                            add_data:       imgOpts.add_data,
                            add_cta:        imgOpts.add_cta,
                            tone_emotivo:   imgOpts.tone_emotivo,
                            tone_comercial: imgOpts.tone_comercial,
                        })
                        : { ok: false, error: { type: 'no_helper', message: 'Recarga la página' } };
                    if (result.ok && result.data && result.data.asset_url) {
                        // Reemplazar la card entera por la imagen
                        card.outerHTML = '<div style="aspect-ratio:1/1; background:#f0f0f0 url(\'' + result.data.asset_url + '\') center/cover no-repeat; border-radius:4px; margin-bottom:6px;"></div>';
                    } else {
                        const msg = result.error ? result.error.message : 'Error desconocido';
                        card.innerHTML = '<div>⚠️ Sigue fallando:</div>'
                            + '<div style="word-break:break-word; max-height:80px; overflow:auto;">' + (msg || '').substr(0, 400).replace(/[<>]/g, '') + '</div>'
                            + '<button type="button" class="button button-small nv-retry-img" data-pid="' + pid + '" style="margin-top:auto;">🔄 Reintentar</button>';
                        // Re-enganchar el handler del nuevo botón
                        const newBtn = card.querySelector('.nv-retry-img');
                        if (newBtn) newBtn.addEventListener('click', btn.onclick);
                    }
                });
            });
        } catch (err) {
            prog.innerHTML = '<span style="color:#c00;">❌ Error de red: ' + err.message + '</span>';
            goBtn.disabled = false;
            if (window.nvShowBackgroundButton) window.nvShowBackgroundButton('mc', false);
        }
    };

    // ─────────────────────────────────────────────────────────────────────
    // v1.0.53: Análisis de competencia
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Llama al endpoint /analizar-competencia/{term_id} para un cliente concreto.
     * Devuelve { ok, data, error }
     */
    async function analizarCompetenciaCliente(termId, clienteName) {
        try {
            const r = await fetch(nvDashboard.restUrl + 'analizar-competencia/' + termId, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-WP-Nonce': nvDashboard.restNonce,
                },
                body: '{}',
            });
            const ctype = r.headers.get('content-type') || '';
            if (!ctype.includes('json')) {
                const txt = await r.text();
                return { ok: false, error: 'HTTP ' + r.status + ' (no JSON): ' + txt.substr(0, 200) };
            }
            const data = await r.json();
            if (!r.ok || data.code) {
                return { ok: false, error: data.message || ('HTTP ' + r.status) };
            }
            return { ok: true, data: data, clienteName: clienteName || data.cliente_name };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    }

    /**
     * Renderiza el modal con la lista de temas y checkboxes para seleccionar.
     * Al confirmar, llama a callback(temas_seleccionados_string).
     */
    function nvAbrirSelectorTemas(resultadosPorCliente, callback) {
        // Eliminar modal previo si existe
        const old = document.getElementById('nv-temas-selector-modal');
        if (old) old.remove();

        const modal = document.createElement('div');
        modal.id = 'nv-temas-selector-modal';
        modal.className = 'nv-modal';
        modal.style.cssText = 'display:flex; align-items:center; justify-content:center; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.6); z-index:99999;';

        // Compilar HTML de las secciones (uno por cliente)
        let body = '';
        let temaIdx = 0;
        resultadosPorCliente.forEach((rc, ci) => {
            if (!rc.ok) {
                body += '<div style="padding:10px; background:#fff5f5; border-left:3px solid #c00; margin-bottom:10px; font-size:13px;">'
                      + '<strong>' + escapeHtml(rc.clienteName || 'Cliente') + '</strong>: '
                      + '<span style="color:#c00;">❌ ' + escapeHtml(rc.error || 'Error') + '</span>'
                      + '</div>';
                return;
            }
            const d = rc.data;
            const modeLabel = d.mode === 'configured'
                ? '<span style="color:#0a7d3a;">✓ basado en competidores configurados</span>'
                : '<span style="color:#0073aa;">🌐 descubiertos en web por la IA</span>';
            const compsList = (d.competidores_analizados || []).join(' · ') || '(ninguno listado)';
            body += '<div style="margin-bottom:18px;">';
            body += '<div style="font-weight:600; font-size:14px; padding:8px 10px; background:#f0f6fc; border-left:3px solid #0073aa;">'
                  + escapeHtml(rc.clienteName) + ' <span style="font-weight:400; font-size:12px; margin-left:6px;">' + modeLabel + '</span>'
                  + '<div style="font-weight:400; font-size:11px; color:#555; margin-top:3px;">Competidores analizados: ' + escapeHtml(compsList) + '</div>'
                  + '</div>';
            body += '<div style="margin-top:8px;">';
            (d.temas || []).forEach(t => {
                const id = 'nv-tema-cb-' + temaIdx;
                body += '<label for="' + id + '" style="display:flex; gap:10px; padding:8px 10px; border-bottom:1px solid #eee; cursor:pointer; font-size:13px;" onmouseover="this.style.background=\'#fafafa\'" onmouseout="this.style.background=\'transparent\'">';
                body += '<input type="checkbox" id="' + id + '" class="nv-tema-cb" data-tema="' + encodeURIComponent(t.tema) + '" data-tipo="' + escapeHtml(t.tipo_sugerido || 'imagen') + '" data-cliente="' + escapeHtml(rc.clienteName) + '" style="margin-top:3px; flex-shrink:0;" />';
                body += '<div style="flex:1;">';
                body += '<div style="font-weight:600;">' + escapeHtml(t.tema) + '</div>';
                body += '<div style="font-size:11px; color:#666; margin-top:2px;">'
                      + '<em>' + escapeHtml(t.justificacion || '') + '</em>'
                      + ' <span style="margin-left:8px; padding:1px 6px; background:#f0f0f0; border-radius:3px;">' + escapeHtml(t.tipo_sugerido || 'imagen') + '</span>'
                      + ' <span style="margin-left:6px; color:#999;">📌 ' + escapeHtml(t.fuente || '?') + '</span>'
                      + '</div>';
                body += '</div></label>';
                temaIdx++;
            });
            body += '</div></div>';
        });

        if (temaIdx === 0) {
            body = '<p style="color:#c00; padding:20px; text-align:center;">No se obtuvieron temas. Reintenta o configura competidores en la ficha del cliente.</p>';
        }

        modal.innerHTML = `
            <div style="background:#fff; border-radius:6px; max-width:780px; width:90%; max-height:88vh; display:flex; flex-direction:column; box-shadow:0 8px 32px rgba(0,0,0,0.3);">
                <div style="padding:16px 20px; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center;">
                    <h2 style="margin:0; font-size:18px;">🔍 Temas propuestos por la IA</h2>
                    <button type="button" onclick="document.getElementById('nv-temas-selector-modal').remove()" style="background:none; border:0; font-size:24px; cursor:pointer; color:#666;">&times;</button>
                </div>
                <div style="padding:16px 20px; overflow-y:auto; flex:1;">
                    <p style="margin:0 0 14px; color:#555; font-size:13px;">Marca los temas que te interesen. Al confirmar, se rellenará el campo de tema/brief con los seleccionados.</p>
                    <div style="margin-bottom:10px;">
                        <button type="button" class="button button-small" onclick="document.querySelectorAll('.nv-tema-cb').forEach(cb=>cb.checked=true);">✓ Marcar todos</button>
                        <button type="button" class="button button-small" onclick="document.querySelectorAll('.nv-tema-cb').forEach(cb=>cb.checked=false);">☐ Desmarcar todos</button>
                        <span id="nv-tema-counter" style="margin-left:14px; font-size:12px; color:#666;">0 seleccionados</span>
                    </div>
                    ${body}
                </div>
                <div style="padding:14px 20px; border-top:1px solid #eee; display:flex; gap:10px; justify-content:flex-end;">
                    <button type="button" class="button" onclick="document.getElementById('nv-temas-selector-modal').remove()">Cancelar</button>
                    <button type="button" class="button button-primary" id="nv-temas-confirmar">📋 Usar temas seleccionados</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // Contador en vivo
        const updateCounter = () => {
            const n = modal.querySelectorAll('.nv-tema-cb:checked').length;
            const counter = modal.querySelector('#nv-tema-counter');
            if (counter) counter.textContent = n + ' seleccionado' + (n === 1 ? '' : 's');
        };
        modal.querySelectorAll('.nv-tema-cb').forEach(cb => cb.addEventListener('change', updateCounter));

        // Confirmar
        modal.querySelector('#nv-temas-confirmar').addEventListener('click', () => {
            const selected = [];
            modal.querySelectorAll('.nv-tema-cb:checked').forEach(cb => {
                selected.push({
                    tema: decodeURIComponent(cb.dataset.tema),
                    tipo: cb.dataset.tipo,
                    cliente: cb.dataset.cliente,
                });
            });
            if (selected.length === 0) {
                alert('Marca al menos un tema antes de confirmar.');
                return;
            }
            modal.remove();
            if (typeof callback === 'function') callback(selected);
        });
    }

    function escapeHtml(s) {
        return String(s || '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    }

    /**
     * Handler del botón "🔍 Analizar competencia" en modal multi-cliente.
     * Recoge los clientes seleccionados, llama al endpoint para cada uno (max 3 paralelo),
     * abre el modal de selección y al confirmar mete los temas en el textarea de tema.
     */
    window.nvAnalizarCompetenciaMulti = async function() {
        const slugs = Array.from(document.querySelectorAll('.nv-mc-cliente:checked')).map(cb => cb.value);
        const status = document.getElementById('nv-mc-competencia-status');
        const btn = document.getElementById('nv-mc-analizar-competencia');
        if (!slugs.length) {
            if (status) status.innerHTML = '<span style="color:#c00;">⚠️ Selecciona al menos un cliente primero.</span>';
            return;
        }
        // Recuperar el mapeo slug → {term_id, name} desde el dashboard (window.nvClientesData lo trae)
        const data = (window.nvDashboard && window.nvDashboard.clientes) || [];
        const seleccionados = data.filter(c => slugs.includes(c.slug));
        if (!seleccionados.length) {
            if (status) status.innerHTML = '<span style="color:#c00;">⚠️ No pude resolver los clientes (recarga la página).</span>';
            return;
        }

        if (btn) btn.disabled = true;
        if (status) status.innerHTML = '⏳ Analizando competencia de ' + seleccionados.length + ' cliente(s)…';

        const queue = seleccionados.slice();
        const results = [];
        const workers = [];

        const worker = async () => {
            while (queue.length > 0) {
                const c = queue.shift();
                if (!c) return;
                const r = await analizarCompetenciaCliente(c.term_id, c.name);
                results.push(r);
                if (status) status.innerHTML = '⏳ ' + results.length + ' / ' + seleccionados.length + ' analizado(s)…';
            }
        };
        for (let i = 0; i < Math.min(3, seleccionados.length); i++) workers.push(worker());
        await Promise.all(workers);

        if (btn) btn.disabled = false;
        const oks = results.filter(r => r.ok).length;
        if (status) {
            status.innerHTML = '<span style="color:#0a7d3a;">✓ ' + oks + ' / ' + results.length + ' analizado(s) — abre selector…</span>';
        }

        nvAbrirSelectorTemas(results, (seleccionados) => {
            // Rellenar el textarea de tema con un texto formateado
            const textarea = document.getElementById('nv-mc-tema');
            if (!textarea) return;
            // Agrupar por cliente
            const grupos = {};
            seleccionados.forEach(s => {
                if (!grupos[s.cliente]) grupos[s.cliente] = [];
                grupos[s.cliente].push(s.tema);
            });
            const lines = [];
            Object.keys(grupos).forEach(cliente => {
                if (Object.keys(grupos).length > 1) {
                    lines.push('— ' + cliente + ' —');
                }
                grupos[cliente].forEach(tema => lines.push('• ' + tema));
            });
            const text = 'Temas elegidos del análisis de competencia (genera una publicación basada en uno o varios de estos):\n\n' + lines.join('\n');
            textarea.value = text;
            if (status) status.innerHTML = '<span style="color:#0a7d3a;">✓ ' + seleccionados.length + ' tema(s) insertado(s) en el campo Tema/brief.</span>';
        });
    };

    /**
     * Handler del botón "🔍 Analizar competencia" en modal generar-mes.
     * El cliente sale de window.nvCliente (filtrado actual del dashboard).
     */
    window.nvAnalizarCompetenciaGenmes = async function() {
        const cliente = window.nvCliente || 'all';
        const status = document.getElementById('nv-genmes-competencia-status');
        if (cliente === 'all') {
            if (status) status.innerHTML = '<span style="color:#c00;">⚠️ Selecciona un cliente específico antes (ahora estás en "todos").</span>';
            return;
        }
        const data = (window.nvDashboard && window.nvDashboard.clientes) || [];
        const target = data.find(c => c.slug === cliente);
        if (!target) {
            if (status) status.innerHTML = '<span style="color:#c00;">⚠️ Cliente no resuelto. Recarga.</span>';
            return;
        }

        if (status) status.innerHTML = '⏳ Analizando competencia de ' + target.name + '…';
        const r = await analizarCompetenciaCliente(target.term_id, target.name);
        if (!r.ok) {
            if (status) status.innerHTML = '<span style="color:#c00;">❌ ' + (r.error || 'Error') + '</span>';
            return;
        }
        if (status) status.innerHTML = '<span style="color:#0a7d3a;">✓ Análisis completo — abre selector…</span>';

        nvAbrirSelectorTemas([r], (seleccionados) => {
            const textarea = document.getElementById('nv-genmes-brief');
            if (!textarea) return;
            const lines = seleccionados.map(s => '• ' + s.tema);
            const text = (textarea.value ? textarea.value.trim() + '\n\n' : '')
                       + 'Temas del análisis de competencia:\n' + lines.join('\n');
            textarea.value = text;
            if (status) status.innerHTML = '<span style="color:#0a7d3a;">✓ ' + seleccionados.length + ' tema(s) añadidos al brief.</span>';
        });
    };

})(jQuery);
