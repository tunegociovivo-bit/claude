/* global AIWD, jQuery */
(function ($) {
    'use strict';

    $(function () {
        const $wizard = $('.aiwd-wizard');
        if (!$wizard.length) return;

        const $steps = $wizard.find('.aiwd-steps li');
        const $sections = $wizard.find('.aiwd-step');

        function show(step) {
            $steps.removeClass('active').filter('[data-step="' + step + '"]').addClass('active');
            $sections.attr('hidden', true).filter('[data-step="' + step + '"]').removeAttr('hidden');
        }

        let current = 1;
        const max = $steps.length;
        show(current);

        $steps.on('click', function () { current = parseInt($(this).data('step'), 10); show(current); });
        $wizard.on('click', '.aiwd-next', function () { current = Math.min(max, current + 1); show(current); });
        $wizard.on('click', '.aiwd-prev', function () { current = Math.max(1, current - 1); show(current); });

        $wizard.on('click', '.aiwd-save', function () {
            saveDraft();
        });

        $wizard.on('click', '.aiwd-generate', function () {
            const mode = $(this).data('mode');
            const projectId = $wizard.data('project-id');
            const $out = $('#aiwd-generation-output');
            $out.text('Generando diseño con Claude...');

            fetch(AIWD.rest_url + 'generate/design', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': AIWD.nonce },
                body: JSON.stringify({ project_id: projectId, mode }),
            })
                .then(r => r.json())
                .then(res => {
                    $out.text(JSON.stringify(res, null, 2));
                })
                .catch(err => $out.text('Error: ' + err.message));
        });

        function saveDraft() {
            const projectId = $wizard.data('project-id');
            const form = document.getElementById('aiwd-wizard-form');
            const fd = new FormData(form);
            const obj = {};
            fd.forEach((v, k) => {
                if (k.startsWith('data[')) {
                    const path = k.replace('data[', '').replace(/]$/, '').split('][');
                    let cur = obj;
                    path.forEach((p, i) => {
                        if (i === path.length - 1) cur[p] = v;
                        else cur[p] = cur[p] || {};
                        if (i < path.length - 1) cur = cur[p];
                    });
                }
            });

            fetch(AIWD.rest_url + 'project/' + projectId + '/save', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': AIWD.nonce },
                body: JSON.stringify({ section: 'briefing', data: obj, note: 'Guardado desde wizard' }),
            })
                .then(r => r.json())
                .then(res => {
                    if (res.ok) alert('✅ Borrador guardado (v' + res.version + ')');
                });
        }
    });
})(jQuery);
