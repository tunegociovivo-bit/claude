/**
 * NV Dashboard — Drive Picker integration (v1.0.22)
 *
 * Carga gapi + Google Identity Services, gestiona OAuth token client-side,
 * y abre el Picker oficial para seleccionar carpetas Drive.
 *
 * Activado en el formulario de edición de cliente (NV_Cliente_Meta) si hay
 * credenciales en NV Dashboard → Configuración. Si no hay, los botones del
 * Picker no aparecen (el formulario sigue funcionando con URL/ID manual).
 *
 * También sirve de base para auto-crear estructura: el access token obtenido
 * aquí se reutiliza para llamar directamente a la Drive API desde el browser.
 */
(function () {
    'use strict';

    var CFG = window.nvDrivePicker || {};
    if (!CFG.clientId || !CFG.apiKey) {
        // Sin credenciales no montamos nada
        console.info('[NV Drive Picker] Credenciales no configuradas. Saltando.');
        return;
    }

    // Scopes:
    //  - drive.readonly: para que el Picker pueda navegar y previsualizar
    //  - drive.file:     para auto-crear carpetas (solo en archivos creados por la app)
    var SCOPES = 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file';

    var pickerApiLoaded = false;
    var gapiLoaded = false;
    var tokenClient = null;
    var accessToken = null;

    // ─────────────────────────────────────────────────────────────────────
    // Carga de scripts Google
    // ─────────────────────────────────────────────────────────────────────

    function loadScript(src, onLoad) {
        var existing = document.querySelector('script[src="' + src + '"]');
        if (existing) {
            if (existing.dataset.loaded === '1') { onLoad(); return; }
            existing.addEventListener('load', onLoad);
            return;
        }
        var s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.defer = true;
        s.onload = function () { s.dataset.loaded = '1'; onLoad(); };
        s.onerror = function () { console.error('[NV Drive Picker] Falló al cargar', src); };
        document.head.appendChild(s);
    }

    function ensureGapiAndPicker(callback) {
        loadScript('https://apis.google.com/js/api.js', function () {
            window.gapi.load('picker', function () {
                pickerApiLoaded = true;
                gapiLoaded = true;
                callback();
            });
        });
    }

    function ensureGsiClient(callback) {
        loadScript('https://accounts.google.com/gsi/client', function () {
            if (!tokenClient) {
                tokenClient = window.google.accounts.oauth2.initTokenClient({
                    client_id: CFG.clientId,
                    scope: SCOPES,
                    callback: '', // se asigna por uso
                });
            }
            callback();
        });
    }

    function requestAccessToken(onSuccess, onError) {
        if (accessToken) {
            // Token cacheado durante esta sesión de página
            onSuccess(accessToken);
            return;
        }
        ensureGsiClient(function () {
            tokenClient.callback = function (resp) {
                if (resp.error) {
                    if (onError) onError(resp);
                    return;
                }
                accessToken = resp.access_token;
                onSuccess(accessToken);
            };
            try {
                tokenClient.requestAccessToken({ prompt: 'consent' });
            } catch (e) {
                if (onError) onError({ error: 'request_failed', message: e.message });
            }
        });
    }

    // ─────────────────────────────────────────────────────────────────────
    // Picker — selección de carpetas
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Abre el Picker para seleccionar UNA carpeta (raíz del cliente).
     * @param {function(folder)} onPick  recibe { id, name, parentId }
     */
    function pickRootFolder(onPick) {
        requestAccessToken(function (token) {
            ensureGapiAndPicker(function () {
                var view = new window.google.picker.DocsView()
                    .setIncludeFolders(true)
                    .setSelectFolderEnabled(true)
                    .setMimeTypes('application/vnd.google-apps.folder');

                var picker = new window.google.picker.PickerBuilder()
                    .addView(view)
                    .setOAuthToken(token)
                    .setDeveloperKey(CFG.apiKey)
                    .setTitle('Selecciona la carpeta raíz del cliente')
                    .setCallback(function (data) {
                        if (data.action === window.google.picker.Action.PICKED) {
                            var doc = data.docs && data.docs[0];
                            if (doc && onPick) onPick({ id: doc.id, name: doc.name, parentId: doc.parentId });
                        }
                    })
                    .build();
                picker.setVisible(true);
            });
        }, function (err) {
            alert('No se pudo obtener el token de Google: ' + (err.error || err.message || 'desconocido'));
        });
    }

    /**
     * Abre el Picker para seleccionar MÚLTIPLES carpetas (subcarpetas).
     * Si parentId está definido, el Picker arranca en esa carpeta padre.
     * @param {string|null} parentId
     * @param {function(folders[])} onPick  recibe array de { id, name, parentId }
     */
    function pickMultipleSubfolders(parentId, onPick) {
        requestAccessToken(function (token) {
            ensureGapiAndPicker(function () {
                var view = new window.google.picker.DocsView()
                    .setIncludeFolders(true)
                    .setSelectFolderEnabled(true)
                    .setMimeTypes('application/vnd.google-apps.folder');
                if (parentId) {
                    view.setParent(parentId);
                }

                var picker = new window.google.picker.PickerBuilder()
                    .enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED)
                    .addView(view)
                    .setOAuthToken(token)
                    .setDeveloperKey(CFG.apiKey)
                    .setTitle('Selecciona las subcarpetas a registrar')
                    .setCallback(function (data) {
                        if (data.action === window.google.picker.Action.PICKED) {
                            var picks = (data.docs || []).map(function (d) {
                                return { id: d.id, name: d.name, parentId: d.parentId };
                            });
                            if (onPick) onPick(picks);
                        }
                    })
                    .build();
                picker.setVisible(true);
            });
        }, function (err) {
            alert('No se pudo obtener el token de Google: ' + (err.error || err.message || 'desconocido'));
        });
    }

    // ─────────────────────────────────────────────────────────────────────
    // Auto-create estructura — Drive API directo desde el browser
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Crea una carpeta dentro de un parent. Devuelve Promise<{id, name}>.
     */
    function driveCreateFolder(name, parentId, token) {
        return fetch('https://www.googleapis.com/drive/v3/files', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                name: name,
                mimeType: 'application/vnd.google-apps.folder',
                parents: parentId ? [parentId] : undefined,
            }),
        }).then(function (r) {
            if (!r.ok) return r.text().then(function (t) { throw new Error('Drive create folder failed (' + r.status + '): ' + t); });
            return r.json();
        });
    }

    /**
     * Crea una estructura completa bajo `parentId`.
     * spec = { rootName: "Clínica X", subfolders: [{ name, type }, ...] }
     * Devuelve Promise<{ rootId, subfolders: [{ name, type, id }] }>.
     */
    function autoCreateStructure(parentId, spec, onProgress) {
        return new Promise(function (resolve, reject) {
            requestAccessToken(function (token) {
                if (onProgress) onProgress('Creando carpeta raíz "' + spec.rootName + '"…');
                driveCreateFolder(spec.rootName, parentId, token).then(function (root) {
                    var rootId = root.id;
                    var results = [];
                    var i = 0;
                    function next() {
                        if (i >= spec.subfolders.length) {
                            resolve({ rootId: rootId, rootName: root.name, subfolders: results });
                            return;
                        }
                        var sf = spec.subfolders[i++];
                        if (onProgress) onProgress('Creando subcarpeta "' + sf.name + '" (' + i + '/' + spec.subfolders.length + ')…');
                        driveCreateFolder(sf.name, rootId, token).then(function (created) {
                            results.push({ name: sf.name, type: sf.type, id: created.id });
                            next();
                        }).catch(reject);
                    }
                    next();
                }).catch(reject);
            }, reject);
        });
    }

    // ─────────────────────────────────────────────────────────────────────
    // Hooks en el formulario de cliente
    // ─────────────────────────────────────────────────────────────────────

    function initFormButtons() {
        // Botón "📁 Seleccionar de Drive" para la carpeta raíz
        var rootInput = document.querySelector('input[name="nv_drive_root_id"]');
        if (rootInput && !document.getElementById('nv-pick-root-btn')) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.id = 'nv-pick-root-btn';
            btn.className = 'button';
            btn.style.cssText = 'margin-left:8px;';
            btn.textContent = '📁 Seleccionar de Drive';
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                pickRootFolder(function (folder) {
                    rootInput.value = folder.id;
                    // Trigger validation
                    var ev = document.createEvent('Event');
                    ev.initEvent('blur', true, true);
                    rootInput.dispatchEvent(ev);
                    // Mostrar el nombre seleccionado al usuario
                    var fb = rootInput.parentElement.querySelector('.nv-drive-id-feedback');
                    if (fb) {
                        fb.textContent = '✓ Seleccionado: "' + folder.name + '" (ID ' + folder.id + ')';
                        fb.className = 'description nv-drive-id-feedback ok';
                    }
                });
            });
            rootInput.parentNode.insertBefore(btn, rootInput.nextSibling);
        }

        // Botón "📁 Añadir desde Drive" para subcarpetas múltiples
        var addBtn = document.querySelector('.nv-drive-add-subfolder');
        if (addBtn && !document.getElementById('nv-pick-subs-btn')) {
            var pickBtn = document.createElement('button');
            pickBtn.type = 'button';
            pickBtn.id = 'nv-pick-subs-btn';
            pickBtn.className = 'button';
            pickBtn.style.cssText = 'margin-left:8px;';
            pickBtn.textContent = '📁 Añadir desde Drive…';
            pickBtn.addEventListener('click', function (e) {
                e.preventDefault();
                var parentId = rootInput && rootInput.value && rootInput.value.match(/^[a-zA-Z0-9_-]{20,60}$/) ? rootInput.value : null;
                pickMultipleSubfolders(parentId, function (folders) {
                    folders.forEach(function (f) {
                        // Inferir tipo desde el nombre (mismo heurístico que la migración PHP)
                        var type = inferTypeFromName(f.name);
                        addSubfolderRow(f.name, f.id, type);
                    });
                });
            });
            addBtn.parentNode.insertBefore(pickBtn, addBtn.nextSibling);
        }

        // Botón "✨ Auto-crear estructura"
        if (rootInput && !document.getElementById('nv-auto-create-btn')) {
            var autoBtn = document.createElement('button');
            autoBtn.type = 'button';
            autoBtn.id = 'nv-auto-create-btn';
            autoBtn.className = 'button';
            autoBtn.style.cssText = 'margin-left:8px; background:#fff7e0;';
            autoBtn.textContent = '✨ Auto-crear estructura…';
            autoBtn.title = 'Crea una carpeta del cliente en REFS NV con subcarpetas estándar para su tipo';
            autoBtn.addEventListener('click', function (e) {
                e.preventDefault();
                openAutoCreateModal();
            });
            // Insertarlo junto al botón Picker
            var pickRootBtn = document.getElementById('nv-pick-root-btn');
            if (pickRootBtn) pickRootBtn.parentNode.insertBefore(autoBtn, pickRootBtn.nextSibling);
            else rootInput.parentNode.insertBefore(autoBtn, rootInput.nextSibling);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Auto-crear estructura: modal de selección de plantilla
    // ─────────────────────────────────────────────────────────────────────

    var TEMPLATES = {
        clinica_medica: {
            label: '🏥 Clínica médica / estética',
            description: 'Persona destacada (CEO/médico), Equipo, Pacientes, Instalaciones, Logo y brand',
            subfolders: [
                { name: 'Persona destacada (CEO)', type: 'persona_destacada' },
                { name: 'Equipo / Trabajadores',   type: 'equipo' },
                { name: 'Pacientes (con consentimiento RGPD)', type: 'pacientes_usuarios' },
                { name: 'Instalaciones',           type: 'instalaciones' },
                { name: 'Logo y brand',            type: 'logo_brand' },
            ],
        },
        agencia_negocio: {
            label: '💼 Agencia / Negocio propio',
            description: 'Persona destacada (CEO), Equipo, Logo y brand',
            subfolders: [
                { name: 'Persona destacada (CEO)', type: 'persona_destacada' },
                { name: 'Equipo',                  type: 'equipo' },
                { name: 'Logo y brand',            type: 'logo_brand' },
            ],
        },
        profesional_independiente: {
            label: '⚖️ Profesional / Despacho',
            description: 'Persona destacada, Despacho/Instalaciones, Logo y brand',
            subfolders: [
                { name: 'Persona destacada',       type: 'persona_destacada' },
                { name: 'Despacho / Instalaciones',type: 'instalaciones' },
                { name: 'Logo y brand',            type: 'logo_brand' },
            ],
        },
        ecommerce_b2c: {
            label: '🛒 Ecommerce / B2C',
            description: 'Productos, Instalaciones, Logo y brand',
            subfolders: [
                { name: 'Productos',               type: 'productos' },
                { name: 'Instalaciones',           type: 'instalaciones' },
                { name: 'Logo y brand',            type: 'logo_brand' },
            ],
        },
        empty: {
            label: '⚪ Vacío (solo carpeta raíz)',
            description: 'Crea solo la carpeta raíz, sin subcarpetas',
            subfolders: [],
        },
    };

    function openAutoCreateModal() {
        // Modal simple inline
        var modal = document.createElement('div');
        modal.id = 'nv-auto-create-modal';
        modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,.5); z-index:160000; display:flex; align-items:center; justify-content:center;';
        var clienteName = (document.querySelector('input[name="name"]') || {}).value
                       || (document.querySelector('#name') || {}).value
                       || (document.querySelector('h1.wp-heading-inline') || {}).textContent
                       || 'Cliente';
        modal.innerHTML = ''
          + '<div style="background:#fff; border-radius:8px; padding:24px; max-width:560px; width:90%; max-height:90vh; overflow:auto;">'
          + '<h2 style="margin:0 0 12px;">✨ Auto-crear estructura Drive</h2>'
          + '<p>Voy a crear una carpeta nueva en Drive bajo la carpeta padre que indiques (ej: REFS NV), con el nombre del cliente y las subcarpetas según la plantilla que elijas.</p>'
          + '<div style="margin:14px 0;">'
          + '<label style="display:block; margin-bottom:4px; font-weight:600;">Carpeta padre (donde colgará la nueva del cliente):</label>'
          + '<input type="text" id="nv-auto-parent-id" placeholder="ID de carpeta padre (ej: REFS NV)" style="width:100%; font-family:monospace; font-size:12px; margin-bottom:6px;" />'
          + '<button type="button" id="nv-auto-pick-parent" class="button">📁 Seleccionar de Drive</button>'
          + '</div>'
          + '<div style="margin:14px 0;">'
          + '<label style="display:block; margin-bottom:4px; font-weight:600;">Nombre de la carpeta nueva:</label>'
          + '<input type="text" id="nv-auto-folder-name" value="' + clienteName.replace(/"/g, '&quot;') + '" style="width:100%; font-size:13px;" />'
          + '</div>'
          + '<div style="margin:14px 0;">'
          + '<label style="display:block; margin-bottom:4px; font-weight:600;">Plantilla:</label>'
          + '<div id="nv-auto-templates" style="display:flex; flex-direction:column; gap:8px;"></div>'
          + '</div>'
          + '<div id="nv-auto-progress" style="margin:14px 0; min-height:24px; color:#0073aa;"></div>'
          + '<div style="display:flex; gap:8px; justify-content:flex-end; margin-top:18px;">'
          + '<button type="button" id="nv-auto-cancel" class="button">Cancelar</button>'
          + '<button type="button" id="nv-auto-go" class="button button-primary">Crear estructura</button>'
          + '</div>'
          + '</div>';

        document.body.appendChild(modal);

        // Render templates
        var tmplBox = modal.querySelector('#nv-auto-templates');
        Object.keys(TEMPLATES).forEach(function (key, idx) {
            var t = TEMPLATES[key];
            var label = document.createElement('label');
            label.style.cssText = 'display:flex; align-items:flex-start; gap:8px; padding:8px 10px; border:1px solid #ddd; border-radius:4px; cursor:pointer;';
            label.innerHTML = '<input type="radio" name="nv-auto-tmpl" value="' + key + '"' + (idx === 0 ? ' checked' : '') + ' />'
                + '<span><strong>' + t.label + '</strong><br><small style="color:#555;">' + t.description + '</small></span>';
            tmplBox.appendChild(label);
        });

        // Handlers
        modal.querySelector('#nv-auto-cancel').addEventListener('click', function () {
            modal.remove();
        });
        modal.querySelector('#nv-auto-pick-parent').addEventListener('click', function () {
            pickRootFolder(function (folder) {
                modal.querySelector('#nv-auto-parent-id').value = folder.id;
            });
        });
        modal.querySelector('#nv-auto-go').addEventListener('click', function () {
            var parentId = modal.querySelector('#nv-auto-parent-id').value.trim();
            var folderName = modal.querySelector('#nv-auto-folder-name').value.trim();
            var tmplKey = (modal.querySelector('input[name="nv-auto-tmpl"]:checked') || {}).value;
            if (!parentId || !folderName || !tmplKey) {
                alert('Falta carpeta padre, nombre o plantilla.');
                return;
            }
            // Permitir pegar URL en parent
            var pm = parentId.match(/\/folders\/([a-zA-Z0-9_-]{20,60})/);
            if (pm) parentId = pm[1];
            if (!/^[a-zA-Z0-9_-]{20,60}$/.test(parentId)) {
                alert('La carpeta padre no parece un ID Drive válido.');
                return;
            }
            var tmpl = TEMPLATES[tmplKey];
            modal.querySelector('#nv-auto-go').disabled = true;
            modal.querySelector('#nv-auto-cancel').disabled = true;
            var prog = modal.querySelector('#nv-auto-progress');
            autoCreateStructure(parentId, { rootName: folderName, subfolders: tmpl.subfolders }, function (msg) {
                prog.textContent = msg;
            }).then(function (result) {
                prog.innerHTML = '<span style="color:#2ea043;">✅ Estructura creada. Aplicando al formulario…</span>';
                applyAutoCreateResultToForm(result);
                setTimeout(function () { modal.remove(); }, 800);
            }).catch(function (err) {
                prog.innerHTML = '<span style="color:#c00;">❌ Error: ' + (err.message || err) + '</span>';
                modal.querySelector('#nv-auto-go').disabled = false;
                modal.querySelector('#nv-auto-cancel').disabled = false;
            });
        });
    }

    function applyAutoCreateResultToForm(result) {
        // Marcar modo "configured"
        var configRadio = document.querySelector('input[name="nv_drive_mode"][value="configured"]');
        if (configRadio) {
            configRadio.checked = true;
            configRadio.dispatchEvent(new Event('change', { bubbles: true }));
        }
        // Setear root_id
        var rootInput = document.querySelector('input[name="nv_drive_root_id"]');
        if (rootInput) {
            rootInput.value = result.rootId;
            rootInput.dispatchEvent(new Event('blur', { bubbles: true }));
        }
        // Añadir subfolders
        result.subfolders.forEach(function (sf) {
            addSubfolderRow(sf.name, sf.id, sf.type);
        });
    }

    // ─────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────

    function addSubfolderRow(name, id, type) {
        // Reusar el botón "+ Añadir subcarpeta" para que mantenga el contador idx
        var addBtn = document.querySelector('.nv-drive-add-subfolder');
        if (!addBtn) return;
        addBtn.click(); // crea fila vacía
        // Coger la última fila creada y rellenarla
        var rows = document.querySelectorAll('.nv-drive-subfolder-row');
        var last = rows[rows.length - 1];
        if (!last) return;
        last.querySelector('input[name$="[name]"]').value = name;
        var idInput = last.querySelector('input[name$="[id]"]');
        idInput.value = id;
        idInput.dispatchEvent(new Event('blur', { bubbles: true }));
        var typeSel = last.querySelector('select[name$="[type]"]');
        if (typeSel) typeSel.value = type;
    }

    function inferTypeFromName(name) {
        var n = (name || '').toLowerCase();
        if (/(ceo|founder|fundador|director|cara|principal|destacad)/.test(n)) return 'persona_destacada';
        if (/(equipo|trabajador|empleado|staff|team)/.test(n)) return 'equipo';
        if (/(paciente|usuario|customer)/.test(n)) return 'pacientes_usuarios';
        if (/(instalaci|oficina|local|cl[ií]nica|edificio|sede)/.test(n)) return 'instalaciones';
        if (/(producto|product|catalog)/.test(n)) return 'productos';
        if (/(logo|brand|marca|paleta|identidad)/.test(n)) return 'logo_brand';
        return 'otros';
    }

    // ─────────────────────────────────────────────────────────────────────
    // Init
    // ─────────────────────────────────────────────────────────────────────

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initFormButtons);
    } else {
        initFormButtons();
    }
})();
