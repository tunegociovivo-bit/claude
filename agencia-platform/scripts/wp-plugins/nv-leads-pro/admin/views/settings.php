<?php
if ( ! defined( 'WPINC' ) ) { die; }
$settings = get_option( 'nvl_settings', array() );
$g = function( $k, $d = '' ) use ( $settings ) { return isset( $settings[ $k ] ) ? $settings[ $k ] : $d; };
?>
<div class="wrap nvl-wrap">
    <h1>Ajustes — Negocio Vivo Leads</h1>

    <?php if ( isset( $_GET['saved'] ) ) : ?>
        <div class="notice notice-success is-dismissible"><p>Ajustes guardados.</p></div>
    <?php endif; ?>
    <?php if ( isset( $_GET['test_ok'] ) ) : ?>
        <div class="notice notice-success"><p>✅ Google Places funcionando. Se devolvieron <?php echo intval( $_GET['test_ok'] ); ?> resultados de prueba.</p></div>
    <?php endif; ?>
    <?php if ( isset( $_GET['test_error'] ) ) : ?>
        <div class="notice notice-error"><p>❌ Error probando Google Places: <?php echo esc_html( wp_unslash( $_GET['test_error'] ) ); ?></p></div>
    <?php endif; ?>
    <?php if ( isset( $_GET['evo_ok'] ) ) : ?>
        <div class="notice notice-success"><p>✅ Evolution API responde. Estado de la instancia: <code><?php echo esc_html( wp_unslash( $_GET['evo_ok'] ) ); ?></code></p></div>
    <?php endif; ?>
    <?php if ( isset( $_GET['evo_error'] ) ) : ?>
        <div class="notice notice-error"><p>❌ Error en Evolution API: <?php echo esc_html( wp_unslash( $_GET['evo_error'] ) ); ?></p></div>
    <?php endif; ?>
    <?php if ( isset( $_GET['ai_ok'] ) ) : ?>
        <div class="notice notice-success"><p>✅ IA conectada. Respuesta de prueba: <code><?php echo esc_html( wp_unslash( $_GET['ai_ok'] ) ); ?></code></p></div>
    <?php endif; ?>
    <?php if ( isset( $_GET['ai_error'] ) ) : ?>
        <div class="notice notice-error"><p>❌ Error IA: <?php echo esc_html( wp_unslash( $_GET['ai_error'] ) ); ?></p></div>
    <?php endif; ?>
    <?php if ( isset( $_GET['wh_ok'] ) ) : ?>
        <div class="notice notice-success"><p>✅ Webhook configurado en Evolution API.</p></div>
    <?php endif; ?>
    <?php if ( isset( $_GET['wh_error'] ) ) : ?>
        <div class="notice notice-error"><p>❌ Error configurando webhook: <?php echo esc_html( wp_unslash( $_GET['wh_error'] ) ); ?></p></div>
    <?php endif; ?>
    <?php if ( isset( $_GET['wa_batch_msg'] ) ) : ?>
        <div class="notice notice-info"><p><?php echo esc_html( wp_unslash( $_GET['wa_batch_msg'] ) ); ?></p></div>
    <?php endif; ?>
    <?php if ( isset( $_GET['rescored'] ) ) : ?>
        <div class="notice notice-success"><p>✅ Re-scoring aplicado a <?php echo intval( $_GET['rescored'] ); ?> leads.</p></div>
    <?php endif; ?>

    <form method="post">
        <?php wp_nonce_field( 'nvl_save_settings' ); ?>
        <input type="hidden" name="nvl_action" value="save_settings">
        <input type="hidden" name="form_section" value="main">

        <h2 class="title">🔍 Google Places</h2>
        <table class="form-table">
            <tr>
                <th><label for="google_api_key">Google Places API Key</label></th>
                <td>
                    <input id="google_api_key" name="google_api_key" type="text" class="regular-text code"
                           value="<?php echo esc_attr( $g( 'google_api_key' ) ); ?>" autocomplete="off">
                    <p class="description">Obtén tu API key en <a href="https://console.cloud.google.com/google/maps-apis/credentials" target="_blank">Google Cloud Console</a> con la <strong>Places API</strong> habilitada.</p>
                    <button type="submit" name="nvl_action" value="test_api_key" class="button">Probar Google API key</button>
                </td>
            </tr>
            <tr>
                <th><label for="batch_size">Provincias por lote</label></th>
                <td>
                    <input id="batch_size" name="batch_size" type="number" min="1" max="20" value="<?php echo esc_attr( $g( 'batch_size', 5 ) ); ?>">
                    <p class="description">Provincias procesadas cada 2 min por el cron de búsqueda.</p>
                </td>
            </tr>
            <tr>
                <th>Enriquecer con Place Details</th>
                <td>
                    <label><input name="fetch_details" type="checkbox" value="1" <?php checked( $g( 'fetch_details' ) ); ?>>
                        Llamar a Place Details para obtener teléfono y web</label>
                </td>
            </tr>
            <tr>
                <th>Filtro IA por keyword</th>
                <td>
                    <label><input name="validate_keyword_match" type="checkbox" value="1" <?php checked( $g( 'validate_keyword_match' ) ); ?>>
                        Validar cada lead contra la keyword con IA y descartar los que no encajan (modo conservador)</label>
                    <p class="description">Requiere IA configurada. Cuesta ~$0.001 por lead. Ante duda, descarta. Evita contactar negocios que no se dedican a lo que buscas.</p>
                </td>
            </tr>
            <tr>
                <th><label for="competitor_count">Competidores por lead</label></th>
                <td><input id="competitor_count" name="competitor_count" type="number" min="1" max="10" value="<?php echo esc_attr( $g( 'competitor_count', 3 ) ); ?>"></td>
            </tr>
            <tr>
                <th><label for="whatsapp_country_code">Código de país por defecto</label></th>
                <td>
                    <input id="whatsapp_country_code" name="whatsapp_country_code" type="text"
                           value="<?php echo esc_attr( $g( 'whatsapp_country_code', '34' ) ); ?>" size="6">
                    <p class="description">Sin el "+". España = 34.</p>
                </td>
            </tr>
        </table>

        <hr>
        <h2 class="title">📱 WhatsApp API (WAHA) — envío automatizado</h2>
        <p>Antes de usar el envío automatizado necesitas tener WAHA desplegado y tu número de WhatsApp vinculado por QR. Consulta la <strong>guía WAHA</strong> que viene con el plugin (<code>WAHA-SETUP.md</code>).</p>
        <table class="form-table">
            <tr>
                <th><label for="evolution_api_url">URL base de WAHA</label></th>
                <td>
                    <input id="evolution_api_url" name="evolution_api_url" type="url" class="regular-text code"
                           value="<?php echo esc_attr( $g( 'evolution_api_url' ) ); ?>"
                           placeholder="http://116.203.16.76:3000">
                    <p class="description">URL pública de WAHA, sin barra final. Ejemplo: <code>http://TU-IP:3000</code>.</p>
                </td>
            </tr>
            <tr>
                <th><label for="evolution_api_key">API key (WHATSAPP_API_KEY)</label></th>
                <td>
                    <input id="evolution_api_key" name="evolution_api_key" type="text" class="regular-text code"
                           value="<?php echo esc_attr( $g( 'evolution_api_key' ) ); ?>" autocomplete="off">
                    <p class="description">La que pusiste en la variable <code>WHATSAPP_API_KEY</code> al levantar el contenedor de WAHA.</p>
                </td>
            </tr>
            <tr>
                <th><label for="evolution_instance">Nombre de la sesión</label></th>
                <td>
                    <input id="evolution_instance" name="evolution_instance" type="text" class="regular-text"
                           value="<?php echo esc_attr( $g( 'evolution_instance', 'default' ) ); ?>" placeholder="default">
                    <p class="description">Nombre de la sesión de WAHA. Por defecto <code>default</code> a no ser que crees varias.</p>
                    <button type="submit" name="nvl_action" value="test_evolution" class="button">Probar conexión WAHA</button>
                </td>
            </tr>
        </table>

        <hr>
        <h2 class="title">⚙ Anti-baneo y ritmo de envío</h2>
        <table class="form-table">
            <tr>
                <th>Envío automático</th>
                <td>
                    <label><input name="send_enabled" type="checkbox" value="1" <?php checked( $g( 'send_enabled', 1 ) ); ?>>
                        Activar motor de envío automático</label>
                    <p class="description">Si lo desactivas, los mensajes encolados no se enviarán hasta que lo reactives.</p>
                </td>
            </tr>
            <tr>
                <th>Delay entre mensajes (segundos)</th>
                <td>
                    <input name="send_delay_min" type="number" min="5" value="<?php echo esc_attr( $g( 'send_delay_min', 60 ) ); ?>" size="5"> mín.
                    &nbsp;
                    <input name="send_delay_max" type="number" min="5" value="<?php echo esc_attr( $g( 'send_delay_max', 180 ) ); ?>" size="5"> máx.
                    <p class="description">Espera aleatoria entre el envío de un mensaje y el siguiente. Recomendado: 60–180.</p>
                </td>
            </tr>
            <tr>
                <th>Ventana horaria</th>
                <td>
                    De <input name="send_window_start" type="time" value="<?php echo esc_attr( $g( 'send_window_start', '09:00' ) ); ?>">
                    a <input name="send_window_end" type="time" value="<?php echo esc_attr( $g( 'send_window_end', '20:00' ) ); ?>">
                    <p class="description">Fuera de esta franja, los mensajes esperan hasta el siguiente día válido.</p>
                </td>
            </tr>
            <tr>
                <th>Fines de semana</th>
                <td>
                    <label><input name="send_on_weekends" type="checkbox" value="1" <?php checked( $g( 'send_on_weekends' ) ); ?>>
                        Permitir envíos sábados y domingos</label>
                </td>
            </tr>
            <tr>
                <th><label for="daily_limit">Límite diario por instancia</label></th>
                <td>
                    <input id="daily_limit" name="daily_limit" type="number" min="1" max="1000" value="<?php echo esc_attr( $g( 'daily_limit', 80 ) ); ?>">
                    <p class="description">Cuando se alcance, el motor se detiene hasta el día siguiente. Recomendado: 50–150 por número.</p>
                </td>
            </tr>
            <tr>
                <th>Variaciones de texto</th>
                <td>
                    <label><input name="enable_variations" type="checkbox" value="1" <?php checked( $g( 'enable_variations', 1 ) ); ?>>
                        Aplicar mini-variaciones automáticas al mensaje (saludo, sinónimos, puntuación)</label>
                    <p class="description">Reduce el patrón "todos los mensajes idénticos" que detectan los algoritmos anti-spam.</p>
                </td>
            </tr>
        </table>

        <p class="submit">
            <button class="button button-primary button-hero">Guardar todos los ajustes</button>
        </p>
    </form>

    <hr>
    <h2 class="title">🤖 Inteligencia Artificial</h2>
    <p>Genera openers personalizados por lead y clasifica las respuestas entrantes automáticamente. Funciona con Anthropic (Claude) y OpenAI.</p>
    <form method="post">
        <?php wp_nonce_field( 'nvl_save_settings' ); ?>
        <input type="hidden" name="form_section" value="ai">
        <table class="form-table">
            <tr>
                <th><label for="ai_provider">Proveedor</label></th>
                <td>
                    <select id="ai_provider" name="ai_provider">
                        <option value="anthropic" <?php selected( $g( 'ai_provider' ), 'anthropic' ); ?>>Anthropic (Claude) — Recomendado</option>
                        <option value="openai"    <?php selected( $g( 'ai_provider' ), 'openai' ); ?>>OpenAI (GPT)</option>
                        <option value="none"      <?php selected( $g( 'ai_provider' ), 'none' ); ?>>Desactivado</option>
                    </select>
                </td>
            </tr>
            <tr>
                <th><label for="ai_api_key">API key</label></th>
                <td>
                    <input id="ai_api_key" name="ai_api_key" type="text" class="regular-text code" value="<?php echo esc_attr( $g( 'ai_api_key' ) ); ?>" autocomplete="off">
                    <p class="description">
                        Para Anthropic: <a href="https://console.anthropic.com/" target="_blank">console.anthropic.com</a>.
                        Para OpenAI: <a href="https://platform.openai.com/api-keys" target="_blank">platform.openai.com</a>.
                    </p>
                </td>
            </tr>
            <tr>
                <th><label for="ai_model_opener">Modelo para opener</label></th>
                <td>
                    <input id="ai_model_opener" name="ai_model_opener" type="text" class="regular-text code" value="<?php echo esc_attr( $g( 'ai_model_opener' ) ); ?>">
                    <p class="description">Recomendado: <code>claude-haiku-4-5-20251001</code> (Anthropic) o <code>gpt-4o-mini</code> (OpenAI). Modelos pequeños y baratos.</p>
                </td>
            </tr>
            <tr>
                <th>Funciones IA activas</th>
                <td>
                    <label><input type="checkbox" name="ai_enabled_opener" value="1" <?php checked( $g( 'ai_enabled_opener', 1 ) ); ?>> Generar opener personalizado <code>{{opener_ia}}</code></label><br>
                    <label><input type="checkbox" name="ai_enabled_classify" value="1" <?php checked( $g( 'ai_enabled_classify', 1 ) ); ?>> Clasificar respuestas entrantes</label>
                </td>
            </tr>
        </table>
        <p>
            <button type="submit" name="nvl_action" value="save_settings" class="button button-primary">Guardar IA</button>
            <button type="submit" name="nvl_action" value="test_ai" class="button">Probar IA</button>
        </p>
    </form>

    <hr>
    <h2 class="title">📨 Webhook (respuestas entrantes)</h2>
    <p>Esta URL debe configurarse en Evolution API para que los mensajes que reciban tus números lleguen al plugin y se clasifiquen automáticamente.</p>
    <table class="form-table">
        <tr>
            <th>URL del webhook</th>
            <td>
                <code style="user-select:all;display:inline-block;padding:6px 10px;background:#f0f0f1;border-radius:4px;"><?php echo esc_html( NVL_Webhook::endpoint_url() ); ?></code>
                <p class="description">Copia esta URL y pégala en Evolution API → Webhook (o usa el botón de abajo para configurarla automáticamente).</p>
                <form method="post" style="display:inline;">
                    <?php wp_nonce_field( 'nvl_save_settings' ); ?>
                    <button type="submit" name="nvl_action" value="configure_webhook" class="button">⚙ Configurar webhook automáticamente en Evolution</button>
                </form>
            </td>
        </tr>
        <tr>
            <th>Validación previa de WA</th>
            <td>
                <form method="post">
                    <?php wp_nonce_field( 'nvl_save_settings' ); ?>
                    <input type="hidden" name="nvl_action" value="save_settings">
                    <input type="hidden" name="form_section" value="wa_validate">
                    <label><input type="checkbox" name="validate_wa_before_send" value="1" <?php checked( $g( 'validate_wa_before_send', 1 ) ); ?>> Comprobar que el número está en WhatsApp antes de enviar (evita quemar mensajes y reduce spam-flag).</label>
                    <p><button class="button">Guardar</button></p>
                </form>
            </td>
        </tr>
    </table>

    <hr>
    <h2 class="title">🛠 Herramientas de mantenimiento</h2>
    <table class="form-table">
        <tr>
            <th>Validar WhatsApp en batch</th>
            <td>
                <a class="button" href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin.php?page=nvl-settings&nvl_action=validate_wa_batch' ), 'nvl_validate_wa_batch' ) ); ?>">Validar 50 leads pendientes</a>
                <p class="description">Comprueba en bloque si los leads sin verificar tienen WhatsApp activo.</p>
            </td>
        </tr>
        <tr>
            <th>Re-calcular scores</th>
            <td>
                <a class="button" href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin.php?page=nvl-settings&nvl_action=rescore_all' ), 'nvl_rescore_all' ) ); ?>">Re-puntuar todos los leads</a>
                <p class="description">Aplica el algoritmo de scoring actual a todos los leads existentes. Útil tras una actualización del plugin.</p>
            </td>
        </tr>
        <tr>
            <th>Re-validar keyword con IA</th>
            <td>
                <a class="button" href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin.php?page=nvl-settings&nvl_action=revalidate_keyword&limit=200' ), 'nvl_revalidate_keyword' ) ); ?>">Re-validar 200 leads pendientes</a>
                <p class="description">Pregunta a la IA si cada lead encaja con la keyword de su búsqueda. Descarta los que no encajen (modo conservador). Útil tras activar el filtro o tras importar leads viejos.</p>
                <?php if ( isset( $_GET['kw_msg'] ) ): ?>
                    <div class="notice notice-success inline" style="margin-top:6px"><p><?php echo esc_html( wp_unslash( $_GET['kw_msg'] ) ); ?></p></div>
                <?php endif; ?>
            </td>
        </tr>
    </table>

    <hr>
    <h2>Aviso legal y buenas prácticas</h2>
    <div class="nvl-info-box">
        <p><strong>WhatsApp Terms of Service:</strong> el envío automatizado a contactos que no te han escrito antes va contra los ToS de WhatsApp y puede provocar el baneo del número. Las medidas anti-baneo de este plugin reducen el riesgo pero no lo eliminan.</p>
        <p><strong>RGPD / LSSI (España):</strong> las comunicaciones comerciales a empresas pueden enviarse con base en interés legítimo, pero deben identificar al remitente, ofrecer mecanismo de baja y respetar las solicitudes de no contactar. Marca como "Descartado" a cualquiera que te diga "no me escribas más".</p>
        <p><strong>Calentamiento del número:</strong> si tu número es nuevo en WhatsApp, no empieces enviando 80 mensajes/día. Sube progresivamente: 10/día la primera semana, 25/día la segunda, 50/día la tercera, etc.</p>
    </div>
</div>
