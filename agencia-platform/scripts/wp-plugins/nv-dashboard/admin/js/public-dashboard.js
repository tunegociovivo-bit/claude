/**
 * NV Dashboard · JS modo público
 *
 * Adapta el comportamiento del dashboard cuando se carga en la URL pública:
 *   - Cambia los enlaces internos para que apunten a la URL pública
 *     (no a /wp-admin/admin.php?page=nv-dashboard-editorial...)
 *   - En modo readonly oculta acciones de escritura
 *   - Soporta query string ?minimal=1 para esconder topbar/footer (útil en
 *     iframes muy pequeños)
 *
 * @since 1.0.5
 */
(function ($) {
    'use strict';

    $(document).ready(function () {

        // ─── Modo minimal (?minimal=1) ──────────────────────
        const params = new URLSearchParams(window.location.search);
        if (params.get('minimal') === '1') {
            document.body.classList.add('nv-minimal');
        }

        // ─── Modo readonly: bloquear acciones que escriben ──
        if (window.nvDashboard && window.nvDashboard.canEdit === false) {
            // Esconder botón aprobar mes y barra
            const approveBar = document.getElementById('nv-approve-bar');
            if (approveBar) approveBar.style.display = 'none';

            // Bloquear cualquier botón con onclick='nvApproveMonth()'
            $('[onclick*="nvApproveMonth"]').prop('disabled', true).attr('title', 'Inicia sesión para aprobar el mes');
        }

        // ─── Override de enlaces de admin a URL pública ─────
        // El dashboard.js original usa enlaces relativos tipo
        // ?page=nv-dashboard-editorial. En modo público necesitamos enlaces
        // absolutos a /nv-dashboard/?vista=editorial
        if (window.nvDashboard && window.nvDashboard.isPublic && window.nvDashboard.baseUrl) {
            const baseUrl = window.nvDashboard.baseUrl;
            $('a').each(function () {
                const $a = $(this);
                const href = $a.attr('href') || '';
                if (href.indexOf('?page=nv-dashboard-editorial') !== -1) {
                    $a.attr('href', baseUrl + '?vista=editorial');
                } else if (href.indexOf('?page=nv-dashboard-settings') !== -1) {
                    // En público no hay settings; redirigir a vista general
                    $a.attr('href', baseUrl);
                } else if (href === '?page=nv-dashboard' || href.indexOf('?page=nv-dashboard&') === 0) {
                    $a.attr('href', baseUrl);
                }
            });
        }
    });

})(jQuery);
