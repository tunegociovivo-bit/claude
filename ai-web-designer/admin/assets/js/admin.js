/* global AIWD, jQuery, wp */
(function ($) {
    'use strict';

    $(function () {
        initMediaPickers();
        initAIButtons();
        initBulkUpload();
    });

    function initMediaPickers() {
        $(document).on('click', '.aiwd-media-pick', function (e) {
            e.preventDefault();
            const $picker = $(this).closest('.aiwd-media-picker');
            const targetInput = $picker.find('input[type="hidden"]');
            const $preview = $picker.find('.aiwd-media-preview');

            const frame = wp.media({
                title: AIWD.i18n.select,
                multiple: false,
                library: { type: 'image' },
            });
            frame.on('select', function () {
                const att = frame.state().get('selection').first().toJSON();
                targetInput.val(att.id);
                $preview.html('<img src="' + att.url + '" />');
            });
            frame.open();
        });
    }

    function initAIButtons() {
        $(document).on('click', '.aiwd-ai-btn', function (e) {
            e.preventDefault();
            const $btn = $(this);
            const action = $btn.data('ai');
            const block = $btn.data('block') || '';
            const projectId = $('.aiwd-wizard').data('project-id');
            const original = $btn.text();
            $btn.prop('disabled', true).text(AIWD.i18n.generating);

            const endpoint = endpointFor(action);
            const body = bodyFor(action, projectId, block, $btn);

            fetch(AIWD.rest_url + endpoint, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': AIWD.nonce },
                body: JSON.stringify(body),
            })
                .then(r => r.json())
                .then(res => handleResult(action, res, $btn, block))
                .catch(err => alert('Error: ' + err.message))
                .finally(() => $btn.prop('disabled', false).text(original));
        });
    }

    function endpointFor(action) {
        if (action === 'scrape_domain') return 'scrape';
        if (action === 'generate_images' || action === 'generate_logo' || action === 'extract_palette_from_logo') return 'generate/image';
        if (action === 'analyze_references' || action === 'suggest_typography' || action === 'briefing_description' || action === 'briefing_audience' || action === 'tagline' || action === 'generate_text') return 'generate/text';
        if (action === 'variants_text') return 'generate/variants';
        if (action === 'suggest_keywords') return 'generate/seo';
        if (action === 'remove_backgrounds') return 'remove-bg';
        return 'generate/text';
    }

    function bodyFor(action, projectId, block, $btn) {
        if (action === 'scrape_domain') {
            const url = $('input[name="data[domain]"]').val();
            return { url };
        }
        if (action === 'generate_logo') {
            const bn = $('input[name="data[business_name]"]').val();
            return { prompt: 'Logo profesional minimalista para: ' + bn };
        }
        if (action === 'generate_images') {
            return { prompt: 'Imagen de portada profesional para el negocio', n: 3 };
        }
        if (action === 'variants_text') {
            return { project_id: projectId, block, n: 3 };
        }
        return { project_id: projectId, block: block || action };
    }

    function handleResult(action, res, $btn, block) {
        if (action === 'scrape_domain') {
            if (res.title) $('input[name="data[business_name]"]').val(res.title);
            if (res.description) $('textarea[name="data[description]"]').val(res.description);
            if (res.emails && res.emails[0]) $('input[name="data[email]"]').val(res.emails[0]);
            if (res.phones && res.phones[0]) $('input[name="data[phone]"]').val(res.phones[0]);
            if (res.colors) {
                if (res.colors[0]) $('input[name="data[color_primary]"]').val(res.colors[0]);
                if (res.colors[1]) $('input[name="data[color_secondary]"]').val(res.colors[1]);
            }
            if (res.social) {
                Object.entries(res.social).forEach(([k, v]) => {
                    $('input[name="data[social][' + k + ']"]').val(v);
                });
            }
            alert('✅ Información importada.');
            return;
        }
        if (action === 'generate_images' || action === 'generate_logo') {
            const $gal = $('#aiwd-gallery');
            (res.images || []).forEach(img => {
                $gal.append('<div class="item src-ai"><span class="badge">IA</span><img src="' + img.url + '" /><label><input type="checkbox" name="data[selected_images][]" value="' + img.id + '" checked /> Usar</label></div>');
            });
            return;
        }
        if (action === 'variants_text' && res.variants) {
            const $textarea = $('textarea[name="data[' + block + ']"]');
            const chosen = prompt('Variantes:\n\n' + res.variants.map((v, i) => (i + 1) + ') ' + v).join('\n\n') + '\n\n¿Cuál usar? (1-' + res.variants.length + ')');
            const idx = parseInt(chosen, 10) - 1;
            if (idx >= 0 && idx < res.variants.length) $textarea.val(res.variants[idx]);
            return;
        }
        if (res.text) {
            const $target = block ? $('textarea[name="data[' + block + ']"], input[name="data[' + block + ']"]') : $btn.closest('tr,div').find('textarea, input[type="text"]').first();
            $target.val(res.text);
        } else if (res.seo) {
            if (res.seo.meta_title) $('input[name="data[meta_title]"]').val(res.seo.meta_title);
            if (res.seo.meta_description) $('textarea[name="data[meta_description]"]').val(res.seo.meta_description);
            if (res.seo.keywords) $('input[name="data[keywords]"]').val(res.seo.keywords.join(', '));
        }
    }

    $(document).on('click', '#aiwd-asana-load-ws', function (e) {
        e.preventDefault();
        const $btn = $(this);
        const $out = $('#aiwd-asana-ws-result');
        $btn.prop('disabled', true);
        fetch(AIWD.rest_url + 'asana/workspaces', {
            credentials: 'same-origin',
            headers: { 'X-WP-Nonce': AIWD.nonce },
        })
            .then(r => r.json())
            .then(res => {
                if (Array.isArray(res)) {
                    $out.html(res.map(w => '<a href="#" class="aiwd-pick-ws" data-gid="' + w.gid + '">' + w.name + ' (' + w.gid + ')</a>').join(' · '));
                } else {
                    $out.text('Error: ' + (res.message || JSON.stringify(res)));
                }
            })
            .finally(() => $btn.prop('disabled', false));
    });

    $(document).on('click', '.aiwd-pick-ws', function (e) {
        e.preventDefault();
        $('input[name="aiwd_settings[asana_workspace]"]').val($(this).data('gid'));
    });

    $(document).on('click', '.aiwd-asana-link', function (e) {
        e.preventDefault();
        const pid = $(this).data('project');
        const q = window.prompt('Busca el proyecto Asana por nombre:');
        if (!q) return;
        fetch(AIWD.rest_url + 'asana/search?' + new URLSearchParams({ q }), {
            credentials: 'same-origin',
            headers: { 'X-WP-Nonce': AIWD.nonce },
        })
            .then(r => r.json())
            .then(res => {
                if (!Array.isArray(res) || !res.length) { alert('Sin resultados.'); return; }
                const choices = res.map((p, i) => (i + 1) + ') ' + p.name).join('\n');
                const pick = parseInt(window.prompt('Elige (1-' + res.length + '):\n\n' + choices, '1'), 10) - 1;
                if (isNaN(pick) || !res[pick]) return;
                fetch(AIWD.rest_url + 'project/' + pid + '/asana/link', {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': AIWD.nonce },
                    body: JSON.stringify({ asana_gid: res[pick].gid }),
                })
                    .then(r => r.json())
                    .then(out => {
                        if (out.project) { alert('✅ Vinculado.'); location.reload(); }
                        else alert('Error: ' + (out.message || JSON.stringify(out)));
                    });
            });
    });

    $(document).on('click', '.aiwd-asana-sync', function (e) {
        e.preventDefault();
        const $btn = $(this);
        const pid = $btn.data('project');
        $btn.prop('disabled', true).text('Sincronizando...');
        fetch(AIWD.rest_url + 'project/' + pid + '/asana/sync', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': AIWD.nonce },
            body: '{}',
        })
            .then(r => r.json())
            .then(res => {
                if (res.url) {
                    if (confirm('✅ Proyecto creado en Asana. ¿Abrir ahora?')) window.open(res.url, '_blank');
                    location.reload();
                } else {
                    alert('Error: ' + (res.message || JSON.stringify(res)));
                }
            })
            .finally(() => $btn.prop('disabled', false).text('Crear en Asana'));
    });

    $(document).on('click', '.aiwd-client-link', function (e) {
        e.preventDefault();
        const $btn = $(this);
        const pid = $btn.data('project');
        $btn.prop('disabled', true).text('Generando...');
        fetch(AIWD.rest_url + 'project/' + pid + '/token', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': AIWD.nonce },
            body: JSON.stringify({ ttl_days: 30 }),
        })
            .then(r => r.json())
            .then(res => {
                if (res.url) {
                    window.prompt('Comparte este enlace con tu cliente (válido 30 días):', res.url);
                }
            })
            .finally(() => $btn.prop('disabled', false).text('Enlace cliente'));
    });

    function initBulkUpload() {
        $(document).on('click', '.aiwd-bulk-upload', function (e) {
            e.preventDefault();
            const frame = wp.media({ title: 'Subir fotos', multiple: true, library: { type: 'image' } });
            frame.on('select', function () {
                const sel = frame.state().get('selection').toJSON();
                const $gal = $('#aiwd-gallery');
                sel.forEach(a => {
                    $gal.append('<div class="item"><img src="' + a.url + '" /><label><input type="checkbox" name="data[selected_images][]" value="' + a.id + '" checked /> Usar</label></div>');
                });
            });
            frame.open();
        });
    }
})(jQuery);
