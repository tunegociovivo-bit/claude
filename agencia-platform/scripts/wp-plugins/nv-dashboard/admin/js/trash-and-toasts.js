/**
 * NV Dashboard — Módulo papelera drag-drop + sistema de toasts (v1.0.39)
 *
 * Tres APIs públicas (en window):
 *   window.nvToasts        → API de notificaciones flotantes (segundo plano)
 *   window.nvTrashSetup    → inicializa la papelera (idempotente)
 *
 * Las publicaciones se borran con DELETE /wp-json/nv/v1/publicacion/{id}.
 */
(function($) {
    'use strict';

    if (!window.nvDashboard) return; // sin contexto, salir

    // ═══════════════════════════════════════════════════════════════════════
    // 1) SISTEMA DE TOASTS (notificaciones flotantes para "segundo plano")
    // ═══════════════════════════════════════════════════════════════════════

    // Inyectar estilos una sola vez
    function ensureToastStyles() {
        if (document.getElementById('nv-toasts-style')) return;
        const css = `
            #nv-toasts-container {
                position: fixed;
                bottom: 20px;
                right: 20px;
                z-index: 99999;
                display: flex;
                flex-direction: column;
                gap: 10px;
                max-width: 360px;
                pointer-events: none;
            }
            .nv-toast {
                pointer-events: auto;
                background: #1e1e1e;
                color: #fff;
                border-radius: 8px;
                padding: 12px 14px;
                box-shadow: 0 6px 24px rgba(0,0,0,0.35);
                display: flex;
                align-items: flex-start;
                gap: 10px;
                font-size: 13px;
                line-height: 1.4;
                animation: nv-toast-in 0.25s ease-out;
            }
            @keyframes nv-toast-in {
                from { opacity: 0; transform: translateX(20px); }
                to   { opacity: 1; transform: translateX(0); }
            }
            .nv-toast-icon {
                flex-shrink: 0;
                width: 20px;
                height: 20px;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .nv-toast-spinner {
                width: 18px;
                height: 18px;
                border: 2px solid #D2A039;
                border-top-color: transparent;
                border-radius: 50%;
                animation: nv-toast-spin 0.8s linear infinite;
            }
            @keyframes nv-toast-spin {
                to { transform: rotate(360deg); }
            }
            .nv-toast-body {
                flex: 1;
                min-width: 0;
                word-wrap: break-word;
            }
            .nv-toast-title { font-weight: 600; margin-bottom: 2px; }
            .nv-toast-detail { font-size: 11px; color: #aaa; }
            .nv-toast-close {
                background: none;
                border: none;
                color: #888;
                font-size: 18px;
                line-height: 1;
                cursor: pointer;
                padding: 0;
                margin-left: 4px;
            }
            .nv-toast-close:hover { color: #fff; }
            .nv-toast.success { border-left: 3px solid #5dd180; }
            .nv-toast.error   { border-left: 3px solid #ff6b6b; }
            .nv-toast.progress { border-left: 3px solid #D2A039; }
            .nv-toast a { color: #D2A039; text-decoration: underline; }

            /* PAPELERA */
            #nv-trash-bin {
                position: fixed;
                bottom: 20px;
                left: 50%;
                transform: translateX(-50%) translateY(120px);
                width: 280px;
                background: #c0392b;
                color: #fff;
                border-radius: 12px;
                padding: 18px 20px;
                box-shadow: 0 8px 30px rgba(192,57,43,0.45);
                font-size: 14px;
                font-weight: 600;
                text-align: center;
                z-index: 99998;
                opacity: 0;
                transition: opacity 0.25s ease, transform 0.25s ease;
                pointer-events: none;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
            }
            #nv-trash-bin.visible {
                opacity: 1;
                transform: translateX(-50%) translateY(0);
                pointer-events: auto;
            }
            #nv-trash-bin.over {
                background: #8b2818;
                transform: translateX(-50%) translateY(0) scale(1.08);
                box-shadow: 0 12px 40px rgba(139,40,24,0.6);
            }
            #nv-trash-bin .nv-trash-icon { font-size: 24px; }
        `;
        const style = document.createElement('style');
        style.id = 'nv-toasts-style';
        style.textContent = css;
        document.head.appendChild(style);
    }

    function ensureToastContainer() {
        ensureToastStyles();
        let c = document.getElementById('nv-toasts-container');
        if (!c) {
            c = document.createElement('div');
            c.id = 'nv-toasts-container';
            document.body.appendChild(c);
        }
        return c;
    }

    let toastIdCounter = 0;

    /**
     * Crea un toast en estado "in-progress" (con spinner).
     * Devuelve un objeto con métodos para actualizarlo.
     */
    function createToast({ title, detail }) {
        const container = ensureToastContainer();
        const id = 'nv-toast-' + (++toastIdCounter);
        const el = document.createElement('div');
        el.className = 'nv-toast progress';
        el.id = id;
        el.innerHTML = `
            <div class="nv-toast-icon"><div class="nv-toast-spinner"></div></div>
            <div class="nv-toast-body">
                <div class="nv-toast-title">${escapeHtml(title || 'Procesando…')}</div>
                ${detail ? `<div class="nv-toast-detail">${escapeHtml(detail)}</div>` : ''}
            </div>
            <button class="nv-toast-close" title="Cerrar">×</button>
        `;
        container.appendChild(el);
        el.querySelector('.nv-toast-close').addEventListener('click', () => removeToast(id));

        return {
            id,
            update: ({ title: t, detail: d }) => {
                const titleEl = el.querySelector('.nv-toast-title');
                const detailEl = el.querySelector('.nv-toast-detail');
                if (t !== undefined && titleEl) titleEl.textContent = t;
                if (d !== undefined) {
                    if (detailEl) {
                        detailEl.textContent = d;
                    } else if (d) {
                        const body = el.querySelector('.nv-toast-body');
                        const newDetail = document.createElement('div');
                        newDetail.className = 'nv-toast-detail';
                        newDetail.textContent = d;
                        body.appendChild(newDetail);
                    }
                }
            },
            success: ({ title: t, detail: d, html: htmlExtra, autoCloseMs }) => {
                el.classList.remove('progress');
                el.classList.add('success');
                el.querySelector('.nv-toast-icon').innerHTML = '<span style="color:#5dd180; font-size:18px;">✓</span>';
                if (t !== undefined) el.querySelector('.nv-toast-title').textContent = t;
                if (d !== undefined || htmlExtra) {
                    let detailEl = el.querySelector('.nv-toast-detail');
                    if (!detailEl) {
                        detailEl = document.createElement('div');
                        detailEl.className = 'nv-toast-detail';
                        el.querySelector('.nv-toast-body').appendChild(detailEl);
                    }
                    if (htmlExtra) {
                        detailEl.innerHTML = htmlExtra;
                    } else {
                        detailEl.textContent = d || '';
                    }
                }
                if (autoCloseMs) setTimeout(() => removeToast(id), autoCloseMs);
            },
            error: ({ title: t, detail: d }) => {
                el.classList.remove('progress');
                el.classList.add('error');
                el.querySelector('.nv-toast-icon').innerHTML = '<span style="color:#ff6b6b; font-size:18px;">✗</span>';
                if (t !== undefined) el.querySelector('.nv-toast-title').textContent = t;
                if (d !== undefined) {
                    let detailEl = el.querySelector('.nv-toast-detail');
                    if (!detailEl) {
                        detailEl = document.createElement('div');
                        detailEl.className = 'nv-toast-detail';
                        el.querySelector('.nv-toast-body').appendChild(detailEl);
                    }
                    detailEl.textContent = d;
                }
            },
            close: () => removeToast(id),
        };
    }

    function removeToast(id) {
        const el = document.getElementById(id);
        if (el) el.remove();
    }

    function escapeHtml(s) {
        return String(s || '').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
    }

    window.nvToasts = { create: createToast, remove: removeToast };

    // ═══════════════════════════════════════════════════════════════════════
    // 2) PAPELERA DRAG-DROP
    // ═══════════════════════════════════════════════════════════════════════

    function ensureTrashBin() {
        ensureToastStyles();
        let bin = document.getElementById('nv-trash-bin');
        if (!bin) {
            bin = document.createElement('div');
            bin.id = 'nv-trash-bin';
            bin.innerHTML = '<span class="nv-trash-icon">🗑️</span><span>Suéltala aquí para borrar</span>';
            document.body.appendChild(bin);
        }
        return bin;
    }

    let dragInProgress = false;
    let lastMouseX = 0, lastMouseY = 0;
    let pendingDelete = null;

    // Tracking global del cursor (FullCalendar no expone el evento mouseup
    // con coordenadas durante drag de events de forma fiable cross-version)
    document.addEventListener('mousemove', (e) => {
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
        if (dragInProgress) updateTrashHover();
    }, true);
    document.addEventListener('touchmove', (e) => {
        if (e.touches && e.touches[0]) {
            lastMouseX = e.touches[0].clientX;
            lastMouseY = e.touches[0].clientY;
            if (dragInProgress) updateTrashHover();
        }
    }, true);

    function updateTrashHover() {
        const bin = document.getElementById('nv-trash-bin');
        if (!bin) return;
        const r = bin.getBoundingClientRect();
        const inside = lastMouseX >= r.left && lastMouseX <= r.right
                    && lastMouseY >= r.top && lastMouseY <= r.bottom;
        bin.classList.toggle('over', inside);
    }

    function isCursorOverTrash() {
        const bin = document.getElementById('nv-trash-bin');
        if (!bin) return false;
        const r = bin.getBoundingClientRect();
        return lastMouseX >= r.left && lastMouseX <= r.right
            && lastMouseY >= r.top && lastMouseY <= r.bottom;
    }

    /**
     * Hook en FullCalendar — invocado por dashboard.js al inicializar el calendario.
     * Si calendar es null, intenta auto-detectar window.nvCalendarInstance.
     */
    function setupTrash(calendar) {
        ensureTrashBin();
        const cal = calendar || window.nvCalendarInstance;
        if (!cal || typeof cal.on !== 'function') {
            // Reintentar más tarde — el calendario aún no está
            setTimeout(() => setupTrash(null), 800);
            return;
        }

        // Hooks de FullCalendar v6
        cal.on('eventDragStart', (info) => {
            dragInProgress = true;
            const bin = ensureTrashBin();
            bin.classList.add('visible');
        });

        cal.on('eventDragStop', (info) => {
            const bin = document.getElementById('nv-trash-bin');
            const wasOverTrash = isCursorOverTrash();
            dragInProgress = false;

            if (bin) {
                bin.classList.remove('visible');
                bin.classList.remove('over');
            }

            if (wasOverTrash) {
                // Confirmar y borrar
                const event = info.event;
                const id = event.id || event.extendedProps?.post_id || event.extendedProps?.id;
                const title = event.title || '(sin título)';
                if (!id) {
                    alert('No se pudo determinar el ID de la publicación. Recarga la página y reinténtalo.');
                    return;
                }
                if (!confirm(`¿Borrar definitivamente "${title}"?\n\nEsta acción no se puede deshacer.`)) {
                    return;
                }
                deletePublicacion(id, title, () => {
                    event.remove();
                });
            }
        });
    }

    function deletePublicacion(id, title, onSuccess) {
        const toast = window.nvToasts.create({
            title: '🗑️ Borrando…',
            detail: title,
        });
        fetch(window.nvDashboard.restUrl + 'publicacion/' + id, {
            method: 'DELETE',
            headers: {
                'X-WP-Nonce': window.nvDashboard.restNonce,
                'Content-Type': 'application/json',
            },
        }).then(async r => {
            const ct = (r.headers.get('content-type') || '').toLowerCase();
            if (!ct.includes('json')) {
                const t = await r.text();
                throw new Error('HTTP ' + r.status + ': ' + t.replace(/<[^>]+>/g, ' ').substr(0, 120));
            }
            const data = await r.json();
            if (!r.ok || data.code) throw new Error(data.message || 'Error desconocido');
            return data;
        }).then(() => {
            toast.success({
                title: '✓ Borrada',
                detail: title,
                autoCloseMs: 3000,
            });
            if (typeof onSuccess === 'function') onSuccess();
        }).catch(err => {
            toast.error({
                title: 'Error al borrar',
                detail: err.message,
            });
        });
    }

    window.nvTrashSetup = setupTrash;
    window.nvDeletePublicacion = deletePublicacion;

    // ═══════════════════════════════════════════════════════════════════════
    // 4) HELPER: generar imagen con retry automático + parseo inteligente
    //    de errores HTML 500 (hosting timeout, Cloudflare, PHP fatal, etc.)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Llama a /generar-imagen-publicacion/{id} con:
     *  - 1 retry automático tras 5s si el primer intento devuelve HTML 500
     *    (transient: hosting timeout, Cloudflare 5xx, PHP-FPM saturado)
     *  - Parseo inteligente del cuerpo HTML para extraer mensaje útil
     *
     * @param {number|string} postId
     * @param {object} bodyParams         Parámetros para el POST (quality, etc.)
     * @param {object} opts
     * @param {boolean} opts.allowRetry   Por defecto true. Si false, no reintenta.
     * @returns {Promise<{ok:boolean, data?:object, error?:object}>}
     *          error: { type, message, raw, status }
     *          type: 'cloudflare_5xx' | 'hosting_timeout' | 'php_fatal' | 'rate_limit' | 'auth' | 'unknown_html' | 'json_error' | 'network'
     */
    async function generateImageForPost(postId, bodyParams = {}, opts = {}) {
        const allowRetry = opts.allowRetry !== false;
        const url = window.nvDashboard.restUrl + 'generar-imagen-publicacion/' + postId;
        const headers = {
            'X-WP-Nonce': window.nvDashboard.restNonce,
            'Content-Type': 'application/json',
        };
        const body = JSON.stringify(bodyParams || {});

        const attempt = async () => {
            try {
                const r = await fetch(url, { method: 'POST', headers, body });
                const ctype = (r.headers.get('content-type') || '').toLowerCase();
                if (!ctype.includes('json')) {
                    const txt = await r.text();
                    return { ok: false, isHtml: true, status: r.status, raw: txt };
                }
                const data = await r.json();
                if (!r.ok || data.code) {
                    return {
                        ok: false,
                        isHtml: false,
                        status: r.status,
                        error: classifyJsonError(r.status, data),
                        raw: JSON.stringify(data),
                    };
                }
                return { ok: true, data };
            } catch (err) {
                return { ok: false, isHtml: false, status: 0, error: { type: 'network', message: err.message }, raw: err.message };
            }
        };

        // Primer intento
        let result = await attempt();
        if (result.ok) return { ok: true, data: result.data };

        // Si fue HTML 500 (probable transient) y se permite retry, esperar y reintentar UNA vez
        if (result.isHtml && allowRetry && result.status >= 500) {
            await new Promise(r => setTimeout(r, 5000));
            const second = await attempt();
            if (second.ok) return { ok: true, data: second.data };
            result = second;
        }

        // Construir error final con mensaje útil
        const error = result.isHtml
            ? classifyHtmlError(result.status, result.raw)
            : (result.error || { type: 'unknown', message: 'Error desconocido' });
        error.status = result.status;
        error.raw = result.raw;
        return { ok: false, error };
    }

    /** Clasifica errores HTML 5xx para mensajes específicos */
    function classifyHtmlError(status, html) {
        const txt = String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

        // Intentar extraer un JSON inline del shutdown_function de PHP
        const jsonMatch = String(html || '').match(/\{"code":"php_fatal"[\s\S]*?\}/);
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[0]);
                return { type: 'php_fatal', message: parsed.message || 'Fatal PHP no especificado' };
            } catch (e) {}
        }

        if (/Request Timeout|Operation timed out|connection timed out|max_execution/i.test(txt)) {
            return {
                type: 'hosting_timeout',
                message: 'El proxy del hosting cortó la petición (>60-90s). OpenAI estaba lento o el hosting tiene timeout duro. Reintenta o cambia a quality=low.',
            };
        }
        if (/504 Gateway/i.test(txt) || status === 504) {
            return {
                type: 'gateway_timeout',
                message: 'Gateway timeout (504). El hosting o un proxy intermedio cortó la respuesta. Reintenta en 30 segundos.',
            };
        }
        if (/Cloudflare|cf-ray|Bad Gateway|520|521|522/i.test(txt)) {
            return {
                type: 'cloudflare_5xx',
                message: 'Hiccup transitorio de Cloudflare/OpenAI. Reintenta en 1-2 minutos, suele resolverse solo.',
            };
        }
        if (/Bad Gateway|502/i.test(txt) || status === 502) {
            return {
                type: 'bad_gateway',
                message: 'Bad Gateway (502). Servidor upstream no respondió. Reintenta en unos segundos.',
            };
        }
        if (/Service Unavailable|503/i.test(txt) || status === 503) {
            return {
                type: 'unavailable',
                message: 'Servicio no disponible (503). Sobrecarga puntual. Espera 1 min y reintenta.',
            };
        }

        // Genérico
        return {
            type: 'unknown_html',
            message: 'Servidor devolvió HTML (HTTP ' + status + ') en vez de JSON. Snippet: ' + txt.substr(0, 400),
        };
    }

    function classifyJsonError(status, data) {
        const msg = (data && data.message) ? String(data.message) : ('HTTP ' + status);
        if (status === 429 || /rate.?limit/i.test(msg)) return { type: 'rate_limit', message: msg };
        if (status === 401 || status === 403) return { type: 'auth', message: msg };
        if (status === 400) return { type: 'bad_request', message: msg };
        if (data && data.code === 'php_fatal') return { type: 'php_fatal', message: msg };
        return { type: 'json_error', message: msg };
    }

    window.nvGenerateImageForPost = generateImageForPost;

    // ═══════════════════════════════════════════════════════════════════════
    // v1.0.50 — REAPLICAR OVERLAY (sin regenerar imagen)
    // Útil para probar cambios de brand_colors / headline_lines / layout
    // sin gastar API de OpenAI ($0.03–$0.05 por intento ahorrados)
    // ═══════════════════════════════════════════════════════════════════════

    async function reaplicarOverlayForPost(postId) {
        const url = window.nvDashboard.restUrl + 'reaplicar-overlay/' + postId;
        try {
            const r = await fetch(url, {
                method: 'POST',
                headers: {
                    'X-WP-Nonce': window.nvDashboard.restNonce,
                    'Content-Type': 'application/json',
                },
                body: '{}',
            });
            const ctype = (r.headers.get('content-type') || '').toLowerCase();
            if (!ctype.includes('json')) {
                const txt = await r.text();
                return { ok: false, error: { type: 'unknown_html', message: 'Respuesta no JSON: ' + txt.slice(0, 200) } };
            }
            const data = await r.json();
            if (!r.ok || data.code) {
                return { ok: false, error: { type: data.code || 'json_error', message: data.message || ('HTTP ' + r.status), status: r.status } };
            }
            return { ok: true, data };
        } catch (err) {
            return { ok: false, error: { type: 'network', message: err.message } };
        }
    }

    window.nvReaplicarOverlayForPost = reaplicarOverlayForPost;

    // ═══════════════════════════════════════════════════════════════════════
    // v1.0.71 — ADAPTAR FORMATO (regenera con IA en otro ratio)
    // ═══════════════════════════════════════════════════════════════════════

    async function adaptarFormatoForPost(postId, options) {
        var url = window.nvDashboard.restUrl + 'adaptar-formato/' + postId;
        var body = {
            tipo_target: (options && options.tipo_target) || '',
            quality:     (options && options.quality)     || 'medium',
        };
        if (options && options.width)  body.width  = options.width;
        if (options && options.height) body.height = options.height;
        try {
            var r = await fetch(url, {
                method: 'POST',
                headers: {
                    'X-WP-Nonce': window.nvDashboard.restNonce,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            });
            var ctype = (r.headers.get('content-type') || '').toLowerCase();
            if (!ctype.includes('json')) {
                if (r.status === 504 || r.status === 502) {
                    return { ok: false, error: { type: 'gateway_timeout', message: 'El servidor (nginx) cerró la conexión a los 60s pero la generación SIGUE en curso. Espera 1-2 min y recarga la página — la nueva imagen debería aparecer.', status: r.status } };
                }
                var txt = await r.text();
                return { ok: false, error: { type: 'unknown_html', message: 'HTTP ' + r.status + '. Snippet: ' + txt.slice(0, 200) } };
            }
            var data = await r.json();
            if (!r.ok || data.code) {
                return { ok: false, error: { type: data.code || 'json_error', message: data.message || ('HTTP ' + r.status), status: r.status } };
            }
            return { ok: true, data: data };
        } catch (err) {
            return { ok: false, error: { type: 'network', message: err.message } };
        }
    }

    window.nvAdaptarFormatoForPost = adaptarFormatoForPost;

    // ═══════════════════════════════════════════════════════════════════════
    // 3) MODO SEGUNDO PLANO — migrar progreso de modal → toast persistente
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Migra el contenido del div de progreso al toast y oculta el modal.
     * El fetch que está corriendo sigue su curso normal — los handlers
     * .then/.catch del flow original siguen actualizando el div oculto.
     * Para que el toast refleje cambios posteriores, instalamos un MutationObserver
     * sobre el div para mirror su contenido.
     */
    function backgroundMigrate({ modalSelector, progressId, jobLabel, onClose }) {
        const modal = document.querySelector(modalSelector);
        const progress = document.getElementById(progressId);
        if (!modal || !progress) return false;

        // 1) Crear toast inicial con snapshot del contenido actual del progreso
        const toast = window.nvToasts.create({
            title: '⏳ ' + jobLabel,
            detail: '(en segundo plano, te avisaré al terminar)',
        });

        // 2) Observar cambios en el div de progreso para reflejarlos en el toast
        const observer = new MutationObserver(() => {
            const txt = progress.innerText.trim().replace(/\s+/g, ' ').slice(0, 200);
            if (txt) {
                toast.update({ detail: txt });
            }
            // Detectar finalización: aparición de "✅" / "❌" / palabras clave
            const html = progress.innerHTML;
            if (/✅|completada|completado/i.test(html) && !/⏳/.test(html)) {
                toast.success({
                    title: '✓ ' + jobLabel + ' lista',
                    htmlExtra: '<a href="#" onclick="event.preventDefault(); if(window.nvCalendarInstance){window.nvCalendarInstance.refetchEvents();} this.closest(\'.nv-toast\').remove();">Refrescar calendario →</a>',
                });
                observer.disconnect();
            } else if (/❌/.test(html) && !/⏳/.test(html)) {
                toast.error({
                    title: '✗ ' + jobLabel + ' falló',
                    detail: txt.slice(0, 180),
                });
                observer.disconnect();
            }
        });
        observer.observe(progress, { childList: true, subtree: true, characterData: true });

        // 3) Ocultar modal (no destruirlo — el JS sigue escribiendo en sus elementos)
        modal.style.display = 'none';

        if (typeof onClose === 'function') onClose();

        return true;
    }

    // Helpers globales invocados por los onclick de los modales
    window.nvMultiClienteBackground = function() {
        backgroundMigrate({
            modalSelector: '#nv-multi-cliente-modal',
            progressId: 'nv-mc-progress',
            jobLabel: 'Generando publicaciones multi-cliente',
        });
    };

    window.nvGenerarMesBackground = function() {
        backgroundMigrate({
            modalSelector: '#nv-generar-mes-modal',
            progressId: 'nv-genmes-progress',
            jobLabel: 'Generando mes de publicaciones',
        });
    };

    /**
     * Mostrar/ocultar el botón "background" según si hay un job corriendo.
     * Llamamos a esto desde dashboard.js cuando se inicia/termina un job.
     */
    window.nvShowBackgroundButton = function(modalType, show) {
        const id = modalType === 'mes' ? 'nv-genmes-background' : 'nv-mc-background';
        const btn = document.getElementById(id);
        if (btn) btn.style.display = show ? 'inline-block' : 'none';
    };

    // Auto-init cuando el DOM esté listo (intentará engancharse al calendario)
    $(function() {
        ensureToastStyles();
        ensureTrashBin();
        // Esperar a que dashboard.js termine de inicializar el calendario
        setTimeout(() => setupTrash(null), 1500);
    });

})(jQuery);
