/**
 * NV Claude Widget - JS
 *
 * Construye el mensaje contextual con todos los datos de la publicación
 * y abre claude.ai/new?q=... en una pestaña nueva.
 *
 * @since 1.0.4
 */
(function ($) {
    'use strict';

    /**
     * Mapas de etiquetas legibles
     */
    const TIPO_LABELS = {
        imagen: 'IMAGEN',
        video: 'VÍDEO',
        copy: 'COPY',
        hashtags: 'HASHTAGS',
        estrategia: 'ESTRATEGIA',
        otro: 'OTRO',
    };

    /**
     * v1.0.73: IDs constantes de la memoria operativa NV en Google Drive.
     *
     * El "Claude externo" (claude.ai en pestaña nueva) NO tiene contexto
     * persistente entre conversaciones, y la memoria interna que cada chat
     * acumula por su cuenta puede quedarse desactualizada. La fuente de
     * verdad operativa de la agencia vive en este documento de Drive y
     * Claude debe leerlo SIEMPRE antes de empezar un trabajo de vídeo
     * (pipeline Seedream V4.5 Edit → Seedance Pro 1080p → ElevenLabs →
     *  Freepik AI music → FFmpeg, reglas Reels NV v1–v13, etc.).
     *
     * Si David mueve el doc o cambia los IDs, basta con actualizar estas
     * constantes y reempaquetar el plugin (no hace falta tocar nada más).
     */
    const NV_MEMORIA_OPERATIVA = {
        doc_master_file_id: '1Ss-Jr0O1rvxeDRJola-_wdZmK5bNZICK',
        doc_master_title:   '🧠 MEMORIA OPERATIVA NEGOCIO VIVO',
        doc_master_url:     'https://drive.google.com/file/d/1Ss-Jr0O1rvxeDRJola-_wdZmK5bNZICK/view',
        refs_root_folder_id:'1Z2Hr5Ec-11RCKX00vtKrnPAt8RzgkrCx',
    };

    /**
     * v1.0.18: Cache + fetcher de cliente-config.
     *
     * Antes de abrir Claude para una revisión de imagen, llamamos a
     * /wp-json/nv/v1/cliente-config/{slug} para conocer:
     *   - Qué modelo de IA está configurado para este cliente (gpt-image-2,
     *     seedream, nano-banana-pro, etc.) — para que Claude no improvise.
     *   - La OpenAI API key si el modelo es gpt-image-2.
     *   - Las refs Drive del cliente (root_folder_id + cliente_folder con
     *     subcarpetas).
     *
     * Sin esto el mensaje no incluía info de modelo, y Claude elegía un
     * modelo distinto al configurado (caso reportado 30/04: post 15430
     * Clínica March, configurado gpt-image-2, Claude proponía Nano Banana).
     */
    let _clienteConfigCache = null;
    function fetchClienteConfig() {
        if (_clienteConfigCache) return Promise.resolve(_clienteConfigCache);

        const ctx = window.nvClaudeWidget || {};
        const slug = ctx.clienteSlug;
        if (!slug || !ctx.restUrl) return Promise.resolve(null);

        return $.ajax({
            url: ctx.restUrl + 'cliente-config/' + encodeURIComponent(slug),
            method: 'GET',
            headers: { 'X-WP-Nonce': ctx.restNonce || '' },
        }).then(function (data) {
            _clienteConfigCache = data;
            return data;
        }).catch(function (xhr) {
            console.warn('[NV Claude Widget] No se pudo leer cliente-config para "' + slug + '":', xhr.status, xhr.statusText);
            return null;
        });
    }

    /**
     * Recoge los valores actuales de los campos ACF que están abiertos en la
     * página de edición (puede que el usuario haya editado y no guardado)
     * para reflejar el estado más reciente.
     */
    function readCurrentACF() {
        const ctx = Object.assign({}, window.nvClaudeWidget || {});

        // Intentar leer ACF dinámicamente (si está editando sin guardar)
        const tryField = (key, selector) => {
            const $el = $(selector);
            if ($el.length && $el.val() !== undefined) {
                const val = $el.val();
                if (val !== '' && val !== null) {
                    ctx[key] = val;
                }
            }
        };

        tryField('fecha', '[data-name="nv_fecha_publicacion"] input, [name="acf[field_nv_fecha]"]');
        tryField('tipo', '[data-name="nv_tipo"] select, [data-name="nv_tipo"] input');
        tryField('copy', '[data-name="nv_copy"] textarea');
        tryField('hashtags', '[data-name="nv_hashtags"] textarea, [data-name="nv_hashtags"] input');
        tryField('assetUrl', '[data-name="nv_asset_url"] input');
        tryField('primerComentario', '[data-name="nv_first_comment"] textarea');

        // Título actual
        const $titleInput = $('#title');
        if ($titleInput.length && $titleInput.val()) {
            ctx.titulo = $titleInput.val();
        }

        return ctx;
    }

    /**
     * Convierte un array de redes en string legible
     */
    function redesToString(redes) {
        if (!redes || !redes.length) return '(no especificadas)';
        if (Array.isArray(redes)) return redes.join(', ');
        return String(redes);
    }

    /**
     * Construye el mensaje completo que se enviará a Claude.
     *
     * @param {string} tipoRevision  Una de las claves de TIPO_LABELS.
     * @param {string} orden         Texto de la orden que escribió David.
     * @param {object|null} cfg      Respuesta de /cliente-config/{slug} (v1.0.18).
     *                               Null si no se pudo fetchear o si el cliente no existe.
     */
    function buildMessage(tipoRevision, orden, cfg) {
        const ctx = readCurrentACF();
        const tipoLabel = TIPO_LABELS[tipoRevision] || 'OTRO';

        const lines = [];

        lines.push('Hola Claude, necesito que revises esta publicación del calendario editorial de Negocio Vivo.');
        lines.push('');
        lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        lines.push('📋 CONTEXTO DE LA PUBLICACIÓN');
        lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        lines.push('');
        lines.push('• ID publicación WP: ' + (ctx.postId || ''));
        lines.push('• Título: ' + (ctx.titulo || '(sin título)'));
        lines.push('• Cliente: ' + (ctx.cliente || ''));
        lines.push('• Tipo contenido: ' + (ctx.tipo || '(sin tipo)'));
        lines.push('• Fecha programada: ' + (ctx.fecha || '(sin fecha)'));
        lines.push('• Redes sociales: ' + redesToString(ctx.redes));
        lines.push('• Estado: ' + (ctx.estado || 'borrador'));
        lines.push('• Auto-publicar: ' + (ctx.autoPublish ? 'SÍ' : 'NO'));
        lines.push('');

        if (ctx.copy) {
            lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            lines.push('✍️ COPY ACTUAL');
            lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            lines.push('');
            lines.push(ctx.copy);
            lines.push('');
        }

        if (ctx.hashtags) {
            lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            lines.push('#️⃣ HASHTAGS');
            lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            lines.push('');
            lines.push(ctx.hashtags);
            lines.push('');
        }

        if (ctx.primerComentario) {
            lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            lines.push('💬 PRIMER COMENTARIO');
            lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            lines.push('');
            lines.push(ctx.primerComentario);
            lines.push('');
        }

        lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        lines.push('🔗 ENLACES Y ASSETS');
        lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        lines.push('');
        if (ctx.assetUrl) {
            lines.push('• Asset principal: ' + ctx.assetUrl);
        }
        if (ctx.assetsExtras) {
            // Si es un array JSON, listarlo; si es string, ponerlo tal cual
            try {
                const extras = typeof ctx.assetsExtras === 'string' ? JSON.parse(ctx.assetsExtras) : ctx.assetsExtras;
                if (Array.isArray(extras)) {
                    extras.forEach((u, i) => lines.push('• Asset extra ' + (i + 1) + ': ' + u));
                } else {
                    lines.push('• Assets extras: ' + ctx.assetsExtras);
                }
            } catch (e) {
                lines.push('• Assets extras: ' + ctx.assetsExtras);
            }
        }
        lines.push('• Editar en WP: ' + (ctx.editUrl || ''));
        lines.push('• REST API publicación: ' + (ctx.siteUrl || '') + 'wp-json/wp/v2/nv_publicacion/' + (ctx.postId || ''));
        lines.push('• Endpoint actualizar: ' + (ctx.siteUrl || '') + 'wp-json/nv/v1/actualizar-publicacion/' + (ctx.postId || ''));
        lines.push('');

        // v1.0.18: Bloque modelo configurado + refs Drive — solo para revisiones de imagen.
        // Antes (v1.0.17) los refs venían del `nvClaudeWidget` localizado, sin modelo.
        // Ahora ambos vienen de /cliente-config/{slug} para que sean consistentes con
        // el flujo de "Generar imágenes con Claude" del calendario (dashboard.js) y
        // para que el modelo configurado por cliente sea visible al chat externo.
        if (tipoRevision === 'imagen') {

            // Bloque 1: modelo IA configurado para este cliente
            if (cfg && cfg.modelo) {
                lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                lines.push('🤖 MODELO DE IMAGEN CONFIGURADO');
                lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                lines.push('');
                const mInfo = cfg.modelo_info || {};
                lines.push('Modelo:    ' + cfg.modelo + (mInfo.label ? ' (' + mInfo.label + ')' : ''));
                if (mInfo.provider) lines.push('Provider:  ' + mInfo.provider);
                if (mInfo.endpoint) lines.push('Endpoint público:  ' + mInfo.endpoint);
                if (cfg.override_per_cliente) {
                    lines.push('(Override per-cliente; default global = ' + (cfg.modelo_default_global || 'seedream-v4-5-edit') + ')');
                }
                if (cfg.openai_required) {
                    const apiToken = ctx.apiToken || '{NV_API_TOKEN_NO_DISPONIBLE}';
                    lines.push('');
                    lines.push('🔒 LA OPENAI KEY NO ESTÁ EN ESTE PROMPT POR SEGURIDAD.');
                    lines.push('');
                    lines.push('Para llamar a OpenAI, USA EL PROXY del plugin (gestiona la key server-side):');
                    lines.push('');
                    lines.push('   POST ' + (ctx.siteUrl || '') + 'wp-json/nv/v1/openai-image-proxy/' + (ctx.postId || ''));
                    lines.push('   Authorization: Bearer ' + apiToken);
                    lines.push('   Content-Type: application/json');
                    lines.push('   Body JSON:');
                    lines.push('     {');
                    lines.push('       "operation": "edit",                ← "edit" para retocar foto real | "generate" para crear desde cero');
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
                    lines.push('   Este Bearer token también vale para los demás endpoints /wp-json/nv/v1/');
                    lines.push('   (subir-imagen-post, actualizar-publicacion, registrar-revision, etc.).');
                }
                lines.push('');
                lines.push('IMPORTANTE: usa EL MODELO CONFIGURADO ARRIBA. NO improvises otro');
                lines.push('(Nano Banana Pro, Seedream, Mystic) si aquí está configurado uno distinto.');
                lines.push('');
            } else if (cfg === null) {
                lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                lines.push('⚠️ MODELO DE IMAGEN — NO CONFIGURADO');
                lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                lines.push('');
                lines.push('No se pudo leer la configuración de cliente-config. PARAR y avisar a David');
                lines.push('antes de elegir modelo IA — no improvises.');
                lines.push('');
            }

            // v1.0.19: Bloque scope — clarifica que esto es marketing legítimo de agencia
            // con consentimiento, no deepfake. Reduce variabilidad ética del Claude externo.
            lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            lines.push('📜 CONTEXTO Y SCOPE DEL TRABAJO');
            lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            lines.push('');
            lines.push('David Díaz Ríos es CEO de Negocio Vivo, agencia de marketing digital');
            lines.push('contratada por el cliente. La persona que aparezca en las refs es el');
            lines.push('CEO o equipo del cliente, posando voluntariamente para material de feed.');
            lines.push('Hay consentimiento expreso documentado y relación contractual vigente.');
            lines.push('');
            lines.push('FLUJO POR DEFECTO = EDICIÓN, NO SÍNTESIS:');
            lines.push('  - Toma UNA foto real de Drive (la mejor para la composición pedida)');
            lines.push('  - Aplica edits sobre ella: retoque de color, encuadre, recorte, fondo,');
            lines.push('    overlay de copy/marca, ajuste de iluminación. SIN regenerar el rostro.');
            lines.push('  - operation="edit" en el proxy con esa foto en image_urls.');
            lines.push('');
            lines.push('Si la orden literal dice "regenerar imagen completa", interprétalo como');
            lines.push('"crear nueva composición de feed sobre foto real existente", NO como');
            lines.push('"sintetizar una versión nueva de la cara del CEO".');
            lines.push('');
            lines.push('Solo usa operation="generate" (sin foto base) para escenas SIN persona');
            lines.push('identificable: detalles de manos, instalaciones de la clínica, planos');
            lines.push('de productos, etc. Esto evita cualquier ambigüedad ética.');
            lines.push('');

            // Bloque 2: refs Drive — v1.0.21 con tres ramas según drive_mode
            const refs = cfg && cfg.refs_drive ? cfg.refs_drive : null;
            const driveMode = refs && refs.drive_mode ? refs.drive_mode : 'pending';

            if (driveMode === 'no_drive_refs') {
                // Cliente que no usa refs de Drive (decisión explícita de David)
                lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                lines.push('📁 REFS VISUALES — NO APLICA PARA ESTE CLIENTE');
                lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                lines.push('');
                lines.push('David ha marcado este cliente como "no usa Drive refs".');
                lines.push('Genera la imagen sin reference_images / sin foto base.');
                lines.push('Usa operation="generate" en el proxy con un prompt descriptivo');
                lines.push('completo basado en la sugerencia visual del primer comentario.');
                lines.push('');
                lines.push('NO pares a preguntar por refs — esta decisión está tomada.');
                lines.push('');
            } else if (driveMode === 'configured' && refs.cliente_folder && refs.cliente_folder.root_id) {
                // Cliente con refs configuradas — flujo normal
                const cf = refs.cliente_folder;
                lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                lines.push('🚨 REFS VISUALES — REGLA CRÍTICA');
                lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                lines.push('');
                lines.push('Fuente canónica ÚNICA: Google Drive, carpeta REFS NV');
                if (refs.root_folder_id) {
                    lines.push('Root folder ID: ' + refs.root_folder_id);
                }
                lines.push('');
                lines.push('PROHIBIDO usar Asana, web del cliente, Slack u otras fuentes');
                lines.push('como sustituto. Si las refs no están en Drive, PARAR y avisar a David');
                lines.push('— NO improvisar.');
                lines.push('');
                lines.push('Subcarpeta raíz del cliente:');
                lines.push('  ID: ' + cf.root_id);

                // v1.0.21: subfolders_v2 con tipos semánticos
                const typed = cf.subfolders_v2 && cf.subfolders_v2.length ? cf.subfolders_v2 : null;
                if (typed) {
                    lines.push('');
                    lines.push('Sub-niveles (con tipo semántico — usa el más adecuado a la escena):');
                    typed.forEach(function(sf) {
                        lines.push('  • [' + sf.type + '] ' + sf.name + ' → ' + sf.id);
                    });
                } else if (cf.subfolders && Object.keys(cf.subfolders).length > 0) {
                    // Compat con datos sin tipos (no debería pasar tras la migración)
                    lines.push('');
                    lines.push('Sub-niveles disponibles:');
                    for (const name in cf.subfolders) {
                        if (Object.prototype.hasOwnProperty.call(cf.subfolders, name)) {
                            lines.push('  • ' + name + ': ' + cf.subfolders[name]);
                        }
                    }
                }
                lines.push('');
                lines.push('Workflow obligatorio:');
                lines.push('  1. Drive MCP download_file_content para bajar las fotos al sandbox');
                lines.push('  2. Subir a host temporal (tmpfiles.org/dl/) durante la sesión');
                lines.push('  3. Usar como reference_images (Seedream) o image= en gpt-image-2 edits');
                lines.push('');
                lines.push('Guía de selección por tipo:');
                lines.push('  - persona_destacada → cuando el copy menciona al CEO/figura visible');
                lines.push('  - equipo            → cuando el mensaje es coral / sobre el equipo');
                lines.push('  - pacientes_usuarios → SOLO con consentimiento RGPD (verificar antes)');
                lines.push('  - instalaciones     → escenas en local/oficina/clínica');
                lines.push('  - productos         → primer plano de producto');
                lines.push('  - logo_brand        → para overlays, watermarks, paleta de marca');
                lines.push('');
                lines.push('NUNCA pedir a David que vuelva a subir fotos — ya están en Drive.');
                lines.push('');
            } else {
                // pending o configured-pero-roto → PARAR
                lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                lines.push('⚠️ CLIENTE SIN CONFIGURAR DRIVE REFS — PARAR');
                lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                lines.push('');
                lines.push('Este cliente no tiene Drive refs configurados (drive_mode = "' + driveMode + '").');
                lines.push('PARAR. Avisar a David para que entre en NV Dashboard → Editorial → Clientes,');
                lines.push('edite este cliente y configure: ');
                lines.push('  - Carpeta raíz Drive del cliente, o');
                lines.push('  - Marcarlo como "No usa Drive refs" si no aplica.');
                lines.push('');
                lines.push('NO improvisar refs de Asana ni de la web del cliente.');
                lines.push('NO continuar con la regeneración hasta que David confirme.');
                lines.push('');
            }
        }

        // v1.0.73: Bloque vídeo — pointer a la memoria operativa NV en Drive.
        //
        // Antes de v1.0.73, una revisión de tipo vídeo solo enviaba al chat externo
        // el contexto genérico (copy, hashtags, asset, orden). El Claude externo no
        // tenía forma de saber que existe un pipeline NV Reels documentado en Drive,
        // y acababa improvisando soluciones tipo "montaje Ken Burns con MoviePy" que
        // no respetaban el pipeline real (Seedream V4.5 Edit → Seedance Pro 1080p →
        // ElevenLabs → Freepik AI music → FFmpeg) ni las reglas v1–v13.
        //
        // Este bloque le dice explícitamente DÓNDE leer la fuente de verdad antes
        // de tocar nada. Mantenemos el pipeline a alto nivel inline (suficiente para
        // que sepa qué buscar) y el detalle exhaustivo se queda en el doc maestro.
        if (tipoRevision === 'video') {

            lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            lines.push('🚨 MEMORIA OPERATIVA NV — LEER ANTES DE EMPEZAR');
            lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            lines.push('');
            lines.push('Antes de proponer NINGÚN plan de producción ni gastar créditos,');
            lines.push('lee el documento maestro de memoria operativa de la agencia:');
            lines.push('');
            lines.push('  • Título: ' + NV_MEMORIA_OPERATIVA.doc_master_title);
            lines.push('  • Drive fileId: ' + NV_MEMORIA_OPERATIVA.doc_master_file_id);
            lines.push('  • URL: ' + NV_MEMORIA_OPERATIVA.doc_master_url);
            lines.push('  • Carpeta REFS NV: ' + NV_MEMORIA_OPERATIVA.refs_root_folder_id);
            lines.push('');
            lines.push('Cómo leerlo: usa la herramienta Google Drive → read_file_content');
            lines.push('con ese fileId. El documento incluye, entre otras cosas:');
            lines.push('  - Pipeline completo de producción de Reels NV (paso a paso)');
            lines.push('  - Reglas no-negociables v1–v13 de Reels NV');
            lines.push('  - Endpoints Freepik verificados (Seedream V4.5 Edit,');
            lines.push('    Seedance Pro 1080p) con parámetros y aspect_ratio enum');
            lines.push('  - Config ElevenLabs (voice ID, modelo, stability, similarity)');
            lines.push('  - Lecciones aprendidas — errores documentados que NO repetir');
            lines.push('');
            lines.push('Solo DESPUÉS de leerlo, propón a David el plan de producción de');
            lines.push('este reel y espera confirmación antes de tirar de créditos.');
            lines.push('');

            lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            lines.push('🎬 PIPELINE NV REELS — RESUMEN (detalle en doc maestro)');
            lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            lines.push('');
            lines.push('Seedream V4.5 Edit (imágenes base, aspect_ratio social_story_9_16)');
            lines.push('   → Seedance Pro 1080p (image-to-video, 5s/clip)');
            lines.push('   → ElevenLabs (voz off, eleven_multilingual_v2, plural España)');
            lines.push('   → Freepik AI music (track de fondo)');
            lines.push('   → FFmpeg montaje: clips + pantallas tipográficas intercaladas');
            lines.push('     (fondo negro, dorado #D2A039, Poppins Bold) + voz/música con');
            lines.push('     sidechain agresivo (threshold 0.02, ratio 12, loudnorm -14 LUFS)');
            lines.push('');
            lines.push('PROHIBIDO sustituir este pipeline por un montaje Ken Burns sobre');
            lines.push('imágenes estáticas — eso NO cuenta como reel generado. Si Seedance');
            lines.push('Pro 1080p falla, PARAR y avisar a David antes de cambiar de modelo.');
            lines.push('');
            lines.push('Aspect ratio correcto: "social_story_9_16" (NO "portrait_9_16",');
            lines.push('deprecated en Freepik).');
            lines.push('');

            // v1.0.74: Branding del cliente — colores, fuentes, logo, brief, style guide.
            // Datos críticos para que FFmpeg drawtext / overlay de logo / pantallas
            // tipográficas intercaladas usen la identidad visual del cliente y no la
            // del default Negocio Vivo (dorado #D2A039 / Poppins Bold).
            const branding = cfg && cfg.branding ? cfg.branding : null;
            if (branding) {
                lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                lines.push('🎨 BRANDING DEL CLIENTE — usar en FFmpeg / overlays');
                lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                lines.push('');
                lines.push('Aplica estos valores a las pantallas tipográficas, drawtext y');
                lines.push('overlays del montaje. NO uses los defaults Negocio Vivo (dorado');
                lines.push('#D2A039 / Poppins Bold) salvo si el cliente ES Negocio Vivo.');
                lines.push('');

                // Colores: muestra los resueltos (siempre 3) e indica cuáles son explícitos.
                const colE = branding.colors_explicit || {};
                const colR = branding.colors_resolved || {};
                const tag = (k) => colE[k] ? ' (explícito)' : ' (fallback automático)';
                lines.push('Paleta:');
                if (colR.primary)         lines.push('  • Primary:         ' + colR.primary + tag('primary'));
                if (colR.accent)          lines.push('  • Accent:          ' + colR.accent  + tag('accent'));
                if (colR.text_on_primary) lines.push('  • Text on primary: ' + colR.text_on_primary + tag('text_on_primary'));
                lines.push('');

                // Fuentes: cada una con URL descargable + weight semántico
                if (branding.fonts && branding.fonts.length) {
                    lines.push('Fuentes configuradas (descarga la URL y pásala a FFmpeg drawtext fontfile=…):');
                    branding.fonts.forEach(function(f) {
                        lines.push('  • [' + (f.weight || 'regular') + '] ' + f.filename + ' → ' + f.url);
                    });
                    lines.push('');
                    lines.push('Si la regla v4 de Reels NV pide "Poppins Bold" y aquí hay una');
                    lines.push('fuente bold del cliente, usa la del cliente. La regla v4 es el');
                    lines.push('default Negocio Vivo; los clientes externos tienen prioridad sobre ella.');
                    lines.push('');
                } else {
                    lines.push('Fuentes: ninguna configurada para este cliente.');
                    lines.push('Usa el default Poppins Bold del plugin (assets/fonts/Poppins-Bold.ttf).');
                    lines.push('');
                }

                // Logo + posición
                if (branding.logo_url) {
                    lines.push('Logo:');
                    lines.push('  • URL: ' + branding.logo_url);
                    if (branding.logo_position) {
                        lines.push('  • Posición preferida: ' + branding.logo_position);
                    }
                    lines.push('  • Aplícalo como overlay sutil (esquina, padding 24-32px).');
                    lines.push('  • NO lo metas en TODAS las tomas — solo en intro/outro o pantallas tipográficas.');
                    lines.push('');
                }

                // Brand brief — posicionamiento/tono/audiencia
                if (branding.brand_brief) {
                    lines.push('Brief de marca (tono, audiencia, posicionamiento):');
                    branding.brand_brief.split(/\r?\n/).forEach(function(l) {
                        if (l.trim() !== '') lines.push('  ' + l);
                    });
                    lines.push('');
                }

                // Patrón visual
                if (branding.visual_pattern) {
                    lines.push('Patrón visual: ' + branding.visual_pattern);
                    lines.push('');
                }

                // Refs fidelity (cuánta fidelidad a refs requiere el cliente)
                if (branding.refs_fidelity) {
                    lines.push('Fidelidad a refs visuales: ' + branding.refs_fidelity);
                    lines.push('');
                }

                // Web
                if (branding.website) {
                    lines.push('Web del cliente: ' + branding.website);
                    lines.push('');
                }

                // Style guide cacheada (texto generado por Claude vision a partir de refs)
                if (branding.style_guide) {
                    lines.push('Guía de estilo visual (generada por Claude vision sobre las refs):');
                    branding.style_guide.split(/\r?\n/).forEach(function(l) {
                        if (l.trim() !== '') lines.push('  ' + l);
                    });
                    if (branding.style_guide_truncated) {
                        lines.push('  […truncada a 1200 chars; fetch /cliente-config/{slug} para el texto completo]');
                    }
                    lines.push('');
                }

                // Dimensiones por tipo de contenido
                if (branding.dimensions && Object.keys(branding.dimensions).length) {
                    lines.push('Dimensiones configuradas por tipo de contenido:');
                    Object.keys(branding.dimensions).forEach(function(tipo) {
                        const d = branding.dimensions[tipo];
                        if (d && d.width && d.height) {
                            lines.push('  • ' + tipo + ': ' + d.width + '×' + d.height + 'px');
                        }
                    });
                    lines.push('');
                }
            } else {
                lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                lines.push('🎨 BRANDING DEL CLIENTE — no recibido');
                lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                lines.push('');
                lines.push('No se pudo cargar el bloque de branding desde /cliente-config.');
                lines.push('PARAR y avisar a David antes de elegir colores/fuentes — no inventar.');
                lines.push('');
            }

            // v1.0.75: Imágenes de referencia visual del cliente (Media Library WP).
            // Cada imagen viene con tipo (persona_destacada / equipo / productos /
            // instalaciones / pacientes_usuarios / logo_brand / general) y un
            // person_name opcional cuando aplica. Esto resuelve el bug del 12/05/2026
            // (Mar Costa del Sol post 415): el chat externo pivotó a "figuras humanas
            // de espaldas/anónimas" porque no veía a Pilar Oliva en ninguna parte del
            // prompt, aunque su foto estaba en la ficha del cliente con su nombre.
            const ri = cfg && cfg.reference_images ? cfg.reference_images : null;
            if (ri && ri.total_count > 0) {
                lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                lines.push('🖼️ IMÁGENES DE REFERENCIA DEL CLIENTE (Media Library)');
                lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                lines.push('');
                lines.push(ri.total_count + ' imágenes cargadas en WP por el cliente,');
                lines.push('cada una con tipo asignado y, cuando aplica, nombre de la persona.');
                lines.push('');

                // Roster — quién es quién, agrupado por persona identificada
                if (ri.team_roster && ri.team_roster.length) {
                    lines.push('Equipo identificado (usa estos nombres si el copy menciona a');
                    lines.push('alguien del cliente; "persona_destacada" suele ser el/la CEO):');
                    ri.team_roster.forEach(function(p) {
                        const fotos = p.photo_count + ' foto' + (p.photo_count === 1 ? '' : 's');
                        lines.push('  • ' + p.name + '  [' + p.type + ', ' + fotos + ']');
                    });
                    lines.push('');
                }

                // Counts por tipo — resumen rápido
                if (ri.counts_by_type) {
                    const cbt = ri.counts_by_type;
                    const summary = Object.keys(cbt).map(function(k) {
                        return k + ': ' + cbt[k];
                    }).join(', ');
                    if (summary) {
                        lines.push('Distribución por tipo: ' + summary);
                        lines.push('');
                    }
                }

                // Listado completo con URLs públicas
                lines.push('Imágenes (URLs públicas, fetch directo desde el sandbox):');
                ri.items.forEach(function(it) {
                    const tagPerson = it.person_name ? ' · ' + it.person_name : '';
                    lines.push('  • [' + it.type + tagPerson + '] → ' + it.url);
                });
                lines.push('');

                lines.push('Workflow obligatorio:');
                lines.push('  1. Descarga las URLs al sandbox con curl/requests (son públicas).');
                lines.push('  2. Pásalas como reference_images a Seedream V4.5 Edit (max 5/call).');
                lines.push('  3. Si el copy menciona a una persona del cliente por nombre,');
                lines.push('     SELECCIONA las refs cuyo person_name coincida — no inventes');
                lines.push('     una cara nueva ni pivotes a figuras anónimas/de espaldas.');
                lines.push('  4. Si el copy menciona a alguien que NO aparece en el roster,');
                lines.push('     PARAR y avisar a David antes de seguir.');
                lines.push('');

                lines.push('Distinción crítica gen vs edit (sección del doc maestro): editar');
                lines.push('una imagen aportada por el cliente, con consentimiento publicitario');
                lines.push('documentado a nivel agencia, ES el flujo normal NV y está permitido.');
                lines.push('NO confundir con "generación pura de persona real desde cero".');
                lines.push('');
            } else if (ri && ri.total_count === 0) {
                lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                lines.push('🖼️ IMÁGENES DE REFERENCIA — ninguna cargada');
                lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                lines.push('');
                lines.push('Este cliente no tiene imágenes de referencia visual cargadas en');
                lines.push('la Media Library WP. Si el copy menciona a una persona concreta');
                lines.push('del cliente, PARAR y avisar a David — no inventes una cara nueva.');
                lines.push('');
            }

            // Refs Drive del cliente (mismo bloque que en imagen pero adaptado a vídeo)
            const refsV = cfg && cfg.refs_drive ? cfg.refs_drive : null;
            const driveModeV = refsV && refsV.drive_mode ? refsV.drive_mode : 'pending';

            if (driveModeV === 'no_drive_refs') {
                lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                lines.push('📁 REFS VISUALES DEL CLIENTE — NO APLICA');
                lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                lines.push('');
                lines.push('David ha marcado este cliente como "no usa Drive refs".');
                lines.push('Genera los frames de Seedream V4.5 Edit sin reference_images');
                lines.push('basándote en la sugerencia visual del primer comentario.');
                lines.push('');
            } else if (driveModeV === 'configured' && refsV.cliente_folder && refsV.cliente_folder.root_id) {
                const cf = refsV.cliente_folder;
                lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                lines.push('📁 REFS VISUALES DEL CLIENTE — Drive');
                lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                lines.push('');
                if (refsV.root_folder_id) {
                    lines.push('Root folder ID: ' + refsV.root_folder_id);
                }
                lines.push('Subcarpeta raíz del cliente:');
                lines.push('  ID: ' + cf.root_id);
                const typedV = cf.subfolders_v2 && cf.subfolders_v2.length ? cf.subfolders_v2 : null;
                if (typedV) {
                    lines.push('');
                    lines.push('Sub-niveles disponibles (usa los que correspondan a cada toma):');
                    typedV.forEach(function(sf) {
                        lines.push('  • [' + sf.type + '] ' + sf.name + ' → ' + sf.id);
                    });
                }
                lines.push('');
                lines.push('Workflow refs: Drive MCP download_file_content → subir a host');
                lines.push('temporal (tmpfiles.org/dl/) → usar como reference_images en');
                lines.push('Seedream V4.5 Edit (max 5 refs por call).');
                lines.push('');
            } else {
                lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                lines.push('📁 REFS VISUALES DEL CLIENTE — sin configurar');
                lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                lines.push('');
                lines.push('Este cliente no tiene Drive refs configurados (drive_mode = "' + driveModeV + '").');
                lines.push('Para reels que NO requieran a David ni a personas identificables del');
                lines.push('cliente, puedes seguir con Seedream V4.5 Edit sin reference_images.');
                lines.push('Si la escena sí necesita una persona identificable del cliente,');
                lines.push('PARAR y avisar a David para que configure las refs.');
                lines.push('');
            }
        }

        lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        lines.push('🎯 TIPO DE REVISIÓN: ' + tipoLabel);
        lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        lines.push('');
        lines.push('📝 ORDEN:');
        lines.push('');
        lines.push(orden);
        lines.push('');
        lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        lines.push('🔐 AUTH PARA SUBIR/ACTUALIZAR EL POST');
        lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        lines.push('');
        lines.push('Todos los endpoints /wp-json/nv/v1/ aceptan Bearer auth con el');
        lines.push('API token del plugin. Úsalo para subir-imagen-post,');
        lines.push('actualizar-publicacion, registrar-revision, etc.:');
        lines.push('');
        lines.push('   Authorization: Bearer ' + (ctx.apiToken || '{NV_API_TOKEN_NO_DISPONIBLE}'));
        lines.push('');
        lines.push('(El token es rotable desde NV Dashboard → Configuración. Si te');
        lines.push(' devuelve 401 después de instalar v1.0.20, pide un token nuevo.)');
        lines.push('');
        lines.push('Cuando termines, sube el resultado a la Media Library de WordPress y actualiza la publicación ' + (ctx.postId || '') + ' usando el endpoint ' + (ctx.siteUrl || '') + 'wp-json/nv/v1/actualizar-publicacion/' + (ctx.postId || '') + ' (con el Bearer de arriba).');

        return lines.join('\n');
    }

    /**
     * Abre Claude.ai con el mensaje pre-rellenado
     * v1.0.7: registra la revisión en el historial WP antes de abrir
     * v1.0.18: async — espera al fetch de cliente-config para incluir modelo + refs
     */
    async function openInClaude() {
        const tipo = $('#nv-claude-tipo-revision').val();
        const orden = $('#nv-claude-orden').val().trim();

        if (!orden) {
            alert('Escribe la orden que quieres que Claude ejecute antes de abrir.');
            $('#nv-claude-orden').focus();
            return;
        }

        // v1.0.18: fetch cliente-config si es revisión de imagen (para modelo + refs)
        // v1.0.73: también si es vídeo, para tener refs Drive del cliente disponibles
        let cfg = null;
        if (tipo === 'imagen' || tipo === 'video') {
            cfg = await fetchClienteConfig();
        }

        const message = buildMessage(tipo, orden, cfg);

        // Aviso si el mensaje es muy largo (URLs ~8000 chars típico)
        if (message.length > 7500) {
            const proceed = confirm(
                'El mensaje es muy largo (' + message.length + ' caracteres). ' +
                'Algunos navegadores podrían truncarlo. ¿Quieres continuar igualmente?'
            );
            if (!proceed) return;
        }

        // v1.0.7: registrar en historial (no bloqueante; si falla, abrimos igual)
        const ctx = window.nvClaudeWidget || {};
        if (ctx.postId && ctx.restNonce) {
            $.ajax({
                url: (ctx.restUrl || '/wp-json/nv/v1/') + 'registrar-revision/' + ctx.postId,
                method: 'POST',
                contentType: 'application/json',
                headers: { 'X-WP-Nonce': ctx.restNonce },
                data: JSON.stringify({ tipo: tipo, orden: orden }),
                error: function(xhr) {
                    console.warn('No se pudo registrar la revisión:', xhr.statusText);
                }
            });
        }

        // URL-encode y abrir
        const url = 'https://claude.ai/new?q=' + encodeURIComponent(message);
        window.open(url, '_blank', 'noopener,noreferrer');
    }

    /**
     * Muestra el mensaje completo en una caja para que el usuario lo revise
     * v1.0.18: async — espera al fetch de cliente-config para incluir modelo + refs
     */
    async function previewMessage() {
        const tipo = $('#nv-claude-tipo-revision').val();
        const orden = $('#nv-claude-orden').val().trim();

        if (!orden) {
            alert('Escribe la orden primero.');
            $('#nv-claude-orden').focus();
            return;
        }

        let cfg = null;
        if (tipo === 'imagen' || tipo === 'video') {
            cfg = await fetchClienteConfig();
        }

        const message = buildMessage(tipo, orden, cfg);
        $('#nv-claude-preview-content').text(message);
        $('#nv-claude-preview-box .nv-claude-char-count').text(message.length + ' caracteres');
        $('#nv-claude-preview-box').slideDown(150);
    }

    /**
     * v1.0.7: Botón rápido pulsado - rellena tipo + orden y abre directamente
     */
    function handleQuickButton(e) {
        const $btn = $(e.currentTarget);
        const tipo = $btn.data('tipo');
        const prompt = $btn.data('prompt');
        if (!tipo || !prompt) return;
        
        $('#nv-claude-tipo-revision').val(tipo);
        $('#nv-claude-orden').val(prompt);
        
        // Animación visual de "se ha rellenado" (CSS puro, sin jQuery UI)
        const $orden = $('#nv-claude-orden');
        $orden.css({
            'background': '#fff7e0',
            'transition': 'background 0.6s ease'
        });
        setTimeout(() => $orden.css('background', ''), 800);
        
        // Abrir directamente
        setTimeout(openInClaude, 200);
    }

    // v1.0.72: helper inline para llamar al endpoint adaptar-formato.
    // Antes (v1.0.71) dependía de window.nvAdaptarFormatoForPost que vive en
    // trash-and-toasts.js, pero ese script NO se carga en post.php (pantalla
    // de edición de publicación), por lo que el handler fallaba.
    async function callAdaptarFormatoEndpoint(postId, options) {
        const url = window.nvDashboard.restUrl + 'adaptar-formato/' + postId;
        const body = {
            tipo_target: (options && options.tipo_target) || '',
            quality:     (options && options.quality)     || 'medium',
        };
        if (options && options.width)  body.width  = options.width;
        if (options && options.height) body.height = options.height;
        try {
            const r = await fetch(url, {
                method: 'POST',
                headers: {
                    'X-WP-Nonce': window.nvDashboard.restNonce,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            });
            const ctype = (r.headers.get('content-type') || '').toLowerCase();
            if (!ctype.includes('json')) {
                if (r.status === 504 || r.status === 502) {
                    return { ok: false, error: { type: 'gateway_timeout', message: 'El servidor (nginx) cerró la conexión a los 60s pero la generación SIGUE corriendo en el backend. Espera 1-2 min y recarga la página — debería estar la nueva imagen.', status: r.status } };
                }
                const txt = await r.text();
                return { ok: false, error: { type: 'unknown_html', message: 'HTTP ' + r.status + '. Snippet: ' + txt.slice(0, 200) } };
            }
            const data = await r.json();
            if (!r.ok || data.code) {
                return { ok: false, error: { type: data.code || 'json_error', message: data.message || ('HTTP ' + r.status), status: r.status } };
            }
            return { ok: true, data: data };
        } catch (err) {
            return { ok: false, error: { type: 'network', message: err.message } };
        }
    }

    // v1.0.71: handler "Adaptar a otro formato" — regenera con IA en otro ratio
    async function handleAdaptarFormato() {
        const $btn = $('#nv-cw-adaptar-go');
        const pid = $btn.data('pid');
        if (!pid) return;
        const tipoTarget = $('#nv-cw-adaptar-tipo').val();
        const quality = $('#nv-cw-adaptar-quality').val();
        const $status = $('#nv-cw-adaptar-status');
        $btn.prop('disabled', true);
        $status.html('⏳ Generando con IA (15-90s)… esta llamada puede superar el timeout de nginx (60s) pero el backend sigue trabajando.');
        const res = await callAdaptarFormatoEndpoint(pid, { tipo_target: tipoTarget, quality: quality });
        $btn.prop('disabled', false);
        if (res.ok) {
            $status.html('✅ Adaptado a <strong>' + res.data.tipo_final + '</strong> (' + res.data.width + '×' + res.data.height + '). Recarga para ver la nueva imagen.');
        } else {
            const err = res.error || {};
            if (err.type === 'gateway_timeout') {
                $status.html('<span style="color:#c80;">⏳ ' + err.message + '</span>');
            } else {
                $status.html('<span style="color:#c00;">❌ ' + (err.message || 'Error') + '</span>');
            }
        }
    }

    $(document).ready(function () {
        $('#nv-claude-open').on('click', openInClaude);
        $('#nv-claude-preview').on('click', previewMessage);

        // v1.0.71: Adaptar formato
        $(document).on('click', '#nv-cw-adaptar-go', handleAdaptarFormato);

        // v1.0.18: pre-fetch cliente-config en background para que el cache esté caliente
        // cuando el usuario pulse el botón. No bloquea — si falla, fetchClienteConfig()
        // lo reintentará al click.
        fetchClienteConfig();
        
        // v1.0.7: botones rápidos
        $(document).on('click', '.nv-claude-quick-btn', handleQuickButton);
        
        // v1.0.7: toggle historial
        $(document).on('click', '#nv-claude-history-toggle', function() {
            $('#nv-claude-history-body').slideToggle(150);
            const $arr = $(this).find('.nv-claude-history-arrow');
            $arr.text($arr.text() === '▼' ? '▲' : '▼');
        });

        // Atajo Ctrl/Cmd+Enter dentro del textarea para abrir Claude
        $('#nv-claude-orden').on('keydown', function (e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                openInClaude();
            }
        });
    });

})(jQuery);
