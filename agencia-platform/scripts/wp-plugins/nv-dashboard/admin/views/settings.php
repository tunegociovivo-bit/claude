<?php
/**
 * Vista Configuración del NV Dashboard
 */
if (!defined('ABSPATH')) exit;

$webhook_url = get_option('nv_dashboard_make_webhook_url', '');
$drive_folder = get_option('nv_dashboard_drive_folder_id', '');
$brand_name = get_option('nv_dashboard_metricool_brand_name', 'Negocio Vivo');
$notif_email = get_option('nv_dashboard_notification_email', get_option('admin_email'));
$anthropic_key = get_option('nv_dashboard_anthropic_api_key', '');
$anthropic_model = get_option('nv_dashboard_anthropic_model', 'claude-sonnet-4-5');
$avatares_urls = get_option('nv_dashboard_avatares_urls', '');

// v1.0.15: OpenAI API key (para gpt-image-2) y modelo imagen por cliente
$openai_key = get_option('nv_dashboard_openai_api_key', '');
$modelo_default = get_option('nv_dashboard_modelo_imagen_default', 'seedream-v4-5-edit');
$modelo_por_cliente_json = get_option('nv_dashboard_modelo_imagen_por_cliente', '{}');
$modelo_por_cliente = json_decode($modelo_por_cliente_json, true);
if (!is_array($modelo_por_cliente)) $modelo_por_cliente = [];

// v1.0.22: Google OAuth (Drive Picker + Auto-create estructura)
$google_client_id = get_option('nv_dashboard_google_client_id', '');
$google_api_key = get_option('nv_dashboard_google_api_key', '');

// v1.0.25: Freepik API key (para modelos Freepik en multi-cliente)
$freepik_key = get_option('nv_dashboard_freepik_api_key', '');

// v1.0.76: URL de destino tras login (Sign in with Google de Site Kit, password, etc.)
$login_redirect_url = get_option('nv_dashboard_login_redirect_url', '');

// v1.0.77: Personalización PWA (Add to Home Screen)
$pwa_app_name    = get_option('nv_dashboard_pwa_app_name', '');
$pwa_short_name  = get_option('nv_dashboard_pwa_short_name', '');
$pwa_theme_color = get_option('nv_dashboard_pwa_theme_color', '');
$pwa_start_url   = get_option('nv_dashboard_pwa_start_url', '');

// Lista de clientes para selector
$clientes_lista = get_terms(['taxonomy' => 'nv_cliente', 'hide_empty' => false]);
if (is_wp_error($clientes_lista)) $clientes_lista = [];

// Modelos disponibles
$modelos_disponibles = [
    'seedream-v4-5-edit' => 'Seedream V4.5 Edit (Freepik · default)',
    'gpt-image-2'        => 'GPT-Image-2 (OpenAI directo · premium $0.05-0.21/img)',
    'mystic-2-5'         => 'Mystic 2.5 (Freepik · fotorrealista premium)',
    'gpt-1-5-high'       => 'GPT 1.5 High (Freepik)',
    'nano-banana-pro'    => 'Nano Banana Pro (Freepik · Google Gemini 3)',
];
?>

<div class="wrap nv-dashboard">
    <div class="nv-header">
        <div class="nv-logo-block">
            <div class="nv-logo">NV</div>
            <div>
                <h1>Configuración</h1>
                <p class="nv-subtitle">Conexiones e integraciones</p>
            </div>
        </div>
    </div>
    
    <div class="nv-tabs">
        <a href="?page=nv-dashboard" class="nv-tab">📊 Vista General</a>
        <a href="?page=nv-dashboard-editorial" class="nv-tab">📅 Editorial</a>
        <a href="<?php echo admin_url('edit.php?post_type=nv_publicacion'); ?>" class="nv-tab">📝 Publicaciones</a>
        <a href="<?php echo admin_url('edit-tags.php?taxonomy=nv_cliente&post_type=nv_publicacion'); ?>" class="nv-tab">👥 Clientes</a>
        <a href="?page=nv-dashboard-settings" class="nv-tab active">⚙️ Configuración</a>
    </div>
    
    <form method="post">
        <?php wp_nonce_field('nv_settings'); ?>
        
        <div class="nv-settings-card">
            <h2>🔗 Webhook Make</h2>
            <p>URL del webhook que se disparará cuando hagas click en "Aprobar mes". Make recibirá los datos del CSV generado y enviará el email final.</p>
            
            <label>
                <strong>URL del Webhook Make:</strong>
                <input type="url" name="make_webhook_url" value="<?php echo esc_attr($webhook_url); ?>" 
                       placeholder="https://hook.eu1.make.com/xxxxxxxxxx" 
                       style="width: 100%; max-width: 600px;">
            </label>
            <p class="description">
                Obtén esta URL al crear un escenario en Make con módulo "Custom webhook" como trigger.
            </p>
        </div>
        
        <div class="nv-settings-card">
            <h2>📁 Google Drive</h2>
            <p>Carpeta donde se almacenan los assets (videos, imágenes) de Negocio Vivo.</p>
            
            <label>
                <strong>ID de carpeta Drive:</strong>
                <input type="text" name="drive_folder_id" value="<?php echo esc_attr($drive_folder); ?>" 
                       placeholder="1aBcDeFgHiJkLmN..." 
                       style="width: 100%; max-width: 600px;">
            </label>
            <p class="description">
                Lo encuentras en la URL de la carpeta: drive.google.com/drive/folders/<strong>ESTE_ID</strong>
            </p>
        </div>
        
        <div class="nv-settings-card">
            <h2>📊 Metricool</h2>
            
            <label>
                <strong>Nombre de marca por defecto:</strong>
                <input type="text" name="metricool_brand_name" value="<?php echo esc_attr($brand_name); ?>" 
                       style="width: 100%; max-width: 600px;">
            </label>
            <p class="description">
                Si está configurado, sobrescribe el "Brand Name" de cada CSV. Si lo dejas vacío, usará el nombre del cliente.
            </p>
        </div>
        
        <div class="nv-settings-card">
            <h2>🤖 Anthropic API (Generador de mes)</h2>
            <p>API key de Anthropic para que el plugin genere calendarios de publicaciones con Claude directamente. Coste estimado: <strong>~5-8 céntimos por mes generado</strong> (14 publicaciones).</p>
            
            <label style="display:block; margin-bottom: 12px;">
                <strong>API Key:</strong>
                <input type="password" name="anthropic_api_key" 
                       value="<?php echo esc_attr($anthropic_key); ?>"
                       placeholder="sk-ant-api03-..." 
                       style="width: 100%; max-width: 600px; font-family: monospace;"
                       autocomplete="off">
            </label>
            <p class="description">
                Obtén tu API key gratis en <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com/settings/keys</a> · 
                Necesitas tener al menos $5 de crédito (alcanza para ~80 meses generados).
            </p>
            
            <label style="display:block; margin: 16px 0 12px;">
                <strong>Modelo:</strong>
                <select name="anthropic_model" style="min-width: 280px;">
                    <option value="claude-sonnet-4-5" <?php selected($anthropic_model, 'claude-sonnet-4-5'); ?>>Claude Sonnet 4.5 (recomendado · ~9 céntimos/mes)</option>
                    <option value="claude-haiku-4-5" <?php selected($anthropic_model, 'claude-haiku-4-5'); ?>>Claude Haiku 4.5 (más barato y rápido · ~3 céntimos/mes)</option>
                </select>
            </label>
            
            <div style="margin-top: 14px;">
                <button type="button" class="button" onclick="nvTestAnthropic()">🧪 Probar conexión</button>
                <span id="nv-anthropic-test-result" style="margin-left: 12px;"></span>
            </div>
            <script>
            function nvTestAnthropic() {
                const out = document.getElementById('nv-anthropic-test-result');
                const inp = document.querySelector('input[name="anthropic_api_key"]');
                const key = inp.value.trim();
                out.textContent = '⏳ Probando…';
                fetch('<?php echo esc_url_raw(rest_url('nv/v1/test-anthropic')); ?>', {
                    method: 'POST',
                    headers: {
                        'X-WP-Nonce': '<?php echo wp_create_nonce('wp_rest'); ?>',
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ api_key: key })
                }).then(r => r.json()).then(d => {
                    if (d.success) {
                        out.innerHTML = '<span style="color:#2ea043;">✅ ' + (d.mensaje || 'OK') + '</span>';
                    } else {
                        out.innerHTML = '<span style="color:#c00;">❌ ' + (d.message || 'Error') + '</span>';
                    }
                }).catch(e => {
                    out.innerHTML = '<span style="color:#c00;">❌ Error de red: ' + e.message + '</span>';
                });
            }
            </script>
        </div>
        
        <div class="nv-settings-card">
            <h2>📧 Notificaciones</h2>
            
            <label>
                <strong>Email para notificaciones:</strong>
                <input type="email" name="notification_email" value="<?php echo esc_attr($notif_email); ?>" 
                       style="width: 100%; max-width: 600px;">
            </label>
            <p class="description">
                Email donde Make te enviará el CSV listo para subir a Metricool.
            </p>
        </div>
        
        <div class="nv-settings-card">
            <h2>🎨 Generación visual con Claude</h2>
            <p>URLs públicas de tus fotos avatar para que Claude las use como <strong>references</strong> en Freepik Seedream V4.5 Edit. Una URL por línea. Sirven cuando el cliente es <strong>Negocio Vivo</strong> (con tu cara). Para el resto de clientes, se usa text-to-image normal sin avatar.</p>
            
            <textarea name="nv_avatares_urls" rows="6"
                      style="width:100%; max-width:700px; font-family:monospace; font-size:12px;"
                      placeholder="https://tmpfiles.org/dl/.../david_face_new_1.jpg&#10;https://tmpfiles.org/dl/.../david_face_new_2.jpg&#10;..."><?php echo esc_textarea($avatares_urls); ?></textarea>
            
            <p class="description">
                💡 <strong>Sugerencia</strong>: estas URLs (tmpfiles.org) caducan en ~30 días. Para algo permanente, sube tus fotos a la Media Library de WP y usa esas URLs públicas (de tu propio dominio).
            </p>
        </div>

        <!-- v1.0.15: Modelo de imagen IA por cliente -->
        <div class="nv-settings-card">
            <h2>🖼️ Modelo de generación de imagen por cliente</h2>
            <p>Configura qué motor de IA debe usar Claude cuando pulses <strong>"Generar imágenes con Claude"</strong> para cada cliente. El cliente puede sobrescribir el modelo por defecto.</p>

            <h3 style="margin-top: 20px;">🔑 OpenAI API key (solo si usas GPT-Image-2)</h3>
            <label>
                <input type="password" name="openai_api_key"
                       value="<?php echo esc_attr($openai_key); ?>"
                       style="width: 100%; max-width: 600px; font-family: monospace; font-size: 13px;"
                       placeholder="sk-proj-...">
            </label>
            <p class="description">
                Obtén tu API key en <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com/api-keys</a> ·
                Solo necesaria si algún cliente tiene seleccionado <code>GPT-Image-2</code>.
                Pricing OpenAI: $0.006/img low · $0.053/img medium · $0.211/img high (1024×1024).
            </p>

            <h3 style="margin-top: 28px;">🔑 Freepik API key (para Seedream / Mystic / Nano Banana / GPT 1.5)</h3>
            <label>
                <input type="password" name="freepik_api_key"
                       value="<?php echo esc_attr($freepik_key); ?>"
                       style="width: 100%; max-width: 600px; font-family: monospace; font-size: 13px;"
                       placeholder="FPSX...">
            </label>
            <p class="description">
                Obtén tu API key en <a href="https://www.freepik.com/api" target="_blank" rel="noopener">freepik.com/api</a> ·
                Solo necesaria si algún cliente tiene seleccionado un modelo Freepik.
                Sin esta key, los clientes con modelo Freepik en el flujo multi-cliente generan copy pero no imagen.
            </p>

            <h3 style="margin-top: 28px;">🌐 Modelo por defecto (global)</h3>
            <label>
                <select name="nv_modelo_imagen_default" style="min-width: 380px;">
                    <?php foreach ($modelos_disponibles as $value => $label): ?>
                        <option value="<?php echo esc_attr($value); ?>" <?php selected($modelo_default, $value); ?>>
                            <?php echo esc_html($label); ?>
                        </option>
                    <?php endforeach; ?>
                </select>
            </label>
            <p class="description">
                Modelo usado para clientes que no tienen un modelo específico configurado abajo.
            </p>

            <h3 style="margin-top: 28px;">🎯 Override por cliente</h3>
            <p class="description" style="margin-bottom: 12px;">
                Si quieres que un cliente concreto use un modelo distinto al global, selecciónalo aquí. Si dejas <em>Default</em>, se usa el global.
            </p>
            <table class="widefat striped" style="max-width: 700px;">
                <thead>
                    <tr>
                        <th style="width: 200px;">Cliente</th>
                        <th>Modelo de imagen</th>
                    </tr>
                </thead>
                <tbody>
                    <?php if (empty($clientes_lista)): ?>
                        <tr><td colspan="2"><em>No hay clientes en la taxonomía aún.</em></td></tr>
                    <?php else: ?>
                        <?php foreach ($clientes_lista as $cli):
                            $modelo_cli = $modelo_por_cliente[$cli->slug] ?? '';
                        ?>
                            <tr>
                                <td><strong><?php echo esc_html($cli->name); ?></strong> <code style="color:#888;font-size:11px;"><?php echo esc_html($cli->slug); ?></code></td>
                                <td>
                                    <select name="nv_modelo_imagen_por_cliente[<?php echo esc_attr($cli->slug); ?>]" style="min-width: 380px;">
                                        <option value="">— Usar default global —</option>
                                        <?php foreach ($modelos_disponibles as $value => $label): ?>
                                            <option value="<?php echo esc_attr($value); ?>" <?php selected($modelo_cli, $value); ?>>
                                                <?php echo esc_html($label); ?>
                                            </option>
                                        <?php endforeach; ?>
                                    </select>
                                </td>
                            </tr>
                        <?php endforeach; ?>
                    <?php endif; ?>
                </tbody>
            </table>
            <p class="description" style="margin-top: 12px;">
                ℹ️ Cuando pulses el botón <strong>"🎨 Generar imágenes con Claude"</strong> del calendario, Claude recibirá el modelo configurado para ese cliente y la API key correspondiente, y lo usará automáticamente. No tienes que recordarlo cada vez.
            </p>
        </div>
        
        <div class="nv-settings-card">
            <h2>🔐 Webhook Secret</h2>
            <p>Token de seguridad que Make debe enviar en el header <code>X-NV-Secret</code> al llamar a endpoints protegidos.</p>
            
            <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin: 12px 0;">
                <code id="nv-secret-display" style="background: #f0f0f0; padding: 10px 14px; font-size: 12px; border-radius: 4px; user-select: all; flex: 1; min-width: 280px; word-break: break-all;">
                    <?php echo esc_html(nv_dashboard_get_webhook_secret()); ?>
                </code>
                <button type="button" class="button" onclick="nvCopySecret()">📋 Copiar</button>
                <button type="button" class="button" onclick="nvRegenerateSecret()" style="color:#c00;">
                    🔄 Regenerar
                </button>
            </div>
            <p class="description" style="color: #c00;">
                ⚠️ <strong>Si regeneras este secret</strong>, deberás actualizarlo en TODOS tus escenarios Make que llamen a endpoints protegidos (ej: marcar-programado).
            </p>
            <script>
            function nvCopySecret() {
                const t = document.getElementById('nv-secret-display').textContent.trim();
                navigator.clipboard.writeText(t).then(() => alert('Secret copiado al portapapeles'));
            }
            function nvRegenerateSecret() {
                if (!confirm('¿Seguro que quieres regenerar el webhook secret?\n\nEsto invalidará el actual y deberás actualizar todos los escenarios Make que lo usen.')) return;
                fetch('<?php echo esc_url_raw(rest_url('nv/v1/regenerar-secret')); ?>', {
                    method: 'POST',
                    headers: {
                        'X-WP-Nonce': '<?php echo wp_create_nonce('wp_rest'); ?>',
                        'Content-Type': 'application/json',
                    }
                }).then(r => r.json()).then(d => {
                    if (d.success) {
                        document.getElementById('nv-secret-display').textContent = d.secret;
                        alert('✅ Secret regenerado:\n\n' + d.secret + '\n\nActualízalo ya en tus escenarios Make.');
                    } else {
                        alert('❌ Error: ' + (d.message || 'desconocido'));
                    }
                });
            }
            </script>
        </div>
        
        <div class="nv-settings-card">
            <h2>🔑 API Token del plugin (Bearer auth)</h2>
            <p>Token para que Claudes externos (los que se abren al pulsar "Abrir en Claude") puedan autenticar contra los endpoints <code>/wp-json/nv/v1/*</code> sin sesión WP. Se inyecta automáticamente en los prompts.</p>

            <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin: 12px 0;">
                <code id="nv-apitoken-display" style="background: #f0f0f0; padding: 10px 14px; font-size: 12px; border-radius: 4px; user-select: all; flex: 1; min-width: 280px; word-break: break-all;">
                    <?php echo esc_html(nv_dashboard_get_api_token()); ?>
                </code>
                <button type="button" class="button" onclick="nvCopyApiToken()">📋 Copiar</button>
                <button type="button" class="button" onclick="nvRotateApiToken()" style="color:#c00;">
                    🔄 Rotar
                </button>
            </div>
            <p class="description">
                Uso: <code>Authorization: Bearer &lt;token&gt;</code> en cualquier endpoint del plugin.
                Más seguro que Application Password porque solo da acceso a <code>/wp-json/nv/v1/*</code>, no al resto del REST de WP.
            </p>
            <p class="description" style="color: #c00;">
                ⚠️ <strong>Rota el token</strong> si sospechas que ha quedado expuesto en logs (claude.ai, capturas, historial). El nuevo se inyectará automáticamente en los siguientes prompts.
            </p>
            <script>
            function nvCopyApiToken() {
                const t = document.getElementById('nv-apitoken-display').textContent.trim();
                navigator.clipboard.writeText(t).then(() => alert('API token copiado al portapapeles'));
            }
            function nvRotateApiToken() {
                if (!confirm('¿Rotar el API token?\n\nEl token actual quedará invalidado al instante. Cualquier Claude externo que esté en medio de una operación tendrá que volver a leer el prompt nuevo.')) return;
                fetch('<?php echo esc_url_raw(rest_url('nv/v1/rotar-api-token')); ?>', {
                    method: 'POST',
                    headers: {
                        'X-WP-Nonce': '<?php echo wp_create_nonce('wp_rest'); ?>',
                        'Content-Type': 'application/json',
                    }
                }).then(r => r.json()).then(d => {
                    if (d.success) {
                        document.getElementById('nv-apitoken-display').textContent = d.api_token;
                        alert('✅ API token rotado:\n\n' + d.api_token + '\n\nLos próximos prompts ya usarán el nuevo automáticamente.');
                    } else {
                        alert('❌ Error: ' + (d.message || 'desconocido'));
                    }
                });
            }
            </script>
        </div>

        <div class="nv-settings-card">
            <h2>📁 Google Drive Picker (OAuth)</h2>
            <p>Credenciales para que el formulario de cliente pueda abrir el Drive Picker oficial y para auto-crear estructura de carpetas. Obligatorio si quieres usar el botón "Seleccionar de Drive" o "Auto-crear estructura". Sin estas credenciales, el formulario sigue funcionando con el campo de URL/ID manual.</p>

            <table class="form-table">
                <tr>
                    <th><label for="google_client_id">OAuth Client ID</label></th>
                    <td>
                        <input type="text" name="google_client_id" id="google_client_id"
                            value="<?php echo esc_attr($google_client_id); ?>"
                            placeholder="123456789012-xxxxxxxxxxxxxxxx.apps.googleusercontent.com"
                            style="width: 100%; max-width: 600px; font-family: monospace; font-size: 12px;" />
                        <p class="description">
                            Lo obtienes en <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">Google Cloud Console → APIs y servicios → Credenciales</a> creando un OAuth 2.0 Client ID de tipo "Aplicación web". En "Orígenes JavaScript autorizados" añade <code><?php echo esc_html(home_url()); ?></code>.
                        </p>
                    </td>
                </tr>
                <tr>
                    <th><label for="google_api_key">API Key</label></th>
                    <td>
                        <input type="text" name="google_api_key" id="google_api_key"
                            value="<?php echo esc_attr($google_api_key); ?>"
                            placeholder="AIzaSy..."
                            style="width: 100%; max-width: 600px; font-family: monospace; font-size: 12px;" />
                        <p class="description">
                            En la misma pantalla de Credenciales, "Crear credencial → Clave de API". Restríngela en "Restricciones de aplicación" a HTTP referrer con tu dominio. APIs habilitadas necesarias: <strong>Google Drive API</strong> y <strong>Google Picker API</strong>.
                        </p>
                    </td>
                </tr>
            </table>

            <details style="margin-top:16px; padding:12px; background:#f7f9fc; border-left:3px solid #0073aa;">
                <summary style="cursor:pointer; font-weight:600;">📋 Guía paso a paso (5 min)</summary>
                <ol style="margin:10px 0 0 20px; line-height:1.8;">
                    <li>Ve a <a href="https://console.cloud.google.com/" target="_blank" rel="noopener">Google Cloud Console</a> y crea un proyecto nuevo (o usa uno existente).</li>
                    <li>En "APIs y servicios → Biblioteca", busca y habilita: <strong>Google Drive API</strong> y <strong>Google Picker API</strong>.</li>
                    <li>Ve a "Pantalla de consentimiento OAuth", configura como "Externo", rellena nombre/email y guarda. En "Scopes" añade <code>drive.readonly</code> y <code>drive.file</code>. En "Usuarios de prueba" añade tu email de Google (el que tiene acceso a REFS NV).</li>
                    <li>"Credenciales → Crear credenciales → ID de cliente OAuth → Aplicación web". Nombre: "NV Dashboard". En "Orígenes JavaScript autorizados" añade: <code><?php echo esc_html(home_url()); ?></code>. Guarda y copia el Client ID.</li>
                    <li>"Credenciales → Crear credenciales → Clave de API". Cópiala. (Opcional pero recomendado: en "Restricciones de aplicación" elige "Sitios web" y añade <code><?php echo esc_html(parse_url(home_url(), PHP_URL_HOST)); ?>/*</code>; en "Restricciones de API" marca solo Drive API y Picker API.)</li>
                    <li>Pega Client ID y API Key arriba y guarda.</li>
                </ol>
            </details>
        </div>

        <div class="nv-settings-card">
            <h2>🚪 Redirección tras login</h2>
            <p>URL a la que WordPress redirigirá automáticamente a David (y a cualquier usuario con permisos editoriales) tras iniciar sesión, sea con el botón "Sign in with Google" de Site Kit o con usuario/contraseña. Pensado sobre todo para móvil: tap en "Iniciar sesión con Google" → directo al NV Dashboard sin pasar por el escritorio genérico de WP.</p>

            <table class="form-table">
                <tr>
                    <th><label for="nv_login_redirect_url">URL de destino</label></th>
                    <td>
                        <input type="text" name="nv_login_redirect_url" id="nv_login_redirect_url"
                            value="<?php echo esc_attr($login_redirect_url); ?>"
                            placeholder="<?php echo esc_attr(admin_url('admin.php?page=nv-dashboard')); ?>"
                            style="width: 100%; max-width: 600px; font-family: monospace; font-size: 12px;" />
                        <p class="description">
                            Acepta URL absoluta (<code>https://hub.negociovivo.com/wp-admin/admin.php?page=nv-dashboard</code>) o ruta relativa empezando por <code>/</code> (<code>/wp-admin/admin.php?page=nv-dashboard</code>). Dejar vacío para volver al comportamiento por defecto de WordPress.
                        </p>
                        <p class="description" style="margin-top:6px;">
                            <strong>Sugerencias rápidas:</strong>
                            <button type="button" class="button button-small"
                                onclick="document.getElementById('nv_login_redirect_url').value='<?php echo esc_js(admin_url('admin.php?page=nv-dashboard')); ?>'">
                                📊 Vista General NV
                            </button>
                            <button type="button" class="button button-small"
                                onclick="document.getElementById('nv_login_redirect_url').value='<?php echo esc_js(admin_url('admin.php?page=nv-dashboard-editorial')); ?>'">
                                📅 Editorial
                            </button>
                            <button type="button" class="button button-small"
                                onclick="document.getElementById('nv_login_redirect_url').value=''">
                                ↺ Default WP
                            </button>
                        </p>
                    </td>
                </tr>
            </table>

            <details style="margin-top:16px; padding:12px; background:#f7f9fc; border-left:3px solid #0073aa;">
                <summary style="cursor:pointer; font-weight:600;">ℹ️ Cómo funciona y a quién afecta</summary>
                <ul style="margin:10px 0 0 20px; line-height:1.8;">
                    <li>Se aplica vía el hook estándar de WordPress <code>login_redirect</code>, así que <strong>cubre todos los métodos de login</strong>: el botón Sign in with Google de Site Kit, el formulario de usuario/contraseña, futuros plugins de auth, etc.</li>
                    <li>Solo redirige a usuarios con capability <code>edit_posts</code> (Administrador, Editor, Autor). Si en el futuro abres el sitio a Suscriptores no afectados (clientes con cuenta limitada), seguirán su flujo normal.</li>
                    <li>Si el flujo de login trae un <code>redirect_to</code> explícito en query string (típico cuando WP te manda al login porque intentaste entrar a una página concreta sin sesión), se respeta ese destino — no se pisa.</li>
                    <li>Solo se sobreescribe cuando el destino default sería el escritorio genérico de WP (<code>/wp-admin/</code>).</li>
                </ul>
            </details>
        </div>

        <div class="nv-settings-card">
            <h2>📱 App móvil (PWA — Añadir a pantalla de inicio)</h2>
            <p>Configura el icono y el comportamiento cuando añades <code><?php echo esc_html(home_url('/wp-admin/')); ?></code> a la pantalla de inicio de tu móvil. Al tocar el icono, el sitio se abre en modo "app" (sin barra del navegador, fullscreen) y aterriza directo en la URL de redirección configurada arriba.</p>

            <p style="background:#fff8e6; border-left:3px solid #d2a039; padding:10px 14px; margin:12px 0;">
                <strong>Cómo añadirlo al móvil:</strong><br>
                <strong>iOS Safari:</strong> abre <code><?php echo esc_html(home_url('/wp-admin/')); ?></code> → botón Compartir (cuadrado con flecha hacia arriba) → "Añadir a pantalla de inicio".<br>
                <strong>Android Chrome:</strong> abre la misma URL → menú ⋮ → "Añadir a pantalla de inicio" o "Instalar app".
            </p>

            <table class="form-table">
                <tr>
                    <th><label for="nv_pwa_app_name">Nombre completo de la app</label></th>
                    <td>
                        <input type="text" name="nv_pwa_app_name" id="nv_pwa_app_name"
                            value="<?php echo esc_attr($pwa_app_name); ?>"
                            placeholder="NV Dashboard"
                            style="width: 100%; max-width: 400px;" maxlength="60" />
                        <p class="description">Aparece en algunos splash screens y en la lista de apps instaladas. Default: <code>NV Dashboard</code>.</p>
                    </td>
                </tr>
                <tr>
                    <th><label for="nv_pwa_short_name">Nombre corto (debajo del icono)</label></th>
                    <td>
                        <input type="text" name="nv_pwa_short_name" id="nv_pwa_short_name"
                            value="<?php echo esc_attr($pwa_short_name); ?>"
                            placeholder="NV"
                            style="width: 100%; max-width: 200px;" maxlength="12" />
                        <p class="description">Texto que aparece debajo del icono en la pantalla de inicio del móvil. Recomendado: 4-8 caracteres. Default: <code>NV</code>.</p>
                    </td>
                </tr>
                <tr>
                    <th><label for="nv_pwa_theme_color">Color de tema</label></th>
                    <td>
                        <?php
                        $tc_value = $pwa_theme_color !== '' ? $pwa_theme_color : '#0A0A0C';
                        ?>
                        <input type="color" name="nv_pwa_theme_color" id="nv_pwa_theme_color_picker"
                            value="<?php echo esc_attr($tc_value); ?>"
                            style="width: 60px; height: 36px; padding: 0; border: 1px solid #ccc; border-radius: 4px; cursor: pointer; vertical-align: middle;"
                            onchange="document.getElementById('nv_pwa_theme_color_text').value = this.value.toUpperCase()" />
                        <input type="text" name="nv_pwa_theme_color_text_visible" id="nv_pwa_theme_color_text"
                            value="<?php echo esc_attr(strtoupper($tc_value)); ?>"
                            placeholder="#0A0A0C" maxlength="7" readonly
                            style="width: 90px; vertical-align: middle; font-family: monospace; background:#f0f0f0;" />
                        <p class="description">Color de la barra de estado del móvil al abrir la app. Default: <code>#0A0A0C</code> (negro NV).</p>
                    </td>
                </tr>
                <tr>
                    <th>Icono</th>
                    <td>
                        <?php if (function_exists('has_site_icon') && has_site_icon()) : ?>
                            <img src="<?php echo esc_url(get_site_icon_url(96)); ?>" alt="" style="width:64px; height:64px; border-radius:12px; vertical-align:middle; margin-right:12px;" />
                            <span>Usando el <strong>Site Icon</strong> configurado en WordPress.</span>
                            <p class="description" style="margin-top:8px;">Para cambiarlo: Apariencia → Personalizar → Identidad del sitio → Icono del sitio. WP genera automáticamente todos los tamaños necesarios (180, 192, 270, 512).</p>
                        <?php else : ?>
                            <img src="<?php echo esc_url(NV_DASHBOARD_URL . 'assets/pwa/icon-192.png'); ?>" alt="" style="width:64px; height:64px; border-radius:12px; vertical-align:middle; margin-right:12px;" />
                            <span>Usando icono <strong>NV por defecto</strong> (negro + dorado, monograma "NV").</span>
                            <p class="description" style="margin-top:8px;">Para personalizarlo, sube tu logo cuadrado en <a href="<?php echo esc_url(admin_url('customize.php?autofocus[section]=title_tagline')); ?>">Apariencia → Personalizar → Identidad del sitio → Icono del sitio</a>. WP genera todos los tamaños automáticamente; el plugin los detectará.</p>
                        <?php endif; ?>
                    </td>
                </tr>
            </table>

            <details style="margin-top:16px; padding:12px; background:#f7f9fc; border-left:3px solid #0073aa;">
                <summary style="cursor:pointer; font-weight:600;">🔍 Comprobar que funciona</summary>
                <ol style="margin:10px 0 0 20px; line-height:1.8;">
                    <li>Abre <a href="<?php echo esc_url(rest_url('nv/v1/pwa-manifest.json')); ?>" target="_blank" rel="noopener"><code><?php echo esc_html(rest_url('nv/v1/pwa-manifest.json')); ?></code></a> — debe devolver un JSON con <code>display: "standalone"</code>, el nombre, icons, etc.</li>
                    <li>En Chrome desktop: F12 → Application → Manifest. Tiene que detectar el manifest, el icono y mostrar "Installable".</li>
                    <li>En el móvil, después de añadirlo a pantalla de inicio, tocar el icono debe abrir el sitio <strong>sin barra de navegador</strong> y aterrizar en la URL de redirección configurada en la tarjeta de arriba.</li>
                </ol>
            </details>
        </div>

        <div class="nv-settings-card">
            <h2>🧹 Limpieza Media Library</h2>
            <p>Detecta y elimina archivos duplicados (con sufijo <code>-1</code>, <code>-2</code>, etc.) que no estén en uso en ninguna publicación.</p>
            <button type="button" class="button" onclick="nvScanDuplicados()">
                🔍 Escanear duplicados
            </button>
            <div id="nv-duplicados-result" style="margin-top: 14px;"></div>
            <script>
            function nvScanDuplicados() {
                const out = document.getElementById('nv-duplicados-result');
                out.innerHTML = '<em>Escaneando…</em>';
                fetch('<?php echo esc_url_raw(rest_url('nv/v1/media-duplicados')); ?>', {
                    headers: { 'X-WP-Nonce': '<?php echo wp_create_nonce('wp_rest'); ?>' }
                }).then(r => r.json()).then(d => {
                    if (!d.duplicados || d.duplicados.length === 0) {
                        out.innerHTML = '<p style="color:#2ea043;">✅ No se encontraron duplicados con sufijo numérico.</p>';
                        return;
                    }
                    let html = `<p><strong>${d.duplicados.length} duplicados detectados</strong> (de ${d.total_candidatos} candidatos analizados):</p><table class="widefat"><thead><tr><th>Duplicado</th><th>Original</th><th>En uso</th><th>Acción</th></tr></thead><tbody>`;
                    d.duplicados.forEach(x => {
                        const usado = x.usado_en_acf > 0
                            ? `<span style="color:#c00;font-weight:600;">SÍ (${x.usado_en_acf})</span>`
                            : '<span style="color:#888;">no</span>';
                        const btn = x.usado_en_acf > 0
                            ? '<button class="button" disabled title="No se puede borrar: está en uso">No borrable</button>'
                            : `<button class="button" onclick="nvBorrarAdjunto(${x.id_duplicado}, this)">🗑 Borrar</button>`;
                        html += `<tr>
                            <td><code>${x.slug_duplicado}</code><br><small>ID ${x.id_duplicado}</small></td>
                            <td><code>${(x.url_original.split('/').pop() || '')}</code><br><small>ID ${x.id_original}</small></td>
                            <td>${usado}</td>
                            <td>${btn}</td>
                        </tr>`;
                    });
                    html += '</tbody></table>';
                    out.innerHTML = html;
                });
            }
            function nvBorrarAdjunto(id, btn) {
                if (!confirm('¿Borrar definitivamente el adjunto ID ' + id + '?')) return;
                btn.disabled = true; btn.textContent = '...';
                fetch('<?php echo esc_url_raw(rest_url('nv/v1/borrar-adjunto/')); ?>' + id, {
                    method: 'DELETE',
                    headers: { 'X-WP-Nonce': '<?php echo wp_create_nonce('wp_rest'); ?>' }
                }).then(r => r.json()).then(d => {
                    if (d.success) {
                        btn.closest('tr').style.opacity = '0.4';
                        btn.textContent = '✓ Borrado';
                    } else {
                        alert('Error: ' + (d.message || ''));
                        btn.disabled = false; btn.textContent = '🗑 Borrar';
                    }
                });
            }
            </script>
        </div>
        
        <div class="nv-settings-card">
            <h2>📡 Endpoints REST API</h2>
            <p>URLs que puede usar Make para integrarse con WordPress:</p>
            <table class="widefat">
                <thead>
                    <tr><th>Método</th><th>Endpoint</th><th>Descripción</th></tr>
                </thead>
                <tbody>
                    <tr>
                        <td><code>GET</code></td>
                        <td><code><?php echo rest_url('nv/v1/publicaciones'); ?></code></td>
                        <td>Listar publicaciones (filtros: cliente, estado, from, to, aprobadas)</td>
                    </tr>
                    <tr>
                        <td><code>POST</code></td>
                        <td><code><?php echo rest_url('nv/v1/aprobar-mes'); ?></code></td>
                        <td>Aprobar mes y generar CSV (body: cliente, mes)</td>
                    </tr>
                    <tr>
                        <td><code>POST</code></td>
                        <td><code><?php echo rest_url('nv/v1/marcar-programado'); ?></code></td>
                        <td>Marcar como programado (header X-NV-Secret + body: post_id, metricool_id)</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <!-- v1.0.14: Shortcode shortcode -->
        <div class="nv-card" style="margin-top: 20px;">
            <h2>📅 Embeber el calendario en una página</h2>
            <p>Usa el shortcode <code>[nv_dashboard]</code> para mostrar el calendario editorial en cualquier página o entrada del WordPress.</p>

            <h4>Atributos disponibles</h4>
            <table class="widefat" style="margin-bottom: 12px;">
                <thead>
                    <tr><th style="width:140px;">Atributo</th><th>Valores</th><th>Descripción</th></tr>
                </thead>
                <tbody>
                    <tr><td><code>cliente</code></td><td>slug · ej. <code>aquaking</code></td><td>Cliente a mostrar (default: <code>all</code>)</td></tr>
                    <tr><td><code>vista</code></td><td><code>editorial</code> | <code>overview</code></td><td>Tipo de vista (default: <code>editorial</code>)</td></tr>
                    <tr><td><code>mes</code></td><td><code>YYYY-MM</code></td><td>Mes inicial (default: mes actual)</td></tr>
                    <tr><td><code>height</code></td><td>píxeles · ej. <code>1400</code></td><td>Altura del iframe (default: <code>1200</code>)</td></tr>
                    <tr><td><code>aprobacion</code></td><td><code>1</code> | <code>0</code></td><td>Mostrar botón aprobación rápida (default: <code>1</code>)</td></tr>
                </tbody>
            </table>

            <h4>Ejemplos copiables</h4>
            <p><strong>Calendario completo del cliente Aquaking:</strong></p>
            <input type="text" readonly value='[nv_dashboard cliente="aquaking" vista="editorial"]'
                   style="width:100%;padding:8px;font-family:monospace;background:#f9f9f9;"
                   onclick="this.select()">

            <p style="margin-top:8px;"><strong>Vista general (todos los clientes):</strong></p>
            <input type="text" readonly value='[nv_dashboard vista="overview"]'
                   style="width:100%;padding:8px;font-family:monospace;background:#f9f9f9;"
                   onclick="this.select()">

            <p style="margin-top:8px;"><strong>Mes específico, altura ampliada:</strong></p>
            <input type="text" readonly value='[nv_dashboard cliente="negocio-vivo" mes="2026-05" height="1400"]'
                   style="width:100%;padding:8px;font-family:monospace;background:#f9f9f9;"
                   onclick="this.select()">

            <p style="margin-top:14px;"><strong>URLs públicas alternativas</strong> (sin shortcode):</p>
            <ul>
                <li><code><?php echo esc_html(home_url('/nv-dashboard/')); ?></code> — Vista general</li>
                <li><code><?php echo esc_html(home_url('/nv-dashboard/?vista=editorial&cliente=aquaking')); ?></code> — Calendario filtrado</li>
            </ul>

            <p style="color:#666;margin-top:12px;font-size:13px;">
                <strong>💡 Aprobación rápida:</strong> Los usuarios con permiso de edición verán un botón circular
                (<span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:#16a34a;color:#fff;text-align:center;line-height:18px;font-weight:700;font-size:12px;">✓</span>)
                en la esquina de cada publicación del calendario. Click para aprobar/desaprobar al instante sin abrir el detalle.
            </p>
        </div>

        <p>
            <input type="submit" name="nv_save_settings" class="button button-primary nv-button-gold" value="Guardar configuración">
        </p>
    </form>
</div>
