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

        // Audio briefing dentro del wizard
        const $audio = $wizard.find('.aiwd-audio-card');
        if ($audio.length) {
            const endpoint = $audio.data('endpoint');
            let recorder, chunks = [];

            $audio.on('click', '.aiwd-rec-start', async function (e) {
                e.preventDefault();
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    recorder = new MediaRecorder(stream);
                    chunks = [];
                    recorder.ondataavailable = ev => chunks.push(ev.data);
                    recorder.onstop = () => { sendAudio(new Blob(chunks, { type: 'audio/webm' })); stream.getTracks().forEach(t => t.stop()); };
                    recorder.start();
                    $audio.find('.aiwd-rec-start').hide();
                    $audio.find('.aiwd-rec-stop').show();
                    $audio.find('.aiwd-rec-status').text('Grabando...').css('color', '#c0392b');
                } catch (err) { alert('Micrófono no accesible: ' + err.message); }
            });

            $audio.on('click', '.aiwd-rec-stop', function (e) {
                e.preventDefault();
                if (recorder && recorder.state === 'recording') recorder.stop();
                $audio.find('.aiwd-rec-stop').hide();
                $audio.find('.aiwd-rec-start').show();
                $audio.find('.aiwd-rec-status').text('Procesando con IA...').css('color', '#444');
            });

            $audio.on('change', '.aiwd-rec-upload', function () {
                const f = this.files[0];
                if (f) { $audio.find('.aiwd-rec-status').text('Procesando...'); sendAudio(f); }
            });

            function sendAudio(blob) {
                const fd = new FormData();
                fd.append('audio', blob, 'briefing.webm');
                fd.append('lang', 'es');
                fetch(endpoint, {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'X-WP-Nonce': AIWD.nonce },
                    body: fd,
                })
                    .then(r => r.json())
                    .then(res => {
                        if (res.transcript) {
                            $audio.find('.aiwd-rec-status').text('✅ Formulario rellenado. Recargando...').css('color', '#1a6b1a');
                            setTimeout(() => location.reload(), 1500);
                        } else {
                            $audio.find('.aiwd-rec-status').text('❌ ' + (res.message || 'Error')).css('color', '#c0392b');
                        }
                    })
                    .catch(err => $audio.find('.aiwd-rec-status').text('❌ ' + err.message));
            }
        }

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
