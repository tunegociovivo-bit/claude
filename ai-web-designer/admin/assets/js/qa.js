/* global AIWD, jQuery */
(function ($) {
    'use strict';

    $(function () {
        const $wrap = $('.aiwd-qa');
        if (!$wrap.length) return;
        const projectId = $wrap.data('project');

        $wrap.on('click', '.aiwd-qa-run', function (e) {
            e.preventDefault();
            const $btn = $(this);
            $btn.prop('disabled', true).text('Ejecutando...');
            fetch(AIWD.rest_url + 'project/' + projectId + '/qa/run', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': AIWD.nonce },
                body: '{}',
            })
                .then(r => r.json())
                .then(() => location.reload())
                .catch(err => { alert('Error: ' + err.message); $btn.prop('disabled', false).text('Ejecutar checks automáticos'); });
        });

        $wrap.on('change', '.aiwd-qa-manual, .aiwd-qa-note', function () {
            const $row = $(this).closest('tr');
            const key = $row.data('key');
            const status = $row.find('.aiwd-qa-manual').val();
            const note = $row.find('.aiwd-qa-note').val();
            fetch(AIWD.rest_url + 'project/' + projectId + '/qa/manual', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': AIWD.nonce },
                body: JSON.stringify({ key, status, note }),
            })
                .then(r => r.json())
                .then(res => {
                    const icon = status === 'pass' ? '✅' : (status === 'fail' ? '❌' : '⚪');
                    $row.find('.aiwd-qa-icon').text(icon);
                    if (res.summary) {
                        $('.aiwd-qa-summary').toggleClass('ok', res.summary.required_failed === 0)
                                            .toggleClass('blocked', res.summary.required_failed !== 0);
                        $('.aiwd-qa-publish').prop('disabled', res.summary.required_failed !== 0);
                    }
                });
        });

        $wrap.on('click', '.aiwd-qa-publish', function (e) {
            e.preventDefault();
            if (!confirm('¿Marcar el proyecto como publicado?')) return;
            fetch(AIWD.rest_url + 'project/' + projectId + '/qa/publish', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': AIWD.nonce },
                body: '{}',
            })
                .then(r => r.json())
                .then(res => {
                    if (res.ok) { alert('✅ Proyecto publicado.'); location.reload(); }
                    else alert('🚫 ' + (res.message || 'No se puede publicar'));
                });
        });

        $wrap.on('click', '.aiwd-qa-override', function (e) {
            e.preventDefault();
            const reason = window.prompt('Razón del override (queda registrada):');
            if (!reason) return;
            fetch(AIWD.rest_url + 'project/' + projectId + '/qa/override', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': AIWD.nonce },
                body: JSON.stringify({ reason }),
            }).then(() => location.reload());
        });

        $wrap.on('click', '.aiwd-qa-override-clear', function (e) {
            e.preventDefault();
            if (!confirm('¿Quitar override?')) return;
            fetch(AIWD.rest_url + 'project/' + projectId + '/qa/override', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': AIWD.nonce },
                body: JSON.stringify({ clear: true }),
            }).then(() => location.reload());
        });
    });
})(jQuery);
