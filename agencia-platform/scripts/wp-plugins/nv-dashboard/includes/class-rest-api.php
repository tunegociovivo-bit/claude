<?php
/**
 * REST API endpoints v1.0.2
 * 
 * NUEVO en v1.0.2:
 * - Endpoint /diagnostico para debug exhaustivo
 * - Mensajes de error mucho más informativos
 * - Logging interno de búsquedas fallidas
 */

if (!defined('ABSPATH')) exit;

class NV_Rest_API {

    /**
     * v1.0.71: override puntual de las dimensiones del cliente, válido sólo
     * durante la ejecución del request "adaptar-formato". Se consulta en
     * generate_image_via_openai/freepik y ensure_image_matches_client_dimensions
     * cuando el term_id coincide. Se resetea a null al terminar el handler.
     *
     * Estructura: { term_id, tipo, width, height } o null.
     */
    private static $dimension_override = null;

    public static function init() {
        add_action('rest_api_init', [__CLASS__, 'register_routes']);
    }
    
    public static function register_routes() {
        register_rest_route('nv/v1', '/publicaciones', [
            'methods' => 'GET',
            'callback' => [__CLASS__, 'list_publicaciones'],
            'permission_callback' => [__CLASS__, 'check_permission'],
        ]);
        
        register_rest_route('nv/v1', '/aprobar-mes', [
            'methods' => 'POST',
            'callback' => [__CLASS__, 'aprobar_mes'],
            'permission_callback' => [__CLASS__, 'check_permission'],
        ]);
        
        register_rest_route('nv/v1', '/marcar-programado', [
            'methods' => 'POST',
            'callback' => [__CLASS__, 'marcar_programado'],
            'permission_callback' => [__CLASS__, 'check_webhook_secret'],
        ]);
        
        // NUEVO en v1.0.2: endpoint de diagnóstico
        register_rest_route('nv/v1', '/diagnostico', [
            'methods' => 'GET',
            'callback' => [__CLASS__, 'diagnostico'],
            'permission_callback' => [__CLASS__, 'check_permission'],
        ]);
        
        // NUEVO en v1.0.3: endpoint para actualizar campos ACF de una publicación
        register_rest_route('nv/v1', '/actualizar-publicacion/(?P<id>\d+)', [
            'methods' => 'POST',
            'callback' => [__CLASS__, 'actualizar_publicacion'],
            'permission_callback' => [__CLASS__, 'check_permission'],
        ]);
        
        // NUEVO en v1.0.6: drag & drop reprogramar publicación
        register_rest_route('nv/v1', '/reprogramar/(?P<id>\d+)', [
            'methods' => 'POST',
            'callback' => [__CLASS__, 'reprogramar'],
            'permission_callback' => [__CLASS__, 'check_permission'],
        ]);
        
        // NUEVO en v1.0.6: duplicar mes
        register_rest_route('nv/v1', '/duplicar-mes', [
            'methods' => 'POST',
            'callback' => [__CLASS__, 'duplicar_mes'],
            'permission_callback' => [__CLASS__, 'check_permission'],
        ]);
        
        // NUEVO en v1.0.6: stats granulares por red y tipo
        register_rest_route('nv/v1', '/stats-granulares', [
            'methods' => 'GET',
            'callback' => [__CLASS__, 'stats_granulares'],
            'permission_callback' => [__CLASS__, 'check_permission'],
        ]);
        
        // NUEVO en v1.0.6: detectar duplicados Media Library
        register_rest_route('nv/v1', '/media-duplicados', [
            'methods' => 'GET',
            'callback' => [__CLASS__, 'media_duplicados'],
            'permission_callback' => [__CLASS__, 'check_permission'],
        ]);
        
        // NUEVO en v1.0.6: borrar adjunto específico (con validación)
        register_rest_route('nv/v1', '/borrar-adjunto/(?P<id>\d+)', [
            'methods' => 'DELETE',
            'callback' => [__CLASS__, 'borrar_adjunto'],
            'permission_callback' => function() { return current_user_can('delete_posts'); },
        ]);
        
        // NUEVO en v1.0.6: regenerar webhook secret
        register_rest_route('nv/v1', '/regenerar-secret', [
            'methods' => 'POST',
            'callback' => [__CLASS__, 'regenerar_secret'],
            'permission_callback' => function() { return current_user_can('manage_options'); },
        ]);
        
        // NUEVO en v1.0.7: crear publicación desde Claude (generador de mes)
        register_rest_route('nv/v1', '/crear-publicacion', [
            'methods' => 'POST',
            'callback' => [__CLASS__, 'crear_publicacion'],
            'permission_callback' => [__CLASS__, 'check_permission'],
        ]);
        
        // NUEVO en v1.0.7: registrar una revisión Claude en el historial
        register_rest_route('nv/v1', '/registrar-revision/(?P<id>\d+)', [
            'methods' => 'POST',
            'callback' => [__CLASS__, 'registrar_revision'],
            'permission_callback' => [__CLASS__, 'check_permission'],
        ]);
        
        // NUEVO en v1.0.7: leer historial de revisiones de una publicación
        register_rest_route('nv/v1', '/historial-revisiones/(?P<id>\d+)', [
            'methods' => 'GET',
            'callback' => [__CLASS__, 'historial_revisiones'],
            'permission_callback' => [__CLASS__, 'check_permission'],
        ]);
        
        // NUEVO en v1.0.8: generador de mes server-side via Anthropic API
        register_rest_route('nv/v1', '/generar-mes-ai', [
            'methods' => 'POST',
            'callback' => [__CLASS__, 'generar_mes_ai'],
            'permission_callback' => [__CLASS__, 'check_permission'],
        ]);
        
        // NUEVO en v1.0.8: test de conexión con Anthropic API
        register_rest_route('nv/v1', '/test-anthropic', [
            'methods' => 'POST',
            'callback' => [__CLASS__, 'test_anthropic'],
            'permission_callback' => function() { return current_user_can('manage_options'); },
        ]);
        
        // NUEVO en v1.0.11: subir imagen externa a Media Library y asociar a publicación
        register_rest_route('nv/v1', '/subir-imagen-post/(?P<id>\d+)', [
            'methods' => 'POST',
            'callback' => [__CLASS__, 'subir_imagen_post'],
            'permission_callback' => [__CLASS__, 'check_permission'],
        ]);
        
        // NUEVO en v1.0.11: lista de publicaciones SIN asset (para alimentar prompt Claude)
        register_rest_route('nv/v1', '/publicaciones-sin-asset', [
            'methods' => 'GET',
            'callback' => [__CLASS__, 'publicaciones_sin_asset'],
            'permission_callback' => [__CLASS__, 'check_permission'],
        ]);

        // v1.0.15: Configuración de modelo de imagen + OpenAI key (para JS de "Generar imágenes con Claude")
        // v1.0.16: regex incluye underscore para slugs como "clinica_march"
        register_rest_route('nv/v1', '/cliente-config/(?P<slug>[a-z0-9_-]+)', [
            'methods' => 'GET',
            'callback' => [__CLASS__, 'cliente_config'],
            'permission_callback' => [__CLASS__, 'check_permission'],
        ]);

        // v1.0.19: proxy server-side OpenAI Image — la key NUNCA sale al chat.
        // Diseñado para Claudes externos: llaman a este endpoint con Bearer
        // NV_API_TOKEN, el plugin maneja la key OpenAI internamente y devuelve
        // base64. Si pasan post_id, también puede asociar la imagen al post.
        register_rest_route('nv/v1', '/openai-image-proxy/(?P<id>\d+)', [
            'methods' => 'POST',
            'callback' => [__CLASS__, 'openai_image_proxy'],
            'permission_callback' => [__CLASS__, 'check_permission'],
        ]);

        // v1.0.20: ver el API token actual (solo admins de la web)
        register_rest_route('nv/v1', '/api-token', [
            'methods' => 'GET',
            'callback' => [__CLASS__, 'get_api_token'],
            'permission_callback' => function() { return current_user_can('manage_options'); },
        ]);

        // v1.0.20: rotar el API token (solo admins de la web)
        register_rest_route('nv/v1', '/rotar-api-token', [
            'methods' => 'POST',
            'callback' => [__CLASS__, 'rotar_api_token'],
            'permission_callback' => function() { return current_user_can('manage_options'); },
        ]);

        // v1.0.23: Crear publicación multi-cliente (batch). Para fechas estacionales
        // (día de la madre, navidad, black friday) que afectan a varios clientes a la vez.
        register_rest_route('nv/v1', '/publicaciones-multi-cliente', [
            'methods' => 'POST',
            'callback' => [__CLASS__, 'publicaciones_multi_cliente'],
            'permission_callback' => [__CLASS__, 'check_permission'],
        ]);

        // v1.0.25: generar imagen para una publicación concreta (gpt-image-2, server-side).
        // Usado por el flow multi-cliente en su Fase 2 para pintar imagen automática
        // tras crear los borradores. También invocable manualmente por publicación.
        register_rest_route('nv/v1', '/generar-imagen-publicacion/(?P<id>\d+)', [
            'methods' => 'POST',
            'callback' => [__CLASS__, 'generar_imagen_publicacion'],
            'permission_callback' => [__CLASS__, 'check_permission'],
        ]);

        // v1.0.50: re-aplicar overlay sobre la imagen YA generada (sin regenerar).
        // Permite probar cambios de brand_colors, layout, headline_lines, etc. sin
        // gastar API de OpenAI. Coge la imagen ORIGINAL del attachment (la versión
        // pre-overlay) si existe en _nv_attachment_pre_overlay, si no la actual.
        register_rest_route('nv/v1', '/reaplicar-overlay/(?P<id>\d+)', [
            'methods' => 'POST',
            'callback' => [__CLASS__, 'reaplicar_overlay_publicacion'],
            'permission_callback' => [__CLASS__, 'check_permission'],
        ]);

        // v1.0.71: Adaptar una publicación ya generada a otro formato/tipo.
        // Regenera la imagen con IA usando el mismo prompt pero con el aspect ratio
        // del nuevo formato. Si se pasa width/height en el body, sobrescribe.
        // Body: { tipo_target: 'reel'|'imagen'|'carrusel'|'story'|'video' [, width, height] }
        register_rest_route('nv/v1', '/adaptar-formato/(?P<id>\d+)', [
            'methods' => 'POST',
            'callback' => [__CLASS__, 'adaptar_formato_publicacion'],
            'permission_callback' => [__CLASS__, 'check_permission'],
        ]);

        // v1.0.56: Reparar bug Unicode "CLuoocdNICA" en posts ya creados antes
        // del fix de líneas 1577/2435. Recorre el meta _nv_headline_lines y, si
        // detecta el patrón "uXXXX" (escape Unicode con la barra invertida
        // perdida), lo reescribe correctamente. Idempotente.
        // POST sin body → repara todos los posts. Body { "post_id": N } → solo ese.
        register_rest_route('nv/v1', '/reparar-headline-unicode', [
            'methods' => 'POST',
            'callback' => [__CLASS__, 'reparar_headline_unicode'],
            'permission_callback' => [__CLASS__, 'check_permission'],
        ]);

        // v1.0.33: actualizar guía de estilo cacheada de un cliente (vision call a Anthropic).
        // Se llama UNA vez por cliente cuando cambian las refs. La generación de copy
        // posterior usa la guía cacheada (texto) en vez de re-procesar las refs cada vez.
        register_rest_route('nv/v1', '/actualizar-guia-estilo/(?P<term_id>\d+)', [
            'methods' => 'POST',
            'callback' => [__CLASS__, 'actualizar_guia_estilo'],
            'permission_callback' => function() { return current_user_can('manage_categories'); },
        ]);

        // v1.0.34: detectar publicaciones huérfanas (post_status=publish sin
        // nv_fecha_publicacion) — ocurre cuando un timeout de hosting cortó la
        // creación a mitad antes de que se asignara la fecha. Las huérfanas no
        // aparecen en el calendario pero existen en WP Admin → Publicaciones.
        register_rest_route('nv/v1', '/diagnostico-publicaciones-huerfanas', [
            'methods' => 'GET',
            'callback' => [__CLASS__, 'diagnostico_publicaciones_huerfanas'],
            'permission_callback' => [__CLASS__, 'check_permission'],
        ]);
        // v1.0.34: borrar (force=true) las huérfanas detectadas
        register_rest_route('nv/v1', '/reparar-publicaciones-huerfanas', [
            'methods' => 'POST',
            'callback' => [__CLASS__, 'reparar_publicaciones_huerfanas'],
            'permission_callback' => [__CLASS__, 'check_permission'],
        ]);

        // v1.0.39: borrar una publicación específica (papelera por drag-and-drop)
        register_rest_route('nv/v1', '/publicacion/(?P<id>\d+)', [
            'methods'  => 'DELETE',
            'callback' => [__CLASS__, 'borrar_publicacion'],
            'permission_callback' => [__CLASS__, 'check_permission'],
        ]);

        // v1.0.40: diagnostico de generación de imagen — ejecuta TODO el flow excepto
        // la llamada a OpenAI. Devuelve qué prompt se construyó, brand_colors,
        // headline_lines, opts, debug. Sirve para distinguir si el problema es
        // del código (debug aquí) o del network/hosting (todo OK aquí).
        // v1.0.41: acepta ?token=NV_API_TOKEN como fallback para acceso directo desde navegador
        register_rest_route('nv/v1', '/test-imagen-publicacion/(?P<id>\d+)', [
            'methods'  => 'GET',
            'callback' => [__CLASS__, 'test_imagen_publicacion'],
            'permission_callback' => function($request) {
                // Auth normal (Bearer / nonce / cookie+capability)
                if (self::check_permission($request)) return true;
                // Fallback: ?token=NV_API_TOKEN (mismo token que el plugin usa internamente)
                $token = $request->get_param('token');
                if (!empty($token) && function_exists('nv_dashboard_get_api_token')) {
                    $expected = nv_dashboard_get_api_token();
                    if (!empty($expected) && hash_equals($expected, $token)) return true;
                }
                return false;
            },
        ]);

        // v1.0.67: Diagnóstico de refs categorizadas por cliente.
        // GET /wp-json/nv/v1/diag-refs/{slug}
        // Devuelve totales por tipo + lista detallada para que el operador sepa
        // qué tipos están cubiertos y cuáles necesitan más fotos subidas.
        register_rest_route('nv/v1', '/diag-refs/(?P<slug>[a-z0-9_-]+)', [
            'methods'  => 'GET',
            'callback' => [__CLASS__, 'diag_refs'],
            'permission_callback' => [__CLASS__, 'check_permission'],
        ]);

        // v1.0.46: Análisis automático de la web del cliente (logo + colores + fuente)
        // POST /wp-json/nv/v1/analizar-web-cliente con { term_id, website_url, save (bool) }
        register_rest_route('nv/v1', '/analizar-web-cliente', [
            'methods'  => 'POST',
            'callback' => [__CLASS__, 'analizar_web_cliente'],
            'permission_callback' => [__CLASS__, 'check_permission'],
        ]);

        // v1.0.53: Análisis de competencia del cliente
        // POST /wp-json/nv/v1/analizar-competencia/{term_id}
        // Lee competidores configurados en cliente o, si no hay, busca en web.
        // Devuelve lista de temas { tema, justificacion, fuente_competidor }.
        register_rest_route('nv/v1', '/analizar-competencia/(?P<id>\d+)', [
            'methods'  => 'POST',
            'callback' => [__CLASS__, 'analizar_competencia'],
            'permission_callback' => [__CLASS__, 'check_permission'],
        ]);

        // v1.0.54: Diagnóstico de pre-requisitos del hosting para pipeline de reels.
        // GET /wp-json/nv/v1/reel-prereq-check
        // Verifica ffmpeg, espacio en disco, memory_limit, max_execution_time, exec().
        register_rest_route('nv/v1', '/reel-prereq-check', [
            'methods'  => 'GET',
            'callback' => [__CLASS__, 'reel_prereq_check'],
            'permission_callback' => [__CLASS__, 'check_permission'],
        ]);

        // v1.0.47: Health check público — para verificar que el plugin cargó correctamente
        // sin necesidad de auth. Lo usa la página "Estado del plugin".
        register_rest_route('nv/v1', '/health', [
            'methods'  => 'GET',
            'callback' => [__CLASS__, 'health_check'],
            'permission_callback' => '__return_true',
        ]);

        // v1.0.49: análisis de wp-config.php para detectar problemas (defines duplicados)
        register_rest_route('nv/v1', '/wp-config-analyze', [
            'methods'  => 'GET',
            'callback' => [__CLASS__, 'wp_config_analyze'],
            'permission_callback' => function() { return current_user_can('manage_options'); },
        ]);

        // v1.0.49: aplicar fix de wp-config.php (con backup automático)
        register_rest_route('nv/v1', '/wp-config-fix', [
            'methods'  => 'POST',
            'callback' => [__CLASS__, 'wp_config_fix'],
            'permission_callback' => function() { return current_user_can('manage_options'); },
        ]);
    }
    
    public static function check_permission($request = null) {
        // v1.0.17 + v1.0.20: Bearer token alternativo.
        // Acepta el token de la constante NV_API_TOKEN (wp-config.php) como fallback,
        // o el de la opción nv_dashboard_api_token (auto-generada en activación).
        // Pensado para Claudes externos que no tienen sesión WP.
        if ($request && method_exists($request, 'get_header')) {
            $auth_header = $request->get_header('authorization');
            if ($auth_header && preg_match('/Bearer\s+(.+)/i', $auth_header, $m)) {
                $provided = trim($m[1]);

                // 1) Constante en wp-config.php (manual, opcional)
                if (defined('NV_API_TOKEN') && NV_API_TOKEN && hash_equals((string) NV_API_TOKEN, $provided)) {
                    return true;
                }
                // 2) Opción auto-generada (default; rotable desde admin)
                $option_token = get_option('nv_dashboard_api_token', '');
                if ($option_token && hash_equals((string) $option_token, $provided)) {
                    return true;
                }
            }
        }
        return current_user_can('edit_posts');
    }
    
    public static function check_webhook_secret($request) {
        $secret = $request->get_header('X-NV-Secret');
        return hash_equals(nv_dashboard_get_webhook_secret(), (string) $secret);
    }
    
    /**
     * GET /publicaciones
     */
    public static function list_publicaciones($request) {
        $cliente = $request->get_param('cliente');
        $estado = $request->get_param('estado');
        $from = $request->get_param('from');
        $to = $request->get_param('to');
        $aprobadas = $request->get_param('aprobadas');
        
        $args = [
            'post_type' => 'nv_publicacion',
            'posts_per_page' => -1,
            'post_status' => 'publish',
            'orderby' => 'meta_value',
            'meta_key' => 'nv_fecha_publicacion',
            'order' => 'ASC',
        ];
        
        if ($cliente) {
            $args['tax_query'] = [[
                'taxonomy' => 'nv_cliente',
                'field' => 'slug',
                'terms' => $cliente,
            ]];
        }
        
        $meta_query = [];
        if ($estado) {
            $meta_query[] = ['key' => 'nv_estado', 'value' => $estado];
        }
        if ($aprobadas === 'true' || $aprobadas === '1') {
            $meta_query[] = ['key' => 'nv_aprobar_metricool', 'value' => '1'];
        }
        if ($from && $to) {
            $meta_query[] = [
                'key' => 'nv_fecha_publicacion',
                'value' => [$from . ' 00:00:00', $to . ' 23:59:59'],
                'compare' => 'BETWEEN',
                'type' => 'DATETIME',
            ];
        }
        if ($meta_query) {
            $args['meta_query'] = $meta_query;
        }
        
        $posts = get_posts($args);
        $data = [];
        foreach ($posts as $p) {
            $data[] = self::format_publicacion($p);
        }
        
        return rest_ensure_response($data);
    }
    
    /**
     * Formatear publicación
     */
    private static function format_publicacion($post) {
        $clientes = get_the_terms($post->ID, 'nv_cliente');
        $extras = get_field('nv_assets_extras', $post->ID) ?: [];
        $extras_urls = array_map(function($e) { return $e['url']; }, $extras);
        
        return [
            'id' => $post->ID,
            'titulo' => $post->post_title,
            'cliente' => $clientes && !is_wp_error($clientes) ? $clientes[0]->slug : null,
            'cliente_nombre' => $clientes && !is_wp_error($clientes) ? $clientes[0]->name : null,
            'fecha' => get_field('nv_fecha_publicacion', $post->ID),
            'tipo' => get_field('nv_tipo', $post->ID),
            'redes' => get_field('nv_redes', $post->ID) ?: [],
            'estado' => get_field('nv_estado', $post->ID) ?: 'borrador',
            'copy' => get_field('nv_copy', $post->ID),
            'hashtags' => get_field('nv_hashtags', $post->ID),
            'first_comment' => get_field('nv_first_comment', $post->ID),
            'asset_url' => get_field('nv_asset_url', $post->ID),
            'assets_extras' => $extras_urls,
            'aprobado' => (bool) get_field('nv_aprobar_metricool', $post->ID),
            'metricool_id' => get_field('nv_metricool_id', $post->ID),
            'edit_url' => get_edit_post_link($post->ID, 'raw'),
            // v1.0.44 + v1.0.45: detección estricta de imagen real existente
            // No basta con que nv_asset_url tenga valor — comprobamos también que el
            // attachment exista realmente en disco. Posts huérfanos o con URL muerta
            // se marcan como SIN imagen para que el badge rojo aparezca.
            'has_featured_image' => self::post_has_real_image($post->ID),
        ];
    }

    /**
     * v1.0.45 — Determina si un post tiene imagen REAL (no solo URL en meta).
     * Comprueba: featured image existe Y archivo en disco, O nv_asset_url no vacío.
     */
    private static function post_has_real_image($post_id) {
        // 1) Featured image (más fiable)
        if (has_post_thumbnail($post_id)) {
            $thumb_id = get_post_thumbnail_id($post_id);
            if ($thumb_id) {
                $url = wp_get_attachment_url($thumb_id);
                if (!empty($url)) return true;
            }
        }
        // 2) nv_asset_url (custom field)
        $asset_url = get_field('nv_asset_url', $post_id);
        if (!empty($asset_url) && is_string($asset_url) && trim($asset_url) !== '') {
            return true;
        }
        return false;
    }
    
    /**
     * POST /aprobar-mes
     * MEJORA v1.0.2: mensajes de error informativos con diagnóstico incluido
     */
    public static function aprobar_mes($request) {
        $cliente = $request->get_param('cliente');
        $mes = $request->get_param('mes');
        
        if (!$cliente || !$mes) {
            return new WP_Error('missing_params', 'Faltan parámetros cliente y mes', ['status' => 400]);
        }
        
        $from = $mes . '-01';
        $to = date('Y-m-t', strtotime($from));
        
        // Verificar que el cliente existe
        $cliente_term = get_term_by('slug', $cliente, 'nv_cliente');
        if (!$cliente_term) {
            return new WP_Error(
                'cliente_no_existe',
                "El cliente '{$cliente}' no existe en NV Dashboard → Clientes",
                ['status' => 404, 'cliente' => $cliente]
            );
        }
        
        // Búsqueda principal: aprobadas + en el mes + del cliente
        $args = [
            'post_type' => 'nv_publicacion',
            'posts_per_page' => -1,
            'post_status' => 'publish',
            'orderby' => 'meta_value',
            'meta_key' => 'nv_fecha_publicacion',
            'order' => 'ASC',
            'tax_query' => [[
                'taxonomy' => 'nv_cliente',
                'field' => 'slug',
                'terms' => $cliente,
            ]],
            'meta_query' => [
                'relation' => 'AND',
                ['key' => 'nv_aprobar_metricool', 'value' => '1'],
                [
                    'key' => 'nv_fecha_publicacion',
                    'value' => [$from . ' 00:00:00', $to . ' 23:59:59'],
                    'compare' => 'BETWEEN',
                    'type' => 'DATETIME',
                ],
            ],
        ];
        
        $posts = get_posts($args);
        
        if (empty($posts)) {
            // DIAGNÓSTICO DETALLADO para ayudar al usuario
            $diagnostico = self::diagnosticar_busqueda_vacia($cliente, $cliente_term, $from, $to, $mes);
            
            return new WP_Error(
                'no_posts',
                $diagnostico['mensaje'],
                [
                    'status' => 404,
                    'diagnostico' => $diagnostico,
                ]
            );
        }
        
        // Generar CSV
        $csv_path = NV_CSV_Generator::generate($posts, $cliente, $mes);
        $csv_url = str_replace(ABSPATH, home_url('/'), $csv_path);
        
        // Marcar como programado
        foreach ($posts as $p) {
            update_field('nv_csv_url', $csv_url, $p->ID);
            update_field('nv_estado', 'programado', $p->ID);
        }
        
        // Webhook
        $webhook_url = get_option('nv_dashboard_make_webhook_url');
        $webhook_disparado = false;
        $webhook_error = null;
        
        if ($webhook_url) {
            $resp = wp_remote_post($webhook_url, [
                'timeout' => 30,
                'body' => wp_json_encode([
                    'cliente' => $cliente,
                    'cliente_nombre' => $cliente_term->name,
                    'mes' => $mes,
                    'count' => count($posts),
                    'csv_url' => $csv_url,
                    'publicaciones' => array_map([__CLASS__, 'format_publicacion'], $posts),
                ]),
                'headers' => ['Content-Type' => 'application/json'],
            ]);
            
            if (is_wp_error($resp)) {
                $webhook_error = $resp->get_error_message();
            } else {
                $webhook_disparado = true;
            }
        }
        
        return rest_ensure_response([
            'success' => true,
            'count' => count($posts),
            'csv_url' => $csv_url,
            'mes' => $mes,
            'cliente' => $cliente,
            'webhook_disparado' => $webhook_disparado,
            'webhook_error' => $webhook_error,
            'titulos' => array_map(function($p) { return $p->post_title; }, $posts),
        ]);
    }
    
    /**
     * Diagnóstico cuando la búsqueda principal no encuentra publicaciones
     * NUEVO v1.0.2
     */
    private static function diagnosticar_busqueda_vacia($cliente_slug, $cliente_term, $from, $to, $mes) {
        $diag = [
            'cliente_buscado' => $cliente_slug,
            'cliente_nombre' => $cliente_term->name,
            'cliente_id' => $cliente_term->term_id,
            'mes_buscado' => $mes,
            'fecha_desde' => $from . ' 00:00:00',
            'fecha_hasta' => $to . ' 23:59:59',
            'mensaje' => '',
            'pasos' => [],
        ];
        
        // Paso 1: ¿Hay publicaciones en este cliente?
        $posts_cliente = get_posts([
            'post_type' => 'nv_publicacion',
            'posts_per_page' => -1,
            'post_status' => 'publish',
            'tax_query' => [[
                'taxonomy' => 'nv_cliente',
                'field' => 'slug',
                'terms' => $cliente_slug,
            ]],
        ]);
        $diag['total_cliente'] = count($posts_cliente);
        $diag['pasos'][] = "Cliente '{$cliente_term->name}' tiene {$diag['total_cliente']} publicaciones en total";
        
        if ($diag['total_cliente'] === 0) {
            // Verificar si hay publicaciones SIN cliente asignado
            $posts_sin_cliente = get_posts([
                'post_type' => 'nv_publicacion',
                'posts_per_page' => -1,
                'post_status' => 'publish',
                'tax_query' => [[
                    'taxonomy' => 'nv_cliente',
                    'operator' => 'NOT EXISTS',
                ]],
            ]);
            $diag['publicaciones_sin_cliente'] = count($posts_sin_cliente);
            
            if (count($posts_sin_cliente) > 0) {
                $diag['mensaje'] = "❌ El cliente '{$cliente_term->name}' no tiene publicaciones asignadas. Hay {$diag['publicaciones_sin_cliente']} publicaciones SIN CLIENTE asignado. Edítalas y asígnales el cliente '{$cliente_term->name}' en el panel derecho.";
                $diag['accion_recomendada'] = "Ir a 'Publicaciones', editar la publicación, en panel derecho marcar checkbox '{$cliente_term->name}'";
            } else {
                $diag['mensaje'] = "❌ No hay ninguna publicación creada todavía. Ve a 'Publicaciones → Añadir publicación' para crear la primera.";
                $diag['accion_recomendada'] = "Crear publicación";
            }
            return $diag;
        }
        
        // Paso 2: ¿Hay publicaciones aprobadas en este cliente?
        $posts_aprobadas = get_posts([
            'post_type' => 'nv_publicacion',
            'posts_per_page' => -1,
            'post_status' => 'publish',
            'tax_query' => [[
                'taxonomy' => 'nv_cliente',
                'field' => 'slug',
                'terms' => $cliente_slug,
            ]],
            'meta_query' => [['key' => 'nv_aprobar_metricool', 'value' => '1']],
        ]);
        $diag['total_aprobadas_cliente'] = count($posts_aprobadas);
        $diag['pasos'][] = "De esas, {$diag['total_aprobadas_cliente']} tienen el checkbox 'Aprobar para Metricool' marcado";
        
        if ($diag['total_aprobadas_cliente'] === 0) {
            // Listar las publicaciones existentes para que el usuario las identifique
            $diag['publicaciones_existentes'] = array_map(function($p) {
                return [
                    'id' => $p->ID,
                    'titulo' => $p->post_title,
                    'fecha' => get_field('nv_fecha_publicacion', $p->ID),
                    'aprobado' => (bool) get_field('nv_aprobar_metricool', $p->ID),
                    'edit_url' => get_edit_post_link($p->ID, 'raw'),
                ];
            }, $posts_cliente);
            
            $diag['mensaje'] = "⚠️ Hay {$diag['total_cliente']} publicaciones del cliente '{$cliente_term->name}' pero NINGUNA tiene el checkbox '✅ Aprobar para Metricool' activado. Edita cada publicación que quieras enviar y activa el checkbox al final del formulario.";
            $diag['accion_recomendada'] = "Editar publicación → bajar al final → activar checkbox '✅ Aprobar para Metricool' → Guardar";
            return $diag;
        }
        
        // Paso 3: ¿Las aprobadas están en el mes correcto?
        $aprobadas_en_mes = 0;
        $fechas_aprobadas = [];
        foreach ($posts_aprobadas as $p) {
            $fecha = get_field('nv_fecha_publicacion', $p->ID);
            $fechas_aprobadas[] = [
                'id' => $p->ID,
                'titulo' => $p->post_title,
                'fecha' => $fecha,
                'mes' => substr($fecha, 0, 7),
                'edit_url' => get_edit_post_link($p->ID, 'raw'),
            ];
            if ($fecha >= ($from . ' 00:00:00') && $fecha <= ($to . ' 23:59:59')) {
                $aprobadas_en_mes++;
            }
        }
        $diag['aprobadas_en_mes'] = $aprobadas_en_mes;
        $diag['fechas_aprobadas'] = $fechas_aprobadas;
        $diag['pasos'][] = "Buscando con fecha entre '{$from}' y '{$to}': {$aprobadas_en_mes} encontradas";
        
        if ($aprobadas_en_mes === 0) {
            $meses_aprobadas = array_unique(array_column($fechas_aprobadas, 'mes'));
            $diag['mensaje'] = "⚠️ Hay {$diag['total_aprobadas_cliente']} publicaciones aprobadas del cliente '{$cliente_term->name}' pero ninguna tiene fecha en {$mes}. Las fechas aprobadas están en: " . implode(', ', $meses_aprobadas);
            $diag['accion_recomendada'] = "Cambia el mes en el calendario con las flechas ◀ ▶ hasta " . implode(' o ', $meses_aprobadas) . ", o edita las publicaciones para que tengan fecha en {$mes}";
            return $diag;
        }
        
        // Si llegamos aquí algo raro pasa (no debería ocurrir)
        $diag['mensaje'] = "🤔 Diagnóstico inconcluso. Hay {$aprobadas_en_mes} publicaciones que cumplen todos los criterios pero la búsqueda principal no las encontró. Posible problema con los meta_query de WordPress. Revisa logs de WP.";
        return $diag;
    }
    
    /**
     * GET /diagnostico?cliente=negocio-vivo&mes=2026-04
     * NUEVO v1.0.2 - endpoint público para debug
     */
    public static function diagnostico($request) {
        $cliente = $request->get_param('cliente');
        $mes = $request->get_param('mes') ?: date('Y-m');
        
        $output = [
            'wordpress_version' => get_bloginfo('version'),
            'plugin_version' => defined('NV_DASHBOARD_VERSION') ? NV_DASHBOARD_VERSION : 'unknown',
            'acf_active' => function_exists('get_field'),
            'fecha_actual' => current_time('mysql'),
            'mes_consultado' => $mes,
            'cliente_consultado' => $cliente,
        ];
        
        // Listar todos los clientes
        $clientes = get_terms(['taxonomy' => 'nv_cliente', 'hide_empty' => false]);
        $output['clientes_disponibles'] = array_map(function($c) {
            return ['id' => $c->term_id, 'name' => $c->name, 'slug' => $c->slug];
        }, $clientes);
        
        // Listar TODAS las publicaciones (sin filtros)
        $todas = get_posts([
            'post_type' => 'nv_publicacion',
            'posts_per_page' => -1,
            'post_status' => 'any',
        ]);
        
        $output['total_publicaciones'] = count($todas);
        $output['publicaciones'] = [];
        
        foreach ($todas as $p) {
            $clientes_post = get_the_terms($p->ID, 'nv_cliente');
            $output['publicaciones'][] = [
                'id' => $p->ID,
                'titulo' => $p->post_title,
                'post_status' => $p->post_status,
                'cliente_slug' => ($clientes_post && !is_wp_error($clientes_post)) ? $clientes_post[0]->slug : null,
                'cliente_name' => ($clientes_post && !is_wp_error($clientes_post)) ? $clientes_post[0]->name : null,
                'fecha' => get_field('nv_fecha_publicacion', $p->ID),
                'tipo' => get_field('nv_tipo', $p->ID),
                'estado' => get_field('nv_estado', $p->ID),
                'aprobado' => (bool) get_field('nv_aprobar_metricool', $p->ID),
                'aprobado_raw' => get_post_meta($p->ID, 'nv_aprobar_metricool', true),
                'asset_url' => get_field('nv_asset_url', $p->ID),
                'edit_url' => get_edit_post_link($p->ID, 'raw'),
            ];
        }
        
        return rest_ensure_response($output);
    }
    
    /**
     * POST /actualizar-publicacion/{id}
     * NUEVO v1.0.3 - escribir campos ACF directamente
     */
    public static function actualizar_publicacion($request) {
        $post_id = (int) $request['id'];
        
        if (!$post_id || get_post_type($post_id) !== 'nv_publicacion') {
            return new WP_Error('invalid_post', 'Publicación no encontrada', ['status' => 404]);
        }
        
        $body = $request->get_json_params();
        if (!is_array($body)) {
            return new WP_Error('invalid_body', 'Body JSON inválido', ['status' => 400]);
        }
        
        // Lista blanca de campos ACF que se pueden actualizar
        $campos_permitidos = [
            'nv_fecha_publicacion',
            'nv_tipo',
            'nv_redes',
            'nv_estado',
            'nv_copy',
            'nv_hashtags',
            'nv_first_comment',
            'nv_asset_url',
            'nv_assets_extras',
            'nv_aprobar_metricool',
        ];
        
        $actualizados = [];
        foreach ($campos_permitidos as $campo) {
            if (array_key_exists($campo, $body)) {
                update_field($campo, $body[$campo], $post_id);
                $actualizados[] = $campo;
            }
        }
        
        return rest_ensure_response([
            'success' => true,
            'post_id' => $post_id,
            'actualizados' => $actualizados,
        ]);
    }
    
    /**
     * POST /marcar-programado
     */
    public static function marcar_programado($request) {
        $post_id = (int) $request->get_param('post_id');
        $metricool_id = sanitize_text_field($request->get_param('metricool_id'));
        
        if (!$post_id || get_post_type($post_id) !== 'nv_publicacion') {
            return new WP_Error('invalid_post', 'Post no válido', ['status' => 400]);
        }
        
        update_field('nv_metricool_id', $metricool_id, $post_id);
        update_field('nv_estado', 'programado', $post_id);
        
        return rest_ensure_response(['success' => true, 'post_id' => $post_id]);
    }
    
    // ====================================================================
    // NUEVO v1.0.6 — Sprint 1
    // ====================================================================
    
    /**
     * POST /reprogramar/{id} - reprogramar una publicación a nueva fecha
     * (drag & drop en calendario)
     */
    public static function reprogramar($request) {
        $post_id = (int) $request['id'];
        $params = $request->get_json_params();
        $nueva_fecha = isset($params['nueva_fecha']) ? sanitize_text_field($params['nueva_fecha']) : '';
        
        if (!$nueva_fecha || !preg_match('/^\d{4}-\d{2}-\d{2}/', $nueva_fecha)) {
            return new WP_Error('invalid_date', 'Fecha inválida (esperado YYYY-MM-DD HH:MM:SS)', ['status' => 400]);
        }
        
        $post = get_post($post_id);
        if (!$post || $post->post_type !== 'nv_publicacion') {
            return new WP_Error('invalid_post', 'Publicación no encontrada', ['status' => 404]);
        }
        
        // Si solo viene fecha (10 chars) le ponemos hora por defecto manteniendo la actual si hay
        if (strlen($nueva_fecha) === 10) {
            $fecha_actual = get_field('nv_fecha_publicacion', $post_id);
            $hora = '12:00:00';
            if ($fecha_actual && preg_match('/(\d{2}:\d{2}(:\d{2})?)$/', $fecha_actual, $m)) {
                $hora = $m[1];
                if (strlen($hora) === 5) $hora .= ':00';
            }
            $nueva_fecha = $nueva_fecha . ' ' . $hora;
        }
        
        update_field('nv_fecha_publicacion', $nueva_fecha, $post_id);
        
        return rest_ensure_response([
            'success' => true,
            'post_id' => $post_id,
            'nueva_fecha' => $nueva_fecha,
        ]);
    }
    
    /**
     * POST /duplicar-mes - duplica todas las publicaciones de un mes a otro
     * Body JSON: { cliente: 'slug', mes_origen: 'YYYY-MM', mes_destino: 'YYYY-MM' }
     */
    public static function duplicar_mes($request) {
        $params = $request->get_json_params();
        $cliente = isset($params['cliente']) ? sanitize_text_field($params['cliente']) : '';
        $mes_origen = isset($params['mes_origen']) ? sanitize_text_field($params['mes_origen']) : '';
        $mes_destino = isset($params['mes_destino']) ? sanitize_text_field($params['mes_destino']) : '';
        
        if (!preg_match('/^\d{4}-\d{2}$/', $mes_origen) || !preg_match('/^\d{4}-\d{2}$/', $mes_destino)) {
            return new WP_Error('invalid_month', 'Meses inválidos (esperado YYYY-MM)', ['status' => 400]);
        }
        if ($mes_origen === $mes_destino) {
            return new WP_Error('same_month', 'El mes origen y destino son el mismo', ['status' => 400]);
        }
        
        // Buscar publicaciones del mes origen
        $args = [
            'post_type' => 'nv_publicacion',
            'posts_per_page' => -1,
            'post_status' => 'publish',
            'meta_query' => [
                [
                    'key' => 'nv_fecha_publicacion',
                    'value' => [$mes_origen . '-01 00:00:00', $mes_origen . '-31 23:59:59'],
                    'compare' => 'BETWEEN',
                    'type' => 'CHAR',
                ],
            ],
        ];
        if ($cliente && $cliente !== 'all') {
            $args['tax_query'] = [[
                'taxonomy' => 'nv_cliente',
                'field' => 'slug',
                'terms' => $cliente,
            ]];
        }
        
        $publicaciones = get_posts($args);
        
        if (empty($publicaciones)) {
            return rest_ensure_response([
                'success' => true,
                'duplicadas' => 0,
                'mensaje' => 'No hay publicaciones en el mes origen',
            ]);
        }
        
        // Calcular shift de meses entre origen y destino
        $origen_dt = DateTime::createFromFormat('Y-m', $mes_origen);
        $destino_dt = DateTime::createFromFormat('Y-m', $mes_destino);
        $diff_meses = (($destino_dt->format('Y') - $origen_dt->format('Y')) * 12) + ($destino_dt->format('n') - $origen_dt->format('n'));
        
        $nuevas = [];
        foreach ($publicaciones as $p) {
            // Clonar el post
            $new_id = wp_insert_post([
                'post_type' => 'nv_publicacion',
                'post_title' => $p->post_title,
                'post_content' => $p->post_content,
                'post_status' => 'publish',
            ]);
            if (is_wp_error($new_id) || !$new_id) continue;
            
            // Copiar taxonomía cliente
            $clientes_tax = wp_get_post_terms($p->ID, 'nv_cliente', ['fields' => 'slugs']);
            if (!empty($clientes_tax)) {
                wp_set_post_terms($new_id, $clientes_tax, 'nv_cliente');
            }
            
            // Copiar TODOS los campos ACF
            $campos = ['nv_tipo', 'nv_redes', 'nv_copy', 'nv_hashtags',
                       'nv_asset_url', 'nv_assets_extras', 'nv_first_comment',
                       'nv_auto_publish'];
            foreach ($campos as $campo) {
                $val = get_field($campo, $p->ID);
                if ($val !== null) {
                    update_field($campo, $val, $new_id);
                }
            }
            
            // Reset estado a borrador y aprobado a false
            update_field('nv_estado', 'borrador', $new_id);
            update_field('nv_aprobar_metricool', false, $new_id);
            
            // Calcular nueva fecha (shift de meses, mismo día y hora)
            $fecha_orig = get_field('nv_fecha_publicacion', $p->ID);
            if ($fecha_orig) {
                $fecha_dt = new DateTime($fecha_orig);
                $fecha_dt->modify("+{$diff_meses} months");
                $fecha_nueva = $fecha_dt->format('Y-m-d H:i:s');
                update_field('nv_fecha_publicacion', $fecha_nueva, $new_id);
            }
            
            $nuevas[] = $new_id;
        }
        
        return rest_ensure_response([
            'success' => true,
            'duplicadas' => count($nuevas),
            'ids' => $nuevas,
            'mes_origen' => $mes_origen,
            'mes_destino' => $mes_destino,
        ]);
    }
    
    /**
     * GET /stats-granulares?cliente=slug&mes=YYYY-MM
     * Devuelve conteos por red social y por tipo
     */
    public static function stats_granulares($request) {
        $cliente = $request->get_param('cliente');
        $mes = $request->get_param('mes');
        
        $args = [
            'post_type' => 'nv_publicacion',
            'posts_per_page' => -1,
            'post_status' => 'publish',
        ];
        if ($cliente && $cliente !== 'all') {
            $args['tax_query'] = [[
                'taxonomy' => 'nv_cliente',
                'field' => 'slug',
                'terms' => $cliente,
            ]];
        }
        if ($mes && preg_match('/^\d{4}-\d{2}$/', $mes)) {
            $args['meta_query'] = [[
                'key' => 'nv_fecha_publicacion',
                'value' => [$mes . '-01 00:00:00', $mes . '-31 23:59:59'],
                'compare' => 'BETWEEN',
                'type' => 'CHAR',
            ]];
        }
        
        $publicaciones = get_posts($args);
        
        $por_red = ['facebook' => 0, 'instagram' => 0, 'linkedin' => 0,
                    'twitter' => 0, 'tiktok' => 0, 'youtube' => 0,
                    'google_my_business' => 0, 'pinterest' => 0, 'bluesky' => 0];
        $por_tipo = ['reel' => 0, 'imagen' => 0, 'carrusel' => 0, 'story' => 0, 'video' => 0];
        $por_estado = ['borrador' => 0, 'aprobado' => 0, 'programado' => 0, 'publicado' => 0];
        
        foreach ($publicaciones as $p) {
            $redes = get_field('nv_redes', $p->ID);
            if (is_array($redes)) {
                foreach ($redes as $r) {
                    $r = strtolower(trim($r));
                    if (isset($por_red[$r])) $por_red[$r]++;
                }
            }
            $tipo = strtolower((string) get_field('nv_tipo', $p->ID));
            if (isset($por_tipo[$tipo])) $por_tipo[$tipo]++;
            
            $estado = strtolower((string) get_field('nv_estado', $p->ID)) ?: 'borrador';
            $aprobado = (bool) get_field('nv_aprobar_metricool', $p->ID);
            
            if ($estado === 'publicado') $por_estado['publicado']++;
            elseif ($estado === 'programado') $por_estado['programado']++;
            elseif ($aprobado) $por_estado['aprobado']++;
            else $por_estado['borrador']++;
        }
        
        return rest_ensure_response([
            'total' => count($publicaciones),
            'por_red' => $por_red,
            'por_tipo' => $por_tipo,
            'por_estado' => $por_estado,
            'cliente' => $cliente ?: 'all',
            'mes' => $mes ?: 'all',
        ]);
    }
    
    /**
     * GET /media-duplicados - detecta archivos en Media Library con sufijo -1, -2, etc.
     * que tengan un original con el mismo prefijo
     */
    public static function media_duplicados($request) {
        global $wpdb;
        
        // Buscar attachments cuyo nombre acabe en -N (donde N es un número)
        // y tengan un "hermano" con el mismo prefijo
        $sql = "
            SELECT ID, post_title, post_name, guid
            FROM {$wpdb->posts}
            WHERE post_type = 'attachment'
              AND post_status = 'inherit'
              AND post_name REGEXP '-[0-9]+$'
            ORDER BY post_date DESC
            LIMIT 200
        ";
        $candidatos = $wpdb->get_results($sql);
        
        $duplicados = [];
        foreach ($candidatos as $c) {
            // Extraer prefijo sin -N final
            if (preg_match('/^(.+)-(\d+)$/', $c->post_name, $m)) {
                $prefix = $m[1];
                $num = (int) $m[2];
                
                // Buscar el original (sin -N)
                $original = $wpdb->get_row($wpdb->prepare(
                    "SELECT ID, post_title, guid, post_date FROM {$wpdb->posts}
                     WHERE post_type = 'attachment' AND post_name = %s LIMIT 1",
                    $prefix
                ));
                
                if ($original) {
                    // Comprobar si el duplicado está en uso en alguna publicación
                    $url_dup = wp_get_attachment_url($c->ID);
                    $usado = $wpdb->get_var($wpdb->prepare(
                        "SELECT COUNT(*) FROM {$wpdb->postmeta}
                         WHERE meta_value LIKE %s",
                        '%' . $wpdb->esc_like($url_dup) . '%'
                    ));
                    
                    $duplicados[] = [
                        'id_duplicado' => $c->ID,
                        'titulo_duplicado' => $c->post_title,
                        'slug_duplicado' => $c->post_name,
                        'url_duplicado' => $url_dup,
                        'id_original' => $original->ID,
                        'titulo_original' => $original->post_title,
                        'url_original' => $original->guid,
                        'numero_duplicado' => $num,
                        'usado_en_acf' => (int) $usado,
                    ];
                }
            }
        }
        
        return rest_ensure_response([
            'total_candidatos' => count($candidatos),
            'duplicados_encontrados' => count($duplicados),
            'duplicados' => $duplicados,
        ]);
    }
    
    /**
     * DELETE /borrar-adjunto/{id} - borra un adjunto específico de Media Library
     */
    public static function borrar_adjunto($request) {
        $att_id = (int) $request['id'];
        $post = get_post($att_id);
        if (!$post || $post->post_type !== 'attachment') {
            return new WP_Error('invalid_attachment', 'No es un adjunto válido', ['status' => 404]);
        }
        $result = wp_delete_attachment($att_id, true); // true = forzar
        if (!$result) {
            return new WP_Error('delete_failed', 'Error al borrar', ['status' => 500]);
        }
        return rest_ensure_response(['success' => true, 'borrado' => $att_id]);
    }
    
    /**
     * POST /regenerar-secret - genera un nuevo webhook secret
     */
    public static function regenerar_secret($request) {
        $new_secret = nv_dashboard_regenerate_webhook_secret();
        return rest_ensure_response([
            'success' => true,
            'mensaje' => 'Secret regenerado. Actualiza tus escenarios Make con el nuevo valor.',
            'secret' => $new_secret,
        ]);
    }
    
    // ====================================================================
    // NUEVO v1.0.7 — Sprint 2
    // ====================================================================
    
    /**
     * POST /crear-publicacion - crea una publicación nueva con todos los campos ACF de una sola llamada
     * Pensado para que Claude pueda crear las 14 publicaciones del mes en serie.
     *
     * Body JSON:
     * {
     *   titulo: string,
     *   cliente_slug: string,
     *   fecha_programada: "YYYY-MM-DD HH:MM:SS",
     *   tipo: "imagen|reel|carrusel|story|video",
     *   redes_sociales: ["facebook","instagram",...],
     *   copy: string,
     *   hashtags: string,
     *   primer_comentario: string (opcional),
     *   asset_url: string (opcional),
     *   estado: "borrador" (default) o "aprobado"
     * }
     */
    public static function crear_publicacion($request) {
        $data = $request->get_json_params();
        
        // Validación básica
        $titulo = isset($data['titulo']) ? sanitize_text_field($data['titulo']) : '';
        $cliente_slug = isset($data['cliente_slug']) ? sanitize_text_field($data['cliente_slug']) : '';
        $fecha = isset($data['fecha_programada']) ? sanitize_text_field($data['fecha_programada']) : '';
        $tipo = isset($data['tipo']) ? sanitize_text_field($data['tipo']) : 'imagen';
        $redes = isset($data['redes_sociales']) && is_array($data['redes_sociales']) ? $data['redes_sociales'] : [];
        $copy = isset($data['copy']) ? wp_kses_post($data['copy']) : '';
        $hashtags = isset($data['hashtags']) ? sanitize_textarea_field($data['hashtags']) : '';
        $primer_com = isset($data['primer_comentario']) ? sanitize_textarea_field($data['primer_comentario']) : '';
        $asset_url = isset($data['asset_url']) ? esc_url_raw($data['asset_url']) : '';
        $estado = isset($data['estado']) ? sanitize_key($data['estado']) : 'borrador';
        
        if (!$titulo) {
            return new WP_Error('missing_title', 'titulo es obligatorio', ['status' => 400]);
        }
        if (!$cliente_slug) {
            return new WP_Error('missing_cliente', 'cliente_slug es obligatorio', ['status' => 400]);
        }
        if (!$fecha || !preg_match('/^\d{4}-\d{2}-\d{2}/', $fecha)) {
            return new WP_Error('invalid_date', 'fecha_programada inválida', ['status' => 400]);
        }
        
        // Verificar que el cliente existe
        $term = get_term_by('slug', $cliente_slug, 'nv_cliente');
        if (!$term) {
            return new WP_Error('invalid_cliente', "Cliente '{$cliente_slug}' no encontrado", ['status' => 400]);
        }
        
        // Crear post
        $post_id = wp_insert_post([
            'post_type' => 'nv_publicacion',
            'post_title' => $titulo,
            'post_status' => 'publish',
        ]);
        if (is_wp_error($post_id) || !$post_id) {
            return new WP_Error('insert_failed', 'No se pudo crear la publicación', ['status' => 500]);
        }
        
        // Asignar cliente
        wp_set_post_terms($post_id, [$cliente_slug], 'nv_cliente');
        
        // Si la fecha viene sin hora, añadir 12:00
        if (strlen($fecha) === 10) {
            $fecha .= ' 12:00:00';
        }
        
        // Campos ACF
        update_field('nv_fecha_publicacion', $fecha, $post_id);
        update_field('nv_tipo', $tipo, $post_id);
        update_field('nv_redes', $redes, $post_id);
        update_field('nv_copy', $copy, $post_id);
        update_field('nv_hashtags', $hashtags, $post_id);
        if ($primer_com) update_field('nv_first_comment', $primer_com, $post_id);
        if ($asset_url) update_field('nv_asset_url', $asset_url, $post_id);
        update_field('nv_estado', $estado, $post_id);
        update_field('nv_aprobar_metricool', $estado === 'aprobado', $post_id);
        
        return rest_ensure_response([
            'success' => true,
            'post_id' => $post_id,
            'titulo' => $titulo,
            'edit_url' => get_edit_post_link($post_id, ''),
        ]);
    }
    
    /**
     * POST /registrar-revision/{id} - registra una revisión enviada a Claude en el historial
     * 
     * Body JSON: { tipo: "imagen", orden: "...", contexto_id: "uniq" (opcional) }
     */
    public static function registrar_revision($request) {
        $post_id = (int) $request['id'];
        $params = $request->get_json_params();
        
        $tipo = isset($params['tipo']) ? sanitize_text_field($params['tipo']) : 'otro';
        $orden = isset($params['orden']) ? sanitize_textarea_field($params['orden']) : '';
        
        if (!$orden) {
            return new WP_Error('missing_orden', 'orden es obligatorio', ['status' => 400]);
        }
        
        $post = get_post($post_id);
        if (!$post || $post->post_type !== 'nv_publicacion') {
            return new WP_Error('invalid_post', 'Publicación no encontrada', ['status' => 404]);
        }
        
        // Cargar historial actual (almacenado en post_meta como JSON)
        $hist_raw = get_post_meta($post_id, '_nv_revisiones_historial', true);
        $hist = $hist_raw ? json_decode($hist_raw, true) : [];
        if (!is_array($hist)) $hist = [];
        
        // Añadir nueva entrada
        $user = wp_get_current_user();
        $entry = [
            'id' => uniqid('rev_', true),
            'timestamp' => current_time('mysql'),
            'tipo' => $tipo,
            'orden' => $orden,
            'usuario_id' => $user->ID,
            'usuario_nombre' => $user->display_name ?: 'desconocido',
        ];
        array_unshift($hist, $entry);  // las nuevas arriba
        
        // Limitar histórico a las 30 últimas
        $hist = array_slice($hist, 0, 30);
        
        update_post_meta($post_id, '_nv_revisiones_historial', wp_json_encode($hist));
        
        return rest_ensure_response([
            'success' => true,
            'post_id' => $post_id,
            'total_revisiones' => count($hist),
            'entry' => $entry,
        ]);
    }
    
    /**
     * GET /historial-revisiones/{id} - devuelve el historial de revisiones
     */
    public static function historial_revisiones($request) {
        $post_id = (int) $request['id'];
        $hist_raw = get_post_meta($post_id, '_nv_revisiones_historial', true);
        $hist = $hist_raw ? json_decode($hist_raw, true) : [];
        if (!is_array($hist)) $hist = [];
        
        return rest_ensure_response([
            'post_id' => $post_id,
            'total' => count($hist),
            'revisiones' => $hist,
        ]);
    }
    
    // ====================================================================
    // NUEVO v1.0.8 - Generador de mes server-side via Anthropic API
    // ====================================================================
    
    /**
     * POST /test-anthropic - verifica que la API key funciona
     */
    public static function test_anthropic($request) {
        $params = $request->get_json_params();
        $api_key = isset($params['api_key']) ? trim($params['api_key']) : get_option('nv_dashboard_anthropic_api_key', '');
        
        if (!$api_key) {
            return new WP_Error('missing_key', 'Falta API key', ['status' => 400]);
        }
        
        $response = wp_remote_post('https://api.anthropic.com/v1/messages', [
            'timeout' => 30,
            'headers' => [
                'x-api-key' => $api_key,
                'anthropic-version' => '2023-06-01',
                'content-type' => 'application/json',
            ],
            'body' => wp_json_encode([
                'model' => 'claude-haiku-4-5',
                'max_tokens' => 50,
                'messages' => [
                    ['role' => 'user', 'content' => 'Responde con la palabra "ok" sin nada más.']
                ],
            ]),
        ]);
        
        if (is_wp_error($response)) {
            return new WP_Error('api_error', 'Error de red: ' . $response->get_error_message(), ['status' => 500]);
        }
        
        $code = wp_remote_retrieve_response_code($response);
        $body = json_decode(wp_remote_retrieve_body($response), true);
        
        if ($code === 200 && isset($body['content'][0]['text'])) {
            return rest_ensure_response([
                'success' => true,
                'mensaje' => 'Conexión OK con Anthropic API',
                'modelo_test' => $body['model'] ?? 'haiku',
                'respuesta' => $body['content'][0]['text'],
            ]);
        }
        
        return new WP_Error(
            'api_failed',
            'API respondió con error: ' . ($body['error']['message'] ?? 'desconocido'),
            ['status' => $code ?: 500]
        );
    }
    
    /**
     * POST /generar-mes-ai - llama Anthropic API y crea publicaciones
     *
     * Body JSON: {
     *   cliente, mes, cantidad, redes, mix, brief, modelo (opcional),
     *   chunk_size (opcional, default 5),     -- v1.0.9 chunking
     *   chunk_index (opcional, default 0),    -- 0 = primer lote
     *   total_chunks (opcional, default 1),
     *   ya_generadas (opcional, array)        -- títulos de chunks previos
     * }
     */
    public static function generar_mes_ai($request) {
        @set_time_limit(120); // generación puede tardar 30-90s
        @ini_set('memory_limit', '256M');
        
        $params = $request->get_json_params();
        $cliente = isset($params['cliente']) ? sanitize_text_field($params['cliente']) : '';
        $mes = isset($params['mes']) ? sanitize_text_field($params['mes']) : '';
        $cantidad_total = isset($params['cantidad']) ? max(1, min(60, (int) $params['cantidad'])) : 14;
        $redes = isset($params['redes']) && is_array($params['redes']) ? array_map('sanitize_text_field', $params['redes']) : [];
        $mix = isset($params['mix']) && is_array($params['mix']) ? $params['mix'] : [];
        $brief = isset($params['brief']) ? sanitize_textarea_field($params['brief']) : '';
        $modelo = isset($params['modelo']) ? sanitize_text_field($params['modelo']) : get_option('nv_dashboard_anthropic_model', 'claude-sonnet-4-5');
        
        // v1.0.9: chunking params
        $chunk_size = isset($params['chunk_size']) ? max(1, min(10, (int) $params['chunk_size'])) : 5;
        $chunk_index = isset($params['chunk_index']) ? max(0, (int) $params['chunk_index']) : 0;
        $total_chunks = isset($params['total_chunks']) ? max(1, (int) $params['total_chunks']) : 1;
        $ya_generadas = isset($params['ya_generadas']) && is_array($params['ya_generadas']) ? $params['ya_generadas'] : [];

        // v1.0.59: percent_targets — distribución por tipo de ref para el lote.
        // Se persiste en cada post creado en este chunk; cuando llegue la Fase 2
        // (generar-imagen-publicacion/{id}), el endpoint individual lee ref_relevance
        // del post + percent_targets y calcula forced_types automáticamente.
        $percent_targets_genmes = [];
        if (!empty($params['percent_targets']) && is_array($params['percent_targets'])) {
            $valid_t = ['persona_destacada', 'equipo', 'instalaciones', 'pacientes_usuarios', 'productos'];
            foreach ($params['percent_targets'] as $k => $v) {
                if (!in_array($k, $valid_t, true)) continue;
                $pct = (int) $v;
                if ($pct < 0) $pct = 0;
                if ($pct > 100) $pct = 100;
                if ($pct > 0) $percent_targets_genmes[$k] = $pct;
            }
        }

        // v1.0.64: longitud objetivo del copy (slider 0-100). Default 50 = medio.
        // v1.0.65: curva ajustada para que valores bajos sean MÁS cortos.
        // Mapeo: 0→40-70 / 25→60-100 / 50→100-180 / 75→200-300 / 100→350-450 palabras.
        $copy_length_pct = isset($params['copy_length']) ? (int) $params['copy_length'] : 50;
        if ($copy_length_pct < 0) $copy_length_pct = 0;
        if ($copy_length_pct > 100) $copy_length_pct = 100;
        if ($copy_length_pct <= 25) {
            // 0-25 → 40-70 ... 60-100 palabras (Instagram muy directo)
            $copy_target_words_min = (int) round(40 + ($copy_length_pct / 25) * 20);   // 40-60
            $copy_target_words_max = (int) round(70 + ($copy_length_pct / 25) * 30);   // 70-100
        } elseif ($copy_length_pct <= 50) {
            // 25-50 → 60-100 ... 100-180 palabras
            $copy_target_words_min = (int) round(60 + (($copy_length_pct - 25) / 25) * 40);   // 60-100
            $copy_target_words_max = (int) round(100 + (($copy_length_pct - 25) / 25) * 80);  // 100-180
        } elseif ($copy_length_pct <= 75) {
            // 50-75 → 100-180 ... 200-300 palabras
            $copy_target_words_min = (int) round(100 + (($copy_length_pct - 50) / 25) * 100); // 100-200
            $copy_target_words_max = (int) round(180 + (($copy_length_pct - 50) / 25) * 120); // 180-300
        } else {
            // 75-100 → 200-300 ... 350-450 palabras
            $copy_target_words_min = (int) round(200 + (($copy_length_pct - 75) / 25) * 150); // 200-350
            $copy_target_words_max = (int) round(300 + (($copy_length_pct - 75) / 25) * 150); // 300-450
        }

        // v1.0.66: overlay_opts — control explícito por el operador de qué elementos
        // visuales sobreimpresos lleva la imagen. Antes (v1.0.65) los flags
        // add_data/add_cta se auto-activaban si Anthropic devolvía contenido — y la AI
        // SIEMPRE devuelve dato y CTA porque están en el JSON template, así que
        // siempre se renderizaban (sobrecargando la imagen).
        // Ahora el operador decide desde el modal "Generar mes". Defaults: logo+titular
        // ON, dato+CTA OFF (imagen limpia editorial por defecto).
        $overlay_opts_input = (isset($params['overlay_opts']) && is_array($params['overlay_opts'])) ? $params['overlay_opts'] : [];
        $overlay_opts_genmes = [
            'add_logo' => isset($overlay_opts_input['add_logo']) ? (bool) $overlay_opts_input['add_logo'] : true,
            'add_text' => isset($overlay_opts_input['add_text']) ? (bool) $overlay_opts_input['add_text'] : true,
            'add_data' => isset($overlay_opts_input['add_data']) ? (bool) $overlay_opts_input['add_data'] : false,
            'add_cta'  => isset($overlay_opts_input['add_cta'])  ? (bool) $overlay_opts_input['add_cta']  : false,
        ];

        // Cuántas pedimos en ESTE chunk
        $offset = $chunk_index * $chunk_size;
        $restantes = $cantidad_total - $offset;
        $cantidad = min($chunk_size, max(1, $restantes));
        
        // Validaciones
        if (!$cliente || $cliente === 'all') {
            return new WP_Error('missing_cliente', 'Debes seleccionar un cliente específico', ['status' => 400]);
        }
        if (!preg_match('/^\d{4}-\d{2}$/', $mes)) {
            return new WP_Error('invalid_month', 'Mes inválido (formato YYYY-MM)', ['status' => 400]);
        }
        if (!$brief) {
            return new WP_Error('missing_brief', 'El brief es obligatorio', ['status' => 400]);
        }
        if (count($redes) === 0) {
            return new WP_Error('missing_redes', 'Selecciona al menos una red social', ['status' => 400]);
        }
        
        // Verificar cliente existe
        $term = get_term_by('slug', $cliente, 'nv_cliente');
        if (!$term) {
            return new WP_Error('invalid_cliente', "Cliente '{$cliente}' no encontrado", ['status' => 400]);
        }
        
        // API key
        $api_key = get_option('nv_dashboard_anthropic_api_key', '');
        if (!$api_key) {
            return new WP_Error('missing_api_key', 'Falta configurar la API key de Anthropic en Configuración', ['status' => 400]);
        }
        
        // v1.0.37: cargar style guide cacheada del cliente (si existe) y opciones de overlay
        $cached_guide = class_exists('NV_Cliente_Meta') ? NV_Cliente_Meta::get_style_guide_cached($term->term_id) : '';
        $guide_stale  = class_exists('NV_Cliente_Meta') ? NV_Cliente_Meta::is_style_guide_stale($term->term_id) : false;
        $use_cached_guide = !empty($cached_guide) && !$guide_stale;

        // Construir prompt
        $system_prompt  = "Eres copywriter senior y DIRECTOR DE ARTE de Negocio Vivo (Marbella, España). ";
        $system_prompt .= "Generas calendarios editoriales mensuales profesionales para clientes B2B en español. ";
        $system_prompt .= "Tu trabajo tiene DOS partes en cada publicación: (a) escribir el copy con tono propio según el brief, y (b) PENSAR COMO DIRECTOR DE ARTE — concebir una escena visual ESPECÍFICA y ÚNICA, no genérica. ";
        $system_prompt .= "REGLA CRÍTICA DE VARIEDAD VISUAL: cada publicación del mes debe tener un concepto visual DISTINTO al resto. NO repitas escenas obvias del sector del cliente (ej: para mudanzas no salgas siempre con la misma caja levantada; para una clínica no salgas siempre con un médico de bata sonriendo a cámara). Pregúntate por cada post: ¿qué escena CONCRETA representa visualmente ESTE TEMA específico? ¿Qué subjects, qué acción, qué momento, qué emoción? ";
        $system_prompt .= "Ejemplos del tipo de pensamiento esperado: ";
        $system_prompt .= "[mudanzas, 'Día del Trabajador'] → grupo de empleados con uniforme dando OK con el pulgar frente a un camión, NO un trabajador genérico levantando una caja. ";
        $system_prompt .= "[clínica estética, 'Lunes motivación'] → detalle macro de manos cuidando piel con luz de mañana, NO una doctora con tablet. ";
        $system_prompt .= "[despacho legal, 'Reforma laboral'] → documento sellado sobre mesa con luz cenital y DOF reducido, NO un abogado con corbata posando. ";
        $system_prompt .= "Tu output debe ser SIEMPRE un JSON válido con la estructura solicitada, sin markdown, sin texto adicional. Devuelve únicamente el objeto JSON.";
        
        $mix_str = '';
        foreach ($mix as $tipo => $n) {
            if ($n > 0) $mix_str .= "$tipo=$n, ";
        }
        $mix_str = rtrim($mix_str, ', ');
        
        $user_prompt = "Genera publicaciones del calendario editorial del mes {$mes} para el cliente \"{$term->name}\" (slug: {$cliente}).\n\n";
        
        // v1.0.9: contexto de chunk
        if ($total_chunks > 1) {
            $user_prompt .= "ESTÁS GENERANDO EL LOTE " . ($chunk_index + 1) . " DE {$total_chunks} (publicaciones {$cantidad} de {$cantidad_total} totales).\n\n";
        }
        
        $user_prompt .= "PARÁMETROS GLOBALES DEL MES:\n";
        $user_prompt .= "- Total publicaciones del mes: {$cantidad_total}\n";
        $user_prompt .= "- Redes objetivo: " . implode(', ', $redes) . "\n";
        if ($mix_str) {
            $user_prompt .= "- Mix de tipos sugerido (en el TOTAL del mes): {$mix_str}\n";
        }
        
        // v1.0.9: incluir títulos ya generados para evitar repetición
        if (!empty($ya_generadas)) {
            $user_prompt .= "\nTÍTULOS YA GENERADOS EN LOTES ANTERIORES (no repitas, complementa):\n";
            foreach ($ya_generadas as $titulo) {
                $user_prompt .= "- " . sanitize_text_field($titulo) . "\n";
            }
        }
        
        $user_prompt .= "\nBRIEF DEL CLIENTE:\n{$brief}\n\n";

        // v1.0.59: si el usuario marcó porcentajes objetivo en el modal, comunicarlos a la AI
        // para que sea consciente de qué tipos de refs son prioritarios y puntúe ref_relevance
        // con criterio (la asignación final por umbral la hace el endpoint en Phase 2).
        if (!empty($percent_targets_genmes)) {
            $type_labels = [
                'persona_destacada'  => 'CEO / persona destacada del cliente',
                'equipo'             => 'equipo / trabajadores',
                'instalaciones'      => 'instalaciones / local del cliente',
                'pacientes_usuarios' => 'paciente / usuario',
                'productos'          => 'productos',
            ];
            $user_prompt .= "DISTRIBUCIÓN OBJETIVO DE REFS VISUALES (lo marca el operador para este lote):\n";
            foreach ($percent_targets_genmes as $type => $pct) {
                $label = $type_labels[$type] ?? $type;
                $user_prompt .= "  · {$label}: aproximadamente {$pct}% de las publicaciones del mes deberían beneficiarse de incluir una imagen de este tipo.\n";
            }
            $user_prompt .= "Cuando puntúes 'ref_relevance' al final de cada publicación, sé HONESTO con la puntuación según el contenido del copy. La asignación efectiva la hace el sistema después comparando puntuaciones. Si el operador puso 100% en CEO, intenta que el copy MAYORITARIO de las publicaciones sea coherente con tener al CEO en escena (atención personalizada, mensaje del director, etc.) — pero conserva variedad de temas.\n\n";
        }

        // v1.0.68: ROSTER REAL del cliente — inyectado al prompt cuando hay refs con
        // person_name configurado. Esto evita que la AI invente "team of 5-7 professionals"
        // cuando solo hay 3 personas reales subidas.
        if (class_exists('NV_Cliente_Meta')) {
            $roster = NV_Cliente_Meta::get_team_roster($term->term_id);
            if (!empty($roster)) {
                $user_prompt .= "▼ ROSTER REAL DEL CLIENTE (CRÍTICO — REGLA NO NEGOCIABLE):\n";
                $user_prompt .= "Las únicas personas REALES disponibles para aparecer en imágenes de este cliente son:\n";
                $type_labels_es = [
                    'persona_destacada' => 'CEO / Persona destacada',
                    'equipo' => 'Equipo',
                    'pacientes_usuarios' => 'Paciente',
                ];
                $roster_names = [];
                foreach ($roster as $p) {
                    $rl = $type_labels_es[$p['type']] ?? $p['type'];
                    $user_prompt .= "  · {$p['name']} ({$rl}, {$p['photo_count']} foto" . ($p['photo_count'] === 1 ? '' : 's') . " disponible" . ($p['photo_count'] === 1 ? '' : 's') . ")\n";
                    $roster_names[] = $p['name'];
                }
                $total_people = count($roster);
                $names_csv = implode(', ', $roster_names);
                $user_prompt .= "\nINSTRUCCIONES OBLIGATORIAS para image_prompt cuando el copy menciona al equipo/CEO/personas del cliente:\n";
                $user_prompt .= "  1. NUNCA digas 'team of 5-7 professionals' u otras cantidades inventadas. Usa el número EXACTO: hay {$total_people} persona" . ($total_people === 1 ? '' : 's') . " real" . ($total_people === 1 ? '' : 'es') . " en este cliente.\n";
                $user_prompt .= "  2. ▼ NOMBRES EN COPY → IMAGEN: si el copy menciona uno o más nombres del roster ({$names_csv}), el image_prompt DEBE describir a TODAS las personas mencionadas en escena.\n";
                $user_prompt .= "     · Ej: si el copy dice 'mis colegas Dra. Angie y Ana comparten esta filosofía', el image_prompt DEBE incluir 3 personas: el CEO + Dra Angie + Ana. NO solo el CEO.\n";
                $user_prompt .= "     · El image_prompt debe enumerar a cada persona con descripción física distintiva, sin nombres (gpt-image-2 no entiende nombres). Ej: 'group portrait of 3 medical professionals: a mature man with short dark hair and trimmed beard wearing white coat (left), a mature blonde woman with white coat (center), a younger woman with dark hair and white uniform (right)'.\n";
                $user_prompt .= "  3. Si el copy es genérico sobre 'el equipo' (sin nombres), el image_prompt describe la escena con EXACTAMENTE {$total_people} personas, no más, no menos.\n";
                $user_prompt .= "  4. Refuerza siempre con: 'group portrait of EXACTLY {$total_people} people from the reference photos, no additional people, no extras, no background figures, no duplicate of the same person'.\n";
                $user_prompt .= "  5. NUNCA describas a la misma persona dos veces (ej: 'two mature men with beard' → eso duplica al CEO). Cada persona del image_prompt debe corresponder a un miembro UNICO del roster.\n\n";
            }
        }

        // v1.0.64: instrucción explícita de longitud del copy según el slider del modal.
        // v1.0.65: instrucción REFORZADA porque la AI tendía a ignorar el rango al 25%.
        $user_prompt .= "▼ LONGITUD DEL COPY — REGLA CRÍTICA NO NEGOCIABLE\n";
        $user_prompt .= "Slider del operador: {$copy_length_pct}/100. Esto se traduce a:\n";
        $user_prompt .= "  · OBJETIVO: cada copy debe tener ENTRE {$copy_target_words_min} Y {$copy_target_words_max} palabras (sin contar hashtags ni el headline gráfico).\n";
        $user_prompt .= "  · NO te pases del máximo. Si el copy supera {$copy_target_words_max} palabras es un FALLO.\n";
        $user_prompt .= "  · NO te quedes corto del mínimo. Si baja de {$copy_target_words_min} palabras también es un FALLO.\n";
        if ($copy_length_pct <= 25) {
            $user_prompt .= "  · ESTILO: ULTRA-DIRECTO. 1-2 párrafos máximo. Sin listas, sin bullets, sin secciones. Pregunta + propuesta + CTA. Punto. Frases cortas. Lenguaje cercano. Tipo Instagram nativo. Si dudas si añadir un párrafo más, NO LO AÑADAS.\n";
        } elseif ($copy_length_pct <= 50) {
            $user_prompt .= "  · ESTILO: directo pero con contexto. 2-3 párrafos. Puede haber un mini-listado de máximo 3 ítems. Mantener prosa fluida sin secciones formales.\n";
        } elseif ($copy_length_pct <= 75) {
            $user_prompt .= "  · ESTILO: desarrollado. 3-5 párrafos con storytelling moderado. Lista de beneficios (3-5 ítems) opcional. CTA explícito al final. Adecuado para Facebook.\n";
        } else {
            $user_prompt .= "  · ESTILO: storytelling completo. 5-7 párrafos. Listas, secciones, narrativa elaborada. Para servicios complejos donde hay que explicar valor (legal, médico, B2B). Solo Facebook.\n";
        }
        $user_prompt .= "  · NO incluyas hashtags dentro del copy — los hashtags van en el campo separado.\n";
        $user_prompt .= "  · CUENTA TUS PALABRAS antes de devolver el JSON. Si te pasaste, REESCRIBE más corto antes de enviar.\n\n";

        if ($use_cached_guide) {
            $user_prompt .= "GUÍA DE ESTILO VISUAL CACHEADA (extraída previamente de las refs visuales del cliente, en inglés). Úsala como base del image_prompt de cada publicación:\n" . $cached_guide . "\n\n";
        }
        $user_prompt .= "TU TAREA EN ESTE LOTE:\nGenera EXACTAMENTE {$cantidad} publicaciones nuevas, distintas a las ya generadas si las hay.\n\n";
        $user_prompt .= "REGLAS DE PRODUCCIÓN:\n";
        $user_prompt .= "1. Distribución temporal: 3-4 publicaciones por semana en el mes {$mes}, días laborables principalmente.\n";
        $user_prompt .= "2. Horarios óptimos: martes/jueves 12:00, lunes/miércoles 18:30, viernes 10:00, sábado 11:00.\n";
        $user_prompt .= "3. Copy: 130-220 palabras, primera línea enganche fuerte, CTA al final.\n";
        $user_prompt .= "4. Hashtags: 10-15 por publicación, mix de alcance medio (10k-100k) + nicho específico + marca.\n";
        $user_prompt .= "5. Tipos válidos: imagen, carrusel, reel, story, video.\n";
        $user_prompt .= "6. Variar formatos.\n";
        $user_prompt .= "7. Cada publicación debe tener una escena visual ÚNICA. NO repitas el mismo concepto visual entre dos posts del mes.\n";
        $user_prompt .= "8. ▼ PERSONA EN ESCENA — REGLA CRÍTICA (v1.0.59 + v1.0.67):\n";
        $user_prompt .= "   Si el copy o el titular mencionan EXPLÍCITAMENTE a una persona específica del cliente (nombre propio, o roles como CEO, doctor/a, fundador/a, director/a, especialista, cirujano/a, equipo, trabajadores) Y/O usan lenguaje de atención directa (\"te escucho\", \"te cuido\", \"te atiende\", \"cuidamos de ti\", \"contigo\"), entonces:\n";
        $user_prompt .= "     · El sujeto principal del image_prompt DEBE ser esa persona (rostro visible, mirada hacia cámara o ligeramente desviada, expresión coherente).\n";
        $user_prompt .= "     · NO sustituyas la persona por escenas alternativas (manos, instrumental, fondos abstractos, modelos/figurantes anónimos).\n";
        $user_prompt .= "     · ▼ TEXT/FACE COLLISION (CRÍTICO): la persona y el texto NO pueden ocupar la misma zona de la imagen. Aplica esta regla:\n";
        $user_prompt .= "         · Si la persona va arriba o centro de la imagen → text_placement DEBE ser \"bottom\".\n";
        $user_prompt .= "         · Si la persona va abajo → text_placement DEBE ser \"top\".\n";
        $user_prompt .= "         · NUNCA pongas text_placement=\"top\" si la persona ocupa la mitad superior. Eso tapa la cara y la imagen es inservible.\n";
        $user_prompt .= "         · En el image_prompt describe explícitamente la posición: \"subject positioned in the LOWER HALF of the frame, leaving the UPPER 40% as solid empty negative space (sky, blurred background, plain backdrop) for text overlay\" o equivalente para la opción contraria.\n";
        $user_prompt .= "         · Refuerza con frases como: \"DO NOT place subject's face in the upper third\", \"keep TOP 40% completely free of facial features\".\n";
        $user_prompt .= "   Si el copy NO menciona persona específica ni atención directa (mensajes de marca generales, productos, instalaciones, datos), puedes proponer escenas conceptuales — esa variedad es deseable cuando el copy lo permite.\n\n";
        $user_prompt .= "FORMATO DE RESPUESTA (JSON estricto, SIN markdown, SIN texto adicional):\n";
        $user_prompt .= "{\n";
        $user_prompt .= '  "publicaciones": [' . "\n";
        $user_prompt .= '    {' . "\n";
        $user_prompt .= '      "titulo": "Título descriptivo sin emoji al inicio",' . "\n";
        $user_prompt .= '      "fecha": "' . $mes . '-DD HH:MM:00",' . "\n";
        $user_prompt .= '      "tipo": "imagen|carrusel|reel|story|video",' . "\n";
        $user_prompt .= '      "redes": ["facebook", "instagram"],' . "\n";
        $user_prompt .= '      "copy": "Copy completo (130-220 palabras)…",' . "\n";
        $user_prompt .= '      "hashtags": "#hashtag1 #hashtag2 …",' . "\n";
        $user_prompt .= '      "primer_comentario": "Sugerencia visual: descripción breve de la imagen",' . "\n";
        $user_prompt .= '      "headline_lines": [' . "\n";
        $user_prompt .= '        {"text":"EN", "size":"sm"},' . "\n";
        $user_prompt .= '        {"text":"NOMBRE", "size":"xl", "weight":"bold"},' . "\n";
        $user_prompt .= '        {"text":"MARCA", "size":"xl", "weight":"bold", "color":"accent"},' . "\n";
        $user_prompt .= '        {"text":"FRASE COMPLEMENTO", "size":"md"}' . "\n";
        $user_prompt .= '      ],' . "\n";
        $user_prompt .= '      "//headline_lines_explicacion": "ARRAY de líneas con jerarquía. size: sm|md|lg|xl. color: white|accent|primary. weight: regular|bold. Identifica el NOMBRE DE MARCA y dale {size:xl,color:accent,weight:bold}. 2-4 líneas. Mayúsculas para impacto. Varía estructura según tema (no siempre EN [marca]).",' . "\n";
        $user_prompt .= '      "headline": "Versión plana 4-8 palabras (fallback si headline_lines falla)",' . "\n";
        $user_prompt .= '      "dato_destacado": "Cifra/hito breve y verificable, o cadena vacía si no aplica",' . "\n";
        $user_prompt .= '      "cta_visible": "1-3 palabras, ej: \"Reserva ya\", \"Pide cita\", o cadena vacía",' . "\n";
        $user_prompt .= '      "image_prompt": "EN INGLÉS, 120-220 palabras. PROMPT COMPLETO listo para gpt-image-2. Estructura: (a) ESCENA CONCRETA Y ÚNICA del tema con subjects exactos/acción/lugar — anti-cliché del sector. (b) Composición y framing. (c) Iluminación específica. (d) Estilo fotográfico (editorial/documentary/lifestyle). (e) Paleta hex (heredada de la guía cacheada si existe, si no propón una coherente con la marca). (f) Mood. (g) Incluye \"ample empty negative space at the [TOP/CENTER/BOTTOM]\" coincidiendo con text_placement. (h) Photographic realism, no illustrations, no AI-art look. (i) screen blurred, no readable text, no text/letters/numbers/watermarks (el texto se compone después). RECUERDA REGLA 8: si el copy menciona persona específica del cliente, ESA persona DEBE ser el sujeto principal del prompt — no la sustituyas por una modelo genérica.",' . "\n";
        $user_prompt .= '      "text_placement": "top|center|bottom — DEBE coincidir con la zona de espacio negativo reservada en image_prompt",' . "\n";
        $user_prompt .= '      "text_align": "left|center|right",' . "\n";
        $user_prompt .= '      "ref_relevance": {' . "\n";
        $user_prompt .= '        "persona_destacada": 0,' . "\n";
        $user_prompt .= '        "equipo": 0,' . "\n";
        $user_prompt .= '        "instalaciones": 0,' . "\n";
        $user_prompt .= '        "pacientes_usuarios": 0,' . "\n";
        $user_prompt .= '        "productos": 0' . "\n";
        $user_prompt .= '      },' . "\n";
        $user_prompt .= '      "//ref_relevance_explicacion": "OBLIGATORIO. Puntúa de 0 a 100 cuánto se beneficia ESTA publicación de incluir una imagen de cada tipo. Sé honesto: si el copy menciona al CEO/director por nombre o usa lenguaje de atención directa (te escucho, te cuido), persona_destacada=80+. Si es mensaje genérico de marca, persona_destacada=20-40. Si habla de instalaciones/local, instalaciones=80+. Si describe un producto concreto, productos=90+. Si es sobre el equipo/trabajadores, equipo=70+. Si es testimonial, pacientes_usuarios=70+. Las puntuaciones son INDEPENDIENTES (no suman 100). Devuelve SIEMPRE los 5 campos con un número."' . "\n";
        $user_prompt .= '    }' . "\n";
        $user_prompt .= "  ]\n";
        $user_prompt .= "}\n\n";
        $user_prompt .= "Genera EXACTAMENTE {$cantidad} publicaciones. Devuelve SOLO el JSON, nada más antes ni después.";
        
        // Llamada a Anthropic API
        $start_time = microtime(true);
        $response = wp_remote_post('https://api.anthropic.com/v1/messages', [
            'timeout' => 110,
            'headers' => [
                'x-api-key' => $api_key,
                'anthropic-version' => '2023-06-01',
                'content-type' => 'application/json',
            ],
            'body' => wp_json_encode([
                'model' => $modelo,
                'max_tokens' => 16000, // v1.0.37: subido por image_prompt + headline + ... por cada pub
                'system' => $system_prompt,
                'messages' => [
                    ['role' => 'user', 'content' => $user_prompt]
                ],
            ]),
        ]);
        $duracion = round(microtime(true) - $start_time, 1);
        
        if (is_wp_error($response)) {
            return new WP_Error('api_error', 'Error red Anthropic: ' . $response->get_error_message(), ['status' => 500]);
        }
        
        $code = wp_remote_retrieve_response_code($response);
        $body = json_decode(wp_remote_retrieve_body($response), true);
        
        if ($code !== 200) {
            $msg = isset($body['error']['message']) ? $body['error']['message'] : 'desconocido';
            return new WP_Error('api_failed', 'Anthropic API error (' . $code . '): ' . $msg, ['status' => $code]);
        }
        
        // Extraer texto
        $texto = isset($body['content'][0]['text']) ? $body['content'][0]['text'] : '';
        if (!$texto) {
            return new WP_Error('empty_response', 'Anthropic devolvió respuesta vacía', ['status' => 500]);
        }
        
        // Limpiar markdown si lo hay
        $texto = preg_replace('/^```(?:json)?\s*/m', '', $texto);
        $texto = preg_replace('/\s*```\s*$/m', '', $texto);
        $texto = trim($texto);
        
        // Parsear JSON
        $data = json_decode($texto, true);
        if (!$data || !isset($data['publicaciones']) || !is_array($data['publicaciones'])) {
            return new WP_Error(
                'invalid_json',
                'Anthropic devolvió un JSON inválido en este lote',
                [
                    'status' => 500,
                    'raw_text' => substr($texto, 0, 500),
                ]
            );
        }
        
        $publicaciones = $data['publicaciones'];
        
        // Crear cada publicación en WP
        $creadas = [];
        $errores = [];
        
        foreach ($publicaciones as $idx => $pub) {
            $titulo = isset($pub['titulo']) ? sanitize_text_field($pub['titulo']) : "Publicación " . ($offset + $idx + 1);
            $fecha = isset($pub['fecha']) ? sanitize_text_field($pub['fecha']) : '';
            $tipo = isset($pub['tipo']) ? sanitize_text_field($pub['tipo']) : 'imagen';
            $redes_pub = isset($pub['redes']) && is_array($pub['redes']) ? $pub['redes'] : $redes;
            $copy = isset($pub['copy']) ? wp_kses_post($pub['copy']) : '';
            $hashtags = isset($pub['hashtags']) ? sanitize_textarea_field($pub['hashtags']) : '';
            $primer_com = isset($pub['primer_comentario']) ? sanitize_textarea_field($pub['primer_comentario']) : '';

            // v1.0.37: campos visuales
            $headline       = isset($pub['headline']) ? sanitize_text_field($pub['headline']) : '';
            // v1.0.38 + v1.0.39: headline_lines defensivo (array o string-JSON)
            $hl_raw = $pub['headline_lines'] ?? null;
            if (is_string($hl_raw)) {
                $hl_parsed = json_decode($hl_raw, true);
                if (is_array($hl_parsed)) $hl_raw = $hl_parsed;
            }
            $headline_lines = (is_array($hl_raw) && !empty($hl_raw)) ? $hl_raw : [];
            $dato_destacado = isset($pub['dato_destacado']) ? sanitize_text_field($pub['dato_destacado']) : '';
            $cta_visible    = isset($pub['cta_visible']) ? sanitize_text_field($pub['cta_visible']) : '';
            $image_prompt   = isset($pub['image_prompt']) ? sanitize_textarea_field($pub['image_prompt']) : '';
            $text_placement = isset($pub['text_placement']) ? sanitize_text_field($pub['text_placement']) : '';
            $text_align     = isset($pub['text_align']) ? sanitize_text_field($pub['text_align']) : '';

            // v1.0.59: ref_relevance — puntuación 0-100 por tipo (para asignación posterior)
            $ref_relevance = [];
            if (!empty($pub['ref_relevance']) && is_array($pub['ref_relevance'])) {
                $valid_t = ['persona_destacada', 'equipo', 'instalaciones', 'pacientes_usuarios', 'productos'];
                foreach ($valid_t as $t) {
                    $score = isset($pub['ref_relevance'][$t]) ? (int) $pub['ref_relevance'][$t] : 0;
                    if ($score < 0) $score = 0;
                    if ($score > 100) $score = 100;
                    $ref_relevance[$t] = $score;
                }
            }

            // Si no hay fecha o es inválida, generar una distribuida
            if (!$fecha || !preg_match('/^\d{4}-\d{2}-\d{2}/', $fecha)) {
                $dia = ((($offset + $idx) % 28) + 1);
                $fecha = $mes . '-' . str_pad($dia, 2, '0', STR_PAD_LEFT) . ' 12:00:00';
            } elseif (strlen($fecha) === 10) {
                $fecha .= ' 12:00:00';
            }

            // v1.0.37: creación atómica — primero draft, asignar todo, luego publish.
            // Si crashea a mitad queda como borrador y no contamina el calendario.
            $post_id = wp_insert_post([
                'post_type'  => 'nv_publicacion',
                'post_title' => $titulo,
                'post_status'=> 'draft',
            ]);

            if (is_wp_error($post_id) || !$post_id) {
                $errores[] = ['idx' => $offset + $idx, 'titulo' => $titulo, 'error' => 'wp_insert_post falló'];
                continue;
            }

            wp_set_post_terms($post_id, [$cliente], 'nv_cliente');

            update_field('nv_fecha_publicacion', $fecha, $post_id);
            update_field('nv_tipo', $tipo, $post_id);
            update_field('nv_redes', $redes_pub, $post_id);
            update_field('nv_copy', $copy, $post_id);
            update_field('nv_hashtags', $hashtags, $post_id);
            if ($primer_com) update_field('nv_first_comment', $primer_com, $post_id);
            update_field('nv_estado', 'borrador', $post_id);
            update_field('nv_aprobar_metricool', false, $post_id);

            // v1.0.37: persistir campos visuales para Fase 2
            if (!empty($headline))       update_post_meta($post_id, '_nv_headline', $headline);
            if (!empty($headline_lines)) update_post_meta($post_id, '_nv_headline_lines', wp_json_encode($headline_lines, JSON_UNESCAPED_UNICODE)); // v1.0.38 + v1.0.56 (UNESCAPED_UNICODE para evitar bug "CLuoocdNICA" en hostings que aplican stripslashes a meta — verificado en hub.negociovivo.com 03/05/2026)
            if (!empty($dato_destacado)) update_post_meta($post_id, '_nv_dato_destacado', $dato_destacado);
            if (!empty($cta_visible))    update_post_meta($post_id, '_nv_cta_visible', $cta_visible);
            if (!empty($image_prompt))   update_post_meta($post_id, '_nv_image_prompt', $image_prompt);
            // v1.0.59: ref_relevance + percent_targets persistidos para que la Fase 2
            // (generar-imagen-publicacion) pueda calcular forced_types automáticamente.
            if (!empty($ref_relevance))  update_post_meta($post_id, '_nv_ref_relevance', wp_json_encode($ref_relevance));
            if (!empty($percent_targets_genmes)) update_post_meta($post_id, '_nv_pct_targets_genmes', wp_json_encode($percent_targets_genmes));
            if (in_array($text_placement, ['top','center','bottom'], true)) {
                update_post_meta($post_id, '_nv_text_placement', $text_placement);
            }
            if (in_array($text_align, ['left','center','right'], true)) {
                update_post_meta($post_id, '_nv_text_align', $text_align);
            }
            // Style guide cacheada del cliente (para Phase 2 si la necesita)
            if ($use_cached_guide) {
                update_post_meta($post_id, '_nv_image_style_guide', $cached_guide);
            }
            // v1.0.66: respetar el control explícito del operador sobre qué elementos
            // sobreimpresos llevar. ANTES (v1.0.65 y anteriores): si Anthropic devolvía
            // dato/cta, se renderizaban siempre — la AI los devuelve siempre por estar
            // en el JSON template, así que siempre saturaban la imagen.
            // AHORA: el modal "Generar mes" tiene checkboxes (default logo+titular ON,
            // dato+CTA OFF) que se respetan literalmente. Si el operador desactiva el
            // dato, NO se renderiza aunque Anthropic lo haya generado.
            $img_opts = [
                'add_logo' => $overlay_opts_genmes['add_logo'],
                'add_text' => $overlay_opts_genmes['add_text'] && !empty($headline),
                'add_data' => $overlay_opts_genmes['add_data'] && !empty($dato_destacado),
                'add_cta'  => $overlay_opts_genmes['add_cta']  && !empty($cta_visible),
                'tone_emotivo' => false,
                'tone_comercial' => false,
            ];
            update_post_meta($post_id, '_nv_img_opts', wp_json_encode($img_opts));

            // v1.0.37: ahora sí, transicionar a publish
            wp_update_post(['ID' => $post_id, 'post_status' => 'publish']);

            $creadas[] = [
                'id' => $post_id,
                'titulo' => $titulo,
                'fecha' => $fecha,
                'tipo' => $tipo,
                'has_image_prompt' => !empty($image_prompt), // hint para JS Phase 2
            ];
        }
        
        // Tokens y coste
        $tokens_in = isset($body['usage']['input_tokens']) ? (int) $body['usage']['input_tokens'] : 0;
        $tokens_out = isset($body['usage']['output_tokens']) ? (int) $body['usage']['output_tokens'] : 0;
        
        $modelo_real = $body['model'] ?? $modelo;
        if (strpos($modelo_real, 'haiku') !== false) {
            $price_in = 1; $price_out = 5;
        } elseif (strpos($modelo_real, 'opus') !== false) {
            $price_in = 15; $price_out = 75;
        } else {
            $price_in = 3; $price_out = 15;
        }
        $coste_usd = round(($tokens_in * $price_in + $tokens_out * $price_out) / 1000000, 4);
        
        return rest_ensure_response([
            'success' => true,
            'chunk_index' => $chunk_index,
            'total_chunks' => $total_chunks,
            'creadas' => count($creadas),
            'errores' => count($errores),
            'publicaciones' => $creadas,
            'errores_detalle' => $errores,
            'duracion_seg' => $duracion,
            'modelo' => $modelo_real,
            'tokens' => [
                'input' => $tokens_in,
                'output' => $tokens_out,
                'coste_estimado_usd' => $coste_usd,
            ],
        ]);
    }
    
    // ====================================================================
    // NUEVO v1.0.11 — Generación visual con Claude (link al chat)
    // ====================================================================
    
    /**
     * GET /publicaciones-sin-asset?cliente=X&mes=YYYY-MM
     * Devuelve publicaciones que NO tienen nv_asset_url, listas para que Claude genere imagen
     */
    public static function publicaciones_sin_asset($request) {
        $cliente = $request->get_param('cliente');
        $mes = $request->get_param('mes');
        
        $args = [
            'post_type' => 'nv_publicacion',
            'posts_per_page' => -1,
            'post_status' => 'publish',
        ];
        if ($cliente && $cliente !== 'all') {
            $args['tax_query'] = [[
                'taxonomy' => 'nv_cliente',
                'field' => 'slug',
                'terms' => $cliente,
            ]];
        }
        if ($mes && preg_match('/^\d{4}-\d{2}$/', $mes)) {
            $args['meta_query'] = [[
                'key' => 'nv_fecha_publicacion',
                'value' => [$mes . '-01 00:00:00', $mes . '-31 23:59:59'],
                'compare' => 'BETWEEN',
                'type' => 'CHAR',
            ]];
        }
        
        $publicaciones = get_posts($args);
        $sin_asset = [];
        
        foreach ($publicaciones as $p) {
            $asset = get_field('nv_asset_url', $p->ID);
            if (!$asset) {
                $clientes = wp_get_post_terms($p->ID, 'nv_cliente', ['fields' => 'all']);
                $cli_slug = !empty($clientes) ? $clientes[0]->slug : '';
                $cli_nombre = !empty($clientes) ? $clientes[0]->name : '';
                
                $sin_asset[] = [
                    'id' => $p->ID,
                    'titulo' => $p->post_title,
                    'cliente_slug' => $cli_slug,
                    'cliente_nombre' => $cli_nombre,
                    'fecha' => get_field('nv_fecha_publicacion', $p->ID),
                    'tipo' => get_field('nv_tipo', $p->ID),
                    'redes' => get_field('nv_redes', $p->ID) ?: [],
                    'copy' => get_field('nv_copy', $p->ID),
                    'hashtags' => get_field('nv_hashtags', $p->ID),
                    'sugerencia_visual' => get_field('nv_first_comment', $p->ID),
                ];
            }
        }
        
        return rest_ensure_response([
            'total' => count($sin_asset),
            'cliente' => $cliente ?: 'all',
            'mes' => $mes ?: 'all',
            'publicaciones' => $sin_asset,
        ]);
    }
    
    /**
     * POST /subir-imagen-post/{id}
     * Acepta JSON: { image_url: "..." }  ó  { base64: "...", filename: "..." }
     * Descarga/decodifica → sube a Media Library → asocia al campo nv_asset_url
     */
    public static function subir_imagen_post($request) {
        @set_time_limit(60);
        @ini_set('memory_limit', '256M');
        
        $post_id = (int) $request['id'];
        $params = $request->get_json_params() ?: [];
        
        $post = get_post($post_id);
        if (!$post || $post->post_type !== 'nv_publicacion') {
            return new WP_Error('invalid_post', 'Publicación no encontrada', ['status' => 404]);
        }
        
        $image_url = isset($params['image_url']) ? esc_url_raw(trim($params['image_url'])) : '';
        $base64 = isset($params['base64']) ? $params['base64'] : '';
        $filename = isset($params['filename']) ? sanitize_file_name($params['filename']) : '';
        $mime_input = isset($params['mime']) ? sanitize_text_field($params['mime']) : '';
        
        $image_data = null;
        $mime = 'image/jpeg';
        $ext = 'jpg';
        
        if ($image_url) {
            // Descargar URL externa
            $resp = wp_remote_get($image_url, ['timeout' => 30]);
            if (is_wp_error($resp)) {
                return new WP_Error('download_failed', 'No se pudo descargar la URL: ' . $resp->get_error_message(), ['status' => 500]);
            }
            $code = wp_remote_retrieve_response_code($resp);
            if ($code !== 200) {
                return new WP_Error('download_failed', 'URL devolvió HTTP ' . $code, ['status' => 500]);
            }
            $image_data = wp_remote_retrieve_body($resp);
            $ct = wp_remote_retrieve_header($resp, 'content-type');
            if ($ct) {
                $mime = preg_replace('/;.*$/', '', $ct);
            }
        } elseif ($base64) {
            // Decodificar base64 (admite "data:image/jpeg;base64,..." o solo el base64 puro)
            if (preg_match('#^data:([^;]+);base64,(.+)$#', $base64, $m)) {
                $mime = $m[1];
                $base64 = $m[2];
            } elseif ($mime_input) {
                $mime = $mime_input;
            }
            $image_data = base64_decode($base64);
        } else {
            return new WP_Error('missing_input', 'Debes pasar image_url o base64', ['status' => 400]);
        }
        
        if (!$image_data || strlen($image_data) < 1000) {
            return new WP_Error('decode_failed', 'Imagen inválida o demasiado pequeña', ['status' => 500]);
        }
        
        // Determinar extensión por MIME
        $mime_to_ext = [
            'image/jpeg' => 'jpg',
            'image/jpg'  => 'jpg',
            'image/png'  => 'png',
            'image/webp' => 'webp',
            'image/gif'  => 'gif',
            'video/mp4'  => 'mp4',
            'video/webm' => 'webm',
        ];
        $ext = isset($mime_to_ext[$mime]) ? $mime_to_ext[$mime] : 'jpg';
        if (!$mime_input && substr($mime, 0, 6) !== 'image/' && substr($mime, 0, 6) !== 'video/') {
            $mime = 'image/jpeg';
            $ext = 'jpg';
        }
        
        if (!$filename) {
            $filename = 'nv-claude-' . $post_id . '-' . time() . '.' . $ext;
        } else {
            // Asegurar extensión coincidente
            $ext_actual = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
            if (!$ext_actual) {
                $filename .= '.' . $ext;
            }
        }
        
        // Guardar fichero
        $upload_dir = wp_upload_dir();
        if (!empty($upload_dir['error'])) {
            return new WP_Error('upload_dir_error', $upload_dir['error'], ['status' => 500]);
        }
        $file_path = trailingslashit($upload_dir['path']) . $filename;
        
        if (file_put_contents($file_path, $image_data) === false) {
            return new WP_Error('save_failed', 'No se pudo guardar el archivo en disco', ['status' => 500]);
        }
        
        // Crear attachment
        require_once ABSPATH . 'wp-admin/includes/image.php';
        require_once ABSPATH . 'wp-admin/includes/file.php';
        require_once ABSPATH . 'wp-admin/includes/media.php';
        
        $attachment = [
            'post_mime_type' => $mime,
            'post_title' => '🤖 Claude · ' . get_the_title($post_id),
            'post_content' => 'Generado con Claude para publicación #' . $post_id,
            'post_status' => 'inherit',
        ];
        
        $attach_id = wp_insert_attachment($attachment, $file_path, $post_id);
        if (is_wp_error($attach_id) || !$attach_id) {
            @unlink($file_path);
            return new WP_Error('attach_failed', 'No se pudo crear el attachment', ['status' => 500]);
        }
        
        // Generar metadata + thumbnails (solo para imágenes)
        if (substr($mime, 0, 6) === 'image/') {
            $attach_data = wp_generate_attachment_metadata($attach_id, $file_path);
            wp_update_attachment_metadata($attach_id, $attach_data);
        }
        
        // URL pública
        $url = wp_get_attachment_url($attach_id);
        
        // Asociar al campo nv_asset_url
        update_field('nv_asset_url', $url, $post_id);
        
        // Si es imagen, marcarla también como featured image del post para que se vea en wp-admin
        if (substr($mime, 0, 6) === 'image/') {
            set_post_thumbnail($post_id, $attach_id);
        }
        
        return rest_ensure_response([
            'success' => true,
            'post_id' => $post_id,
            'attachment_id' => $attach_id,
            'asset_url' => $url,
            'mime' => $mime,
            'size_bytes' => strlen($image_data),
        ]);
    }

    /**
     * GET /cliente-config/{slug}
     *
     * v1.0.15 — Devuelve la configuración del cliente para la generación de imágenes:
     *  - modelo seleccionado (override per-cliente o default global)
     *  - flag indicando si requiere API key OpenAI
     *  - la API key OpenAI (solo si current_user_can edit_posts y el modelo es gpt-image-2)
     *
     * Este endpoint lo consume el JS del botón "Generar imágenes con Claude"
     * para inyectar en el prompt el modelo correcto y la key necesaria.
     */
    public static function cliente_config($request) {
        $slug = sanitize_text_field($request['slug']);

        $term = get_term_by('slug', $slug, 'nv_cliente');
        if (!$term) {
            return new WP_Error('invalid_cliente', "Cliente '{$slug}' no encontrado", ['status' => 404]);
        }

        // Resolver modelo: per-cliente override > default global > seedream
        $por_cliente_json = get_option('nv_dashboard_modelo_imagen_por_cliente', '{}');
        $por_cliente = json_decode($por_cliente_json, true);
        if (!is_array($por_cliente)) $por_cliente = [];
        $modelo_default = get_option('nv_dashboard_modelo_imagen_default', 'seedream-v4-5-edit');
        $modelo = !empty($por_cliente[$slug]) ? $por_cliente[$slug] : $modelo_default;

        // ¿Requiere OpenAI key?
        $requiere_openai = ($modelo === 'gpt-image-2');

        // v1.0.19: la OpenAI key SOLO se devuelve a usuarios con sesión WP (cookie+nonce).
        // Si la llamada viene por Bearer NV_API_TOKEN (Claude externo), devolvemos
        // string vacío — el Claude externo debe usar el endpoint /openai-image-proxy/{id}
        // que mantiene la key server-side.
        $is_logged_in = is_user_logged_in() && current_user_can('edit_posts');
        $openai_key = ($requiere_openai && $is_logged_in) ? get_option('nv_dashboard_openai_api_key', '') : '';

        // v1.0.21: Refs visuales Drive — fuente primaria es term meta (NV_Cliente_Meta).
        // Fallback al option global solo para root_folder_id (REFS NV master).
        $refs_root = '1Z2Hr5Ec-11RCKX00vtKrnPAt8RzgkrCx'; // default REFS NV
        $refs_json = get_option('nv_dashboard_refs_drive_folders', '');
        if ($refs_json) {
            $refs_data = json_decode($refs_json, true);
            if (is_array($refs_data) && !empty($refs_data['root_folder_id'])) {
                $refs_root = $refs_data['root_folder_id'];
            }
        }

        $cliente_drive = class_exists('NV_Cliente_Meta')
            ? NV_Cliente_Meta::get_cliente_drive_config($term->term_id)
            : null;

        // Construir cliente_folder en formato compatible con v1.0.20 + nuevos campos
        $cliente_folder = null;
        if ($cliente_drive && $cliente_drive['drive_mode'] === 'configured') {
            $sub_object = [];
            $sub_typed = [];
            foreach ($cliente_drive['subfolders'] as $sf) {
                $sub_object[$sf['name']] = $sf['id'];           // formato legacy v1.0.17-v1.0.20
                $sub_typed[] = $sf;                              // formato v1.0.21 con type
            }
            $cliente_folder = [
                'root_id'       => $cliente_drive['root_id'],
                'subfolders'    => $sub_object,                 // legacy
                'subfolders_v2' => $sub_typed,                  // con tipos semánticos
            ];
        }

        $refs_drive = [
            'root_folder_id' => $refs_root,
            'drive_mode'     => $cliente_drive ? $cliente_drive['drive_mode'] : 'pending',  // v1.0.21
            'cliente_folder' => $cliente_folder,
        ];

        // Datos descriptivos del modelo (para que el JS los muestre)
        $modelos_info = [
            'seedream-v4-5-edit' => [
                'label'    => 'Seedream V4.5 Edit',
                'provider' => 'Freepik',
                'endpoint' => 'POST https://api.freepik.com/v1/ai/text-to-image/seedream-v4-5-edit',
                'auth'     => 'header x-freepik-api-key',
                'requiere_refs' => true,
            ],
            'gpt-image-2' => [
                'label'    => 'GPT-Image-2',
                'provider' => 'OpenAI directo',
                'endpoint' => 'POST https://api.openai.com/v1/images/generations',
                'auth'     => 'header Authorization: Bearer {OPENAI_KEY}',
                'requiere_refs' => false,
                'modelo_id' => 'gpt-image-2',
                'docs'     => 'https://platform.openai.com/docs/guides/image-generation',
                'pricing'  => '$0.006 low / $0.053 medium / $0.211 high (1024x1024)',
            ],
            'mystic-2-5' => [
                'label'    => 'Mystic 2.5',
                'provider' => 'Freepik',
                'endpoint' => 'POST https://api.freepik.com/v1/ai/mystic',
                'auth'     => 'header x-freepik-api-key',
                'requiere_refs' => false,
            ],
            'gpt-1-5-high' => [
                'label'    => 'GPT 1.5 High',
                'provider' => 'Freepik',
                'endpoint' => 'POST https://api.freepik.com/v1/ai/text-to-image (model=gpt-1-5-high)',
                'auth'     => 'header x-freepik-api-key',
                'requiere_refs' => false,
            ],
            'nano-banana-pro' => [
                'label'    => 'Nano Banana Pro',
                'provider' => 'Freepik (Google Gemini 3)',
                'endpoint' => 'POST https://api.freepik.com/v1/ai/text-to-image/google-nano-banana-pro',
                'auth'     => 'header x-freepik-api-key',
                'requiere_refs' => false,
            ],
        ];

        // v1.0.74: Branding del cliente — colores, fuentes, logo, brief, style guide.
        // Necesario para que el Claude externo pueda producir vídeos NV Reels con
        // tipografía y paleta correctas (FFmpeg drawtext, pantallas tipográficas
        // intercaladas, overlay de logo, etc.) sin tener que adivinar.
        $branding = null;
        if (class_exists('NV_Cliente_Meta')) {
            $tid = $term->term_id;

            // Colores: explícitos del cliente (sin fallback automático para no inventar)
            $colors_explicit = NV_Cliente_Meta::get_brand_colors_explicit($tid);
            $colors_resolved = NV_Cliente_Meta::get_brand_colors($tid);

            // Fuentes: array de { weight, url, filename }. wp_get_attachment_url() devuelve
            // una URL pública servible que Claude externo puede descargar y pasar a FFmpeg.
            $fonts_payload = [];
            foreach (NV_Cliente_Meta::get_fonts_typed($tid) as $f) {
                $url = wp_get_attachment_url((int) $f['id']);
                if (!$url) continue;
                $fonts_payload[] = [
                    'weight'   => $f['weight'],
                    'url'      => $url,
                    'filename' => basename(parse_url($url, PHP_URL_PATH)),
                ];
            }

            // Logo
            $logo_id  = NV_Cliente_Meta::get_logo_attachment_id($tid);
            $logo_url = $logo_id ? wp_get_attachment_url($logo_id) : '';

            // Style guide cacheada (texto generado por Claude vision). Suele ser largo
            // y muy útil para describir el "look & feel" del cliente. Truncamos a 1200
            // caracteres para no inflar el prompt — si Claude externo necesita más,
            // puede fetchear el endpoint completo.
            $style_guide_full = NV_Cliente_Meta::get_style_guide_cached($tid);
            $style_guide_short = '';
            if ($style_guide_full !== '') {
                $sg = wp_strip_all_tags($style_guide_full);
                $style_guide_short = mb_strlen($sg) > 1200 ? (mb_substr($sg, 0, 1200) . '…') : $sg;
            }

            // Dimensiones — qué tamaño/aspect ratio usa este cliente por tipo de
            // contenido. Útil para que Seedream/Seedance reciban los parámetros correctos.
            $dimensions_all = NV_Cliente_Meta::get_dimensions_all($tid);

            $branding = [
                'colors_explicit'    => $colors_explicit,    // null fields si no configurado
                'colors_resolved'    => $colors_resolved,    // siempre 3 hex válidos (con fallback)
                'fonts'              => $fonts_payload,      // array; vacío si solo usa defaults
                'logo_url'           => $logo_url,
                'logo_position'      => NV_Cliente_Meta::get_logo_position($tid),
                'brand_brief'        => NV_Cliente_Meta::get_brand_brief($tid),
                'website'            => (string) get_term_meta($tid, 'nv_cliente_website', true),
                'visual_pattern'     => NV_Cliente_Meta::get_visual_pattern($tid),
                'refs_fidelity'      => NV_Cliente_Meta::get_refs_fidelity($tid),
                'style_guide'        => $style_guide_short,
                'style_guide_truncated' => ($style_guide_short !== '' && mb_strlen($style_guide_full) > 1200),
                'dimensions'         => $dimensions_all,
            ];
        }

        // v1.0.75: Imágenes de referencia visual del cliente (Media Library WP).
        // Distinto de refs_drive (Drive) — éstas son las que David carga en la ficha
        // del cliente con tipo (persona_destacada / equipo / productos / etc.) y
        // nombre opcional (Pilar Oliva, Dra Angie Bech, Asistente Carmen…).
        // Críticas para que el Claude externo sepa A QUIÉN incluir en el reel
        // cuando el copy menciona a alguien por nombre.
        $reference_images = null;
        if (class_exists('NV_Cliente_Meta')) {
            $tid = $term->term_id;
            $items_raw = NV_Cliente_Meta::get_reference_images_data($tid);
            $items = [];
            foreach ($items_raw as $it) {
                // get_reference_images_data() ya nos da thumb + full. Usamos full
                // como URL principal para que el Claude externo trabaje en alta
                // resolución y la pase a Seedream/Seedance como reference_images.
                $items[] = [
                    'id'          => (int) $it['id'],
                    'url'         => $it['full'],
                    'thumb'       => $it['thumb'],
                    'type'        => $it['type'],
                    'person_name' => $it['person_name'],
                ];
            }
            $reference_images = [
                'total_count'     => count($items),
                'counts_by_type'  => NV_Cliente_Meta::get_reference_images_counts_by_type($tid),
                'team_roster'     => NV_Cliente_Meta::get_team_roster($tid),
                'items'           => $items,
            ];
        }

        return rest_ensure_response([
            'cliente_slug'  => $slug,
            'cliente_name'  => $term->name,
            'modelo'        => $modelo,
            'modelo_info'   => $modelos_info[$modelo] ?? null,
            'modelo_default_global' => $modelo_default,
            'override_per_cliente'  => !empty($por_cliente[$slug]),
            'openai_key'    => $openai_key,  // sólo si modelo=gpt-image-2; vacío para los demás
            'openai_required' => $requiere_openai,
            'refs_drive'    => $refs_drive,        // v1.0.17
            'branding'      => $branding,          // v1.0.74
            'reference_images' => $reference_images, // v1.0.75
        ]);
    }

    /**
     * POST /openai-image-proxy/{id}
     *
     * v1.0.19 — Proxy server-side a la API de OpenAI Image.
     * La OpenAI key vive en wp_options y NUNCA sale al cliente.
     *
     * Body JSON:
     *   - operation: "generate" | "edit"  (default: "generate")
     *   - prompt: string (requerido)
     *   - size: "1024x1024" | "1024x1536" | "1536x1024"  (default: 1024x1024)
     *   - quality: "low" | "medium" | "high"  (default: "high")
     *   - n: int 1-4 (default: 1)
     *   - image_urls: array de URLs (solo para operation=edit; se descargan
     *     server-side como multipart files). Hasta 4.
     *   - mask_url: URL opcional para inpainting (solo edit).
     *   - upload_to_post: bool (default: false). Si true, la imagen
     *     resultante se sube a Media Library y se asocia al post como
     *     featured image + nv_asset_url.
     *
     * Response:
     *   - success: true
     *   - images: [{ b64_json: "...", attachment_id: int|null, asset_url: "..."|null }]
     *   - openai_response: metadata de la respuesta de OpenAI
     */
    public static function openai_image_proxy($request) {
        @set_time_limit(120);
        @ini_set('memory_limit', '512M');

        $post_id = (int) $request['id'];
        $post = get_post($post_id);
        if (!$post || $post->post_type !== 'nv_publicacion') {
            return new WP_Error('invalid_post', 'Publicación no encontrada', ['status' => 404]);
        }

        $params = $request->get_json_params() ?: [];
        $operation = isset($params['operation']) ? sanitize_text_field($params['operation']) : 'generate';
        $prompt = isset($params['prompt']) ? trim((string) $params['prompt']) : '';
        $size = isset($params['size']) ? sanitize_text_field($params['size']) : '1024x1024';
        $quality = isset($params['quality']) ? sanitize_text_field($params['quality']) : 'high';
        $n = isset($params['n']) ? max(1, min(4, (int) $params['n'])) : 1;
        $image_urls = isset($params['image_urls']) && is_array($params['image_urls']) ? $params['image_urls'] : [];
        $mask_url = isset($params['mask_url']) ? esc_url_raw($params['mask_url']) : '';
        $upload_to_post = !empty($params['upload_to_post']);

        if (!in_array($operation, ['generate', 'edit'], true)) {
            return new WP_Error('invalid_operation', 'operation debe ser "generate" o "edit"', ['status' => 400]);
        }
        if (!$prompt) {
            return new WP_Error('missing_prompt', 'prompt es requerido', ['status' => 400]);
        }
        if ($operation === 'edit' && empty($image_urls)) {
            return new WP_Error('missing_images', 'image_urls es requerido para operation=edit', ['status' => 400]);
        }

        $openai_key = get_option('nv_dashboard_openai_api_key', '');
        if (empty($openai_key)) {
            return new WP_Error('no_openai_key', 'OpenAI API key no configurada en NV Dashboard → Configuración', ['status' => 500]);
        }

        // Llamada a OpenAI según operación
        $endpoint = $operation === 'edit'
            ? 'https://api.openai.com/v1/images/edits'
            : 'https://api.openai.com/v1/images/generations';

        if ($operation === 'generate') {
            // JSON simple
            $body = [
                'model' => 'gpt-image-2',
                'prompt' => $prompt,
                'size' => $size,
                'quality' => $quality,
                'n' => $n,
            ];
            $resp = wp_remote_post($endpoint, [
                'timeout' => 180, // v1.0.30: subido de 90 → 180 (gpt-image-2 puede tardar bajo carga)
                'headers' => [
                    'Authorization' => 'Bearer ' . $openai_key,
                    'Content-Type' => 'application/json',
                ],
                'body' => wp_json_encode($body),
            ]);
        } else {
            // multipart/form-data — descargar imágenes server-side primero
            $boundary = wp_generate_password(24, false);
            $body = '';
            $crlf = "\r\n";

            $append_field = function($name, $value) use (&$body, $boundary, $crlf) {
                $body .= '--' . $boundary . $crlf;
                $body .= 'Content-Disposition: form-data; name="' . $name . '"' . $crlf . $crlf;
                $body .= $value . $crlf;
            };
            $append_file = function($name, $filename, $mime, $data) use (&$body, $boundary, $crlf) {
                $body .= '--' . $boundary . $crlf;
                $body .= 'Content-Disposition: form-data; name="' . $name . '"; filename="' . $filename . '"' . $crlf;
                $body .= 'Content-Type: ' . $mime . $crlf . $crlf;
                $body .= $data . $crlf;
            };

            $append_field('model', 'gpt-image-2');
            $append_field('prompt', $prompt);
            $append_field('size', $size);
            $append_field('quality', $quality);
            $append_field('n', (string) $n);

            // Descargar las imágenes de referencia
            foreach ($image_urls as $idx => $img_url) {
                $img_url = esc_url_raw($img_url);
                if (!$img_url) continue;
                $r = wp_remote_get($img_url, ['timeout' => 30]);
                if (is_wp_error($r) || wp_remote_retrieve_response_code($r) !== 200) {
                    return new WP_Error('img_download_failed', 'No se pudo descargar image_urls[' . $idx . ']: ' . $img_url, ['status' => 502]);
                }
                $img_data = wp_remote_retrieve_body($r);
                $img_mime = wp_remote_retrieve_header($r, 'content-type');
                $img_mime = $img_mime ? preg_replace('/;.*$/', '', $img_mime) : 'image/png';
                $img_ext = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'][$img_mime] ?? 'png';
                $field_name = count($image_urls) > 1 ? 'image[]' : 'image';
                $append_file($field_name, 'ref-' . $idx . '.' . $img_ext, $img_mime, $img_data);
            }

            if ($mask_url) {
                $r = wp_remote_get($mask_url, ['timeout' => 30]);
                if (!is_wp_error($r) && wp_remote_retrieve_response_code($r) === 200) {
                    $append_file('mask', 'mask.png', 'image/png', wp_remote_retrieve_body($r));
                }
            }

            $body .= '--' . $boundary . '--' . $crlf;

            $resp = wp_remote_post($endpoint, [
                'timeout' => 180, // v1.0.30: subido de 120 → 180
                'headers' => [
                    'Authorization' => 'Bearer ' . $openai_key,
                    'Content-Type' => 'multipart/form-data; boundary=' . $boundary,
                ],
                'body' => $body,
            ]);
        }

        if (is_wp_error($resp)) {
            return new WP_Error('openai_request_failed', 'OpenAI request failed: ' . $resp->get_error_message(), ['status' => 502]);
        }

        $code = wp_remote_retrieve_response_code($resp);
        $resp_body = wp_remote_retrieve_body($resp);
        $resp_json = json_decode($resp_body, true);

        if ($code !== 200) {
            $err_msg = isset($resp_json['error']['message']) ? $resp_json['error']['message'] : 'OpenAI HTTP ' . $code;
            return new WP_Error('openai_error', $err_msg, ['status' => 502, 'openai_response' => $resp_json]);
        }

        if (!isset($resp_json['data']) || !is_array($resp_json['data'])) {
            return new WP_Error('invalid_openai_response', 'Respuesta OpenAI sin campo data', ['status' => 502]);
        }

        // Procesar imágenes resultantes
        $images_out = [];
        foreach ($resp_json['data'] as $idx => $img_data) {
            $b64 = isset($img_data['b64_json']) ? $img_data['b64_json'] : '';
            if (!$b64) continue;

            $entry = [
                'b64_json' => $b64,
                'attachment_id' => null,
                'asset_url' => null,
            ];

            // Si upload_to_post, subir a Media Library
            if ($upload_to_post) {
                $upload_result = self::upload_b64_to_post($b64, $post_id, $idx);
                if (!is_wp_error($upload_result)) {
                    $entry['attachment_id'] = $upload_result['attachment_id'];
                    $entry['asset_url'] = $upload_result['asset_url'];
                    // Solo el primero se asocia como featured + nv_asset_url
                    if ($idx === 0) {
                        update_field('nv_asset_url', $upload_result['asset_url'], $post_id);
                        set_post_thumbnail($post_id, $upload_result['attachment_id']);

                        // v1.0.50 — APLICAR OVERLAYS con brand_colors del cliente.
                        // Antes este flujo (botón "🎨 Generar imágenes con Claude") tampoco
                        // aplicaba overlays — los textos del cliente quedaban sin estilizar.
                        $clientes_terms = wp_get_post_terms($post_id, 'nv_cliente', ['fields' => 'all']);
                        $cliente_term   = (!empty($clientes_terms) && !is_wp_error($clientes_terms)) ? $clientes_terms[0] : null;
                        if ($cliente_term) {
                            $stored_opts_raw = get_post_meta($post_id, '_nv_img_opts', true);
                            $stored_opts = is_string($stored_opts_raw) ? json_decode($stored_opts_raw, true) : [];
                            if (!is_array($stored_opts)) $stored_opts = [];
                            $img_opts_overlay = array_merge(
                                ['add_logo' => true, 'add_text' => true, 'add_data' => false, 'add_cta' => false],
                                $stored_opts
                            );
                            $overlay_res = self::apply_overlays_to_attachment($post_id, $upload_result['attachment_id'], $cliente_term, $img_opts_overlay);
                            $entry['overlay_composited'] = (bool) ($overlay_res['composited'] ?? false);
                            if (!empty($overlay_res['warnings'])) {
                                $entry['overlay_warnings'] = $overlay_res['warnings'];
                            }
                        }
                    }
                }
            }

            $images_out[] = $entry;
        }

        return rest_ensure_response([
            'success' => true,
            'post_id' => $post_id,
            'operation' => $operation,
            'model' => 'gpt-image-2',
            'count' => count($images_out),
            'images' => $images_out,
        ]);
    }

    /**
     * GET /api-token  (v1.0.20)
     * Devuelve el API token actual. Solo accesible para admins de la web.
     */
    public static function get_api_token($request) {
        $token = function_exists('nv_dashboard_get_api_token') ? nv_dashboard_get_api_token() : get_option('nv_dashboard_api_token', '');
        return rest_ensure_response([
            'api_token' => $token,
            'site_url' => home_url('/'),
            'rest_base' => rest_url('nv/v1/'),
        ]);
    }

    /**
     * POST /rotar-api-token  (v1.0.20)
     * Genera un token nuevo, invalidando el anterior. Solo admins.
     */
    public static function rotar_api_token($request) {
        if (!function_exists('nv_dashboard_regenerate_api_token')) {
            return new WP_Error('helper_missing', 'Helper de regeneración no disponible', ['status' => 500]);
        }
        $new_token = nv_dashboard_regenerate_api_token();
        return rest_ensure_response([
            'success' => true,
            'api_token' => $new_token,
            'rotated_at' => current_time('mysql'),
        ]);
    }

    /**
     * Helper interno: sube un base64 a Media Library asociado a un post.
     * @return array|WP_Error  { attachment_id, asset_url } o error
     */
    private static function upload_b64_to_post($b64, $post_id, $idx = 0) {
        $image_data = base64_decode($b64);
        if (!$image_data || strlen($image_data) < 1000) {
            return new WP_Error('decode_failed', 'b64 inválido o demasiado pequeño');
        }
        $upload_dir = wp_upload_dir();
        if (!empty($upload_dir['error'])) {
            return new WP_Error('upload_dir_error', $upload_dir['error']);
        }
        $filename = 'nv-openai-' . $post_id . '-' . time() . '-' . $idx . '.png';
        $file_path = trailingslashit($upload_dir['path']) . $filename;
        if (file_put_contents($file_path, $image_data) === false) {
            return new WP_Error('save_failed', 'No se pudo guardar el archivo');
        }
        require_once ABSPATH . 'wp-admin/includes/image.php';
        require_once ABSPATH . 'wp-admin/includes/file.php';
        require_once ABSPATH . 'wp-admin/includes/media.php';
        $attachment = [
            'post_mime_type' => 'image/png',
            'post_title' => '🤖 OpenAI gpt-image-2 · ' . get_the_title($post_id),
            'post_content' => 'Generado vía proxy NV Dashboard para post #' . $post_id,
            'post_status' => 'inherit',
        ];
        $attach_id = wp_insert_attachment($attachment, $file_path, $post_id);
        if (is_wp_error($attach_id) || !$attach_id) {
            @unlink($file_path);
            return new WP_Error('attach_failed', 'No se pudo crear el attachment');
        }
        $attach_data = wp_generate_attachment_metadata($attach_id, $file_path);
        wp_update_attachment_metadata($attach_id, $attach_data);
        return [
            'attachment_id' => $attach_id,
            'asset_url' => wp_get_attachment_url($attach_id),
        ];
    }

    // ─────────────────────────────────────────────────────────────────────
    // v1.0.23: Publicaciones multi-cliente (batch estacional)
    // ─────────────────────────────────────────────────────────────────────

    /**
     * POST /publicaciones-multi-cliente
     *
     * Crea N borradores de publicación (uno por cliente seleccionado) para una
     * fecha concreta, generando copy + hashtags + sugerencia visual con la
     * Anthropic API adaptado al brief de marca de cada cliente.
     *
     * Body JSON:
     *   - fecha:          "Y-m-d H:i:s"  (requerido)
     *   - tipo:           "imagen" | "reel" | "carrusel" | "story" | "video"  (default: imagen)
     *   - redes:          array de "facebook"|"instagram"|"linkedin"|"twitter"|"tiktok"  (default: [facebook, instagram])
     *   - tema:           string (requerido, brief libre del usuario)
     *   - cliente_slugs:  array de slugs de clientes (requerido, mín 1)
     *   - skip_existing:  bool (default true) — saltar clientes con publicación ya existente para esa fecha
     *
     * Response:
     *   { success, created: [...], skipped: [...], errors: [...] }
     */
    public static function publicaciones_multi_cliente($request) {
        // v1.0.26: arquitectura en dos fases — este endpoint solo hace Fase 1
        // (Anthropic + crear posts). La generación de imagen se hace en Fase 2
        // en peticiones HTTP independientes vía /generar-imagen-publicacion/{id}
        // para evitar timeouts del servidor en batches grandes.
        @set_time_limit(180);
        @ini_set('memory_limit', '512M');

        $params = $request->get_json_params() ?: [];

        $fecha = isset($params['fecha']) ? sanitize_text_field($params['fecha']) : '';
        $tipo  = isset($params['tipo'])  ? sanitize_text_field($params['tipo'])  : 'imagen';
        $redes = isset($params['redes']) && is_array($params['redes']) ? array_map('sanitize_text_field', $params['redes']) : ['facebook', 'instagram'];
        $tema  = isset($params['tema'])  ? trim((string) $params['tema'])  : '';
        $cliente_slugs = isset($params['cliente_slugs']) && is_array($params['cliente_slugs'])
            ? array_map('sanitize_text_field', $params['cliente_slugs'])
            : [];
        $skip_existing = isset($params['skip_existing']) ? (bool) $params['skip_existing'] : true;
        // v1.0.26: por defecto NO generar imagen aquí (se hace en fase 2 separada).
        // Mantenemos el flag por compat para llamadas directas a la API que quieran
        // el flujo todo-en-uno (no recomendado para >3 clientes).
        $generate_image = isset($params['generate_image']) ? (bool) $params['generate_image'] : false;
        $image_quality  = isset($params['image_quality']) ? sanitize_text_field($params['image_quality']) : 'medium';
        if (!in_array($image_quality, ['low', 'medium', 'high'], true)) $image_quality = 'medium';

        // v1.0.27: opciones de estilo de imagen (booleanos)
        $img_opts = [
            'add_logo'       => isset($params['add_logo'])       ? (bool) $params['add_logo']       : true,
            'add_text'       => isset($params['add_text'])       ? (bool) $params['add_text']       : true,
            'add_data'       => isset($params['add_data'])       ? (bool) $params['add_data']       : false,
            'add_cta'        => isset($params['add_cta'])        ? (bool) $params['add_cta']        : false,
            'tone_emotivo'   => isset($params['tone_emotivo'])   ? (bool) $params['tone_emotivo']   : false,
            'tone_comercial' => isset($params['tone_comercial']) ? (bool) $params['tone_comercial'] : false,
        ];

        // v1.0.53: override puntual de la fidelidad a refs (opcional). Si se pasa,
        // sobreescribe el default del cliente solo para este request. Si no,
        // generate_image_for_post lee el default del cliente.
        $refs_fidelity_override = null;
        if (array_key_exists('refs_fidelity', $params) && $params['refs_fidelity'] !== '' && $params['refs_fidelity'] !== null) {
            $rf = (int) $params['refs_fidelity'];
            if ($rf < 0) $rf = 0;
            if ($rf > 100) $rf = 100;
            $refs_fidelity_override = $rf;
        }

        // v1.0.59: forced_types — array de tipos de refs a forzar (post individual).
        // Si está set, generate_image_via_openai usa SOLO refs de esos tipos
        // ignorando el heurístico. Aceptado como array o string CSV.
        $forced_types = [];
        if (!empty($params['forced_types'])) {
            $raw_ft = $params['forced_types'];
            if (is_string($raw_ft)) {
                $forced_types = array_map('trim', explode(',', $raw_ft));
            } elseif (is_array($raw_ft)) {
                $forced_types = array_map('strval', $raw_ft);
            }
            $forced_types = array_values(array_filter($forced_types));
        }

        // v1.0.59: percent_targets — para multi-cliente con sliders.
        // Formato: { "persona_destacada": 30, "instalaciones": 50 } → en lote de 30 posts,
        // los TOP 30% por puntuación-persona_destacada llevarán refs CEO,
        // los TOP 50% por puntuación-instalaciones llevarán refs locales, etc.
        // (independientes — un post puede llevar varios tipos a la vez).
        $percent_targets = [];
        if (!empty($params['percent_targets']) && is_array($params['percent_targets'])) {
            $valid_t = ['persona_destacada', 'equipo', 'instalaciones', 'pacientes_usuarios', 'productos'];
            foreach ($params['percent_targets'] as $k => $v) {
                if (!in_array($k, $valid_t, true)) continue;
                $pct = (int) $v;
                if ($pct < 0) $pct = 0;
                if ($pct > 100) $pct = 100;
                if ($pct > 0) $percent_targets[$k] = $pct;
            }
        }

        // Validaciones
        if (empty($fecha) || !preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/', $fecha)) {
            return new WP_Error('invalid_fecha', 'Formato de fecha inválido. Esperado: YYYY-MM-DD HH:MM[:SS]', ['status' => 400]);
        }
        if (strlen($fecha) === 16) $fecha .= ':00';
        if (empty($tema)) {
            return new WP_Error('missing_tema', 'El campo tema es requerido', ['status' => 400]);
        }
        $tipos_validos = ['imagen', 'reel', 'carrusel', 'story', 'video'];
        if (!in_array($tipo, $tipos_validos, true)) {
            $tipo = 'imagen';
        }
        if (empty($cliente_slugs)) {
            return new WP_Error('no_clientes', 'Selecciona al menos un cliente', ['status' => 400]);
        }

        $api_key = get_option('nv_dashboard_anthropic_api_key', '');
        $modelo  = get_option('nv_dashboard_anthropic_model', 'claude-sonnet-4-5');
        $use_ai  = !empty($api_key);

        $created = [];
        $skipped = [];
        $errors  = [];

        foreach ($cliente_slugs as $slug) {
            @set_time_limit(180); // reset per cliente para batches largos

            $term = get_term_by('slug', $slug, 'nv_cliente');
            if (!$term || is_wp_error($term)) {
                // Probar formato alternativo (underscore/dash)
                $alt = strpos($slug, '-') !== false ? str_replace('-', '_', $slug) : str_replace('_', '-', $slug);
                $term = get_term_by('slug', $alt, 'nv_cliente');
            }
            if (!$term || is_wp_error($term)) {
                $errors[] = ['cliente_slug' => $slug, 'error' => 'Cliente no encontrado'];
                continue;
            }

            // ¿Existe ya una publicación para este cliente en esta fecha exacta?
            if ($skip_existing) {
                $existing = self::find_existing_publication($term->term_id, $fecha);
                if ($existing) {
                    $skipped[] = ['cliente_slug' => $term->slug, 'cliente_name' => $term->name, 'reason' => 'exists', 'existing_post_id' => $existing];
                    continue;
                }
            }

            // Generar copy con AI si hay key, si no dejar campos vacíos
            $ai_data = null;
            $ai_error = null;
            if ($use_ai) {
                // v1.0.27: pasar opciones de estilo de imagen a la AI para que genere
                // los campos extra (headline, dato, cta) cuando corresponda
                $ai_result = self::generar_copy_para_cliente($term, $fecha, $tipo, $redes, $tema, $api_key, $modelo, $img_opts);
                if (is_wp_error($ai_result)) {
                    $ai_error = $ai_result->get_error_message();
                } else {
                    $ai_data = $ai_result;
                }
            }

            // Crear el post
            // v1.0.24: post_status='publish' para que aparezca en el calendario
            //          inmediatamente. nv_estado sigue siendo 'borrador'.
            // v1.0.34: pero se crea como 'draft' PRIMERO (invisible al calendario)
            //          y se transiciona a 'publish' al final, después de tener todas
            //          las metas asignadas. Si el script se corta a mitad por
            //          timeout del hosting, el post queda como borrador en vez de
            //          como publicación huérfana sin fecha (que ensuciaba el calendario).
            $titulo = self::build_titulo_multi_cliente($tema, $term->name);
            $post_id = wp_insert_post([
                'post_type'    => 'nv_publicacion',
                'post_title'   => $titulo,
                'post_status'  => 'draft', // v1.0.34: empieza como draft
                'post_content' => '',
            ], true);

            if (is_wp_error($post_id) || !$post_id) {
                $errors[] = [
                    'cliente_slug' => $term->slug,
                    'error' => 'wp_insert_post falló: ' . (is_wp_error($post_id) ? $post_id->get_error_message() : 'unknown'),
                ];
                continue;
            }

            // Asignar cliente (taxonomía)
            wp_set_object_terms($post_id, [$term->term_id], 'nv_cliente', false);

            // ACF fields
            update_field('nv_fecha_publicacion', $fecha, $post_id);
            update_field('nv_tipo', $tipo, $post_id);
            update_field('nv_redes', $redes, $post_id);
            update_field('nv_estado', 'borrador', $post_id);

            if ($ai_data) {
                if (!empty($ai_data['copy']))          update_field('nv_copy', $ai_data['copy'], $post_id);
                if (!empty($ai_data['hashtags']))      update_field('nv_hashtags', $ai_data['hashtags'], $post_id);
                if (!empty($ai_data['first_comment']))update_field('nv_first_comment', $ai_data['first_comment'], $post_id);
                // v1.0.27: campos extra para overlays en imagen (post_meta hidden, prefijo _)
                update_post_meta($post_id, '_nv_headline',       (string) ($ai_data['headline'] ?? ''));
                // v1.0.38: jerarquía tipográfica por líneas (lo realmente usado por el renderer)
                if (!empty($ai_data['headline_lines']) && is_array($ai_data['headline_lines'])) {
                    update_post_meta($post_id, '_nv_headline_lines', wp_json_encode($ai_data['headline_lines'], JSON_UNESCAPED_UNICODE)); // v1.0.56 (ver línea 1577)
                }
                update_post_meta($post_id, '_nv_dato_destacado', (string) ($ai_data['dato_destacado'] ?? ''));
                update_post_meta($post_id, '_nv_cta_visible',    (string) ($ai_data['cta_visible'] ?? ''));
                // v1.0.28 + v1.0.33: guía de estilo. Si la cache estaba disponible, ya no la
                // pedimos a la AI (ahorro de vision); en su lugar copiamos la cacheada al post_meta.
                $cached_for_post = class_exists('NV_Cliente_Meta') ? NV_Cliente_Meta::get_style_guide_cached($term->term_id) : '';
                $cache_is_fresh  = class_exists('NV_Cliente_Meta') ? !NV_Cliente_Meta::is_style_guide_stale($term->term_id) : false;
                if (!empty($cached_for_post) && $cache_is_fresh) {
                    update_post_meta($post_id, '_nv_image_style_guide', $cached_for_post);
                } else {
                    update_post_meta($post_id, '_nv_image_style_guide', (string) ($ai_data['image_style_guide'] ?? ''));
                }
                // v1.0.36: image_prompt completo (lo más importante para variedad visual)
                $img_prompt_ai = (string) ($ai_data['image_prompt'] ?? '');
                if (!empty($img_prompt_ai)) {
                    update_post_meta($post_id, '_nv_image_prompt', $img_prompt_ai);
                }
                // v1.0.36: posición y alineación del texto sobre la imagen (sin chrome)
                $tp = (string) ($ai_data['text_placement'] ?? '');
                if (in_array($tp, ['top', 'center', 'bottom'], true)) {
                    update_post_meta($post_id, '_nv_text_placement', $tp);
                }
                $ta = (string) ($ai_data['text_align'] ?? '');
                if (in_array($ta, ['left', 'center', 'right'], true)) {
                    update_post_meta($post_id, '_nv_text_align', $ta);
                }
                // v1.0.59: persistir ref_relevance (puntuación 0-100 por tipo)
                if (!empty($ai_data['ref_relevance']) && is_array($ai_data['ref_relevance'])) {
                    update_post_meta($post_id, '_nv_ref_relevance', wp_json_encode($ai_data['ref_relevance']));
                }
            }
            // v1.0.27: persistir flags de imagen como meta para que la fase 2 los lea sin que la JS los reenvíe
            update_post_meta($post_id, '_nv_img_opts', wp_json_encode($img_opts));

            // v1.0.34: AHORA que tenemos todo asignado, transicionar a publish.
            // Si el script crasheó antes de aquí, el post queda como draft
            // (visible en WP Admin → Publicaciones, invisible al calendario).
            wp_update_post(['ID' => $post_id, 'post_status' => 'publish']);

            // v1.0.25: Generación de imagen server-side
            // v1.0.25-fix: tolerar first_comment vacío (cae en fallback al copy en build_image_prompt).
            // El error siempre se devuelve en image_error para que el JS lo muestre.
            $image_data = null;
            $image_error = null;
            if ($generate_image && $ai_data) {
                @set_time_limit(180);
                $brand_brief = class_exists('NV_Cliente_Meta') ? NV_Cliente_Meta::get_brand_brief($term->term_id) : '';
                $first_for_img = !empty($ai_data['first_comment']) ? $ai_data['first_comment'] : '';

                // v1.0.59: si NO hay forced_types explícitos pero SÍ hay percent_targets,
                // computar forced_types para ESTE post comparando su ref_relevance con umbral.
                // Heurístico: umbral_min = 100 - pct (clamped 30-90).
                // Ej: pct=30 → umbral=70 → solo posts con ref_relevance>=70 llevan ese tipo.
                $effective_forced_types = $forced_types;
                if (empty($effective_forced_types) && !empty($percent_targets)) {
                    $relevance = !empty($ai_data['ref_relevance']) && is_array($ai_data['ref_relevance'])
                        ? $ai_data['ref_relevance']
                        : [];
                    foreach ($percent_targets as $type => $pct) {
                        $score = isset($relevance[$type]) ? (int) $relevance[$type] : 0;
                        // umbral con clamping para evitar extremos:
                        //  pct=100 → umbral=30 (casi todos pasan)
                        //  pct=50  → umbral=50
                        //  pct=10  → umbral=90
                        //  pct=0   → umbral=999 (nunca pasa, ya filtrado arriba)
                        // v1.0.62: pct=100 → umbral 0 (TODOS los posts pasan, incluso ref_relevance bajo).
                        // pct<100 → mantenemos clamp inferior 30 para evitar incluir posts irrelevantes.
                        $threshold = 100 - $pct;
                        if ($pct >= 100) {
                            $threshold = 0; // 100% significa "todos los posts" — sin filtrar por relevancia
                        } else {
                            if ($threshold < 30) $threshold = 30;
                            if ($threshold > 90) $threshold = 90;
                        }
                        if ($score >= $threshold) {
                            $effective_forced_types[] = $type;
                        }
                    }
                    $effective_forced_types = array_values(array_unique($effective_forced_types));
                    if (!empty($effective_forced_types)) {
                        update_post_meta($post_id, '_nv_image_pct_resolved', wp_json_encode([
                            'percent_targets' => $percent_targets,
                            'relevance' => $relevance,
                            'resolved' => $effective_forced_types,
                        ]));
                    }
                }

                $img_result = self::generate_image_for_post($post_id, $term, $tipo, $ai_data['copy'], $first_for_img, $brand_brief, $image_quality, $refs_fidelity_override, $effective_forced_types);
                if (is_wp_error($img_result)) {
                    $image_error = $img_result->get_error_message();
                } else {
                    $image_data = $img_result;
                }
            } elseif ($generate_image && !$ai_data) {
                $image_error = 'No se generó imagen porque el copy IA falló (' . ($ai_error ? $ai_error : 'sin detalles') . ')';
            }

            $created[] = [
                'post_id'             => $post_id,
                'cliente_slug'        => $term->slug,
                'cliente_name'        => $term->name,
                'title'               => $titulo,
                'edit_url'            => get_edit_post_link($post_id, ''),
                'ai_used'             => (bool) $ai_data,
                'ai_error'            => $ai_error,
                'image_generated'     => (bool) $image_data,
                'image_url'           => $image_data ? $image_data['asset_url'] : null,
                'image_attachment_id' => $image_data ? $image_data['attachment_id'] : null,
                'image_error'         => $image_error,
            ];
        }

        return rest_ensure_response([
            'success' => true,
            'fecha'   => $fecha,
            'tipo'    => $tipo,
            'tema'    => $tema,
            'created' => $created,
            'skipped' => $skipped,
            'errors'  => $errors,
        ]);
    }

    /**
     * Busca si ya existe una publicación de ese cliente en esa fecha exacta.
     * @return int|null  post_id si existe, null si no
     */
    private static function find_existing_publication($term_id, $fecha) {
        $posts = get_posts([
            'post_type'   => 'nv_publicacion',
            'post_status' => ['draft', 'publish', 'pending'],
            'numberposts' => 1,
            'fields'      => 'ids',
            'tax_query'   => [[
                'taxonomy' => 'nv_cliente',
                'field'    => 'term_id',
                'terms'    => $term_id,
            ]],
            'meta_query'  => [[
                'key'   => 'nv_fecha_publicacion',
                'value' => $fecha,
            ]],
        ]);
        return !empty($posts) ? (int) $posts[0] : null;
    }

    private static function build_titulo_multi_cliente($tema, $cliente_name) {
        // Limita longitud y limpia. Tema "Día de la madre — felicitación cálida" → "Día de la madre — Clínica March"
        $tema_short = trim($tema);
        if (mb_strlen($tema_short) > 60) {
            $tema_short = mb_substr($tema_short, 0, 57) . '…';
        }
        // Si el tema tiene un guion largo o un punto, cortar ahí
        if (preg_match('/^([^—\.]+?)\s*[—\.]/u', $tema_short, $m)) {
            $tema_short = trim($m[1]);
        }
        return $tema_short . ' — ' . $cliente_name;
    }

    /**
     * Genera copy + hashtags + sugerencia visual para un cliente concreto vía Anthropic.
     * @return array|WP_Error  { copy, hashtags, first_comment }
     */
    private static function generar_copy_para_cliente($term, $fecha, $tipo, $redes, $tema, $api_key, $modelo, $img_opts = []) {
        $brand_brief = class_exists('NV_Cliente_Meta') ? NV_Cliente_Meta::get_brand_brief($term->term_id) : '';
        if (empty($brand_brief)) {
            $brand_brief = '(sin brief específico — adapta el tono según lo que sugiera el nombre del cliente)';
        }

        // v1.0.27: opciones de estilo de imagen — controlan qué campos extra pide a la IA
        $want_headline = !empty($img_opts['add_text']);
        $want_data     = !empty($img_opts['add_data']);
        $want_cta      = !empty($img_opts['add_cta']);
        $tone_emotivo  = !empty($img_opts['tone_emotivo']);
        $tone_comercial= !empty($img_opts['tone_comercial']);

        // v1.0.28 + v1.0.33: priorizar cache de guía de estilo. Si existe, NO mandamos
        // las imágenes a vision (lento) — usamos el texto cacheado y la llamada Anthropic
        // se hace text-only (mucho más rápida, ~5s vs ~15s).
        $cached_guide = class_exists('NV_Cliente_Meta') ? NV_Cliente_Meta::get_style_guide_cached($term->term_id) : '';
        $guide_stale  = class_exists('NV_Cliente_Meta') ? NV_Cliente_Meta::is_style_guide_stale($term->term_id) : false;
        $use_cached_guide = !empty($cached_guide) && !$guide_stale;

        // Si NO hay cache pero sí hay refs, cargarlas para enviar a vision (ruta fallback)
        $ref_image_blocks = [];
        if (!$use_cached_guide && class_exists('NV_Cliente_Meta')) {
            $has_refs_uploaded = !empty(NV_Cliente_Meta::get_reference_images($term->term_id));
            if ($has_refs_uploaded) {
                $ref_image_blocks = self::prepare_reference_images_for_anthropic($term->term_id);
            }
        }
        $has_refs = !empty($ref_image_blocks);

        // Día de la semana en español para que la AI lo tenga en cuenta
        $dias_es = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
        $dia_idx = (int) date('w', strtotime($fecha));
        $dia_nombre = $dias_es[$dia_idx] ?? '';

        $redes_str = is_array($redes) ? implode(', ', $redes) : (string) $redes;

        $system_prompt  = "Eres redactor profesional senior y DIRECTOR DE ARTE de Negocio Vivo, agencia de marketing digital especializada en Costa del Sol y resto de España. ";
        $system_prompt .= "Tu trabajo tiene DOS partes: (a) escribir el copy del post con tono propio según el brief de marca, y (b) PENSAR COMO DIRECTOR DE ARTE — concebir una escena visual ESPECÍFICA y ÚNICA para esta publicación, no genérica. ";
        $system_prompt .= "REGLA CRÍTICA DE VARIEDAD VISUAL: cada publicación debe tener un concepto visual DISTINTO al resto. NO repitas escenas obvias del sector del cliente (ej: para una mudanzas, no salgas siempre con la misma caja siendo levantada; para una clínica, no salgas siempre con un médico de bata sonriendo a cámara). Pregúntate: ¿qué escena CONCRETA representa visualmente ESTE TEMA específico? ¿Qué subjects, qué acción, qué momento, qué emoción? ";
        $system_prompt .= "Ejemplos del tipo de pensamiento esperado: ";
        $system_prompt .= "[Cliente=mudanzas, tema='Día del Trabajador'] → escena: grupo de empleados con uniforme de la empresa sonriendo dando el OK con el pulgar al aire libre frente a un camión (NO un trabajador genérico levantando una caja). ";
        $system_prompt .= "[Cliente=clínica estética, tema='Lunes motivación'] → escena: detalle macro de manos cuidando piel con luz de mañana (NO una doctora mirando una tablet). ";
        $system_prompt .= "[Cliente=despacho legal, tema='Reforma laboral 2026'] → escena: documento con sello sobre mesa de despacho con luz cenital, DOF reducido (NO un abogado posando con corbata). ";
        if ($has_refs) {
            $system_prompt .= "Cuando recibas imágenes de referencia visual del cliente, analízalas para extraer su ADN visual (paleta de colores en hex, tipografía si es visible, estilo fotográfico, composición, mood) y reflejarlo en image_style_guide. ";
        }
        $system_prompt .= "Devuelves EXCLUSIVAMENTE JSON válido, sin markdown, sin explicaciones, sin texto fuera del JSON.";

        $user_prompt  = "CLIENTE\n";
        $user_prompt .= "Nombre: {$term->name}\n";
        if (!empty($term->description)) {
            $user_prompt .= "Descripción interna: {$term->description}\n";
        }
        $user_prompt .= "Brief de marca:\n{$brand_brief}\n";

        // v1.0.33: si hay cache, inyectarlo como texto (NO se pide image_style_guide a la AI ahora)
        if ($use_cached_guide) {
            $user_prompt .= "\nGuía de estilo visual cacheada (extraída previamente de las refs visuales del cliente, en inglés):\n" . $cached_guide . "\n";
            $user_prompt .= "→ Esta guía ya está procesada. NO necesitas devolverla en el JSON.\n";
        } elseif ($has_refs) {
            $user_prompt .= "\nIMÁGENES DE REFERENCIA: te he adjuntado " . count($ref_image_blocks) . " imagen(es) de referencia visual de este cliente. Analízalas para entender su estilo visual real y úsalas para construir el image_style_guide.\n";
        }
        $user_prompt .= "\n";

        $user_prompt .= "PUBLICACIÓN A CREAR\n";
        $user_prompt .= "Fecha: {$fecha} ({$dia_nombre})\n";
        $user_prompt .= "Tipo: {$tipo}\n";
        $user_prompt .= "Redes: {$redes_str}\n";
        $user_prompt .= "Tema/brief del responsable: {$tema}\n";
        if ($tone_emotivo)  $user_prompt .= "Tono solicitado: EMOTIVO — cálido, humano, conexión emocional, evita lenguaje comercial directo.\n";
        if ($tone_comercial) $user_prompt .= "Tono solicitado: COMERCIAL — destaca beneficios, urgencia, llamada a actuar, lenguaje directo.\n";
        $user_prompt .= "\n";

        $user_prompt .= "INSTRUCCIONES\n";
        $user_prompt .= "1. copy (180-260 palabras): español, tono propio del cliente según su brief. Incluye CTA al final si procede.\n";
        $user_prompt .= "2. hashtags (12-15): mezcla de branded del cliente + topic del tema + ubicación si aplica.\n";
        $user_prompt .= "3. first_comment: una frase descriptiva de la imagen ideal, empezando con \"Sugerencia visual:\".\n";

        $extra_fields_json = '';
        if ($want_headline) {
            // v1.0.38: jerarquía tipográfica por líneas con estilo individual.
            // En lugar de un string plano, pedimos al AI que componga el titular como
            // una serie de líneas, cada una con su tamaño, color y peso. Esto permite
            // resultados como Image 2 (CLÍNICA grande blanco / MARCH grande dorado /
            // CUIDAMOS DE TÍ mediano blanco), no como Image 1 (texto plano).
            $user_prompt .= "4. headline_lines (ARRAY de líneas con estilo individual): compón el titular como UNA SERIE DE LÍNEAS con jerarquía tipográfica. Cada línea es un objeto {text, size, color, weight}.\n";
            $user_prompt .= "   - text: máx 1-3 palabras por línea (excepto líneas pequeñas que pueden tener más). EVITA palabras de más de 12 letras. Sin emojis.\n";
            $user_prompt .= "   - size: \"sm\" (conector, ej: 'EN', 'PARA') | \"md\" (frase secundaria, ej: 'CUIDAMOS DE TI') | \"lg\" (palabra principal) | \"xl\" (palabra hero, máximo impacto, suele ser la marca o el verbo principal). Default md.\n";
            $user_prompt .= "   - color: \"white\" (default, blanco para legibilidad sobre fondo) | \"accent\" (color de acento del cliente, USAR PARA DESTACAR el nombre de marca o palabra clave) | \"primary\" (color primario del cliente). \n";
            $user_prompt .= "   - weight: \"regular\" (default) | \"bold\" (negrita, usar para xl y palabras clave).\n";
            $user_prompt .= "   REGLA CRÍTICA: identifica EL NOMBRE DE MARCA del cliente (ej: 'MARCH' en Clínica March, 'REVA' en Guardamuebles Reva, 'NV' en Negocio Vivo) y dale {size:xl, color:accent, weight:bold} para que destaque. El resto se compone alrededor con jerarquía.\n";
            $user_prompt .= "   EJEMPLOS DE COMPOSICIÓN (sigue este patrón de jerarquía):\n";
            $user_prompt .= "   [Clínica March, post de bienvenida]: [{\"text\":\"EN\",\"size\":\"sm\"},{\"text\":\"CLÍNICA\",\"size\":\"xl\",\"weight\":\"bold\"},{\"text\":\"MARCH\",\"size\":\"xl\",\"weight\":\"bold\",\"color\":\"accent\"},{\"text\":\"CUIDAMOS DE TI\",\"size\":\"md\"}]\n";
            $user_prompt .= "   [Guardamuebles Reva, día del trabajador]: [{\"text\":\"FELICIDADES\",\"size\":\"md\"},{\"text\":\"EQUIPO\",\"size\":\"xl\",\"weight\":\"bold\",\"color\":\"accent\"},{\"text\":\"REVA\",\"size\":\"xl\",\"weight\":\"bold\"}]\n";
            $user_prompt .= "   [RSAdvocats, asesoría laboral]: [{\"text\":\"REFORMA\",\"size\":\"lg\",\"weight\":\"bold\"},{\"text\":\"LABORAL\",\"size\":\"lg\",\"weight\":\"bold\",\"color\":\"accent\"},{\"text\":\"TE LO EXPLICAMOS\",\"size\":\"sm\"}]\n";
            $user_prompt .= "   Mayúsculas para impacto editorial. 2-4 líneas. La AI varía el patrón según el tema (no siempre 'EN [marca]').\n";
            $extra_fields_json .= ', "headline_lines": [{"text":"...", "size":"sm|md|lg|xl", "color":"white|accent|primary", "weight":"regular|bold"}]';
        }
        if ($want_data) {
            $user_prompt .= "5. dato_destacado (1 línea corta, español): cifra, hito o estadística breve y cierta relacionada con el cliente o el tema. Ejemplos: \"+15 años de experiencia\", \"5★ Google\", \"Más de 1.000 clientes\". Si no hay un dato verificable, devuelve cadena vacía.\n";
            $extra_fields_json .= ', "dato_destacado": "..."';
        }
        if ($want_cta) {
            $user_prompt .= "6. cta_visible (1-3 palabras, español): call-to-action breve para botón visual. Ejemplos: \"Reserva ya\", \"Llámanos hoy\", \"Pide cita\".\n";
            $extra_fields_json .= ', "cta_visible": "..."';
        }
        if ($has_refs) {
            $user_prompt .= "7. image_style_guide (EN INGLÉS, 80-180 palabras): guía visual detallada extraída de las imágenes de referencia adjuntas, formateada para usarla como prompt de un generador de imagen text-to-image (gpt-image-2). Incluye: paleta de colores exactos en hex (ej: \"primary palette: #2A4D6E warm navy, #D2A039 gold accent, #F5F1E8 cream background\"), estilo fotográfico (ej: \"soft natural lighting, shallow depth of field, candid portraits\"), composición típica (ej: \"centered subject, rule of thirds, ample negative space\"), mood (ej: \"warm, professional, aspirational\"). Sé específico y concreto, evita términos genéricos como \"professional\" sin contexto. Esta guía se inyecta literalmente en el prompt de imagen, así que escríbela en inglés directo y útil.\n";
            $extra_fields_json .= ', "image_style_guide": "..."';
        }

        // v1.0.36: campo CRÍTICO — el image_prompt completo. Es lo que hace que las
        // publicaciones del mismo cliente NO salgan todas iguales. Aquí la AI piensa
        // como director de arte y propone una escena ESPECÍFICA para este tema.
        $user_prompt .= "8. image_prompt (EN INGLÉS, 140-260 palabras, OBLIGATORIO): el prompt COMPLETO que se enviará a gpt-image-2 para generar la imagen de esta publicación. NO es un resumen, es el prompt entero, listo para usar.\n";
        $user_prompt .= "   ESTRUCTURA esperada del prompt (en este orden, en una sola descripción fluida):\n";
        $user_prompt .= "   a) ESCENA CONCRETA Y ESPECÍFICA del tema (subjects exactos, acción, momento, lugar). Pensad como director de arte: ¿qué escena, dentro del universo del cliente, REPRESENTA ESTE TEMA mejor? Diferente para cada post.\n";
        $user_prompt .= "   b) Composición y framing (close-up / medium shot / wide; rule of thirds; ángulo de cámara).\n";
        $user_prompt .= "   c) Iluminación específica (golden hour, soft window light, dramatic side light, etc.).\n";
        $user_prompt .= "   d) Estilo fotográfico (editorial, documentary, lifestyle, product photography, etc.).\n";
        $user_prompt .= "   e) Paleta de colores en hex (heredada del image_style_guide o de la guía cacheada del cliente).\n";
        $user_prompt .= "   f) Mood / emoción que transmite la escena.\n";
        $user_prompt .= "   ▼ g0) PERSONA EN ESCENA — REGLA CRÍTICA (v1.0.58):\n";
        $user_prompt .= "      Si el copy o el headline_lines mencionan EXPLÍCITAMENTE a una persona específica (nombre propio como Rochar, o roles como CEO, doctor/a, fundador/a, director/a, especialista, cirujano/a) Y/O usan lenguaje de atención directa primera persona (\"te escucho\", \"te cuido\", \"te atiende\", \"cuidamos de ti\", \"contigo\"), entonces:\n";
        $user_prompt .= "        · El sujeto principal de la escena DEBE ser esa persona (rostro visible, mirada hacia cámara o ligeramente desviada, expresión coherente con el copy).\n";
        $user_prompt .= "        · NO sustituyas la persona por una escena alternativa (manos, instrumental, pasillo de clínica, instalaciones). Eso falsifica el mensaje del copy: si el copy dice 'Rochar te escucha', la imagen DEBE mostrar a Rochar, no a dos manos genéricas.\n";
        $user_prompt .= "        · La text safe zone (g) sigue aplicándose: la persona ocupa el tercio opuesto al texto, no se solapan.\n";
        $user_prompt .= "      Si el copy NO menciona persona específica ni usa lenguaje de atención directa (ej: \"nuestras instalaciones de última generación\", \"tecnología avanzada\", mensajes generales de marca), entonces sí puedes proponer escenas conceptuales (instrumental, instalaciones, productos, manos en detalle, paisajes) — esa variedad es deseable cuando el copy lo permite.\n";
        $user_prompt .= "   g) ▼▼▼ TEXT SAFE ZONE — REGLA CRÍTICA, NO OPCIONAL ▼▼▼\n";
        $user_prompt .= "      ANTES de escribir la escena, decide MENTALMENTE dónde irá el sujeto principal y dónde irá el bloque de texto. NUNCA pueden coincidir.\n";
        $user_prompt .= "      Workflow obligatorio:\n";
        $user_prompt .= "        1. Identifica el sujeto principal de la escena (la persona/objeto/acción que comunica el tema).\n";
        $user_prompt .= "        2. Decide en qué TERCIO del frame irá ese sujeto (top / center / bottom).\n";
        $user_prompt .= "        3. text_placement = el TERCIO OPUESTO. Si el sujeto va arriba → texto abajo; si va abajo → texto arriba; si va al centro → reserva un costado o la franja inferior según composición.\n";
        $user_prompt .= "        4. Cuando escribas image_prompt, INCLUYE explícitamente y con detalle la text safe zone como una INSTRUCCIÓN DE COMPOSICIÓN, no un comentario añadido.\n";
        $user_prompt .= "      EJEMPLOS de cómo redactar la text safe zone DENTRO del image_prompt (NO los pegues literales — adáptalos a tu escena):\n";
        $user_prompt .= "        · Si text_placement=bottom: \"...The subject occupies the upper two-thirds of the frame using rule-of-thirds composition. The bottom 35% of the frame is intentionally kept visually quiet: out-of-focus floor surface OR soft bokeh OR plain neutral wall — explicitly NO subjects, NO faces, NO hands, NO product close-ups, NO signage, NO focal elements in that bottom strip. Shallow depth of field with that area defocused.\"\n";
        $user_prompt .= "        · Si text_placement=top: \"...The subject sits in the lower two-thirds of the frame. The top 30-35% of the frame must be visually empty: clear sky OR ceiling OR softly defocused background OR negative wall space — strictly NO subjects, NO heads, NO hands, NO objects, NO labels visible in that upper band.\"\n";
        $user_prompt .= "        · Si text_placement=center y el formato lo permite (ej. cuadrado): describe un wide shot con el sujeto a un lado del frame y el centro como aire negativo (cielo, agua, fondo plano, depth of field). Centro es la opción menos recomendada — prefiere top o bottom.\n";
        $user_prompt .= "      VOCABULARIO ÚTIL para la text safe zone (en INGLÉS): \"visually quiet\", \"intentionally empty\", \"defocused background\", \"out-of-focus\", \"shallow depth of field with that area blurred\", \"soft gradient wall\", \"clear sky\", \"open negative space\", \"no focal elements\", \"no faces\", \"no hands\", \"no product close-ups\", \"no readable signage\".\n";
        $user_prompt .= "      ANTI-PATRÓN (lo que produjo bugs en versiones anteriores): NO escribas solo \"ample empty negative space at the bottom for text overlay\" — eso es genérico y la IA igual mete el sujeto ahí. La regla es PROHIBIR explícitamente sujetos/caras/manos/elementos focales en esa zona.\n";
        $user_prompt .= "   h) Anti-cliché: si el sector tiene un cliché (mudanzas=caja, clínica=bata, abogado=corbata, restaurante=plato perfecto centrado), EVÍTALO conscientemente. Busca un ángulo no obvio.\n";
        $user_prompt .= "   i) NO incluyas texto a renderizar dentro de la imagen (\"screen blurred, no readable text\" — el texto se compone después con código).\n";
        $user_prompt .= "   j) Photographic realism, no illustrations, no cartoons, no AI-art look.\n";
        $extra_fields_json .= ', "image_prompt": "..."';

        // v1.0.59: puntuación de relevancia por tipo de ref.
        // Cada post se puntúa 0-100 en cada categoría según cuánto el COPY/escena
        // beneficiaría de tener una ref de ese tipo en la imagen.
        // Usamos esto en multi-cliente para asignar refs por TOP X según %.
        $user_prompt .= "11. ref_relevance (objeto JSON): puntúa de 0 a 100 cuánto se beneficiaría esta publicación de incluir una imagen de cada tipo en la composición. Sé honesto: si el copy menciona al CEO/director por nombre, persona_destacada=90+. Si es un mensaje genérico de marca, persona_destacada=20-40. Si el copy habla de instalaciones o el local, instalaciones=80+. Si describe un producto concreto, productos=90+. Si es un mensaje sobre el equipo o trabajadores, equipo=70+. Si es testimonial o caso de éxito, pacientes_usuarios=70+. Las puntuaciones son INDEPENDIENTES (no tienen que sumar 100). Devuelve los 5 campos siempre.\n";
        $extra_fields_json .= ', "ref_relevance": {"persona_destacada": 0-100, "equipo": 0-100, "instalaciones": 0-100, "pacientes_usuarios": 0-100, "productos": 0-100}';

        // v1.0.36: posición y alineación del texto sobre la imagen (sin chrome)
        if ($want_headline || $want_data || $want_cta) {
            $user_prompt .= "9. text_placement (top | center | bottom): dónde va el bloque de texto sobre la imagen. DEBE ser el tercio OPUESTO al sujeto principal, y el image_prompt que escribes en (8) DEBE haber prohibido explícitamente cualquier sujeto/cara/mano/elemento focal en esa zona. Si no estás seguro de esto último, vuelve a (8) y refuérzalo. Por defecto bottom (en imágenes verticales 4:5/9:16 el sujeto suele ir arriba), pero si el visual es un paisaje, una vista panorámica o un producto colocado en mesa, top puede ser mejor.\n";
            $user_prompt .= "10. text_align (left | center | right): alineación del texto. Center es lo más equilibrado pero left puede dar look editorial; usa right solo si la composición de la imagen lo justifica.\n";
            $extra_fields_json .= ', "text_placement": "top|center|bottom", "text_align": "left|center|right"';
        }

        $user_prompt .= "\nDEVUELVE EXCLUSIVAMENTE JSON, sin markdown ni texto extra:\n";
        $user_prompt .= '{"copy": "...", "hashtags": "#hashtag1 #hashtag2 ...", "first_comment": "Sugerencia visual: ..."' . $extra_fields_json . '}';

        // v1.0.28: construir mensaje user con bloques: texto inicial + imágenes refs + texto final
        if ($has_refs) {
            // Anthropic acepta content como array de blocks (texto + imagen entremezclados)
            $user_content = array_merge(
                [['type' => 'text', 'text' => $user_prompt]],
                $ref_image_blocks
            );
        } else {
            $user_content = $user_prompt; // string directo, formato legacy compatible
        }

        $response = wp_remote_post('https://api.anthropic.com/v1/messages', [
            'timeout' => 120, // v1.0.28: más timeout porque vision lenta a veces
            'headers' => [
                'x-api-key' => $api_key,
                'anthropic-version' => '2023-06-01',
                'content-type' => 'application/json',
            ],
            'body' => wp_json_encode([
                'model'      => $modelo,
                'max_tokens' => 3500, // v1.0.36: más espacio para image_prompt detallado
                'system'     => $system_prompt,
                'messages'   => [
                    ['role' => 'user', 'content' => $user_content],
                ],
            ]),
        ]);

        if (is_wp_error($response)) {
            return new WP_Error('anthropic_network', 'Error de red al llamar a Anthropic: ' . $response->get_error_message());
        }

        $code = wp_remote_retrieve_response_code($response);
        $body = json_decode(wp_remote_retrieve_body($response), true);

        if ($code !== 200) {
            $msg = isset($body['error']['message']) ? $body['error']['message'] : 'HTTP ' . $code;
            return new WP_Error('anthropic_error', 'Anthropic API error: ' . $msg);
        }

        $texto = isset($body['content'][0]['text']) ? $body['content'][0]['text'] : '';
        if (empty($texto)) {
            return new WP_Error('empty_response', 'Anthropic devolvió respuesta vacía');
        }

        // Extraer JSON tolerante (a veces viene con ```json ... ```)
        $texto_limpio = $texto;
        if (preg_match('/```(?:json)?\s*(\{.+?\})\s*```/s', $texto, $m)) {
            $texto_limpio = $m[1];
        } elseif (preg_match('/\{.+\}/s', $texto, $m)) {
            $texto_limpio = $m[0];
        }
        $data = json_decode($texto_limpio, true);

        if (!is_array($data) || !isset($data['copy'])) {
            return new WP_Error('parse_error', 'No se pudo parsear el JSON de Anthropic. Respuesta: ' . substr($texto, 0, 200));
        }

        // v1.0.39: aceptar headline_lines como array O como string-JSON.
        // Algunos modelos serializan arrays anidados como string escapada cuando
        // hay anidación profunda. Decodificar defensivamente.
        $hl_raw_ai = $data['headline_lines'] ?? null;
        if (is_string($hl_raw_ai)) {
            $hl_parsed_ai = json_decode($hl_raw_ai, true);
            if (is_array($hl_parsed_ai)) $hl_raw_ai = $hl_parsed_ai;
        }
        $headline_lines_clean = (is_array($hl_raw_ai) && !empty($hl_raw_ai)) ? $hl_raw_ai : [];

        return [
            'copy'              => isset($data['copy']) ? (string) $data['copy'] : '',
            'hashtags'          => isset($data['hashtags']) ? (string) $data['hashtags'] : '',
            'first_comment'     => isset($data['first_comment']) ? (string) $data['first_comment'] : '',
            'headline'          => isset($data['headline']) ? (string) $data['headline'] : '',
            'headline_lines'    => $headline_lines_clean, // v1.0.38 + v1.0.39 (defensive parse)
            'dato_destacado'    => isset($data['dato_destacado']) ? (string) $data['dato_destacado'] : '',
            'cta_visible'       => isset($data['cta_visible']) ? (string) $data['cta_visible'] : '',
            'image_style_guide' => isset($data['image_style_guide']) ? (string) $data['image_style_guide'] : '',
            'image_prompt'      => isset($data['image_prompt']) ? (string) $data['image_prompt'] : '',
            'text_placement'    => isset($data['text_placement']) ? (string) $data['text_placement'] : '',
            'text_align'        => isset($data['text_align']) ? (string) $data['text_align'] : '',
        ];
    }

    // ─────────────────────────────────────────────────────────────────────
    // v1.0.25: Generación de imagen server-side para multi-cliente
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Resuelve el modelo de imagen configurado para un cliente.
     */
    private static function get_cliente_imagen_model($slug) {
        $por_cliente_json = get_option('nv_dashboard_modelo_imagen_por_cliente', '{}');
        $por_cliente = json_decode($por_cliente_json, true);
        if (!is_array($por_cliente)) $por_cliente = [];
        $modelo_default = get_option('nv_dashboard_modelo_imagen_default', 'seedream-v4-5-edit');
        return !empty($por_cliente[$slug]) ? $por_cliente[$slug] : $modelo_default;
    }

    /**
     * Genera la imagen para un post según el modelo configurado del cliente,
     * la sube a Media Library, la asocia como featured image y rellena nv_asset_url.
     *
     * @return array|WP_Error  { attachment_id, asset_url } o error
     */
    private static function generate_image_for_post($post_id, $term, $tipo, $copy, $first_comment, $brand_brief, $quality = 'medium', $refs_fidelity_override = null, $forced_types = []) {
        $modelo = self::get_cliente_imagen_model($term->slug);

        // v1.0.53: leer style_guide del post (cacheado por cliente o generado por la IA en el flujo de copy)
        $image_style_guide = (string) get_post_meta($post_id, '_nv_image_style_guide', true);
        // Fallback: si no hay style_guide en el post pero sí en el cliente, usarlo
        if ($image_style_guide === '' && class_exists('NV_Cliente_Meta')) {
            $image_style_guide = NV_Cliente_Meta::get_style_guide_cached($term->term_id);
        }

        // v1.0.53: fidelidad efectiva. Si el caller pasó override, usar; si no, default del cliente.
        $refs_fidelity = ($refs_fidelity_override === null)
            ? (class_exists('NV_Cliente_Meta') ? NV_Cliente_Meta::get_refs_fidelity($term->term_id) : 50)
            : (int) $refs_fidelity_override;

        // v1.0.55: text_placement decidido por la AI en Phase 1 (default 'bottom')
        $text_placement = (string) get_post_meta($post_id, '_nv_text_placement', true);
        if (!in_array($text_placement, ['top','center','bottom'], true)) $text_placement = 'bottom';

        $prompt = self::build_image_prompt_for_multi_cliente($term, $tipo, $copy, $first_comment, $brand_brief, $image_style_guide, $refs_fidelity, $text_placement);

        // v1.0.53: dejar trazabilidad — qué fidelidad y qué guía se usaron en este post
        update_post_meta($post_id, '_nv_image_refs_fidelity_used', $refs_fidelity);
        update_post_meta($post_id, '_nv_image_prompt_last', $prompt);

        if ($modelo === 'gpt-image-2') {
            // v1.0.57: pasar term_id + copy_hint para detección automática de refs.
            // Si el cliente tiene nv_reference_images Y el copy sugiere persona,
            // generate_image_via_openai usará /v1/images/edits con multipart.
            // Si no, sigue por /v1/images/generations puro como antes.
            $headline_hint = (string) get_post_meta($post_id, '_nv_headline', true);
            $hl_lines_raw = get_post_meta($post_id, '_nv_headline_lines', true);
            if (!empty($hl_lines_raw)) {
                $hl_decoded = is_string($hl_lines_raw) ? json_decode($hl_lines_raw, true) : null;
                if (is_array($hl_decoded)) {
                    foreach ($hl_decoded as $line) {
                        if (!empty($line['text'])) $headline_hint .= ' ' . $line['text'];
                    }
                }
            }
            $copy_hint = trim($copy . ' ' . $first_comment . ' ' . $headline_hint);
            $result = self::generate_image_via_openai($prompt, $tipo, $quality, (int) $term->term_id, $copy_hint, $forced_types);

            // Trazabilidad: persistir qué endpoint se usó y por qué
            if (!is_wp_error($result)) {
                if (!empty($result['endpoint_used'])) {
                    update_post_meta($post_id, '_nv_image_endpoint_used', $result['endpoint_used']);
                }
                if (!empty($result['used_refs'])) {
                    update_post_meta($post_id, '_nv_image_refs_used', wp_json_encode($result['used_refs']));
                }
                if (!empty($result['detection_reasons'])) {
                    update_post_meta($post_id, '_nv_image_refs_detection', wp_json_encode($result['detection_reasons']));
                }
                if (!empty($result['forced_types_applied'])) {
                    update_post_meta($post_id, '_nv_image_forced_types', wp_json_encode($result['forced_types_applied']));
                }
            }
        } elseif (in_array($modelo, ['seedream-v4-5-edit', 'mystic-2-5', 'gpt-1-5-high', 'nano-banana-pro'], true)) {
            // v1.0.71: pasamos term_id para que Freepik use el aspect_ratio del cliente
            $result = self::generate_image_via_freepik($prompt, $tipo, $modelo, (int) $term->term_id);
        } else {
            return new WP_Error('unknown_model', 'Modelo de imagen desconocido: ' . $modelo);
        }

        if (is_wp_error($result)) return $result;

        // Subir base64 a Media Library + asignar al post
        $upload = self::upload_b64_to_post($result['b64'], $post_id, 0);
        if (is_wp_error($upload)) return $upload;

        // Asignar como featured image + nv_asset_url (igual que openai_image_proxy con upload_to_post=true)
        update_field('nv_asset_url', $upload['asset_url'], $post_id);
        set_post_thumbnail($post_id, $upload['attachment_id']);

        // v1.0.50 — APLICAR OVERLAYS con brand_colors del cliente.
        // Antes este flujo NO aplicaba overlays — gpt-image-2 bakeaba texto blanco
        // por defecto y los colores brand del cliente (#C6C82F #505252 etc) no se
        // usaban nunca. Ahora los textos van encima con la tipografía y colores correctos.
        $stored_opts_raw = get_post_meta($post_id, '_nv_img_opts', true);
        $stored_opts = is_string($stored_opts_raw) ? json_decode($stored_opts_raw, true) : [];
        if (!is_array($stored_opts)) $stored_opts = [];
        $img_opts_overlay = array_merge(
            ['add_logo' => true, 'add_text' => true, 'add_data' => false, 'add_cta' => false],
            $stored_opts
        );
        // v1.0.71: garantizar dimensiones del cliente aunque no haya overlays
        $resize_warnings = self::ensure_image_matches_client_dimensions($post_id, $upload['attachment_id'], $term);
        $overlay_res = self::apply_overlays_to_attachment($post_id, $upload['attachment_id'], $term, $img_opts_overlay);
        if (!empty($resize_warnings) || !empty($overlay_res['warnings'])) {
            update_post_meta($post_id, '_nv_overlay_warnings', wp_json_encode(array_merge($resize_warnings, $overlay_res['warnings'])));
        }
        $upload['overlay_composited'] = (bool) ($overlay_res['composited'] ?? false);
        $upload['overlay_warnings']   = $overlay_res['warnings'];

        return $upload;
    }

    /**
     * Construye el prompt de generación de imagen a partir del contexto de la publicación.
     * v1.0.25-fix: si first_comment está vacío, usar el copy como fallback descriptivo.
     */
    private static function build_image_prompt_for_multi_cliente($term, $tipo, $copy, $first_comment, $brand_brief, $image_style_guide = '', $refs_fidelity = 50, $text_placement = 'bottom') {
        $aspect_desc = [
            'imagen'   => 'vertical 4:5 portrait orientation, optimized for Instagram and Facebook feed',
            'reel'     => 'vertical 9:16 portrait orientation, optimized for Instagram Reels and TikTok',
            'carrusel' => 'square 1:1 orientation, optimized for Instagram carousel',
            'story'    => 'vertical 9:16 portrait orientation, optimized for Instagram and Facebook stories',
            'video'    => 'horizontal 16:9 landscape orientation, optimized for YouTube and Facebook video',
        ];
        $aspect = isset($aspect_desc[$tipo]) ? $aspect_desc[$tipo] : 'square 1:1';

        // Extraer "sugerencia visual:" si viene con prefijo
        $clean_first = preg_replace('/^\s*sugerencia\s*visual\s*:\s*/iu', '', (string) $first_comment);
        $clean_first = trim($clean_first);

        // Fallback: si no hay sugerencia visual, derivar una mini-descripción del copy
        if (empty($clean_first) && !empty($copy)) {
            $copy_clean = trim(preg_replace('/\s+/', ' ', (string) $copy));
            $clean_first = mb_substr($copy_clean, 0, 240);
        }
        if (empty($clean_first)) {
            $clean_first = 'a representative scene related to the brand, no specific objects required';
        }

        $parts = [];
        $parts[] = 'Professional social media image for "' . $term->name . '".';
        $parts[] = $aspect . '.';
        $parts[] = 'Visual concept: ' . $clean_first;

        if (!empty($brand_brief)) {
            $brief_short = mb_substr(trim($brand_brief), 0, 350);
            $parts[] = 'Brand context: ' . $brief_short . '.';
        }

        // v1.0.53: inyectar la guía de estilo SEGÚN el slider de fidelidad a refs.
        // refs_fidelity: 0..100 (default 50)
        //  · 0-29  → libertad total: NO inyectar style_guide. Solo brand_brief y aspect.
        //  · 30-69 → inspiración suave: inyectar como "draw inspiration from"
        //  · 70-100 → replicación estricta: inyectar como "strictly replicate"
        $fidelity = (int) max(0, min(100, $refs_fidelity));
        $sg = trim((string) $image_style_guide);
        if ($sg !== '' && $fidelity >= 30) {
            $sg_short = mb_substr($sg, 0, 600);
            if ($fidelity >= 70) {
                $parts[] = 'STRICT VISUAL TEMPLATE — strictly replicate this brand pattern (composition, color blocks, badge/strip placement, typography hierarchy, photographic style): ' . $sg_short;
                $parts[] = 'Fidelity to template: ' . $fidelity . '%. Match the template as closely as possible.';
            } else {
                // 30-69
                $parts[] = 'Style inspiration (draw mood, palette and composition cues from this — do not copy literally): ' . $sg_short;
                $parts[] = 'Fidelity to references: ' . $fidelity . '% (soft inspiration only).';
            }
        }
        // Si fidelity < 30, NO inyectamos style_guide en absoluto. Libertad total.

        $parts[] = 'Style: high-quality professional photography, modern aesthetic, soft natural lighting, clean composition.';

        // v1.0.55: TEXT SAFE ZONE — instrucciones detalladas según text_placement.
        // El bug que esto resuelve: si pides "ample empty space at the bottom",
        // gpt-image-2 puede igual meter manos/caras/elementos focales en esa zona.
        // La regla CRÍTICA es PROHIBIR explícitamente esos elementos en la zona reservada.
        $tp = in_array($text_placement, ['top','center','bottom'], true) ? $text_placement : 'bottom';
        switch ($tp) {
            case 'top':
                $parts[] = 'TEXT SAFE ZONE — CRITICAL COMPOSITION RULE: Place the main subject in the lower two-thirds of the frame (rule of thirds). The TOP 35% of the frame must be visually empty and intentionally quiet. That top band can be: clear sky, ceiling, soft gradient wall, defocused background with shallow depth of field, or open negative space. STRICTLY NO subjects, NO heads, NO faces, NO hands, NO product close-ups, NO focal elements, NO readable signage, NO logos, NO objects in that top 35%. The eye must travel from empty top → main subject in the lower portion.';
                break;
            case 'center':
                $parts[] = 'TEXT SAFE ZONE — CRITICAL COMPOSITION RULE: Frame as a wide shot with the main subject placed to one side (left or right third). The HORIZONTAL CENTER BAND (middle 35% of the frame height) must be visually empty: defocused background, sky, water, plain wall, soft bokeh. STRICTLY NO subjects, NO faces, NO hands, NO focal elements, NO readable signage in the center horizontal band.';
                break;
            case 'bottom':
            default:
                $parts[] = 'TEXT SAFE ZONE — CRITICAL COMPOSITION RULE: Place the main subject in the upper two-thirds of the frame (rule of thirds). The BOTTOM 35% of the frame must be visually empty and intentionally quiet. That bottom band can be: out-of-focus floor surface, soft bokeh, plain neutral wall, defocused background with shallow depth of field, or open negative space. STRICTLY NO subjects, NO faces, NO hands, NO product close-ups, NO focal elements, NO readable signage, NO logos, NO objects in that bottom 35%. The bottom band exists ONLY to receive overlay text in post-processing — keep it visually quiet.';
                break;
        }
        $parts[] = 'This text safe zone rule overrides any other compositional preference. If in doubt, prioritize keeping the safe zone empty over filling the frame.';

        // v1.0.50: ABSOLUTAMENTE prohibido texto en la imagen, sea cual sea el tipo.
        // Antes (v1.0.49) reel/story permitían "Optional minimal text overlay" — eso causaba
        // que gpt-image-2 bakeaba títulos en blanco/gris IGNORANDO los brand_colors del cliente.
        // El texto se compone DESPUÉS con PHP/GD usando los brand_colors correctos.
        $parts[] = 'CRITICAL: ABSOLUTELY NO TEXT, NO LETTERS, NO WORDS, NO NUMBERS, NO TYPOGRAPHY, NO LOGOS, NO WATERMARKS, NO SIGNS, NO READABLE TEXT in the image. Pure visual composition only — any title or copy will be overlaid in post-processing with proper brand colors. If text appears anywhere in the frame (signs, screens, posters, labels), keep it blurred and unreadable.';

        return implode(' ', $parts);
    }

    /**
     * Llama a OpenAI con gpt-image-2.
     *
     * v1.0.57: Soporte automático de imágenes de referencia del cliente.
     *
     * Si el cliente tiene `nv_reference_images` (attachments locales) Y la escena
     * (copy/headline) sugiere que se necesita una persona reconocible (CEO,
     * doctor, director, "te escucho"...), pasa hasta 4 fotos como `image[]=` a
     * `/v1/images/edits`. Esto da consistencia de cara entre publicaciones del
     * mismo cliente (Rochar saldrá parecido al real, no genérico).
     *
     * Si la escena NO necesita persona específica (escenas conceptuales: manos,
     * instrumental, instalaciones), va por `/v1/images/generations` puro como
     * antes — esto preserva la variedad visual del calendario.
     *
     * Detección de "necesita persona": busca palabras clave en el copy/headline
     * pasados al método (Rochar, doctor/a, médico/a, director/a, CEO, fundador,
     * dueño, "te escucho/cuido/atiendo", consulta, atención personalizada...).
     * Es un heurístico simple pero efectivo basado en el patrón real de copy.
     *
     * Si el cliente no tiene refs configuradas, va siempre por /generations
     * (comportamiento legacy v1.0.55, sin cambios).
     *
     * @param string $prompt          Prompt completo
     * @param string $tipo            'imagen' / 'reel' / 'carrusel' / 'story' / 'video'
     * @param string $quality         'low' / 'medium' / 'high'
     * @param int    $term_id_cliente Term ID del cliente (para leer nv_reference_images)
     * @param string $copy_hint       Texto del copy + headline para detectar si necesita persona
     * @return array|WP_Error  { b64, used_refs (array IDs), endpoint_used } o error
     */
    private static function generate_image_via_openai($prompt, $tipo, $quality, $term_id_cliente = 0, $copy_hint = '', $forced_types = []) {
        $openai_key = get_option('nv_dashboard_openai_api_key', '');
        if (empty($openai_key)) {
            return new WP_Error('no_openai_key', 'OpenAI API key no configurada en NV Dashboard → Configuración');
        }

        // v1.0.71: prioridad al size del cliente si tiene dimensiones custom configuradas.
        // OpenAI gpt-image-2 solo acepta 1024x1024 / 1024x1536 / 1536x1024 — get_openai_size_for_dimensions
        // elige el más cercano al ratio del cliente. El resize final al tamaño exacto
        // lo hace composite_overlays_on_image() en post-procesado.
        $size = null;
        // Si hay un override activo (request "adaptar-formato") y coincide con este cliente, usarlo.
        if (is_array(self::$dimension_override) && (int) self::$dimension_override['term_id'] === (int) $term_id_cliente) {
            $size = NV_Cliente_Meta::get_openai_size_for_dimensions(
                (int) self::$dimension_override['width'],
                (int) self::$dimension_override['height']
            );
        }
        if (!$size && $term_id_cliente > 0 && class_exists('NV_Cliente_Meta')) {
            $dim = NV_Cliente_Meta::get_dimensions_for_tipo($term_id_cliente, $tipo);
            if (!empty($dim['width']) && !empty($dim['height'])) {
                $size = NV_Cliente_Meta::get_openai_size_for_dimensions($dim['width'], $dim['height']);
            }
        }
        if (!$size) {
            // Fallback al mapa estático (compat pre-v1.0.71)
            $size_map = [
                'imagen'   => '1024x1536',
                'reel'     => '1024x1536',
                'carrusel' => '1024x1024',
                'story'    => '1024x1536',
                'video'    => '1536x1024',
            ];
            $size = isset($size_map[$tipo]) ? $size_map[$tipo] : '1024x1024';
        }

        // ─── DETECCIÓN AUTOMÁTICA DE REFS (v1.0.57) ───
        // Solo se activa si:
        //   1) cliente tiene nv_reference_images cargadas
        //   2) el copy/headline sugiere que la escena necesita persona reconocible
        //
        // v1.0.59: NUEVO — si $forced_types contiene tipos explícitos
        // (['persona_destacada'], ['equipo','instalaciones'], etc.), bypassa el
        // heurístico y usa SOLO refs de esos tipos. El prompt también recibe
        // refuerzo textual para asegurar que el sujeto es del tipo forzado.
        $ref_attachment_ids = [];
        $needs_person = false;
        $detection_reasons = [];
        $forced_types_applied = []; // qué tipos se usaron realmente

        if ($term_id_cliente > 0 && class_exists('NV_Cliente_Meta')) {
            // v1.0.59: si forced_types está set, filtrar refs por esos tipos
            // v1.0.67: descartar tipos que no tengan refs subidas — si pides "equipo"
            // pero no hay refs de equipo, NO usamos refs de otros tipos como fallback
            // (eso producía caras de Rochar inventadas como "equipo"). Mejor que el plugin
            // caiga al modo /generations puro y registre el warning para que el operador
            // suba las fotos del tipo que falta.
            if (!empty($forced_types) && is_array($forced_types)) {
                $valid = ['persona_destacada', 'equipo', 'instalaciones', 'pacientes_usuarios', 'productos', 'logo_brand', 'general'];
                $clean_types = array_values(array_intersect($forced_types, $valid));
                if (!empty($clean_types)) {
                    $available_types = [];
                    $missing_types = [];
                    foreach ($clean_types as $t) {
                        $ids_t = NV_Cliente_Meta::get_reference_images_by_type($term_id_cliente, [$t]);
                        if (!empty($ids_t)) $available_types[] = $t;
                        else $missing_types[] = $t;
                    }
                    if (!empty($available_types)) {
                        // v1.0.69: SELECCIÓN BALANCEADA — antes (v1.0.68) se cogían las
                        // refs en orden de aparición, lo que dejaba fuera personas con menos
                        // fotos cuando se llegaba al cap. Ej: 3 fotos Rochar + 1 Angie + 1 Ana +
                        // 5 instalaciones = 10 refs. Cap=8 cogía Rochar(3)+Angie(1)+Local(4)
                        // dejando a Ana fuera. Resultado: gpt-image-2 inventaba la cara de Ana
                        // copiando Rochar.
                        //
                        // Ahora seleccionamos en rondas: para tipos de persona, priorizamos
                        // 1 foto por person_name único antes de añadir 2as fotos. Para
                        // instalaciones/productos, sin person_name, también ronda igualitaria.
                        $ref_attachment_ids = self::pick_balanced_refs(
                            $term_id_cliente,
                            $available_types,
                            ($n_types_forced = count($available_types)) >= 3 ? 8 : ($n_types_forced === 2 ? 6 : 4)
                        );
                        $forced_types_applied = $available_types;
                        $needs_person = !empty($ref_attachment_ids);
                        $detection_reasons[] = 'forced_types:' . implode(',', $available_types);
                        $detection_reasons[] = 'balanced_pick:' . count($ref_attachment_ids);
                    }
                    if (!empty($missing_types)) {
                        $detection_reasons[] = 'WARNING_missing_refs_for_types:' . implode(',', $missing_types);
                    }
                    if (empty($available_types)) {
                        $ref_attachment_ids = [];
                        $detection_reasons[] = 'FALLBACK_to_generations_no_refs_available';
                    }
                }
            } else {
                // Modo automático (heurístico) — comportamiento v1.0.57
                $ref_attachment_ids = NV_Cliente_Meta::get_reference_images($term_id_cliente);
                // Cap mínimo en automático
                if (count($ref_attachment_ids) > 4) {
                    $ref_attachment_ids = array_slice($ref_attachment_ids, 0, 4);
                }
            }
        }

        // El heurístico de keywords solo aplica en modo automático
        if (empty($forced_types_applied) && !empty($ref_attachment_ids) && !empty($copy_hint)) {
            // Heurístico: ¿menciona el copy una persona reconocible o atención directa?
            $hint_lower = mb_strtolower($copy_hint, 'UTF-8');
            // Detección 1: nombre del cliente o de personas conocidas en el copy
            $person_keywords = [
                'rochar', 'director', 'directora', 'doctor', 'doctora', 'médico', 'medica',
                'dr.', 'dra.', 'ceo', 'fundador', 'fundadora', 'dueño', 'dueña',
                'experto', 'experta', 'especialista', 'cirujano', 'cirujana',
            ];
            // Detección 2: lenguaje de atención directa 1-a-1 (persona en escena)
            $service_keywords = [
                'te escucho', 'te escucha', 'te cuida', 'te cuido', 'te atiende',
                'te atiendo', 'consulta', 'atención personalizada', 'cuidamos de ti',
                'cuidamos de tí', 'te acompaña', 'te acompaño', 'contigo',
            ];
            // Detección 3: anti-patrón — escenas que explícitamente NO son de persona
            $object_keywords = [
                'instalaciones', 'instrumental', 'producto', 'productos',
                'manos cuidando', 'detalle macro', 'caja', 'cajas',
            ];

            foreach ($person_keywords as $kw) {
                if (mb_strpos($hint_lower, $kw) !== false) {
                    $needs_person = true;
                    $detection_reasons[] = "person_keyword:$kw";
                    break;
                }
            }
            if (!$needs_person) {
                foreach ($service_keywords as $kw) {
                    if (mb_strpos($hint_lower, $kw) !== false) {
                        $needs_person = true;
                        $detection_reasons[] = "service_keyword:$kw";
                        break;
                    }
                }
            }
            // Si el copy es claramente de objetos/escena, NO usar refs aunque haya
            // matched person_keywords (anti-patrón gana)
            if ($needs_person) {
                foreach ($object_keywords as $kw) {
                    if (mb_strpos($hint_lower, $kw) !== false) {
                        $needs_person = false;
                        $detection_reasons[] = "BLOCKED_BY_object_keyword:$kw";
                        break;
                    }
                }
            }
        }

        $use_edits = $needs_person && !empty($ref_attachment_ids);

        // v1.0.62: refuerzo del prompt cuando hay tipos forzados.
        //
        // BUG observado en v1.0.61: aunque se pasaban refs vía /edits, el
        // image_prompt de Phase 1 podía describir "manos", "mujer joven", etc.
        // (cuando la AI puntuó persona_destacada bajo). Resultado: prompt detallado
        // de la AI ganaba sobre el prefijo simple → la cara de Rochar no aparecía.
        //
        // Solución: SANDWICH (prefix fuerte ANTES + suffix imperativo DESPUÉS).
        // gpt-image-2 procesa todo el prompt; el suffix al final tiene gran peso.
        if ($use_edits && !empty($forced_types_applied)) {
            // v1.0.68: contar personas reales por tipo (basándonos en refs efectivamente
            // pasadas) para que el prompt sandwich indique cuántas personas EXACTAS
            // debe haber en la imagen. Esto evita que gpt-image-2 invente "team of 5-7"
            // cuando solo hay 3 fotos de equipo reales.
            $person_count = 0;
            $person_types_used = ['persona_destacada', 'equipo', 'pacientes_usuarios'];
            if ($term_id_cliente > 0 && class_exists('NV_Cliente_Meta')) {
                $items = NV_Cliente_Meta::get_reference_images_typed($term_id_cliente);
                $unique_persons = [];
                foreach ($items as $it) {
                    if (!in_array($it['type'], $person_types_used, true)) continue;
                    if (!in_array($it['type'], $forced_types_applied, true)) continue;
                    // Si tiene person_name → contar por nombre único; si no → contar por id (como persona distinta)
                    $key = !empty($it['person_name']) ? mb_strtolower($it['person_name']) : ('id_' . $it['id']);
                    $unique_persons[$key] = true;
                }
                $person_count = count($unique_persons);
            }

            $count_clause = '';
            if ($person_count > 0 && array_intersect(['persona_destacada','equipo','pacientes_usuarios'], $forced_types_applied)) {
                if ($person_count === 1) {
                    $count_clause = " The image must show EXACTLY 1 person from the reference photos — not 2, not 3, just 1.";
                } else {
                    $count_clause = " The image must show EXACTLY {$person_count} people from the reference photos — not more, not less. If the scene description suggests more people (e.g. 'team of 5-7 professionals', 'group of medical staff', 'crowd'), IGNORE that and show exactly {$person_count} people.";
                }
            }

            $type_subject_map = [
                'persona_destacada'  => 'CRITICAL OVERRIDE — SUBJECT REQUIREMENT: The single main subject of this image MUST be the specific person shown in the reference photos provided. Reproduce their EXACT face from the references (eyes, nose, mouth, beard, hair). Do NOT invent a different person, do NOT replace them with a generic model, do NOT show only hands or anonymous figures. ',
                'equipo'             => 'CRITICAL OVERRIDE — SUBJECT REQUIREMENT: The subjects MUST be the SAME PEOPLE shown in the reference photos provided. Reproduce their EXACT faces from the references. Do NOT invent additional team members. Do NOT add extras, background figures, or fillers. The team consists of the people in the references AND ONLY those people. ',
                'instalaciones'      => 'CRITICAL OVERRIDE — SETTING REQUIREMENT: The setting MUST be the actual facility shown in the reference photos. Reproduce its architecture, color palette and ambiance. ',
                'pacientes_usuarios' => 'CRITICAL OVERRIDE — SUBJECT REQUIREMENT: A patient/user matching the demographic in the reference photos. ',
                'productos'          => 'CRITICAL OVERRIDE — PRODUCT REQUIREMENT: The product MUST match exactly the product in the reference photos. ',
                'general'            => '',
            ];
            $type_suffix_map = [
                'persona_destacada'  => "\n\nFINAL ENFORCEMENT — read this last: The protagonist is the person from the reference photos. If the scene description suggests a different subject, REPLACE that subject with them. Their face must be visible and recognizable.",
                'equipo'             => "\n\nFINAL ENFORCEMENT — read this last: The team members in the image are EXACTLY those shown in the reference photos.{$count_clause} Reproduce each person's face from their reference photo. Do NOT add anyone who isn't in the references. Do NOT 'fill in' empty space with invented colleagues. Do NOT duplicate the same person — each person from the references must appear exactly once.",
                'instalaciones'      => "\n\nFINAL ENFORCEMENT: the setting is the facility from the reference photos.",
                'pacientes_usuarios' => "\n\nFINAL ENFORCEMENT: the subject is a patient matching the reference photos demographic.",
                'productos'          => "\n\nFINAL ENFORCEMENT: the product is the one in the reference photos.",
                'general'            => '',
            ];
            $prefix = '';
            $suffix = '';
            foreach ($forced_types_applied as $t) {
                if (!empty($type_subject_map[$t])) $prefix .= $type_subject_map[$t];
                if (!empty($type_suffix_map[$t]))  $suffix .= $type_suffix_map[$t];
            }
            // v1.0.68: si no hay clausula explícita de equipo pero forced_types incluye CEO+otra persona, añadir count
            if (in_array('persona_destacada', $forced_types_applied, true) && $count_clause !== '' && strpos($suffix, 'EXACTLY') === false) {
                $suffix .= "\n\nPERSON COUNT:{$count_clause}";
            }
            if ($prefix !== '' || $suffix !== '') {
                $prompt = $prefix . "\n\nSCENE DESCRIPTION:\n" . $prompt . $suffix;
            }
        }

        // ─── Construir request según el modo ───
        $endpoint = $use_edits
            ? 'https://api.openai.com/v1/images/edits'
            : 'https://api.openai.com/v1/images/generations';

        if (!$use_edits) {
            // ───── /v1/images/generations — texto puro, escena conceptual ─────
            $request_body = wp_json_encode([
                'model'   => 'gpt-image-2',
                'prompt'  => $prompt,
                'size'    => $size,
                'quality' => $quality,
                'n'       => 1,
            ]);
            $request_args = [
                'timeout' => 180,
                'headers' => [
                    'Authorization' => 'Bearer ' . $openai_key,
                    'Content-Type'  => 'application/json',
                ],
                'body' => $request_body,
            ];
        } else {
            // ───── /v1/images/edits — multipart con refs locales como image[] ─────
            // Replica el comportamiento del botón "🎨 Generar imágenes con Claude"
            // (openai_image_proxy con operation=edit) automatizado en el calendario.
            $boundary = wp_generate_password(24, false);
            $crlf     = "\r\n";
            $body     = '';

            $append_field = function($name, $value) use (&$body, $boundary, $crlf) {
                $body .= '--' . $boundary . $crlf;
                $body .= 'Content-Disposition: form-data; name="' . $name . '"' . $crlf . $crlf;
                $body .= $value . $crlf;
            };
            $append_file = function($name, $filename, $mime, $data) use (&$body, $boundary, $crlf) {
                $body .= '--' . $boundary . $crlf;
                $body .= 'Content-Disposition: form-data; name="' . $name . '"; filename="' . $filename . '"' . $crlf;
                $body .= 'Content-Type: ' . $mime . $crlf . $crlf;
                $body .= $data . $crlf;
            };

            $append_field('model',   'gpt-image-2');
            $append_field('prompt',  $prompt);
            $append_field('size',    $size);
            $append_field('quality', $quality);
            $append_field('n',       '1');

            $field_name = (count($ref_attachment_ids) > 1) ? 'image[]' : 'image';
            $attached   = 0;
            foreach ($ref_attachment_ids as $idx => $att_id) {
                $path = get_attached_file($att_id);
                if (!$path || !file_exists($path)) continue;

                $data = @file_get_contents($path);
                if ($data === false || empty($data)) continue;

                $mime = function_exists('mime_content_type') ? @mime_content_type($path) : 'image/png';
                if (!is_string($mime)) $mime = 'image/png';
                $mime = preg_replace('/;.*$/', '', $mime);

                $allowed = ['image/png', 'image/jpeg', 'image/webp'];
                if (!in_array($mime, $allowed, true)) $mime = 'image/png';

                $ext_map = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
                $ext = $ext_map[$mime] ?? 'png';

                $append_file($field_name, 'ref-' . $idx . '.' . $ext, $mime, $data);
                $attached++;
            }

            // Si por algún motivo no se pudo adjuntar ninguna ref (archivos perdidos),
            // caer a /generations en vez de fallar.
            if ($attached === 0) {
                $use_edits = false;
                $endpoint  = 'https://api.openai.com/v1/images/generations';
                $detection_reasons[] = 'FALLBACK_no_files_attached';
                $request_body = wp_json_encode([
                    'model'   => 'gpt-image-2',
                    'prompt'  => $prompt,
                    'size'    => $size,
                    'quality' => $quality,
                    'n'       => 1,
                ]);
                $request_args = [
                    'timeout' => 180,
                    'headers' => [
                        'Authorization' => 'Bearer ' . $openai_key,
                        'Content-Type'  => 'application/json',
                    ],
                    'body' => $request_body,
                ];
            } else {
                $body .= '--' . $boundary . '--' . $crlf;
                $request_args = [
                    'timeout' => 180,
                    'headers' => [
                        'Authorization' => 'Bearer ' . $openai_key,
                        'Content-Type'  => 'multipart/form-data; boundary=' . $boundary,
                    ],
                    'body' => $body,
                ];
            }
        }

        @set_time_limit(300);
        $resp = wp_remote_post($endpoint, $request_args);

        // v1.0.37: retry una vez en HTTP 5xx transitorio (incluido Cloudflare 520-527)
        $retry_codes = [500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527];
        if (!is_wp_error($resp)) {
            $resp_code = wp_remote_retrieve_response_code($resp);
            if (in_array($resp_code, $retry_codes, true)) {
                sleep(2);
                @set_time_limit(300);
                $resp = wp_remote_post($endpoint, $request_args);
            }
        }

        if (is_wp_error($resp)) {
            return new WP_Error('openai_network', 'OpenAI request failed: ' . $resp->get_error_message());
        }
        $code = wp_remote_retrieve_response_code($resp);
        $body_resp = json_decode(wp_remote_retrieve_body($resp), true);
        if ($code !== 200) {
            $msg = isset($body_resp['error']['message']) ? $body_resp['error']['message'] : 'HTTP ' . $code;
            $endpoint_used = $use_edits ? 'edits' : 'generations';
            return new WP_Error('openai_error', 'OpenAI error (' . $endpoint_used . '): ' . $msg);
        }
        if (empty($body_resp['data'][0]['b64_json'])) {
            return new WP_Error('invalid_openai_response', 'OpenAI no devolvió b64_json');
        }

        return [
            'b64'                  => $body_resp['data'][0]['b64_json'],
            'used_refs'            => $use_edits ? $ref_attachment_ids : [],
            'endpoint_used'        => $use_edits ? 'edits' : 'generations',
            'detection_reasons'    => $detection_reasons,
            'forced_types_applied' => $forced_types_applied, // v1.0.59
        ];
    }

    /**
     * v1.0.69: Selección balanceada de refs por tipo y persona.
     *
     * Antes el plugin cogía las refs en orden de aparición en el storage. Si una persona
     * tenía 3 fotos y otra 1, al alcanzar el cap se quedaban las 3 de la primera persona
     * y la otra fuera. Resultado: gpt-image-2 inventaba la cara faltante copiando otra
     * persona presente.
     *
     * Esta función reparte el cap usando rondas:
     *   Ronda 1: 1 foto por cada person_name único de cada tipo + 1 foto de cada
     *            tipo sin nombre (instalaciones, productos, general).
     *   Ronda 2+: añade 2as fotos de los mismos cubos hasta llegar al cap.
     *
     * Garantiza que TODAS las personas con nombre y todos los tipos solicitados están
     * representados antes de duplicar.
     *
     * @param int $term_id_cliente
     * @param array $types  Tipos a incluir (subset de forced_types_applied)
     * @param int $cap      Máximo de refs a devolver
     * @return int[]        Array de attachment IDs balanceados
     */
    private static function pick_balanced_refs($term_id_cliente, $types, $cap) {
        if ($term_id_cliente <= 0 || empty($types) || $cap <= 0 || !class_exists('NV_Cliente_Meta')) {
            return [];
        }
        $items = NV_Cliente_Meta::get_reference_images_typed($term_id_cliente);
        if (empty($items)) return [];

        // Agrupar por "bucket": para tipos de persona el bucket es type+person_name;
        // para tipos sin persona el bucket es solo type.
        $person_capable = ['persona_destacada', 'equipo', 'pacientes_usuarios'];
        $buckets = []; // bucket_key => [id1, id2, ...]
        foreach ($items as $it) {
            if (!in_array($it['type'], $types, true)) continue;
            if (in_array($it['type'], $person_capable, true)) {
                $name = !empty($it['person_name']) ? mb_strtolower($it['person_name']) : 'noname_' . $it['id'];
                $key = $it['type'] . '|' . $name;
            } else {
                $key = $it['type'];
            }
            if (!isset($buckets[$key])) $buckets[$key] = [];
            $buckets[$key][] = (int) $it['id'];
        }

        if (empty($buckets)) return [];

        // Selección por rondas
        $result = [];
        $bucket_keys = array_keys($buckets);
        $bucket_pos = array_fill_keys($bucket_keys, 0);
        $made_progress = true;
        while (count($result) < $cap && $made_progress) {
            $made_progress = false;
            foreach ($bucket_keys as $key) {
                if (count($result) >= $cap) break 2;
                $pos = $bucket_pos[$key];
                if ($pos < count($buckets[$key])) {
                    $result[] = $buckets[$key][$pos];
                    $bucket_pos[$key]++;
                    $made_progress = true;
                }
            }
        }
        return $result;
    }

    /**
     * Llama a Freepik según el modelo configurado.
     * Freepik devuelve URLs (no base64), así que descargamos y convertimos a b64.
     *
     * @return array|WP_Error  { b64 } o error
     */
    private static function generate_image_via_freepik($prompt, $tipo, $modelo, $term_id_cliente = 0) {
        $freepik_key = get_option('nv_dashboard_freepik_api_key', '');
        if (empty($freepik_key)) {
            return new WP_Error('no_freepik_key', 'Freepik API key no configurada (NV Dashboard → Configuración → 🔑 Freepik API key). El cliente usa "' . $modelo . '" que es modelo Freepik.');
        }

        // v1.0.71: prioridad al aspect ratio del cliente si tiene dimensiones custom.
        $aspect = null;
        // Override puntual de adaptar-formato
        if (is_array(self::$dimension_override) && (int) self::$dimension_override['term_id'] === (int) $term_id_cliente) {
            $aspect = NV_Cliente_Meta::get_freepik_aspect_for_dimensions(
                (int) self::$dimension_override['width'],
                (int) self::$dimension_override['height']
            );
        }
        if (!$aspect && $term_id_cliente > 0 && class_exists('NV_Cliente_Meta')) {
            $dim = NV_Cliente_Meta::get_dimensions_for_tipo($term_id_cliente, $tipo);
            if (!empty($dim['width']) && !empty($dim['height'])) {
                $aspect = NV_Cliente_Meta::get_freepik_aspect_for_dimensions($dim['width'], $dim['height']);
            }
        }
        if (!$aspect) {
            // Fallback al mapa estático (compat pre-v1.0.71)
            $aspect_map = [
                'imagen'   => 'traditional_3_4',
                'reel'     => 'social_story_9_16',
                'carrusel' => 'square_1_1',
                'story'    => 'social_story_9_16',
                'video'    => 'widescreen_16_9',
            ];
            $aspect = isset($aspect_map[$tipo]) ? $aspect_map[$tipo] : 'square_1_1';
        }

        // Endpoint y body por modelo
        $url = '';
        $body = ['prompt' => $prompt, 'aspect_ratio' => $aspect];

        switch ($modelo) {
            case 'seedream-v4-5-edit':
                $url = 'https://api.freepik.com/v1/ai/text-to-image/seedream-v4-5-edit';
                $body['enable_safety_checker'] = true;
                break;
            case 'mystic-2-5':
                $url = 'https://api.freepik.com/v1/ai/mystic';
                $body['model'] = 'realism';
                break;
            case 'gpt-1-5-high':
                $url = 'https://api.freepik.com/v1/ai/text-to-image';
                $body['model'] = 'gpt-1-5-high';
                break;
            case 'nano-banana-pro':
                $url = 'https://api.freepik.com/v1/ai/text-to-image/google-nano-banana-pro';
                break;
            default:
                return new WP_Error('unknown_freepik_model', 'Modelo Freepik desconocido: ' . $modelo);
        }

        // Llamada inicial — Freepik usa un job-pattern: POST devuelve task_id, hay que poll
        $resp = wp_remote_post($url, [
            'timeout' => 60,
            'headers' => [
                'x-freepik-api-key' => $freepik_key,
                'Content-Type'      => 'application/json',
            ],
            'body' => wp_json_encode($body),
        ]);
        if (is_wp_error($resp)) {
            return new WP_Error('freepik_network', 'Freepik request failed: ' . $resp->get_error_message());
        }
        $code = wp_remote_retrieve_response_code($resp);
        $data = json_decode(wp_remote_retrieve_body($resp), true);
        if ($code < 200 || $code >= 300) {
            $msg = isset($data['message']) ? $data['message'] : 'HTTP ' . $code;
            return new WP_Error('freepik_error', 'Freepik error: ' . $msg);
        }

        // Caso 1: Freepik devuelve directamente la URL (algunos endpoints)
        $image_url = self::extract_freepik_image_url($data);

        // Caso 2: devuelve task_id, hay que poll
        if (empty($image_url) && !empty($data['data']['task_id'])) {
            $task_id = $data['data']['task_id'];
            $status_url = preg_replace('#(/v1/ai/[^?]+).*#', '$1/' . $task_id, $url);
            // Poll hasta 90s
            $start = time();
            while (time() - $start < 90) {
                sleep(3);
                $poll = wp_remote_get($status_url, [
                    'timeout' => 20,
                    'headers' => ['x-freepik-api-key' => $freepik_key],
                ]);
                if (is_wp_error($poll)) continue;
                $poll_data = json_decode(wp_remote_retrieve_body($poll), true);
                $status = isset($poll_data['data']['status']) ? $poll_data['data']['status'] : '';
                if (in_array($status, ['COMPLETED', 'completed'], true)) {
                    $image_url = self::extract_freepik_image_url($poll_data);
                    break;
                }
                if (in_array($status, ['FAILED', 'failed'], true)) {
                    return new WP_Error('freepik_failed', 'Freepik task failed: ' . wp_json_encode($poll_data));
                }
            }
        }

        if (empty($image_url)) {
            return new WP_Error('freepik_no_image', 'Freepik no devolvió URL de imagen tras 90s de polling');
        }

        // Descargar la imagen y convertir a base64
        $img_resp = wp_remote_get($image_url, ['timeout' => 30]);
        if (is_wp_error($img_resp) || wp_remote_retrieve_response_code($img_resp) !== 200) {
            return new WP_Error('freepik_download', 'No se pudo descargar imagen Freepik');
        }
        $img_bytes = wp_remote_retrieve_body($img_resp);
        return ['b64' => base64_encode($img_bytes)];
    }

    /**
     * Extrae la URL de imagen de la respuesta Freepik (varía según endpoint).
     */
    private static function extract_freepik_image_url($data) {
        if (!is_array($data)) return '';
        // Estructuras comunes:
        // - data.generated[0]
        // - data.images[0].url
        // - images[0]
        if (!empty($data['data']['generated']) && is_array($data['data']['generated'])) {
            $first = reset($data['data']['generated']);
            if (is_string($first)) return $first;
            if (is_array($first) && !empty($first['url'])) return $first['url'];
        }
        if (!empty($data['data']['images'][0]['url'])) return $data['data']['images'][0]['url'];
        if (!empty($data['images'][0])) {
            $first = $data['images'][0];
            return is_string($first) ? $first : (isset($first['url']) ? $first['url'] : '');
        }
        return '';
    }

    // ─────────────────────────────────────────────────────────────────────
    // v1.0.25: Generar imagen para una publicación (gpt-image-2 server-side)
    // ─────────────────────────────────────────────────────────────────────

    /**
     * POST /generar-imagen-publicacion/{id}
     *
     * Genera una imagen con gpt-image-2 (operation=generate, sin refs Drive)
     * basada en la sugerencia visual del post + brief de marca del cliente,
     * la sube a Media Library y la asocia al post como featured + nv_asset_url.
     *
     * Body JSON (todo opcional):
     *   - quality: "low" | "medium" | "high"  (default: "medium")
     *   - force:   bool  (default: false) — regenerar aunque ya tenga imagen
     */
    /**
     * v1.0.50 — Re-aplica overlay sobre la imagen YA generada del post.
     *
     * Toma la versión limpia (pre-overlay) guardada en _nv_attachment_pre_overlay,
     * la copia sobre el attachment actual, y aplica el overlay con los datos
     * actuales (brand_colors del cliente, headline_lines de post_meta, etc.).
     *
     * Útil cuando David cambia colores corporativos del cliente y quiere ver el
     * resultado SIN regenerar la imagen (ahorra 3-5 céntimos por intento).
     *
     * Si no existe versión pre-overlay (post antiguo, generado antes de v1.0.50),
     * devuelve un error claro pidiendo regenerar la imagen una vez.
     */
    public static function reaplicar_overlay_publicacion($request) {
        @set_time_limit(120);
        @ini_set('memory_limit', '512M');

        $post_id = (int) $request['id'];
        $post = get_post($post_id);
        if (!$post || $post->post_type !== 'nv_publicacion') {
            return new WP_Error('invalid_post', 'Publicación no encontrada', ['status' => 404]);
        }

        $attachment_id = (int) get_post_thumbnail_id($post_id);
        if (!$attachment_id) {
            return new WP_Error('no_attachment', 'La publicación no tiene imagen subida. Regenera la imagen primero.', ['status' => 400]);
        }

        $pre_overlay_path = (string) get_post_meta($post_id, '_nv_attachment_pre_overlay', true);
        $orig_path = get_attached_file($attachment_id);

        if (empty($pre_overlay_path) || !file_exists($pre_overlay_path)) {
            // Imagen generada antes de v1.0.50, sin backup. Tomamos el actual COMO si fuera
            // limpio — el overlay irá encima del texto que ya pueda tener gpt-image-2.
            // Avisamos para que David sepa que el resultado puede no ser limpio.
            return new WP_Error(
                'no_pre_overlay_backup',
                'Esta imagen se generó antes de v1.0.50 y no tiene versión limpia guardada. Para que el re-aplicar funcione bien, regenera la imagen una vez (ya con v1.0.50 instalado) y entonces los cambios de color funcionarán al instante.',
                ['status' => 409]
            );
        }

        $clientes_terms = wp_get_post_terms($post_id, 'nv_cliente', ['fields' => 'all']);
        $cliente = (!empty($clientes_terms) && !is_wp_error($clientes_terms)) ? $clientes_terms[0] : null;
        if (!$cliente) {
            return new WP_Error('no_cliente', 'La publicación no tiene cliente asignado', ['status' => 400]);
        }

        $stored_opts_raw = get_post_meta($post_id, '_nv_img_opts', true);
        $stored_opts = is_string($stored_opts_raw) ? json_decode($stored_opts_raw, true) : [];
        if (!is_array($stored_opts)) $stored_opts = [];
        $img_opts = array_merge(
            ['add_logo' => true, 'add_text' => true, 'add_data' => false, 'add_cta' => false],
            $stored_opts
        );

        // Llamar al helper — internamente se encarga de partir del backup limpio
        $res = self::apply_overlays_to_attachment($post_id, $attachment_id, $cliente, $img_opts);

        $brand_colors_used = NV_Cliente_Meta::get_brand_colors($cliente->term_id);

        return rest_ensure_response([
            'success'           => true,
            'post_id'           => $post_id,
            'attachment_id'     => $attachment_id,
            'asset_url'         => wp_get_attachment_url($attachment_id) . '?nv=' . time(), // cache-buster
            'composited'        => (bool) ($res['composited'] ?? false),
            'overlay_warnings'  => $res['warnings'] ?? [],
            'brand_colors_used' => $brand_colors_used,
            'pre_overlay_path'  => basename($pre_overlay_path),
        ]);
    }

    /**
     * v1.0.71: Adapta una publicación ya generada a otro formato (reel ↔ imagen ↔
     * carrusel ↔ story ↔ video) o a unas medidas libres. Re-llama al modelo de IA
     * con el prompt original guardado y el nuevo aspect ratio, sustituye el asset
     * principal y vuelve a aplicar overlays.
     *
     * Body JSON:
     *   {
     *     "tipo_target": "reel|imagen|carrusel|story|video",   // opcional si pasas width+height
     *     "width": 1080,                                          // opcional, override
     *     "height": 1920,                                         // opcional, override
     *     "quality": "low|medium|high"                            // opcional, default medium
     *   }
     */
    public static function adaptar_formato_publicacion($request) {
        @set_time_limit(300);
        @ini_set('memory_limit', '1024M');
        // v1.0.72: garantizar que PHP siga procesando aunque nginx cierre el proxy
        // a los 60s con 504. La generacion de OpenAI/Freepik suele tardar 30-90s
        // y el usuario vera la nueva imagen tras recargar.
        @ignore_user_abort(true);

        $post_id = (int) $request['id'];
        $post = get_post($post_id);
        if (!$post || $post->post_type !== 'nv_publicacion') {
            return new WP_Error('invalid_post', 'Publicación no encontrada', ['status' => 404]);
        }

        $params = $request->get_json_params() ?: [];
        $tipo_target = isset($params['tipo_target']) ? sanitize_text_field($params['tipo_target']) : '';
        $valid_tipos = ['imagen','reel','carrusel','story','video'];
        if ($tipo_target && !in_array($tipo_target, $valid_tipos, true)) {
            return new WP_Error('bad_tipo', 'tipo_target inválido. Esperado: imagen|reel|carrusel|story|video', ['status' => 400]);
        }
        $override_w = isset($params['width']) ? (int) $params['width'] : 0;
        $override_h = isset($params['height']) ? (int) $params['height'] : 0;
        if (!$tipo_target && ($override_w <= 0 || $override_h <= 0)) {
            return new WP_Error('bad_request', 'Debes indicar tipo_target o width+height', ['status' => 400]);
        }
        $quality = isset($params['quality']) ? sanitize_text_field($params['quality']) : 'medium';
        if (!in_array($quality, ['low','medium','high'], true)) $quality = 'medium';

        // Cliente
        $clientes_terms = wp_get_post_terms($post_id, 'nv_cliente', ['fields' => 'all']);
        $cliente = (!empty($clientes_terms) && !is_wp_error($clientes_terms)) ? $clientes_terms[0] : null;
        if (!$cliente) {
            return new WP_Error('no_cliente', 'La publicación no tiene cliente asignado', ['status' => 400]);
        }

        // Resolver tipo final + W/H final
        $tipo_actual = function_exists('get_field') ? (string) get_field('nv_tipo', $post_id) : 'imagen';
        if (!in_array($tipo_actual, $valid_tipos, true)) $tipo_actual = 'imagen';
        $tipo_final = $tipo_target ?: $tipo_actual;

        $client_dim = NV_Cliente_Meta::get_dimensions_for_tipo($cliente->term_id, $tipo_final);
        $final_w = $override_w > 0 ? $override_w : (int) $client_dim['width'];
        $final_h = $override_h > 0 ? $override_h : (int) $client_dim['height'];
        if ($final_w < 256 || $final_h < 256 || $final_w > 4096 || $final_h > 4096) {
            return new WP_Error('bad_dim', 'Dimensiones fuera de rango (256–4096)', ['status' => 400]);
        }

        // Recuperar prompt original o reconstruir
        $prompt = (string) get_post_meta($post_id, '_nv_image_prompt_last', true);
        if (empty($prompt)) {
            $prompt = (string) get_post_meta($post_id, '_nv_image_prompt', true);
        }
        if (empty($prompt)) {
            // Reconstruir mínimo a partir del copy / first_comment
            $copy = function_exists('get_field') ? (string) get_field('nv_copy', $post_id) : '';
            $first_comment = function_exists('get_field') ? (string) get_field('nv_first_comment', $post_id) : '';
            $brand_brief = class_exists('NV_Cliente_Meta') ? NV_Cliente_Meta::get_brand_brief($cliente->term_id) : '';
            $image_style_guide = class_exists('NV_Cliente_Meta') ? NV_Cliente_Meta::get_style_guide_cached($cliente->term_id) : '';
            $refs_fidelity = class_exists('NV_Cliente_Meta') ? NV_Cliente_Meta::get_refs_fidelity($cliente->term_id) : 50;
            $text_placement = (string) get_post_meta($post_id, '_nv_text_placement', true);
            if (!in_array($text_placement, ['top','center','bottom'], true)) $text_placement = 'bottom';
            $prompt = self::build_image_prompt_for_multi_cliente($cliente, $tipo_final, $copy, $first_comment, $brand_brief, $image_style_guide, $refs_fidelity, $text_placement);
        }

        // OVERRIDE TEMPORAL: hacer que get_dimensions_for_tipo devuelva las dimensiones
        // finales pedidas (para que generate_image_via_openai elija el size correcto
        // y el resize posterior recorte al tamaño exacto).
        // Lo implementamos guardando temporalmente el array en una propiedad estática
        // que generate_image_via_openai consulta antes que el term_meta.
        self::$dimension_override = [
            'term_id' => (int) $cliente->term_id,
            'tipo'    => $tipo_final,
            'width'   => $final_w,
            'height'  => $final_h,
        ];

        // Detectar copy hint para refs detection automática
        $copy_for_hint = function_exists('get_field') ? (string) get_field('nv_copy', $post_id) : '';
        $first_comment_hint = function_exists('get_field') ? (string) get_field('nv_first_comment', $post_id) : '';
        $headline_hint = (string) get_post_meta($post_id, '_nv_headline', true);
        $copy_hint = trim($copy_for_hint . ' ' . $first_comment_hint . ' ' . $headline_hint);

        $modelo = get_option('nv_dashboard_image_model_default', 'gpt-image-2');
        // Permitir override por cliente si existe
        if (class_exists('NV_Cliente_Meta')) {
            $cliente_modelo = (string) get_term_meta($cliente->term_id, 'nv_image_model', true);
            if (!empty($cliente_modelo)) $modelo = $cliente_modelo;
        }

        if ($modelo === 'gpt-image-2') {
            $result = self::generate_image_via_openai($prompt, $tipo_final, $quality, (int) $cliente->term_id, $copy_hint, []);
        } elseif (in_array($modelo, ['seedream-v4-5-edit', 'mystic-2-5', 'gpt-1-5-high', 'nano-banana-pro'], true)) {
            $result = self::generate_image_via_freepik($prompt, $tipo_final, $modelo, (int) $cliente->term_id);
        } else {
            self::$dimension_override = null;
            return new WP_Error('unknown_model', 'Modelo de imagen desconocido: ' . $modelo, ['status' => 500]);
        }

        if (is_wp_error($result)) {
            self::$dimension_override = null;
            return $result;
        }

        // Subir la nueva imagen como nuevo attachment
        $upload = self::upload_b64_to_post($result['b64'], $post_id, 0);
        if (is_wp_error($upload)) {
            self::$dimension_override = null;
            return $upload;
        }

        // Si el usuario cambió el tipo, persistirlo en ACF
        if ($tipo_target && $tipo_target !== $tipo_actual && function_exists('update_field')) {
            update_field('nv_tipo', $tipo_target, $post_id);
        }

        // Si el tipo cambió, actualizamos el meta de dimensiones temporalmente con
        // las medidas pedidas para que apply_overlays_to_attachment haga el resize
        // correcto. Después restauramos.
        // (No es necesario tocar el meta del cliente — el override está activo.)

        // Aplicar overlays + resize
        $stored_opts_raw = get_post_meta($post_id, '_nv_img_opts', true);
        $stored_opts = is_string($stored_opts_raw) ? json_decode($stored_opts_raw, true) : [];
        if (!is_array($stored_opts)) $stored_opts = [];
        $img_opts = array_merge(
            ['add_logo' => true, 'add_text' => true, 'add_data' => false, 'add_cta' => false],
            $stored_opts
        );

        // Borrar backup pre-overlay antiguo (era de la imagen vieja)
        $old_pre = (string) get_post_meta($post_id, '_nv_attachment_pre_overlay', true);
        if (!empty($old_pre) && file_exists($old_pre) && strpos($old_pre, '__pre-overlay.') !== false) {
            @unlink($old_pre);
        }
        delete_post_meta($post_id, '_nv_attachment_pre_overlay');

        $resize_warnings = self::ensure_image_matches_client_dimensions($post_id, $upload['attachment_id'], $cliente);
        $overlay_res = self::apply_overlays_to_attachment($post_id, $upload['attachment_id'], $cliente, $img_opts);

        // Asociar a la publicación
        if (function_exists('update_field')) {
            update_field('nv_asset_url', $upload['asset_url'], $post_id);
        }
        set_post_thumbnail($post_id, $upload['attachment_id']);

        self::$dimension_override = null;

        return rest_ensure_response([
            'success'        => true,
            'post_id'        => $post_id,
            'asset_url'      => $upload['asset_url'] . '?nv=' . time(),
            'attachment_id'  => $upload['attachment_id'],
            'tipo_anterior'  => $tipo_actual,
            'tipo_final'     => $tipo_final,
            'width'          => $final_w,
            'height'         => $final_h,
            'composited'     => (bool) ($overlay_res['composited'] ?? false),
            'warnings'       => array_merge($resize_warnings, $overlay_res['warnings'] ?? []),
        ]);
    }

    public static function generar_imagen_publicacion($request) {
        // v1.0.31: catcher de fatales PHP (memoria, etc.) — sin esto, un fatal
        // devuelve la página HTML 500 del servidor y el JS no sabe qué pasó.
        register_shutdown_function(function() {
            $err = error_get_last();
            if (!$err) return;
            if (!in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR, E_RECOVERABLE_ERROR], true)) return;
            error_log('[NV Dashboard v1.0.31] Fatal en generar_imagen_publicacion: ' . print_r($err, true) . ' / mem peak=' . memory_get_peak_usage(true));
            if (!headers_sent()) {
                http_response_code(500);
                header('Content-Type: application/json; charset=utf-8');
                $is_oom = stripos($err['message'], 'memory') !== false || stripos($err['message'], 'Allowed memory') !== false;
                $hint = $is_oom
                    ? ' — MEMORIA AGOTADA: el cliente tiene un logo o imagen muy grande. Pide al hosting subir memory_limit a 512M+, o reduce calidad a low/medium.'
                    : ' — fatal PHP, revisa el error_log del servidor para detalle.';
                echo wp_json_encode([
                    'code'    => 'php_fatal',
                    'message' => 'PHP fatal: ' . $err['message'] . ' en ' . basename($err['file']) . ':' . $err['line'] . $hint,
                    'data'    => ['status' => 500, 'mem_peak_mb' => round(memory_get_peak_usage(true)/1048576, 1)],
                ]);
            }
        });

        @ini_set('memory_limit', '1024M'); // v1.0.31: subido de 512M
        @set_time_limit(300);

        $post_id = (int) $request['id'];
        $post = get_post($post_id);
        if (!$post || $post->post_type !== 'nv_publicacion') {
            return new WP_Error('invalid_post', 'Publicación no encontrada', ['status' => 404]);
        }

        $params = $request->get_json_params() ?: [];
        $quality = isset($params['quality']) ? sanitize_text_field($params['quality']) : 'medium';
        if (!in_array($quality, ['low', 'medium', 'high'], true)) $quality = 'medium';
        $force = !empty($params['force']);

        // v1.0.53: fidelidad efectiva. Body wins; si no, default del cliente.
        $refs_fidelity = null;
        if (array_key_exists('refs_fidelity', $params) && $params['refs_fidelity'] !== '' && $params['refs_fidelity'] !== null) {
            $refs_fidelity = (int) $params['refs_fidelity'];
            if ($refs_fidelity < 0) $refs_fidelity = 0;
            if ($refs_fidelity > 100) $refs_fidelity = 100;
        }

        // Si ya tiene imagen y no es force, devolver la existente sin gastar API
        if (!$force) {
            $existing_url = function_exists('get_field') ? get_field('nv_asset_url', $post_id) : '';
            if (!empty($existing_url)) {
                return rest_ensure_response([
                    'success' => true,
                    'post_id' => $post_id,
                    'asset_url' => $existing_url,
                    'attachment_id' => get_post_thumbnail_id($post_id),
                    'reused' => true,
                ]);
            }
        }

        $openai_key = get_option('nv_dashboard_openai_api_key', '');
        if (empty($openai_key)) {
            return new WP_Error('no_openai_key', 'OpenAI API key no configurada en NV Dashboard → Configuración', ['status' => 500]);
        }

        // Recoger contexto del post
        $clientes_terms = wp_get_post_terms($post_id, 'nv_cliente', ['fields' => 'all']);
        $cliente = (!empty($clientes_terms) && !is_wp_error($clientes_terms)) ? $clientes_terms[0] : null;

        $tipo  = function_exists('get_field') ? (string) get_field('nv_tipo', $post_id) : 'imagen';
        $first_comment = function_exists('get_field') ? (string) get_field('nv_first_comment', $post_id) : '';
        $copy = function_exists('get_field') ? (string) get_field('nv_copy', $post_id) : '';
        $brand_brief = ($cliente && class_exists('NV_Cliente_Meta')) ? NV_Cliente_Meta::get_brand_brief($cliente->term_id) : '';

        // v1.0.27: opciones de overlay — body wins; si no, leer del meta del post
        $stored_opts_raw = get_post_meta($post_id, '_nv_img_opts', true);
        $stored_opts = is_string($stored_opts_raw) ? json_decode($stored_opts_raw, true) : [];
        if (!is_array($stored_opts)) $stored_opts = [];
        $defaults = ['add_logo' => true, 'add_text' => true, 'add_data' => false, 'add_cta' => false, 'tone_emotivo' => false, 'tone_comercial' => false];
        $img_opts = array_merge($defaults, $stored_opts);
        foreach (['add_logo','add_text','add_data','add_cta','tone_emotivo','tone_comercial'] as $k) {
            if (isset($params[$k])) $img_opts[$k] = (bool) $params[$k];
        }

        // Limpiar el "Sugerencia visual: " del primer comentario para que la AI lo lea como descripción
        $visual = $first_comment;
        if (preg_match('/^[\s\xc2\xa0]*Sugerencia visual:?\s*(.+)$/uis', $visual, $m)) {
            $visual = trim($m[1]);
        }

        // v1.0.36: SI la AI ha generado un image_prompt completo en Phase 1, lo usamos
        //          DIRECTAMENTE. Es la solución a la repetitividad — la AI piensa como
        //          director de arte y crea una escena ÚNICA por publicación. Solo si
        //          no hay (cliente sin Anthropic, posts antiguos, etc.) caemos al
        //          constructor genérico de abajo.
        $ai_image_prompt = (string) get_post_meta($post_id, '_nv_image_prompt', true);
        $text_placement_meta = (string) get_post_meta($post_id, '_nv_text_placement', true);
        if (!in_array($text_placement_meta, ['top','center','bottom'], true)) $text_placement_meta = 'bottom';

        // v1.0.55: helper local — devuelve la regla detallada de text safe zone según placement
        $build_safe_zone_clause = function($tp) {
            switch ($tp) {
                case 'top':
                    return ' TEXT SAFE ZONE — CRITICAL COMPOSITION RULE: Place the main subject in the lower two-thirds of the frame. The TOP 35% must be visually empty and intentionally quiet (clear sky, ceiling, soft gradient wall, defocused background, or open negative space). STRICTLY NO subjects, NO heads, NO faces, NO hands, NO product close-ups, NO focal elements, NO readable signage, NO logos, NO objects in that top 35%. This rule overrides any other compositional preference.';
                case 'center':
                    return ' TEXT SAFE ZONE — CRITICAL COMPOSITION RULE: Frame as wide shot with subject placed to one side. The HORIZONTAL CENTER BAND (middle 35% of frame height) must be visually empty (defocused background, sky, water, plain wall, soft bokeh). STRICTLY NO subjects, NO faces, NO hands, NO focal elements in the center band. This rule overrides any other compositional preference.';
                case 'bottom':
                default:
                    return ' TEXT SAFE ZONE — CRITICAL COMPOSITION RULE: Place the main subject in the upper two-thirds of the frame. The BOTTOM 35% must be visually empty and intentionally quiet (out-of-focus floor, soft bokeh, plain neutral wall, defocused background, or open negative space). STRICTLY NO subjects, NO faces, NO hands, NO product close-ups, NO focal elements, NO readable signage, NO logos, NO objects in that bottom 35%. This rule overrides any other compositional preference.';
            }
        };

        if (!empty($ai_image_prompt) && mb_strlen($ai_image_prompt) > 80) {
            $prompt = $ai_image_prompt;
            // Asegurar la regla anti-texto (a veces la AI se olvida)
            if (stripos($prompt, 'no text') === false && stripos($prompt, 'sin texto') === false && stripos($prompt, 'no readable text') === false) {
                $prompt .= ' No text, letters, words, numbers, watermarks, or logos in the image — all textual elements are added in post-processing. screen blurred, no readable text.';
            }
            // v1.0.55: si el prompt baked NO menciona explícitamente la text safe zone,
            // la añadimos al final con detalle. Esto cubre posts antiguos generados con
            // versiones del system prompt que no exigían la regla detallada.
            $has_safe_zone = stripos($prompt, 'text safe zone') !== false
                          || stripos($prompt, 'visually empty') !== false
                          || stripos($prompt, 'intentionally empty') !== false;
            if (!$has_safe_zone) {
                $prompt .= $build_safe_zone_clause($text_placement_meta);
            }
        } else {
            // ─── FALLBACK: prompt construido (modo antiguo, menos varido) ───
            $prompt_parts = [];
            $prompt_parts[] = 'Imagen profesional para publicación en redes sociales, alta calidad, estilo fotográfico real.';
            if ($cliente && !empty($cliente->name)) {
                $prompt_parts[] = "Cliente: {$cliente->name}.";
            }
            if (!empty($brand_brief)) {
                $brief_short = $brand_brief;
                if (mb_strlen($brief_short) > 280) {
                    $brief_short = mb_substr($brief_short, 0, 280) . '…';
                }
                $prompt_parts[] = "Marca y posicionamiento: {$brief_short}";
            }
            if (!empty($visual)) {
                $prompt_parts[] = "Escena específica: {$visual}";
            } elseif (!empty($copy)) {
                $copy_short = mb_substr(trim(preg_replace('/\s+/', ' ', $copy)), 0, 220);
                $prompt_parts[] = "Tema del post: {$copy_short}";
            }

            // v1.0.53: inyectar guía de estilo SEGÚN slider de fidelidad a refs.
            // Si no hay override en este request, usar el default del cliente.
            $effective_fidelity = $refs_fidelity;
            if ($effective_fidelity === null) {
                $effective_fidelity = ($cliente && class_exists('NV_Cliente_Meta'))
                    ? NV_Cliente_Meta::get_refs_fidelity($cliente->term_id)
                    : 50;
            }
            $style_guide = (string) get_post_meta($post_id, '_nv_image_style_guide', true);
            if (!empty($style_guide) && $effective_fidelity >= 30) {
                if ($effective_fidelity >= 70) {
                    $prompt_parts[] = 'STRICT VISUAL TEMPLATE (replicate composition, color blocks, badge/strip placement, typography hierarchy, photographic style — fidelity ' . $effective_fidelity . '%): ' . $style_guide;
                } else {
                    $prompt_parts[] = 'Style inspiration (draw mood, palette and composition cues — do not copy literally — fidelity ' . $effective_fidelity . '%): ' . $style_guide;
                }
            }
            // Si effective_fidelity < 30, NO se inyecta style_guide (libertad total).
            if (!empty($img_opts['tone_emotivo'])) {
                $prompt_parts[] = 'Tono visual: cálido, humano, emocional. Uso de luz suave dorada, expresiones afectivas, cercanía. Evita objetos comerciales o de venta.';
            }
            if (!empty($img_opts['tone_comercial'])) {
                $prompt_parts[] = 'Tono visual: comercial, producto en primer plano, energía dinámica, colores vibrantes, sensación de oferta o llamada a actuar.';
            }
            // v1.0.55: text safe zone DETALLADA (sustituye la antigua "deja espacio limpio").
            // Aplicamos siempre — mientras haya texto que sobreimprimir, la zona debe estar
            // físicamente reservada con instrucciones explícitas.
            if (!empty($img_opts['add_logo']) || !empty($img_opts['add_text']) || !empty($img_opts['add_data']) || !empty($img_opts['add_cta'])) {
                $prompt_parts[] = $build_safe_zone_clause($text_placement_meta);
            }
            $prompt_parts[] = 'NO incluyas texto, letras, palabras, números ni marcas de agua en la imagen — todos los elementos textuales se añadirán por separado en post-procesado.';

            $prompt = implode(' ', $prompt_parts);
        }

        // v1.0.53: trazabilidad de la fidelidad efectiva usada
        if ($refs_fidelity !== null) {
            update_post_meta($post_id, '_nv_image_refs_fidelity_used', $refs_fidelity);
        } elseif ($cliente && class_exists('NV_Cliente_Meta')) {
            update_post_meta($post_id, '_nv_image_refs_fidelity_used', NV_Cliente_Meta::get_refs_fidelity($cliente->term_id));
        }
        update_post_meta($post_id, '_nv_image_prompt_last', $prompt);

        // Determinar tamaño según tipo
        $size = '1024x1024'; // imagen, carrusel, default
        if (in_array($tipo, ['reel', 'story'], true)) {
            $size = '1024x1536';
        } elseif ($tipo === 'video') {
            $size = '1536x1024';
        }

        // v1.0.59: usar helper unificado que respeta forced_types y heurístico de refs.
        // Antes (v1.0.55) este endpoint hacía su propia llamada directa a /v1/images/generations
        // sin soporte de refs. Ahora delega al mismo helper que usa el calendario.
        $forced_types_indiv = [];
        if (!empty($params['forced_types'])) {
            $raw_ft = $params['forced_types'];
            if (is_string($raw_ft)) {
                $forced_types_indiv = array_map('trim', explode(',', $raw_ft));
            } elseif (is_array($raw_ft)) {
                $forced_types_indiv = array_map('strval', $raw_ft);
            }
            $forced_types_indiv = array_values(array_filter($forced_types_indiv));
        }

        // v1.0.59: si NO vienen forced_types en el request pero EL POST fue creado con
        // percent_targets (desde el modal "Generar mes"), calcular forced_types
        // automáticamente comparando ref_relevance del post con los umbrales del % objetivo.
        if (empty($forced_types_indiv)) {
            $pct_meta = get_post_meta($post_id, '_nv_pct_targets_genmes', true);
            $rel_meta = get_post_meta($post_id, '_nv_ref_relevance', true);
            if (!empty($pct_meta) && !empty($rel_meta)) {
                $pct = is_string($pct_meta) ? json_decode($pct_meta, true) : (is_array($pct_meta) ? $pct_meta : []);
                $rel = is_string($rel_meta) ? json_decode($rel_meta, true) : (is_array($rel_meta) ? $rel_meta : []);
                if (is_array($pct) && is_array($rel)) {
                    foreach ($pct as $type => $target_pct) {
                        $score = isset($rel[$type]) ? (int) $rel[$type] : 0;
                        // v1.0.62: pct=100 → umbral 0 (TODOS los posts pasan)
                        $threshold = 100 - (int) $target_pct;
                        if ((int) $target_pct >= 100) {
                            $threshold = 0;
                        } else {
                            if ($threshold < 30) $threshold = 30;
                            if ($threshold > 90) $threshold = 90;
                        }
                        if ($score >= $threshold) {
                            $forced_types_indiv[] = $type;
                        }
                    }
                    $forced_types_indiv = array_values(array_unique($forced_types_indiv));
                }
            }
        }

        // copy_hint: copy + first_comment + headline para detección automática
        $copy_for_hint = (string) get_post_meta($post_id, '_nv_copy', true);
        if (empty($copy_for_hint) && function_exists('get_field')) {
            $copy_for_hint = (string) get_field('nv_copy', $post_id);
        }
        $first_comment_hint = function_exists('get_field') ? (string) get_field('nv_first_comment', $post_id) : '';
        $headline_hint_indiv = (string) get_post_meta($post_id, '_nv_headline', true);
        $hl_lines_raw_indiv = get_post_meta($post_id, '_nv_headline_lines', true);
        if (!empty($hl_lines_raw_indiv)) {
            $hl_decoded = is_string($hl_lines_raw_indiv) ? json_decode($hl_lines_raw_indiv, true) : null;
            if (is_array($hl_decoded)) {
                foreach ($hl_decoded as $line) {
                    if (!empty($line['text'])) $headline_hint_indiv .= ' ' . $line['text'];
                }
            }
        }
        $copy_hint_indiv = trim($copy_for_hint . ' ' . $first_comment_hint . ' ' . $headline_hint_indiv);

        $term_id_indiv = ($cliente && !empty($cliente->term_id)) ? (int) $cliente->term_id : 0;

        @set_time_limit(300);
        $oai_result = self::generate_image_via_openai($prompt, $tipo, $quality, $term_id_indiv, $copy_hint_indiv, $forced_types_indiv);

        if (is_wp_error($oai_result)) {
            $err_msg = $oai_result->get_error_message();
            $is_timeout = (strpos($err_msg, 'cURL error 28') !== false || strpos($err_msg, 'timed out') !== false);
            $hint = $is_timeout
                ? ' — OpenAI tardó >180s O tu hosting cortó la petición. Prueba quality=low (más rápido) o reintenta en unos minutos.'
                : '';
            return new WP_Error('openai_network', $err_msg . $hint, ['status' => 502]);
        }

        // Trazabilidad v1.0.57+
        if (!empty($oai_result['endpoint_used'])) {
            update_post_meta($post_id, '_nv_image_endpoint_used', $oai_result['endpoint_used']);
        }
        if (!empty($oai_result['used_refs'])) {
            update_post_meta($post_id, '_nv_image_refs_used', wp_json_encode($oai_result['used_refs']));
        }
        if (!empty($oai_result['detection_reasons'])) {
            update_post_meta($post_id, '_nv_image_refs_detection', wp_json_encode($oai_result['detection_reasons']));
        }
        if (!empty($oai_result['forced_types_applied'])) {
            update_post_meta($post_id, '_nv_image_forced_types', wp_json_encode($oai_result['forced_types_applied']));
        }

        $b64 = $oai_result['b64'];
        if (empty($b64)) {
            return new WP_Error('no_image', 'OpenAI no devolvió imagen (respuesta vacía)', ['status' => 502]);
        }

        // Subir a Media Library
        $upload = self::upload_b64_to_post($b64, $post_id, 0);
        if (is_wp_error($upload)) {
            return $upload;
        }

        // ─── v1.0.50: post-procesado vía helper reutilizable ───
        // (antes en v1.0.49 todo este bloque vivía aquí inline; lo extrajimos
        // a apply_overlays_to_attachment() para que también lo usen multi-cliente
        // y openai-image-proxy)
        $any_overlay_requested = $img_opts['add_logo'] || $img_opts['add_text'] || $img_opts['add_data'] || $img_opts['add_cta'];
        // v1.0.71: garantizar dimensiones del cliente aunque no haya overlays
        $resize_warnings_indiv = self::ensure_image_matches_client_dimensions($post_id, $upload['attachment_id'], $cliente);
        $overlay_result = self::apply_overlays_to_attachment($post_id, $upload['attachment_id'], $cliente, $img_opts);
        $overlay_warnings = array_merge($resize_warnings_indiv, $overlay_result['warnings']);

        // Asociar a la publicación
        if (function_exists('update_field')) {
            update_field('nv_asset_url', $upload['asset_url'], $post_id);
        }
        set_post_thumbnail($post_id, $upload['attachment_id']);

        return rest_ensure_response([
            'success'          => true,
            'post_id'          => $post_id,
            'asset_url'        => $upload['asset_url'],
            'attachment_id'    => $upload['attachment_id'],
            'size'             => $size,
            'quality'          => $quality,
            'prompt_chars'     => strlen($prompt),
            'overlays_applied' => $any_overlay_requested,
            'overlay_warnings' => $overlay_warnings,
        ]);
    }

    // ─────────────────────────────────────────────────────────────────────
    // v1.0.27: Compositing GD-based de overlays sobre la imagen generada
    // ─────────────────────────────────────────────────────────────────────

    /**
     * v1.0.50 — Helper REUTILIZABLE para aplicar overlays sobre una imagen ya
     * subida a Media Library. Antes de v1.0.50 este bloque vivía sólo dentro de
     * generar_imagen_publicacion(); ahora también lo llaman:
     *   - generate_image_for_post() (multi-cliente Fase 1+2 inline)
     *   - openai_image_proxy() (botón "🎨 Generar imágenes con Claude")
     *   - reaplicar_overlay_publicacion() (re-aplica sin regenerar imagen)
     *
     * Resultado: las 4 rutas respetan brand_colors del cliente. Antes solo lo
     * hacía la 1ª — por eso David veía blancos/grises del default de gpt-image-2
     * cuando generaba el calendario mensual.
     *
     * @return array  ['warnings' => string[], 'composited' => bool]
     */
    private static function apply_overlays_to_attachment($post_id, $attachment_id, $cliente, $img_opts) {
        $warnings = [];
        $any = !empty($img_opts['add_logo']) || !empty($img_opts['add_text'])
            || !empty($img_opts['add_data']) || !empty($img_opts['add_cta']);
        if (!$any || !$cliente) {
            return ['warnings' => $warnings, 'composited' => false];
        }
        if (!class_exists('NV_Cliente_Meta')) {
            $warnings[] = 'NV_Cliente_Meta no disponible';
            return ['warnings' => $warnings, 'composited' => false];
        }

        $logo_path = !empty($img_opts['add_logo']) ? NV_Cliente_Meta::get_logo_path($cliente->term_id) : null;
        $logo_pos  = NV_Cliente_Meta::get_logo_position($cliente->term_id);
        // v1.0.63: cargar fuentes regular y bold por separado.
        // Si solo hay 1 fuente subida, get_font_path_by_weight devuelve la misma para ambos
        // (comportamiento idéntico a v1.0.62 — backward compatible).
        $font_regular = NV_Cliente_Meta::get_font_path_by_weight($cliente->term_id, 'regular');
        $font_bold    = NV_Cliente_Meta::get_font_path_by_weight($cliente->term_id, 'bold');
        $font_path    = $font_regular; // legacy alias para callsites que no diferencian

        $headline = !empty($img_opts['add_text']) ? (string) get_post_meta($post_id, '_nv_headline', true) : '';
        $headline_lines = [];
        if (!empty($img_opts['add_text'])) {
            $hl_raw = get_post_meta($post_id, '_nv_headline_lines', true);
            if (!empty($hl_raw)) {
                $hl_parsed = is_string($hl_raw) ? json_decode($hl_raw, true) : (is_array($hl_raw) ? $hl_raw : null);
                if (is_array($hl_parsed)) $headline_lines = $hl_parsed;
            }
        }

        // Fallback duro: si add_text=true pero la AI no dejó nada, derivamos del título
        $overlay_debug = [];
        if (!empty($img_opts['add_text']) && empty($headline_lines) && empty($headline)) {
            $post_obj = get_post($post_id);
            $post_title = $post_obj ? trim($post_obj->post_title) : '';
            $cli_name   = trim($cliente->name);
            $headline_lines = self::build_fallback_headline_lines($post_title, $cli_name);
            $overlay_debug['fallback_used'] = 'title-based (' . count($headline_lines) . ' lines)';
            $overlay_debug['post_title'] = $post_title;
        } else {
            $overlay_debug['source'] = !empty($headline_lines)
                ? ('headline_lines from meta (' . count($headline_lines) . ' lines)')
                : (!empty($headline) ? 'headline plain' : 'none');
        }
        update_post_meta($post_id, '_nv_overlay_debug', wp_json_encode($overlay_debug));

        $dato = !empty($img_opts['add_data']) ? (string) get_post_meta($post_id, '_nv_dato_destacado', true) : '';
        $cta  = !empty($img_opts['add_cta'])  ? (string) get_post_meta($post_id, '_nv_cta_visible', true) : '';

        if (!empty($img_opts['add_logo']) && empty($logo_path)) {
            $warnings[] = 'Logo solicitado pero el cliente no tiene logo subido';
        }

        $brand_colors   = NV_Cliente_Meta::get_brand_colors($cliente->term_id);
        $text_placement = (string) get_post_meta($post_id, '_nv_text_placement', true);
        $text_align     = (string) get_post_meta($post_id, '_nv_text_align', true);

        // v1.0.50: persist los colores realmente usados — facilita debugging para David
        update_post_meta($post_id, '_nv_brand_colors_used', wp_json_encode($brand_colors));

        $has_overlay = !empty($logo_path) || !empty($headline) || !empty($headline_lines) || !empty($dato) || !empty($cta);
        if (!$has_overlay) {
            return ['warnings' => $warnings, 'composited' => false];
        }

        $orig_path = get_attached_file($attachment_id);
        if (!$orig_path || !file_exists($orig_path)) {
            $warnings[] = 'No se encontró el archivo original del attachment ' . (int) $attachment_id;
            return ['warnings' => $warnings, 'composited' => false];
        }

        // v1.0.50: BACKUP pre-overlay. Guardamos copia LIMPIA (sin texto) la primera
        // vez que aplicamos overlays a este attachment, para poder re-aplicar
        // luego con colores/textos distintos sin tener que regenerar la imagen
        // (que cuesta ~3-5 céntimos de OpenAI por intento).
        $pre_overlay_path = (string) get_post_meta($post_id, '_nv_attachment_pre_overlay', true);
        if (empty($pre_overlay_path) || !file_exists($pre_overlay_path)) {
            $info = pathinfo($orig_path);
            $backup = $info['dirname'] . '/' . $info['filename'] . '__pre-overlay.' . ($info['extension'] ?? 'jpg');
            if (@copy($orig_path, $backup)) {
                update_post_meta($post_id, '_nv_attachment_pre_overlay', $backup);
                $pre_overlay_path = $backup;
            }
        }
        // Si tenemos backup limpio, partimos de él (sino los overlays se acumularían)
        if (!empty($pre_overlay_path) && file_exists($pre_overlay_path) && $pre_overlay_path !== $orig_path) {
            @copy($pre_overlay_path, $orig_path);
        }

        // v1.0.71: reencuadre a las dimensiones del cliente antes de overlays
        $resize_warnings = self::ensure_image_matches_client_dimensions($post_id, $attachment_id, $cliente);
        $warnings = array_merge($warnings, $resize_warnings);

        $composited = false;
        try {
            $r = self::composite_overlays_on_image($orig_path, [
                'logo_path'      => $logo_path,
                'logo_position'  => $logo_pos,
                'headline'       => $headline,
                'headline_lines' => $headline_lines,
                'dato_destacado' => $dato,
                'cta_visible'    => $cta,
                'font_path'      => $font_path,
                // v1.0.63: pasar también regular y bold separados para que
                // el bucle de líneas elija según el weight del headline_lines
                'font_regular'   => $font_regular,
                'font_bold'      => $font_bold,
                'brand_colors'   => $brand_colors,
                'text_placement' => $text_placement,
                'text_align'     => $text_align,
                // v1.0.52: patrón visual + nombre del cliente para layout "frame"
                'visual_pattern' => NV_Cliente_Meta::get_visual_pattern($cliente->term_id),
                'cliente_name'   => (string) $cliente->name,
            ]);
            if (is_wp_error($r)) {
                $warnings[] = 'Composición falló: ' . $r->get_error_message();
                update_post_meta($post_id, '_nv_composite_status', 'error: ' . $r->get_error_message());
            } else {
                $composited = true;
                update_post_meta($post_id, '_nv_composite_status', 'ok (v' . NV_DASHBOARD_VERSION . ')');
                // Regenerar thumbnails para que el texto aparezca en TODOS los tamaños
                try {
                    if (!function_exists('wp_generate_attachment_metadata')) {
                        require_once ABSPATH . 'wp-admin/includes/image.php';
                    }
                    $new_meta = wp_generate_attachment_metadata($attachment_id, $orig_path);
                    if (!empty($new_meta) && !is_wp_error($new_meta)) {
                        wp_update_attachment_metadata($attachment_id, $new_meta);
                        update_post_meta($post_id, '_nv_thumbs_regenerated', 'ok (' . count($new_meta['sizes'] ?? []) . ' sizes, v' . NV_DASHBOARD_VERSION . ')');
                    }
                } catch (\Throwable $regen_err) {
                    $warnings[] = 'Regenerar thumbnails falló: ' . $regen_err->getMessage();
                }
            }
        } catch (\Throwable $e) {
            $warnings[] = 'Composición lanzó excepción: ' . $e->getMessage() . ' (' . basename($e->getFile()) . ':' . $e->getLine() . ')';
            error_log('[NV Dashboard v1.0.50] apply_overlays throwable: ' . $e->getMessage() . "\n" . $e->getTraceAsString());
            update_post_meta($post_id, '_nv_composite_status', 'throwable: ' . $e->getMessage());
        }

        return ['warnings' => $warnings, 'composited' => $composited];
    }

    /**
     * v1.0.71: Garantiza que la imagen tiene las dimensiones configuradas para
     * el tipo de la publicación. Llama internamente a resize_image_cover.
     *
     * @return array string[] warnings
     */
    private static function ensure_image_matches_client_dimensions($post_id, $attachment_id, $cliente) {
        $warnings = [];
        if (!$cliente || !class_exists('NV_Cliente_Meta')) return $warnings;
        $orig_path = get_attached_file($attachment_id);
        if (!$orig_path || !file_exists($orig_path)) return $warnings;

        // v1.0.71: si hay override activo (adaptar-formato), usar esas medidas.
        if (is_array(self::$dimension_override) && (int) self::$dimension_override['term_id'] === (int) $cliente->term_id) {
            $target_w = (int) self::$dimension_override['width'];
            $target_h = (int) self::$dimension_override['height'];
        } else {
            $tipo_post = function_exists('get_field') ? (string) get_field('nv_tipo', $post_id) : 'imagen';
            if (!in_array($tipo_post, ['imagen','reel','carrusel','story','video'], true)) $tipo_post = 'imagen';
            $target_dim = NV_Cliente_Meta::get_dimensions_for_tipo($cliente->term_id, $tipo_post);
            $target_w = (int) ($target_dim['width']  ?? 0);
            $target_h = (int) ($target_dim['height'] ?? 0);
        }
        if ($target_w <= 0 || $target_h <= 0) return $warnings;

        $resize_res = self::resize_image_cover($orig_path, $target_w, $target_h);
        if (is_wp_error($resize_res)) {
            $warnings[] = 'Reencuadre a ' . $target_w . 'x' . $target_h . ' falló: ' . $resize_res->get_error_message();
        } else {
            update_post_meta($post_id, '_nv_image_dimensions', $target_w . 'x' . $target_h);
        }
        return $warnings;
    }

    /**
     * v1.0.71: Reescala+recorta la imagen a un W×H exacto, usando estrategia "cover"
     * (rellena el lienzo y recorta el sobrante centrado). Sobrescribe $base_path
     * con la nueva versión. Si la imagen ya está en el tamaño correcto, no hace nada.
     *
     * @return true|WP_Error
     */
    private static function resize_image_cover($base_path, $target_w, $target_h) {
        if (!function_exists('imagecreatefromjpeg')) {
            return new WP_Error('no_gd', 'PHP GD no disponible');
        }
        $target_w = (int) $target_w;
        $target_h = (int) $target_h;
        if ($target_w < 16 || $target_h < 16) {
            return new WP_Error('bad_target', 'Target dimensions inválidas');
        }
        $info = @getimagesize($base_path);
        if (!$info) return new WP_Error('bad_image', 'No se pudo leer la imagen base');
        $src_w = (int) $info[0];
        $src_h = (int) $info[1];
        if ($src_w === $target_w && $src_h === $target_h) {
            return true; // ya estamos
        }

        switch ($info[2]) {
            case IMAGETYPE_JPEG: $src = @imagecreatefromjpeg($base_path); break;
            case IMAGETYPE_PNG:  $src = @imagecreatefrompng($base_path);  break;
            case IMAGETYPE_WEBP: $src = function_exists('imagecreatefromwebp') ? @imagecreatefromwebp($base_path) : null; break;
            default:             $src = null;
        }
        if (!$src) return new WP_Error('load_failed', 'Formato no soportado para reencuadre');

        // Calcular escala "cover": el factor que llena al menos uno de los lados
        $scale = max($target_w / $src_w, $target_h / $src_h);
        $scaled_w = (int) ceil($src_w * $scale);
        $scaled_h = (int) ceil($src_h * $scale);
        // Offset para recorte centrado
        $off_x = (int) floor(($scaled_w - $target_w) / 2);
        $off_y = (int) floor(($scaled_h - $target_h) / 2);

        $dst = imagecreatetruecolor($target_w, $target_h);
        // Para PNG/WEBP con alfa preservamos transparencia
        imagealphablending($dst, false);
        imagesavealpha($dst, true);
        $transp = imagecolorallocatealpha($dst, 0, 0, 0, 127);
        imagefilledrectangle($dst, 0, 0, $target_w, $target_h, $transp);
        imagealphablending($dst, true);

        // Resample fuente al lienzo "scaled" virtual y copiar el recorte centrado
        // (usamos imagecopyresampled directamente con offsets negativos)
        $ok = imagecopyresampled(
            $dst, $src,
            -$off_x, -$off_y,           // destino: desplazado para recortar
            0, 0,                        // origen
            $scaled_w, $scaled_h,        // destino size (lienzo virtual escalado)
            $src_w, $src_h               // origen size
        );
        if (!$ok) {
            imagedestroy($src); imagedestroy($dst);
            return new WP_Error('resample_failed', 'imagecopyresampled devolvió false');
        }

        // Guardar en el mismo formato/ruta
        $save_ok = false;
        switch ($info[2]) {
            case IMAGETYPE_JPEG: $save_ok = imagejpeg($dst, $base_path, 92); break;
            case IMAGETYPE_PNG:  $save_ok = imagepng($dst, $base_path); break;
            case IMAGETYPE_WEBP: $save_ok = function_exists('imagewebp') ? imagewebp($dst, $base_path, 92) : imagejpeg($dst, $base_path, 92); break;
            default:             $save_ok = imagejpeg($dst, $base_path, 92);
        }
        imagedestroy($src);
        imagedestroy($dst);
        if (!$save_ok) return new WP_Error('save_failed', 'No se pudo guardar la imagen reescalada');
        return true;
    }

    /**
     * Sobrescribe $base_path con una versión que tiene logo + textos compuestos.
     * Devuelve true en éxito o WP_Error.
     */
    private static function composite_overlays_on_image($base_path, $opts) {
        if (!function_exists('imagecreatefromjpeg') || !function_exists('imagettftext')) {
            return new WP_Error('no_gd', 'PHP GD con FreeType no está disponible en este servidor');
        }

        $info = @getimagesize($base_path);
        if (!$info) return new WP_Error('bad_image', 'No se pudo leer la imagen base');

        // Cargar base
        switch ($info[2]) {
            case IMAGETYPE_JPEG: $base = @imagecreatefromjpeg($base_path); break;
            case IMAGETYPE_PNG:  $base = @imagecreatefrompng($base_path);  break;
            case IMAGETYPE_WEBP: $base = function_exists('imagecreatefromwebp') ? @imagecreatefromwebp($base_path) : null; break;
            default:             $base = null;
        }
        if (!$base) return new WP_Error('load_failed', 'Formato de imagen no soportado: ' . $info['mime']);

        $w = imagesx($base);
        $h = imagesy($base);
        imagealphablending($base, true);
        imagesavealpha($base, true);

        $font = !empty($opts['font_path']) && file_exists($opts['font_path']) ? $opts['font_path'] : null;
        if (!$font) {
            imagedestroy($base);
            return new WP_Error('no_font', 'No hay fuente disponible (ni del cliente ni Poppins-Bold del plugin)');
        }

        // ── 1. Logo ──
        if (!empty($opts['logo_path']) && file_exists($opts['logo_path'])) {
            $linfo = @getimagesize($opts['logo_path']);
            // v1.0.31: pre-check de tamaño — un PNG 4000x4000 con alpha ocupa ~64MB
            // en GD raw, lo que mata PHP en hostings con memory_limit bajo.
            // Si excede 16M píxeles (≈ 4000×4000), saltamos con warning.
            if ($linfo && ($linfo[0] * $linfo[1] > 16000000)) {
                $logo = null;
                trigger_error('NV Dashboard: logo demasiado grande (' . $linfo[0] . 'x' . $linfo[1] . '), saltado para evitar OOM. Sube una versión más pequeña (recomendado <2000x2000).', E_USER_WARNING);
            } else {
                $logo = null;
                if ($linfo) {
                    switch ($linfo[2]) {
                        case IMAGETYPE_PNG:  $logo = @imagecreatefrompng($opts['logo_path']); break;
                        case IMAGETYPE_JPEG: $logo = @imagecreatefromjpeg($opts['logo_path']); break;
                        case IMAGETYPE_WEBP: $logo = function_exists('imagecreatefromwebp') ? @imagecreatefromwebp($opts['logo_path']) : null; break;
                    }
                }
            }
            if ($logo) {
                $lw0 = imagesx($logo); $lh0 = imagesy($logo);
                $tw  = (int) ($w * 0.18); // 18% del ancho
                $th  = (int) ($lh0 * ($tw / $lw0));
                $resized = imagecreatetruecolor($tw, $th);
                imagealphablending($resized, false);
                imagesavealpha($resized, true);
                $transp = imagecolorallocatealpha($resized, 0, 0, 0, 127);
                imagefilledrectangle($resized, 0, 0, $tw, $th, $transp);
                imagealphablending($resized, true);
                imagecopyresampled($resized, $logo, 0, 0, 0, 0, $tw, $th, $lw0, $lh0);
                $margin = (int) ($w * 0.035);
                $pos = $opts['logo_position'] ?? 'br';
                switch ($pos) {
                    case 'tl': $lx = $margin;             $ly = $margin;             break;
                    case 'tr': $lx = $w - $tw - $margin;  $ly = $margin;             break;
                    case 'bl': $lx = $margin;             $ly = $h - $th - $margin;  break;
                    case 'br':
                    default:   $lx = $w - $tw - $margin;  $ly = $h - $th - $margin;  break;
                }
                imagecopy($base, $resized, $lx, $ly, 0, 0, $tw, $th);
                imagedestroy($logo);
                imagedestroy($resized);
            }
        }

        // ── 2. Overlay de texto limpio (v1.0.36) ──
        // Sin franjas, sin tarjetas, sin pills. Solo tipografía bien posicionada
        // con stroke fino y sombra suave para legibilidad sobre cualquier imagen.
        // La AI sugiere text_placement (top/center/bottom) y text_align (left/center/right).
        $brand = isset($opts['brand_colors']) && is_array($opts['brand_colors']) ? $opts['brand_colors'] : [
            'primary' => '#1F2937', 'accent' => '#2563EB', 'text_on_primary' => '#FFFFFF',
        ];
        $bp_rgb = self::hex_to_rgb($brand['primary'] ?? '#1F2937');
        $ba_rgb = self::hex_to_rgb($brand['accent']  ?? '#2563EB');

        $placement = isset($opts['text_placement']) ? (string) $opts['text_placement'] : '';
        if (!in_array($placement, ['top', 'center', 'bottom'], true)) $placement = 'bottom';

        // v1.0.70: AUTO-CORRECCIÓN DE PLACEMENT. La AI elige top/center/bottom
        // pero gpt-image-2 a veces no respeta el espacio negativo (sobre todo cuando
        // las refs son personas — pone caras en la zona "principal" igual). Antes
        // de componer el texto, analizamos las 3 bandas (top/center/bottom) y, si
        // la banda elegida tiene mucha "complejidad" (varianza alta = caras/objetos)
        // y otra banda tiene espacio realmente libre, cambiamos el placement.
        $auto_placement = self::detect_safe_text_zone($base, $w, $h);
        if ($auto_placement !== null && $auto_placement !== $placement) {
            error_log("[NV Dashboard v1.0.70] auto_placement override: AI quería '{$placement}' pero la zona libre real es '{$auto_placement}'. Cambiando.");
            $placement = $auto_placement;
        }

        $align = isset($opts['text_align']) ? (string) $opts['text_align'] : '';
        if (!in_array($align, ['left', 'center', 'right'], true)) $align = 'center';

        $layout_args = [
            'headline'       => $opts['headline'] ?? '',
            'headline_lines' => $opts['headline_lines'] ?? [], // v1.0.43 — BUG FIX: faltaba aquí, por eso el renderer recibía args vacíos
            'dato_destacado' => $opts['dato_destacado'] ?? '',
            'cta_visible'    => $opts['cta_visible'] ?? '',
            'font_path'      => $font,
            // v1.0.63: fuentes regular/bold separadas para que el bucle de líneas
            // elija según headline_lines[i].weight. Si solo hay 1 fuente subida,
            // ambas apuntan al mismo path (idéntico a v1.0.62).
            'font_regular'   => !empty($opts['font_regular']) && file_exists($opts['font_regular']) ? $opts['font_regular'] : $font,
            'font_bold'      => !empty($opts['font_bold']) && file_exists($opts['font_bold']) ? $opts['font_bold'] : $font,
            'logo_position'  => $opts['logo_position'] ?? 'br',
            'primary'        => $bp_rgb,
            'accent'         => $ba_rgb,
            'placement'      => $placement,
            'align'          => $align,
            // v1.0.44: source de brand_colors. Si 'default' (cliente sin configurar),
            // forzamos todo a blanco para no contaminar la imagen con #2563EB royal blue.
            'brand_source'   => isset($opts['brand_colors']['source']) ? (string) $opts['brand_colors']['source'] : 'default',
            // v1.0.52: cliente_name para extraer brand_word (ej: "REVA" de "Guardamuebles Reva")
            'cliente_name'   => isset($opts['cliente_name']) ? (string) $opts['cliente_name'] : '',
        ];

        // v1.0.52: ramificar entre layouts según visual_pattern del cliente
        $visual_pattern = isset($opts['visual_pattern']) ? (string) $opts['visual_pattern'] : 'clean';
        if ($visual_pattern === 'frame') {
            self::apply_frame_layout($base, $layout_args);
        } else {
            self::apply_clean_text_overlay($base, $layout_args);
        }

        // Guardar (sobrescribir)
        $ok = false;
        switch ($info[2]) {
            case IMAGETYPE_JPEG: $ok = imagejpeg($base, $base_path, 92); break;
            case IMAGETYPE_PNG:  $ok = imagepng($base, $base_path); break;
            case IMAGETYPE_WEBP: $ok = function_exists('imagewebp') ? imagewebp($base, $base_path, 92) : imagejpeg($base, $base_path, 92); break;
        }
        imagedestroy($base);

        if (!$ok) return new WP_Error('save_failed', 'No se pudo guardar la imagen compuesta');
        return true;
    }

    /**
     * Helper interno: dibuja texto con banda de fondo opcional.
     */
    private static function draw_text_with_band($img, $text, $font_path, $opts) {
        $w = imagesx($img); $h = imagesy($img);
        $size  = $opts['size'];
        $pos_y = $opts['pos_y'];
        $align = $opts['align'] ?? 'center';
        $pad_x = $opts['pad_x'] ?? null;
        $max_w_pct = $opts['max_width_pct'] ?? 0.85;
        $fg = $opts['fg'];
        $bg = $opts['bg'] ?? null;
        $pad_extra = !empty($opts['pad_extra']);

        // Wrap text si excede max_w
        $max_w = (int) ($w * $max_w_pct);
        $lines = self::wrap_text_for_imagettf($text, $font_path, $size, $max_w);
        $line_height = (int) ($size * 1.25);
        $total_h = $line_height * count($lines);

        // Cálculo de posición Y inicial
        $y_start = $pos_y;
        $pad = $pad_extra ? (int) ($size * 0.7) : (int) ($size * 0.4);

        foreach ($lines as $i => $line) {
            $bbox = imagettfbbox($size, 0, $font_path, $line);
            $tw = $bbox[2] - $bbox[0];
            $th = $bbox[1] - $bbox[7];
            switch ($align) {
                case 'left':   $tx = $pad_x !== null ? $pad_x : (int) ($w * 0.04); break;
                case 'right':  $tx = $w - $tw - ($pad_x !== null ? $pad_x : (int) ($w * 0.04)); break;
                case 'center':
                default:       $tx = (int) (($w - $tw) / 2); break;
            }
            $ty = $y_start + ($i * $line_height);

            // Banda de fondo
            if ($bg) {
                $r = $bg[0]; $g = $bg[1]; $b = $bg[2]; $a = isset($bg[3]) ? $bg[3] : 0;
                $color_bg = imagecolorallocatealpha($img, $r, $g, $b, $a);
                imagefilledrectangle($img, $tx - $pad, $ty - $th - $pad/2, $tx + $tw + $pad, $ty + $pad/2, $color_bg);
            }

            // Sombra suave
            $shadow = imagecolorallocatealpha($img, 0, 0, 0, 80);
            imagettftext($img, $size, 0, $tx + 2, $ty + 2, $shadow, $font_path, $line);

            // Texto fg
            $color_fg = imagecolorallocate($img, $fg[0], $fg[1], $fg[2]);
            imagettftext($img, $size, 0, $tx, $ty, $color_fg, $font_path, $line);
        }
    }

    /**
     * Helper interno: wrap text breaking on word boundaries para imagettf.
     */
    private static function wrap_text_for_imagettf($text, $font, $size, $max_width) {
        $words = preg_split('/\s+/u', trim($text));
        $lines = [];
        $current = '';
        foreach ($words as $w) {
            $test = $current === '' ? $w : ($current . ' ' . $w);
            $bbox = imagettfbbox($size, 0, $font, $test);
            $width = $bbox[2] - $bbox[0];
            if ($width > $max_width && $current !== '') {
                $lines[] = $current;
                $current = $w;
            } else {
                $current = $test;
            }
        }
        if ($current !== '') $lines[] = $current;
        return $lines;
    }

    // ─────────────────────────────────────────────────────────────────────
    // v1.0.35: Helpers visuales y layouts de overlay
    // ─────────────────────────────────────────────────────────────────────

    /** '#RRGGBB' → [R, G, B] como ints 0-255 */
    private static function hex_to_rgb($hex) {
        $hex = ltrim((string) $hex, '#');
        if (!preg_match('/^[0-9A-Fa-f]{6}$/', $hex)) return [31, 41, 55]; // fallback gris carbón
        return [hexdec(substr($hex, 0, 2)), hexdec(substr($hex, 2, 2)), hexdec(substr($hex, 4, 2))];
    }

    /** Calcula tamaño de fuente que ajusta el texto en max_width sin partir palabras y sin pasar de N líneas. */
    private static function fit_text_size($text, $font, $max_width, $max_lines, $size_min, $size_max) {
        // v1.0.65: el wrap por palabras no parte palabras únicas, así que una línea
        // puede SER más ancha que max_width si la palabra es muy larga (caso "RINOPLASTIA"
        // en xl bold). Hay que chequear el ancho REAL de cada línea, no solo el conteo.
        $fits = function($lines, $size_to_check) use ($font, $max_width) {
            foreach ($lines as $ln) {
                $bb = imagettfbbox($size_to_check, 0, $font, $ln);
                if (($bb[2] - $bb[0]) > $max_width) return false;
            }
            return true;
        };

        // Pase 1 — tamaño en rango normal con max_lines
        for ($size = $size_max; $size >= $size_min; $size -= 2) {
            $lines = self::wrap_text_for_imagettf($text, $font, $size, $max_width);
            if (count($lines) <= $max_lines && $fits($lines, $size)) {
                return ['size' => $size, 'lines' => $lines];
            }
        }
        // Pase 2 — agresivo: bajar por debajo de size_min hasta 12px buscando que
        // entre en max_lines Y todas las líneas dentro del max_width real.
        $absolute_min = 12;
        for ($size = $size_min - 2; $size >= $absolute_min; $size -= 2) {
            $lines = self::wrap_text_for_imagettf($text, $font, $size, $max_width);
            if (count($lines) <= $max_lines && $fits($lines, $size)) {
                return ['size' => $size, 'lines' => $lines];
            }
        }
        // Pase 3 — última oportunidad: aceptar más líneas con tal de que TODAS
        // entren dentro del max_width real. Cubre "RINOPLASTIA" en xl bold: si
        // no cabe en 2 líneas, va a 3-4 líneas pero siempre dentro del frame.
        for ($size = $size_max; $size >= $absolute_min; $size -= 2) {
            $lines = self::wrap_text_for_imagettf($text, $font, $size, $max_width);
            if ($fits($lines, $size)) {
                return ['size' => $size, 'lines' => $lines];
            }
        }
        // Recurso final — partir manualmente la palabra más larga por caracteres
        // si una sola palabra a 12px sigue excediendo el ancho.
        $size = $absolute_min;
        $lines = self::wrap_text_for_imagettf($text, $font, $size, $max_width);
        $fixed = [];
        foreach ($lines as $ln) {
            $bb = imagettfbbox($size, 0, $font, $ln);
            if (($bb[2] - $bb[0]) <= $max_width) {
                $fixed[] = $ln;
            } else {
                // partir palabra larga por caracteres
                $chars = preg_split('//u', $ln, -1, PREG_SPLIT_NO_EMPTY);
                $chunk = '';
                foreach ($chars as $c) {
                    $test = $chunk . $c;
                    $bb = imagettfbbox($size, 0, $font, $test);
                    if (($bb[2] - $bb[0]) > $max_width && $chunk !== '') {
                        $fixed[] = $chunk;
                        $chunk = $c;
                    } else {
                        $chunk = $test;
                    }
                }
                if ($chunk !== '') $fixed[] = $chunk;
            }
        }
        return ['size' => $size, 'lines' => $fixed];
    }

    /** Dibuja rectángulo con esquinas redondeadas relleno de un color */
    private static function draw_rounded_rect($img, $x1, $y1, $x2, $y2, $radius, $color) {
        $w = $x2 - $x1; $h = $y2 - $y1;
        if ($radius * 2 > min($w, $h)) $radius = (int)(min($w, $h) / 2);
        // Cuerpo principal (cruz)
        imagefilledrectangle($img, $x1 + $radius, $y1, $x2 - $radius, $y2, $color);
        imagefilledrectangle($img, $x1, $y1 + $radius, $x2, $y2 - $radius, $color);
        // 4 esquinas con elipse rellena
        imagefilledellipse($img, $x1 + $radius, $y1 + $radius, $radius * 2, $radius * 2, $color);
        imagefilledellipse($img, $x2 - $radius, $y1 + $radius, $radius * 2, $radius * 2, $color);
        imagefilledellipse($img, $x1 + $radius, $y2 - $radius, $radius * 2, $radius * 2, $color);
        imagefilledellipse($img, $x2 - $radius, $y2 - $radius, $radius * 2, $radius * 2, $color);
    }

    /** Sombra suave debajo de un rectángulo (varias capas con alpha decreciente) */
    private static function draw_soft_shadow($img, $x1, $y1, $x2, $y2, $radius, $blur = 8, $offset_y = 4) {
        for ($i = $blur; $i >= 1; $i--) {
            $alpha = (int) (110 - ($i / $blur) * 60); // 50-110
            $color = imagecolorallocatealpha($img, 0, 0, 0, $alpha);
            self::draw_rounded_rect($img, $x1 - $i, $y1 - $i + $offset_y, $x2 + $i, $y2 + $i + $offset_y, $radius + $i, $color);
        }
    }

    /** Dibuja texto con stroke (contorno) y sombra suave — para hero-stroke */
    private static function draw_text_stroked($img, $x, $y, $size, $font, $text, $rgb_fill, $rgb_stroke, $stroke_w = 3) {
        $stroke = imagecolorallocate($img, $rgb_stroke[0], $rgb_stroke[1], $rgb_stroke[2]);
        $shadow = imagecolorallocatealpha($img, 0, 0, 0, 90);
        // Sombra primero
        imagettftext($img, $size, 0, $x + 3, $y + 3, $shadow, $font, $text);
        // Stroke (contorno) — ofset en 8 direcciones
        for ($dx = -$stroke_w; $dx <= $stroke_w; $dx++) {
            for ($dy = -$stroke_w; $dy <= $stroke_w; $dy++) {
                if ($dx === 0 && $dy === 0) continue;
                imagettftext($img, $size, 0, $x + $dx, $y + $dy, $stroke, $font, $text);
            }
        }
        // Fill
        $fill = imagecolorallocate($img, $rgb_fill[0], $rgb_fill[1], $rgb_fill[2]);
        imagettftext($img, $size, 0, $x, $y, $fill, $font, $text);
    }

    /**
     * v1.0.38 — Overlay con jerarquía tipográfica.
     *
     * Acepta `headline_lines` como array de objetos {text, size, color, weight}
     * para componer titulares con múltiples tamaños y colores (como Image 2 del
     * brief: "EN" pequeño / "CLÍNICA" grande / "MARCH" grande dorado / "CUIDAMOS
     * DE TÍ" mediano). Si solo viene `headline` plano, lo convierte a 1 línea.
     *
     * Sin franjas, sin tarjetas. Solo tipografía con sombra suave + stroke fino
     * oscuro para legibilidad universal sobre cualquier fondo.
     *
     * Tamaños (% de altura de la imagen):
     *   sm = 3.0%   md = 5.0%   lg = 7.5%   xl = 10.5%
     *
     * Colores (token → RGB):
     *   white   → [255,255,255]   (default)
     *   accent  → brand accent (auto-aclarado si oscuro)
     *   primary → brand primary (auto-aclarado si oscuro)
     *   dark    → [26,26,26]
     */

    /**
     * v1.0.70: Detecta automáticamente qué zona vertical de la imagen tiene MENOS
     * complejidad visual (caras, objetos, contraste) y por tanto es la más
     * apropiada para colocar texto sin tapar elementos importantes.
     *
     * Algoritmo:
     *   1. Divide la imagen en 3 bandas verticales: top (0-33%), center (33-66%), bottom (66-100%).
     *   2. Para cada banda calcula la varianza de luminosidad sampleando ~400 puntos.
     *      Varianza alta = mucho contraste/detalle (caras, objetos, textura compleja).
     *      Varianza baja = zona uniforme (cielo, fondo blur, pared).
     *   3. Devuelve la banda con MENOR varianza (más uniforme = más segura para texto).
     *
     * Devuelve `null` si la imagen es muy uniforme en general (no hay diferencia
     * significativa entre bandas → respetar la elección de la AI).
     *
     * @param resource $img    Recurso GD ya cargado
     * @param int $w           Ancho
     * @param int $h           Alto
     * @return string|null     'top' | 'center' | 'bottom' | null (no override)
     */
    private static function detect_safe_text_zone($img, $w, $h) {
        if (!$img || $w < 100 || $h < 100) return null;

        // Sampleo ~400 puntos por banda en una grid 20x20
        $samples_x = 20;
        $samples_y = 20; // por banda → 7 puntos verticales por banda en 1/3 de altura
        $bands = [
            'top'    => ['y_start' => 0,                     'y_end' => (int)($h * 0.33)],
            'center' => ['y_start' => (int)($h * 0.33),      'y_end' => (int)($h * 0.66)],
            'bottom' => ['y_start' => (int)($h * 0.66),      'y_end' => $h],
        ];

        $variances = [];
        foreach ($bands as $name => $band) {
            $bh = $band['y_end'] - $band['y_start'];
            if ($bh < 10) { $variances[$name] = 0; continue; }
            $luma = [];
            $step_x = max(1, (int)($w / $samples_x));
            $step_y = max(1, (int)($bh / $samples_y));
            for ($y = $band['y_start']; $y < $band['y_end']; $y += $step_y) {
                for ($x = 0; $x < $w; $x += $step_x) {
                    $rgb = imagecolorat($img, $x, $y);
                    if ($rgb === false) continue;
                    $r = ($rgb >> 16) & 0xFF;
                    $g = ($rgb >> 8) & 0xFF;
                    $b = $rgb & 0xFF;
                    // Luminosidad perceptual (Rec.601)
                    $luma[] = 0.299 * $r + 0.587 * $g + 0.114 * $b;
                }
            }
            $n = count($luma);
            if ($n < 10) { $variances[$name] = 0; continue; }
            $mean = array_sum($luma) / $n;
            $sum_sq = 0;
            foreach ($luma as $l) $sum_sq += ($l - $mean) * ($l - $mean);
            $variances[$name] = $sum_sq / $n; // varianza
        }

        // Diferencia mínima para considerar override (evitar ruido)
        $min_v = min($variances);
        $max_v = max($variances);
        if ($max_v < 100) return null; // imagen muy uniforme en total → no hay info útil
        $ratio = $min_v / max(1, $max_v);
        // Si la zona más uniforme tiene menos del 60% de varianza que la más cargada,
        // hay diferencia suficiente para confiar en la detección.
        if ($ratio > 0.6) return null; // bandas similares → no override

        // Devolver la banda con menor varianza (más uniforme = mejor para texto)
        asort($variances);
        $best = array_key_first($variances);
        // Log para diag
        $diag = json_encode($variances);
        error_log("[NV Dashboard v1.0.70] detect_safe_text_zone: variances={$diag} best={$best}");
        return $best;
    }

    private static function apply_clean_text_overlay($img, $args) {
        $w = imagesx($img); $h = imagesy($img);
        $font = $args['font_path'];
        // v1.0.63: fuentes regular y bold separadas. Si no se proveen, usar $font legacy.
        $font_regular = !empty($args['font_regular']) && file_exists($args['font_regular']) ? $args['font_regular'] : $font;
        $font_bold    = !empty($args['font_bold'])    && file_exists($args['font_bold'])    ? $args['font_bold']    : $font;
        $primary = $args['primary'];
        $accent  = $args['accent'];

        // ─── Resolver headline → array de líneas ───
        $headline_lines = isset($args['headline_lines']) && is_array($args['headline_lines']) ? $args['headline_lines'] : [];

        // Backwards compat: si solo vino headline plano, convertir a 1 línea
        $plain_headline = isset($args['headline']) ? trim((string) $args['headline']) : '';
        if (empty($headline_lines) && $plain_headline !== '') {
            $headline_lines = [['text' => $plain_headline, 'size' => 'lg', 'color' => 'white', 'weight' => 'bold']];
        }

        $dato = trim((string) ($args['dato_destacado'] ?? ''));
        $cta  = trim((string) ($args['cta_visible'] ?? ''));
        if (empty($headline_lines) && $dato === '' && $cta === '') return;

        $placement = $args['placement'];
        $align     = $args['align'];

        $padding = (int) ($w * 0.06);
        $max_w   = $w - 2 * $padding;

        // ─── Mapeos de size y color ───
        $size_map = [
            'sm' => 0.030,
            'md' => 0.050,
            'lg' => 0.075,
            'xl' => 0.105,
        ];
        // v1.0.44: si el cliente no tiene brand_colors configurados, ignorar
        // tokens "accent" y "primary" (sería el azul royal default #2563EB que
        // se ve fuera de marca). Forzar todo a blanco; la jerarquía la da el tamaño.
        $brand_source = isset($args['brand_source']) ? (string) $args['brand_source'] : 'explicit';
        $force_white_only = ($brand_source === 'default');

        // v1.0.51: ELIMINADO brighten_if_dark de tokens accent/primary.
        // ANTES (v1.0.34–1.0.50): si el color brand tenía luminancia < 0.45 lo
        // mezclábamos al 55% con blanco "para asegurar legibilidad sobre fondos
        // oscuros". Eso destrozaba colores brand intencionalmente oscuros: el
        // gris corporativo #505252 de Guardamuebles Reva salía renderizado como
        // #B0B1B1 (gris claro casi blanco), ignorando completamente la marca.
        // AHORA: respetar el color brand exacto. La legibilidad se da con
        // stroke contrastante automático en draw_text_with_thin_stroke (calculado
        // según luminancia del fill) — eso da contraste universal sin alterar el
        // color del fill. Ver brighten_if_dark más abajo: queda como helper
        // legacy por si algún callsite lo usa, pero los tokens ya no lo invocan.
        $resolve_color = function($token) use ($primary, $accent, $force_white_only) {
            if ($force_white_only) return [255, 255, 255];
            switch ($token) {
                case 'accent':  return $accent;       // RESPETAR color brand exacto
                case 'primary': return $primary;      // RESPETAR color brand exacto
                case 'dark':    return [26, 26, 26];
                case 'white':
                default:        return [255, 255, 255];
            }
        };

        // ─── Construir lista unificada de líneas a renderizar ───
        // Cada entry: ['text', 'size_px', 'color_rgb', 'bold', 'lh', 'gap_after']
        $rendered = [];

        // 1) Headline lines (jerarquía AI)
        $n_head = count($headline_lines);
        foreach ($headline_lines as $i => $line) {
            $text = trim((string) ($line['text'] ?? ''));
            if ($text === '') continue;
            // v1.0.54: normalizar UTF-8 antes de calcular bbox y renderizar
            $text = self::normalize_utf8_for_render($text);
            if ($text === '') continue;
            $size_token  = $line['size'] ?? 'md';
            $color_token = $line['color'] ?? 'white';
            $weight      = $line['weight'] ?? 'regular';
            $size_pct    = $size_map[$size_token] ?? 0.05;
            $size_px_max = (int) ($h * $size_pct);
            $size_px_min = max(16, (int) ($size_px_max * 0.55));

            // v1.0.63: elegir fuente real según weight (la AI ya marca regular|bold).
            // Si solo hay una fuente subida, font_regular y font_bold apuntan al mismo path.
            $font_for_line = ($weight === 'bold') ? $font_bold : $font_regular;
            // Faux-bold (offset 1px) solo si quería bold pero no tenemos una bold REAL distinta
            $use_faux_bold = ($weight === 'bold' && $font_for_line === $font_regular);

            // Auto-fit dentro de max_w respetando palabras enteras.
            // v1.0.64: para evitar que palabras muy largas en xl/lg (ej "RINOPLASTIA"
            // en Bold) se corten porque max_lines=1 fuerza un size_min insuficiente,
            // ahora xl/lg permiten hasta 2 líneas como segundo recurso. La AI ya hace
            // su propio split por importancia — esto solo se activa cuando una sola
            // palabra del headline supera el ancho disponible.
            $auto_fit_max_lines = ($size_token === 'sm' || $size_token === 'md') ? 2 : 2;
            $fit = self::fit_text_size($text, $font_for_line, $max_w, $auto_fit_max_lines, $size_px_min, $size_px_max);
            // Para xl/lg preferimos una línea sola (la AI ya las parte por importancia)
            foreach ($fit['lines'] as $sub_idx => $sub_text) {
                $rendered[] = [
                    'text'      => $sub_text,
                    'size_px'   => $fit['size'],
                    'color_rgb' => $resolve_color($color_token),
                    'bold'      => $use_faux_bold, // solo aplica offset 1px si NO hay bold real diferente
                    'font'      => $font_for_line, // v1.0.63: persistir la fuente elegida
                    'lh'        => (int) ($fit['size'] * ($size_token === 'xl' ? 1.05 : 1.15)),
                    // Espacio extra después del último sub-text de cada línea original
                    'gap_after' => ($sub_idx === count($fit['lines']) - 1) ? (int) ($h * 0.006) : 0,
                ];
            }
        }
        // Gap después del bloque headline si hay dato/cta debajo
        if (!empty($rendered) && ($dato !== '' || $cta !== '')) {
            $rendered[count($rendered) - 1]['gap_after'] += (int) ($h * 0.014);
        }

        // 2) Dato destacado (en accent, mediano, bold)
        if ($dato !== '') {
            $size_max = (int) ($h * 0.038);
            $size_min = (int) ($h * 0.024);
            $fit = self::fit_text_size($dato, $font_bold, $max_w, 1, $size_min, $size_max);
            // v1.0.63: faux-bold solo si NO hay bold real distinta de regular
            $faux = ($font_bold === $font_regular);
            foreach ($fit['lines'] as $line) {
                $rendered[] = [
                    'text'      => $line,
                    'size_px'   => $fit['size'],
                    'color_rgb' => $accent, // v1.0.51: respetar color brand exacto (legibilidad via stroke contrastante)
                    'bold'      => $faux,
                    'font'      => $font_bold, // v1.0.63: dato siempre en bold (real o faux)
                    'lh'        => (int) ($fit['size'] * 1.30),
                    'gap_after' => 0,
                ];
            }
            if ($cta !== '') {
                $rendered[count($rendered) - 1]['gap_after'] = (int) ($h * 0.012);
            }
        }

        // 3) CTA visible (uppercase con letter-spacing opcional, en accent, bold).
        // v1.0.65: el letter-spacing por chars hacía el CTA muy ancho — ahora solo se aplica
        // si la versión espaciada CABE en el frame; si no, fallback a uppercase plano.
        if ($cta !== '') {
            $cta_upper = mb_strtoupper($cta);
            $size_max = (int) ($h * 0.034);
            $size_min = (int) ($h * 0.022);
            $faux = ($font_bold === $font_regular);

            // Probar versión con letter-spacing solo si la cadena original es corta
            $use_spaced = false;
            $cta_text = $cta_upper;
            if (mb_strlen($cta_upper) <= 18) {
                $spaced = implode(' ', preg_split('//u', $cta_upper, -1, PREG_SPLIT_NO_EMPTY));
                $bb = imagettfbbox($size_min, 0, $font_bold, $spaced);
                if (($bb[2] - $bb[0]) <= $max_w) {
                    $cta_text = $spaced;
                    $use_spaced = true;
                }
            }

            // Auto-fit con check de ancho real (Pase 3 del fit_text_size acepta más líneas)
            $fit = self::fit_text_size($cta_text, $font_bold, $max_w, 2, $size_min, $size_max);
            foreach ($fit['lines'] as $sub_idx => $sub_text) {
                $rendered[] = [
                    'text'      => $sub_text,
                    'size_px'   => $fit['size'],
                    'color_rgb' => $accent,
                    'bold'      => $faux,
                    'font'      => $font_bold,
                    'lh'        => (int) ($fit['size'] * 1.30),
                    'gap_after' => 0,
                ];
            }
        }

        if (empty($rendered)) return;

        // ─── Calcular altura total del bloque ───
        $total_h = 0;
        foreach ($rendered as $r) $total_h += $r['lh'] + $r['gap_after'];

        // v1.0.70: AUTO-FIT DE ALTURA. Si el bloque total excede ~35% del frame,
        // reducimos proporcionalmente todos los tamaños hasta que quepa. Esto cubre
        // el caso del post 204: 3 líneas xl bold + 1 lg + 1 sm = 52% del frame, que
        // se desborda sobre las caras del equipo aunque el placement sea correcto.
        // El target 35% deja espacio negativo suficiente para que el texto NO entre
        // en la zona donde gpt-image-2 puso las personas.
        $max_block_h = (int) ($h * 0.35);
        if ($total_h > $max_block_h && $total_h > 0) {
            $scale = $max_block_h / $total_h;
            // Aplicar escala a todos los items, manteniendo proporciones relativas
            foreach ($rendered as &$r) {
                $r['size_px']   = max(14, (int) round($r['size_px'] * $scale));
                $r['lh']        = (int) round($r['lh'] * $scale);
                $r['gap_after'] = (int) round($r['gap_after'] * $scale);
            }
            unset($r);
            // Recalcular total_h con los nuevos tamaños
            $total_h = 0;
            foreach ($rendered as $r) $total_h += $r['lh'] + $r['gap_after'];
            error_log("[NV Dashboard v1.0.70] auto-fit headline: bloque excedía 35% del frame, escalado x" . round($scale, 3) . " para caber en zona segura");
        }

        // ─── Y inicial según placement ───
        switch ($placement) {
            case 'top':    $start_y = (int) ($h * 0.07); break;
            case 'center': $start_y = (int) (($h - $total_h) / 2); break;
            case 'bottom':
            default:       $start_y = $h - (int) ($h * 0.07) - $total_h; break;
        }

        // ─── Dibujar ───
        $cur_y = $start_y;
        foreach ($rendered as $r) {
            $size  = $r['size_px'];
            $line  = $r['text'];
            // v1.0.63: usar la fuente persistida en cada item (regular o bold según corresponda)
            $f     = !empty($r['font']) ? $r['font'] : $font;
            $bbox  = imagettfbbox($size, 0, $f, $line);
            $tw    = $bbox[2] - $bbox[0];
            switch ($align) {
                case 'left':   $tx = $padding; break;
                case 'right':  $tx = $w - $padding - $tw; break;
                case 'center':
                default:       $tx = (int) (($w - $tw) / 2); break;
            }
            $ty = $cur_y + $size;

            // Stroke fino oscuro semi-transparente (legibilidad universal sin pesadez)
            self::draw_text_with_thin_stroke($img, $tx, $ty, $size, $f, $line, $r['color_rgb'], $r['bold']);

            $cur_y += $r['lh'] + $r['gap_after'];
        }
    }

    /**
     * v1.0.44 — Texto limpio. Sin biselado.
     *
     * Fill plano + ÚNICA sombra suave detrás (no es un stroke, es una sombra
     * de offset cero blured-style usando 1 sola pasada con alpha bajo).
     * Da legibilidad mínima sobre fondos contrastados sin la pesadez del
     * multi-layer stroke de v1.0.42.
     *
     * El bold se simula con doble pasada offset 1px (faux-bold).
     */
    /**
     * v1.0.52 — Layout "frame" estilo Guardamuebles Reva.
     *
     * Replica el patrón visual de las refs subidas por el cliente:
     *   1) Triángulo diagonal de color primary en esquina superior derecha,
     *      con la palabra-marca (última palabra del nombre del cliente) en
     *      letras grandes contrastadas dentro de la franja.
     *   2) Cápsulas individuales por línea de texto, con fondo opaco (negro
     *      por defecto, color brand cuando la línea es accent/primary), texto
     *      blanco o contrastante.
     *   3) Apilado vertical en la zona inferior izquierda con padding consistente.
     *
     * Diseñado para clientes con identidad visual fuerte donde el texto debe
     * estar enmarcado, no flotando sobre la imagen. Los colores brand se
     * respetan al 100% (sin brighten_if_dark, sin stroke contrastante).
     *
     * NOTA: GD nativo no soporta esquinas redondeadas en imagefilledrectangle.
     * Las cápsulas son rectángulos rectos. Para "redondeadas" necesitaríamos
     * imagefilledellipse compuesto, pero el aspecto rectangular es coherente
     * con el patrón observado en las refs de Guardamuebles Reva.
     */
    private static function apply_frame_layout($img, $args) {
        $w = imagesx($img); $h = imagesy($img);
        $font = $args['font_path'];
        // v1.0.63: fuentes regular y bold separadas
        $font_regular = !empty($args['font_regular']) && file_exists($args['font_regular']) ? $args['font_regular'] : $font;
        $font_bold    = !empty($args['font_bold'])    && file_exists($args['font_bold'])    ? $args['font_bold']    : $font;
        $primary = $args['primary'];
        $accent  = $args['accent'];
        $cliente_name = trim((string) ($args['cliente_name'] ?? ''));

        // ─── 1) Franja diagonal (triángulo en esquina superior derecha) ───
        $poly = [
            (int) ($w * 0.45), 0,
            $w, 0,
            $w, (int) ($h * 0.55),
        ];
        $col_primary = imagecolorallocate($img, $primary[0], $primary[1], $primary[2]);
        imagefilledpolygon($img, $poly, count($poly) / 2, $col_primary);

        // ─── 2) Logo del cliente (última palabra) sobre la franja ───
        if ($cliente_name !== '') {
            $words = preg_split('/\s+/u', $cliente_name);
            $words = array_values(array_filter($words, function($x){ return $x !== ''; }));
            $brand_word = !empty($words) ? mb_strtoupper(end($words)) : '';
            // v1.0.54: normalizar UTF-8 (puede venir con tildes desde nombre del cliente)
            $brand_word = self::normalize_utf8_for_render($brand_word);
            if ($brand_word !== '' && mb_strlen($brand_word) <= 12) {
                $logo_size = (int) ($h * 0.06);
                $bbox = imagettfbbox($logo_size, 0, $font, $brand_word);
                $logo_w = $bbox[2] - $bbox[0];
                $logo_x = $w - $logo_w - (int) ($w * 0.06);
                $logo_y = (int) ($h * 0.09) + $logo_size;
                // Color del texto sobre la franja: contraste según luminancia del primary
                $text_on_primary = self::contrast_text_color($primary);
                $col_logo = imagecolorallocate($img, $text_on_primary[0], $text_on_primary[1], $text_on_primary[2]);
                imagettftext($img, $logo_size, 0, $logo_x, $logo_y, $col_logo, $font, $brand_word);
            }
        }

        // ─── 3) Cápsulas para headline_lines ───
        $headline_lines = isset($args['headline_lines']) && is_array($args['headline_lines']) ? $args['headline_lines'] : [];

        // Backwards compat: convertir headline plano a 1 línea
        $plain_headline = isset($args['headline']) ? trim((string) $args['headline']) : '';
        if (empty($headline_lines) && $plain_headline !== '') {
            $headline_lines = [['text' => $plain_headline, 'size' => 'lg', 'color' => 'white', 'weight' => 'bold']];
        }
        if (empty($headline_lines)) return;

        // Mapeo de tamaños — un poco mayor que en clean para que las cápsulas tengan presencia
        $size_map = [
            'sm' => 0.034,
            'md' => 0.052,
            'lg' => 0.072,
            'xl' => 0.090,
        ];
        $padding_h = (int) ($w * 0.030);
        $padding_v = (int) ($h * 0.014);
        $gap       = (int) ($h * 0.014);
        $max_w_capsule = (int) ($w * 0.78); // las cápsulas no ocupan toda la imagen

        // Construir cápsulas y precalcular dimensiones
        $capsules = [];
        $total_h = 0;
        foreach ($headline_lines as $line) {
            $text = trim((string) ($line['text'] ?? ''));
            if ($text === '') continue;
            // v1.0.54: normalizar UTF-8 (mojibake / entities / bytes inválidos)
            $text = self::normalize_utf8_for_render($text);
            if ($text === '') continue;
            $size_token  = $line['size'] ?? 'md';
            $color_token = $line['color'] ?? 'white';
            $weight      = $line['weight'] ?? 'regular';
            $size_pct    = $size_map[$size_token] ?? 0.052;
            $size_px_max = (int) ($h * $size_pct);
            $size_px_min = max(18, (int) ($size_px_max * 0.50));

            // v1.0.63: elegir fuente según weight
            $font_for_line = ($weight === 'bold') ? $font_bold : $font_regular;

            // Auto-fit: reducir tamaño si el texto+padding desborda max_w_capsule
            $size_px = $size_px_max;
            for ($attempt = 0; $attempt < 12; $attempt++) {
                $bbox = imagettfbbox($size_px, 0, $font_for_line, $text);
                $tw = $bbox[2] - $bbox[0];
                if ($tw + 2 * $padding_h <= $max_w_capsule || $size_px <= $size_px_min) break;
                $size_px = (int) ($size_px * 0.92);
            }
            $bbox = imagettfbbox($size_px, 0, $font_for_line, $text);
            $tw = $bbox[2] - $bbox[0];
            $th = $bbox[1] - $bbox[7];
            $cap_w = $tw + 2 * $padding_h;
            $cap_h = $th + 2 * $padding_v;

            // Color de fondo de la cápsula
            $bg_token = 'black'; // default
            if (in_array($color_token, ['accent', 'primary'], true)) $bg_token = $color_token;

            $capsules[] = [
                'text' => $text,
                'size' => $size_px,
                'tw' => $tw, 'th' => $th,
                'cap_w' => $cap_w, 'cap_h' => $cap_h,
                'bold' => ($weight === 'bold'),
                'font' => $font_for_line, // v1.0.63: persistir font de cada cápsula
                'bg_token' => $bg_token,
            ];
            $total_h += $cap_h + $gap;
        }
        if (!empty($capsules)) $total_h -= $gap;

        // v1.0.70: AUTO-FIT también en layout 'frame' — si total_h > 35% h, escalar.
        $max_block_h_frame = (int) ($h * 0.35);
        if ($total_h > $max_block_h_frame && $total_h > 0 && !empty($capsules)) {
            $scale_f = $max_block_h_frame / $total_h;
            $total_h = 0;
            foreach ($capsules as &$cap) {
                $cap['size']  = max(14, (int) round($cap['size']  * $scale_f));
                $cap['cap_h'] = (int) round($cap['cap_h'] * $scale_f);
                $cap['cap_w'] = (int) round($cap['cap_w'] * $scale_f);
                $cap['tw']    = (int) round($cap['tw']    * $scale_f);
                $cap['th']    = (int) round($cap['th']    * $scale_f);
                $total_h += $cap['cap_h'] + $gap;
            }
            unset($cap);
            if (!empty($capsules)) $total_h -= $gap;
            error_log("[NV Dashboard v1.0.70] auto-fit frame_layout: bloque excedía 35%, escalado x" . round($scale_f, 3));
        }

        // Posicionar bloque según placement
        $placement = isset($args['placement']) ? $args['placement'] : 'bottom';
        $x_left = (int) ($w * 0.05);
        switch ($placement) {
            case 'top':    $start_y = (int) ($h * 0.07); break;
            case 'center': $start_y = (int) (($h - $total_h) / 2); break;
            case 'bottom':
            default:       $start_y = $h - $total_h - (int) ($h * 0.07); break;
        }

        $cur_y = $start_y;
        foreach ($capsules as $cap) {
            switch ($cap['bg_token']) {
                case 'primary':
                    $bg_rgb = $primary;
                    $text_rgb = self::contrast_text_color($primary);
                    break;
                case 'accent':
                    $bg_rgb = $accent;
                    $text_rgb = self::contrast_text_color($accent);
                    break;
                case 'black':
                default:
                    $bg_rgb = [10, 10, 10];
                    $text_rgb = [255, 255, 255];
                    break;
            }

            // Cápsula con alpha 25/127 ≈ 80% opaco para que se sienta sobre la imagen
            // pero no sea totalmente plano. (Brand bg también semi-opaco.)
            $bg = imagecolorallocatealpha($img, $bg_rgb[0], $bg_rgb[1], $bg_rgb[2], 25);
            $text_color = imagecolorallocate($img, $text_rgb[0], $text_rgb[1], $text_rgb[2]);

            $x_right = $x_left + $cap['cap_w'];
            $y_top   = $cur_y;
            $y_bot   = $cur_y + $cap['cap_h'];

            imagefilledrectangle($img, $x_left, $y_top, $x_right, $y_bot, $bg);

            $tx = $x_left + $padding_h;
            $ty = $cur_y + $padding_v + $cap['th'];
            // v1.0.63: usar la fuente persistida en cada cápsula (regular o bold según corresponda)
            $f_cap = !empty($cap['font']) ? $cap['font'] : $font;
            imagettftext($img, $cap['size'], 0, $tx, $ty, $text_color, $f_cap, $cap['text']);
            // Faux-bold opcional con offset 1px en X (solo si NO tenemos una bold real diferente)
            if ($cap['bold'] && $f_cap === $font_regular) {
                imagettftext($img, $cap['size'], 0, $tx + 1, $ty, $text_color, $f_cap, $cap['text']);
            }

            $cur_y += $cap['cap_h'] + $gap;
        }
    }

    /**
     * v1.0.52: helper. Devuelve [10,10,10] (negro) o [255,255,255] (blanco)
     * según luminancia del rgb dado, para garantizar contraste en texto que
     * va sobre un fondo de ese color.
     */
    private static function contrast_text_color($rgb) {
        $lum = (0.2126 * $rgb[0] + 0.7152 * $rgb[1] + 0.0722 * $rgb[2]) / 255;
        return ($lum > 0.6) ? [10, 10, 10] : [255, 255, 255];
    }

    /**
     * v1.0.54 — Normaliza un string a UTF-8 puro válido para imagettftext.
     *
     * Detecta y arregla los tres modos típicos de corrupción que dan "texto raro"
     * en español al renderizar con GD:
     *   1. Mojibake / doble codificación: "MÃ¡S ESPACIO" en vez de "MÁS ESPACIO".
     *      Sucede cuando UTF-8 se interpreta como Latin1 y se vuelve a codificar
     *      como UTF-8. Lo detectamos por patrones (Ã¡, Ã©, Ã±, Ã³, Ãº, Ã"...) y
     *      des-codificamos UNA pasada Latin1→UTF-8.
     *   2. HTML entities: "M&aacute;S ESPACIO" cuando el JSON o algún sanitizer
     *      las introdujo. html_entity_decode las resuelve.
     *   3. Bytes UTF-8 inválidos: si por algún punto del flujo el string tiene
     *      bytes corruptos, mb_convert_encoding('UTF-8','UTF-8') los limpia.
     *
     * El fix es idempotente: aplicar dos veces a un texto correcto NO lo daña
     * (los patrones de mojibake solo se buscan, no se asume nada).
     */
    private static function normalize_utf8_for_render($text) {
        if (!is_string($text) || $text === '') return '';

        // 1) Decodificar HTML entities por si el JSON o sanitize_text_field las dejó
        if (function_exists('html_entity_decode')) {
            $decoded = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
            if (is_string($decoded)) $text = $decoded;
        }

        // 2) Detectar mojibake (doble codificación UTF-8 → Latin1 → UTF-8)
        // Buscamos patrones típicos de tildes españolas mal codificadas
        $mojibake_patterns = ['Ã¡','Ã©','Ã­','Ã³','Ãº','Ã±','Ã\x81','Ã\x89','Ã\x8d','Ã\x93','Ã\x9a','Ã\x91','Â¡','Â¿','Ã\xbc','Ã\x9c'];
        $has_mojibake = false;
        foreach ($mojibake_patterns as $p) {
            if (strpos($text, $p) !== false) { $has_mojibake = true; break; }
        }
        if ($has_mojibake && function_exists('mb_convert_encoding')) {
            $fixed = @mb_convert_encoding($text, 'ISO-8859-1', 'UTF-8');
            if (is_string($fixed) && $fixed !== '' && function_exists('mb_check_encoding') && mb_check_encoding($fixed, 'UTF-8')) {
                $text = $fixed;
            }
        }

        // 3) Asegurar UTF-8 válido descartando bytes corruptos
        if (function_exists('mb_check_encoding') && function_exists('mb_convert_encoding')) {
            if (!mb_check_encoding($text, 'UTF-8')) {
                $text = mb_convert_encoding($text, 'UTF-8', 'UTF-8');
            }
        }

        return (string) $text;
    }

    private static function draw_text_with_thin_stroke($img, $x, $y, $size, $font, $text, $rgb_fill, $bold = false) {
        // v1.0.54: normalizar UTF-8 antes de imagettftext para evitar mojibake/entities
        $text = self::normalize_utf8_for_render($text);

        // v1.0.52: TEXTO LIMPIO sin biselado/stroke. David rechazó explícitamente
        // cualquier tipo de contorno. Pipeline minimal:
        //   1) Sombra suave (legibilidad sobre fondos claros sin marcarse).
        //   2) Fill principal con el color brand exacto.
        //   3) Faux-bold opcional (doble pasada offset 1px en X).
        //
        // Si el cliente necesita legibilidad sobre fondos contrastantes, la
        // resolución correcta es aplicar un layout "frame" (cápsulas con fondo
        // opaco bajo cada línea) — ver apply_frame_layout. NUNCA stroke.

        // 1) Sombra sutil a offset 2,3 — alpha 100/127 ≈ 21% opaco
        $shadow = imagecolorallocatealpha($img, 0, 0, 0, 100);
        imagettftext($img, $size, 0, $x + 2, $y + 3, $shadow, $font, $text);

        // 2) Fill principal — color brand exacto, plano
        $fill = imagecolorallocate($img, $rgb_fill[0], $rgb_fill[1], $rgb_fill[2]);
        imagettftext($img, $size, 0, $x, $y, $fill, $font, $text);

        // 3) Faux-bold: pasada extra con offset 1px en X
        if ($bold) {
            imagettftext($img, $size, 0, $x + 1, $y, $fill, $font, $text);
        }
    }

    /**
     * @deprecated v1.0.51 — ya no se invoca desde resolve_color ni desde dato/cta.
     *             Se mantiene definido por compat por si algún callsite externo
     *             la usa. La legibilidad universal se consigue ahora vía stroke
     *             contrastante automático en draw_text_with_thin_stroke.
     */
    private static function brighten_if_dark($rgb) {
        $r = $rgb[0] / 255; $g = $rgb[1] / 255; $b = $rgb[2] / 255;
        $lum = 0.2126 * $r + 0.7152 * $g + 0.0722 * $b;
        if ($lum >= 0.45) return $rgb;
        $factor = 0.55;
        return [
            (int) ($rgb[0] + (255 - $rgb[0]) * $factor),
            (int) ($rgb[1] + (255 - $rgb[1]) * $factor),
            (int) ($rgb[2] + (255 - $rgb[2]) * $factor),
        ];
    }

    /**
     * v1.0.39 — Fallback determinista para headline_lines.
     *
     * Cuando la AI no devuelve headline_lines NI headline plano, construimos una
     * composición desde el título del post y el nombre del cliente. La heurística:
     *   1. Detectar palabra "marca" del nombre del cliente (última palabra suele
     *      ser la distintiva: "Clínica MARCH", "Guardamuebles REVA"). Esa va xl+accent.
     *   2. Resto del cliente va xl bold blanco.
     *   3. Título del post (recortado si es largo) va md.
     *
     * Resultado mínimo viable: SIEMPRE hay 2-4 líneas de texto.
     */
    private static function build_fallback_headline_lines($post_title, $cliente_name) {
        $lines = [];
        $title = trim((string) $post_title);
        $cli   = trim((string) $cliente_name);

        // 1) Decomposición del nombre del cliente
        if ($cli !== '') {
            $cli_words = preg_split('/\s+/u', $cli);
            $cli_words = array_filter($cli_words, function($w){ return $w !== ''; });
            $cli_words = array_values($cli_words);
            if (count($cli_words) === 1) {
                $lines[] = ['text' => mb_strtoupper($cli_words[0]), 'size' => 'xl', 'color' => 'accent', 'weight' => 'bold'];
            } else {
                // Más de una palabra: última = marca distintiva (accent), resto = blanco
                $brand_word = array_pop($cli_words);
                $rest = implode(' ', $cli_words);
                if (mb_strlen($rest) <= 12) {
                    $lines[] = ['text' => mb_strtoupper($rest), 'size' => 'xl', 'color' => 'white', 'weight' => 'bold'];
                } else {
                    $lines[] = ['text' => mb_strtoupper($rest), 'size' => 'lg', 'color' => 'white', 'weight' => 'bold'];
                }
                $lines[] = ['text' => mb_strtoupper($brand_word), 'size' => 'xl', 'color' => 'accent', 'weight' => 'bold'];
            }
        }

        // 2) Título del post (limpiado y recortado para no saturar)
        if ($title !== '') {
            // Quitar prefijo redundante del cliente si lo tuviera
            if ($cli !== '' && stripos($title, $cli) === 0) {
                $title = trim(substr($title, mb_strlen($cli)));
                $title = ltrim($title, " -·:|—");
            }
            // Recortar si es muy largo (max ~40 chars para que se lea bien)
            if (mb_strlen($title) > 50) {
                $title = mb_substr($title, 0, 47) . '…';
            }
            if ($title !== '') {
                $lines[] = ['text' => $title, 'size' => 'md', 'color' => 'white', 'weight' => 'regular'];
            }
        }

        // 3) Si no había NADA (caso límite), poner al menos cliente o un texto neutro
        if (empty($lines)) {
            $lines[] = ['text' => $cli !== '' ? mb_strtoupper($cli) : 'NEGOCIO VIVO', 'size' => 'lg', 'color' => 'white', 'weight' => 'bold'];
        }

        return $lines;
    }

    // ─────────────────────────────────────────────────────────────────────
    // v1.0.28: Imágenes de referencia visual del cliente para Anthropic vision
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Carga las imágenes de referencia de un cliente, las redimensiona a max
     * 1024px y las codifica en base64 para enviarlas como content blocks de
     * tipo "image" a la Anthropic Messages API.
     *
     * Limita a 5 imágenes (suficiente para extraer estilo) para controlar
     * coste de tokens.
     *
     * @return array  array de content blocks {type:'image', source:{type:'base64', media_type, data}}
     */
    private static function prepare_reference_images_for_anthropic($term_id, $max_count = 5) {
        if (!class_exists('NV_Cliente_Meta')) return [];
        $ids = NV_Cliente_Meta::get_reference_images($term_id);
        if (empty($ids)) return [];
        if (count($ids) > $max_count) $ids = array_slice($ids, 0, $max_count);

        $blocks = [];
        foreach ($ids as $aid) {
            $path = get_attached_file($aid);
            if (!$path || !file_exists($path)) continue;

            $info = @getimagesize($path);
            if (!$info) continue;
            $mime = $info['mime'];
            if (!in_array($mime, ['image/jpeg','image/png','image/webp','image/gif'], true)) continue;

            // Cargar y redimensionar a max 1024px lado largo
            $src = null;
            switch ($info[2]) {
                case IMAGETYPE_JPEG: $src = @imagecreatefromjpeg($path); break;
                case IMAGETYPE_PNG:  $src = @imagecreatefrompng($path);  break;
                case IMAGETYPE_WEBP: $src = function_exists('imagecreatefromwebp') ? @imagecreatefromwebp($path) : null; break;
                case IMAGETYPE_GIF:  $src = @imagecreatefromgif($path);  break;
            }
            if (!$src) continue;

            $w0 = imagesx($src); $h0 = imagesy($src);
            $maxd = 1024;
            if ($w0 > $maxd || $h0 > $maxd) {
                $ratio = $maxd / max($w0, $h0);
                $w1 = (int) round($w0 * $ratio);
                $h1 = (int) round($h0 * $ratio);
                $dst = imagecreatetruecolor($w1, $h1);
                if ($info[2] === IMAGETYPE_PNG || $info[2] === IMAGETYPE_WEBP) {
                    imagealphablending($dst, false);
                    imagesavealpha($dst, true);
                }
                imagecopyresampled($dst, $src, 0, 0, 0, 0, $w1, $h1, $w0, $h0);
                imagedestroy($src);
                $src = $dst;
            }

            // Convertir todo a JPEG calidad 80 para Anthropic (más compacto, suficiente para análisis de estilo)
            ob_start();
            imagejpeg($src, null, 80);
            $bytes = ob_get_clean();
            imagedestroy($src);

            if (!$bytes) continue;
            $blocks[] = [
                'type'   => 'image',
                'source' => [
                    'type'       => 'base64',
                    'media_type' => 'image/jpeg',
                    'data'       => base64_encode($bytes),
                ],
            ];
        }

        return $blocks;
    }

    // ─────────────────────────────────────────────────────────────────────
    // v1.0.33: Endpoint para pre-cachear la guía de estilo de un cliente
    // ─────────────────────────────────────────────────────────────────────

    /**
     * POST /actualizar-guia-estilo/{term_id}
     *
     * Llama a Anthropic Sonnet vision con las refs visuales del cliente y
     * el brand_brief, le pide que extraiga una guía de estilo en inglés
     * (paleta hex, tipografía, mood, composición), y la cachea en term_meta.
     *
     * Esta llamada es lenta (10-25s) porque procesa imágenes vision. Pero solo
     * se hace UNA vez por cliente; las generaciones de copy posteriores usan
     * la guía cacheada como texto plano, ahorrando ese tiempo en cada post.
     */
    public static function actualizar_guia_estilo($request) {
        @set_time_limit(180);
        @ini_set('memory_limit', '512M');

        $term_id = (int) $request['term_id'];
        $term = get_term($term_id, 'nv_cliente');
        if (!$term || is_wp_error($term)) {
            return new WP_Error('invalid_term', 'Cliente no encontrado', ['status' => 404]);
        }

        $api_key = get_option('nv_dashboard_anthropic_api_key', '');
        if (empty($api_key)) {
            return new WP_Error('no_api_key', 'Anthropic API key no configurada en NV Dashboard → Configuración', ['status' => 500]);
        }
        $modelo = get_option('nv_dashboard_anthropic_model', 'claude-sonnet-4-5');

        // Cargar refs (con redimensionado y base64)
        $ref_blocks = self::prepare_reference_images_for_anthropic($term_id);
        if (empty($ref_blocks)) {
            return new WP_Error('no_refs', 'Este cliente no tiene imágenes de referencia. Sube al menos una para poder generar guía de estilo.', ['status' => 400]);
        }

        $brand_brief = class_exists('NV_Cliente_Meta') ? NV_Cliente_Meta::get_brand_brief($term_id) : '';
        if (empty($brand_brief)) $brand_brief = '(sin brief específico)';

        $system_prompt  = "You are a brand visual analyst. You receive reference images from a client and must extract a precise visual style guide in English to be used as a prompt for a text-to-image AI (gpt-image-2). ";
        $system_prompt .= "Be specific and concrete. Output ONLY a single JSON object {\"image_style_guide\": \"...\"} with no markdown or extra text.";

        $user_text = "CLIENTE: {$term->name}\n";
        $user_text .= "Brand brief:\n{$brand_brief}\n\n";
        $user_text .= "REFERENCE IMAGES: I've attached " . count($ref_blocks) . " reference images of this client's visual style.\n\n";
        $user_text .= "TASK: Analyze the references and produce an image_style_guide (80-200 words, English) that will be injected into image generation prompts. Include:\n";
        $user_text .= "- Exact color palette in hex (e.g., 'primary palette: #2A4D6E warm navy, #D2A039 gold accent, #F5F1E8 cream background')\n";
        $user_text .= "- Photographic style (lighting, depth of field, framing)\n";
        $user_text .= "- Typical composition (subject placement, negative space)\n";
        $user_text .= "- Mood and tone (warm/cool, professional/casual, aspirational/practical)\n";
        $user_text .= "- Typography style if visible (modern sans, classic serif, etc.)\n\n";
        $user_text .= "Be concrete. Avoid generic terms like 'professional' without context.\n\n";
        $user_text .= "RETURN: {\"image_style_guide\": \"...\"}";

        $user_content = array_merge(
            [['type' => 'text', 'text' => $user_text]],
            $ref_blocks
        );

        $response = wp_remote_post('https://api.anthropic.com/v1/messages', [
            'timeout' => 120,
            'headers' => [
                'x-api-key' => $api_key,
                'anthropic-version' => '2023-06-01',
                'content-type' => 'application/json',
            ],
            'body' => wp_json_encode([
                'model'      => $modelo,
                'max_tokens' => 1500,
                'system'     => $system_prompt,
                'messages'   => [['role' => 'user', 'content' => $user_content]],
            ]),
        ]);

        if (is_wp_error($response)) {
            return new WP_Error('anthropic_network', 'Error de red Anthropic: ' . $response->get_error_message(), ['status' => 502]);
        }
        $code = wp_remote_retrieve_response_code($response);
        $body = json_decode(wp_remote_retrieve_body($response), true);
        if ($code !== 200) {
            $msg = isset($body['error']['message']) ? $body['error']['message'] : ('HTTP ' . $code);
            return new WP_Error('anthropic_error', 'Anthropic: ' . $msg, ['status' => 502]);
        }

        $texto = isset($body['content'][0]['text']) ? $body['content'][0]['text'] : '';
        if (empty($texto)) {
            return new WP_Error('empty_response', 'Anthropic devolvió respuesta vacía', ['status' => 502]);
        }

        // Parse tolerante
        $clean = $texto;
        if (preg_match('/```(?:json)?\s*(\{.+?\})\s*```/s', $clean, $m)) $clean = $m[1];
        elseif (preg_match('/\{.+\}/s', $clean, $m)) $clean = $m[0];
        $data = json_decode($clean, true);
        $guide = is_array($data) && !empty($data['image_style_guide']) ? (string) $data['image_style_guide'] : '';

        if (empty($guide)) {
            // Fallback: usar el texto crudo como guía (truncado)
            $guide = mb_substr(trim($texto), 0, 1500);
        }

        // Cachear con hash de la lista actual de refs
        $hash = NV_Cliente_Meta::get_reference_images_hash($term_id);
        NV_Cliente_Meta::set_style_guide_cached($term_id, $guide, $hash);

        return rest_ensure_response([
            'success' => true,
            'term_id' => $term_id,
            'length'  => strlen($guide),
            'hash'    => $hash,
            'guide'   => $guide,
        ]);
    }

    // ─────────────────────────────────────────────────────────────────────
    // v1.0.34: Diagnóstico y reparación de publicaciones huérfanas
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Detecta posts nv_publicacion con post_status=publish que NO tienen
     * el meta nv_fecha_publicacion (típicamente porque un timeout de hosting
     * cortó la creación a mitad). Estas publicaciones son invisibles al
     * calendario pero ocupan espacio en WP Admin.
     *
     * GET /wp-json/nv/v1/diagnostico-publicaciones-huerfanas
     */
    public static function diagnostico_publicaciones_huerfanas($request) {
        $args = [
            'post_type'      => 'nv_publicacion',
            'post_status'    => 'publish',
            'posts_per_page' => -1,
            'fields'         => 'ids',
        ];
        $all_ids = get_posts($args);
        $orphans = [];
        foreach ($all_ids as $pid) {
            $fecha = get_post_meta($pid, 'nv_fecha_publicacion', true);
            if (empty($fecha)) {
                $p = get_post($pid);
                $orphans[] = [
                    'id'        => $pid,
                    'title'     => $p ? $p->post_title : '(sin título)',
                    'date'      => $p ? $p->post_date : '',
                    'edit_url'  => admin_url('post.php?post=' . $pid . '&action=edit'),
                ];
            }
        }
        return rest_ensure_response([
            'total_publish' => count($all_ids),
            'orphans'       => $orphans,
            'orphan_count'  => count($orphans),
        ]);
    }

    /**
     * Borra (force_delete=true) las publicaciones huérfanas que pasan en el body.
     *
     * POST /wp-json/nv/v1/reparar-publicaciones-huerfanas
     * Body: { "ids": [123, 456, ...], "action": "delete" | "convert_to_draft" }
     *
     * - delete: borra definitivamente (default)
     * - convert_to_draft: las pasa a draft (visibles en lista de borradores
     *   para que el usuario decida)
     */
    public static function reparar_publicaciones_huerfanas($request) {
        $params = $request->get_json_params();
        $ids = isset($params['ids']) && is_array($params['ids']) ? array_map('intval', $params['ids']) : [];
        $action = isset($params['action']) ? $params['action'] : 'delete';

        if (empty($ids)) {
            return new WP_Error('no_ids', 'Lista de IDs vacía', ['status' => 400]);
        }

        $processed = [];
        $skipped   = [];
        foreach ($ids as $pid) {
            $p = get_post($pid);
            if (!$p || $p->post_type !== 'nv_publicacion') {
                $skipped[] = ['id' => $pid, 'reason' => 'no es nv_publicacion'];
                continue;
            }
            // Verificar de nuevo que sigue siendo huérfana (no estamos borrando posts válidos)
            $fecha = get_post_meta($pid, 'nv_fecha_publicacion', true);
            if (!empty($fecha)) {
                $skipped[] = ['id' => $pid, 'reason' => 'tiene fecha asignada, no es huérfana'];
                continue;
            }

            if ($action === 'convert_to_draft') {
                wp_update_post(['ID' => $pid, 'post_status' => 'draft']);
                $processed[] = ['id' => $pid, 'action' => 'converted_to_draft'];
            } else {
                $deleted = wp_delete_post($pid, true); // force delete
                if ($deleted) {
                    $processed[] = ['id' => $pid, 'action' => 'deleted'];
                } else {
                    $skipped[] = ['id' => $pid, 'reason' => 'wp_delete_post falló'];
                }
            }
        }

        return rest_ensure_response([
            'success'   => true,
            'action'    => $action,
            'processed' => $processed,
            'skipped'   => $skipped,
            'count'     => count($processed),
        ]);
    }

    /**
     * v1.0.39 — Borrar una publicación específica (usado por la papelera drag-drop).
     * DELETE /wp-json/nv/v1/publicacion/{id}
     */
    public static function borrar_publicacion($request) {
        $id = (int) $request['id'];
        if ($id <= 0) {
            return new WP_Error('invalid_id', 'ID inválido', ['status' => 400]);
        }
        $p = get_post($id);
        if (!$p || $p->post_type !== 'nv_publicacion') {
            return new WP_Error('not_found', 'No se encontró la publicación o no es del tipo correcto', ['status' => 404]);
        }
        $title = $p->post_title;
        $deleted = wp_delete_post($id, true);
        if (!$deleted) {
            return new WP_Error('delete_failed', 'wp_delete_post falló', ['status' => 500]);
        }
        return rest_ensure_response(['success' => true, 'id' => $id, 'title' => $title]);
    }

    /**
     * v1.0.56 — Repara el bug Unicode "CLuoocdNICA" en posts ya creados.
     *
     * Causa raíz: en algunos hostings (verificado en hub.negociovivo.com /
     * Hetzner WP 6.9.4 PHP 8.3.6), guardar con
     * update_post_meta($id, '_nv_headline_lines', wp_json_encode($arr))
     * provoca que WP aplique internamente un slash/unslash que come la barra
     * invertida del escape \uXXXX, dejando "CLu00cdNICA" como texto literal.
     *
     * Esta función detecta ese patrón en posts ya creados y los repara. El fix
     * preventivo está en líneas 1577 y 2435 (JSON_UNESCAPED_UNICODE), pero los
     * posts creados antes de ese fix necesitan esta reparación retroactiva.
     *
     * POST /wp-json/nv/v1/reparar-headline-unicode
     *   body vacío           → repara todos los posts del CPT
     *   body {"post_id": N}  → repara solo ese post
     *
     * Idempotente: posts ya correctos no se tocan.
     * Tras reparar, llamar a /reaplicar-overlay/{id} para regenerar el PNG.
     */
    public static function reparar_headline_unicode($request) {
        $params = $request->get_json_params();
        $target_id = isset($params['post_id']) ? (int) $params['post_id'] : 0;

        $args = [
            'post_type'      => 'nv_publicacion',
            'posts_per_page' => -1,
            'post_status'    => ['publish', 'draft', 'pending', 'private'],
            'fields'         => 'ids',
        ];
        if ($target_id > 0) {
            $args['p'] = $target_id;
        }
        $ids = get_posts($args);

        $resultados = [
            'total_revisados' => count($ids),
            'reparados'       => [],
            'sin_cambios'     => [],
        ];

        foreach ($ids as $pid) {
            $hl_raw = get_post_meta($pid, '_nv_headline_lines', true);
            if (empty($hl_raw)) {
                $resultados['sin_cambios'][] = ['id' => $pid, 'razon' => 'sin headline_lines'];
                continue;
            }

            // Detectar patrón "uXXXX" sin barra invertida precedente.
            // Indica que el escape \uXXXX original perdió la barra.
            $tiene_corrupcion = preg_match('/(?<!\\\\)u[0-9a-fA-F]{4}/', $hl_raw);

            if (!$tiene_corrupcion) {
                $resultados['sin_cambios'][] = ['id' => $pid, 'razon' => 'no parece corrupto'];
                continue;
            }

            // Reañadir la barra invertida → cadena vuelve a ser JSON válido con escape Unicode
            $hl_fixed = preg_replace_callback(
                '/(?<!\\\\)u([0-9a-fA-F]{4})/',
                function($m) { return '\\u' . $m[1]; },
                $hl_raw
            );

            $decoded = json_decode($hl_fixed, true);
            if (!is_array($decoded)) {
                $resultados['sin_cambios'][] = [
                    'id' => $pid,
                    'razon' => 'reparación falló al validar JSON tras añadir barra',
                    'raw_preview' => substr($hl_raw, 0, 200),
                ];
                continue;
            }

            // Re-encode con UNESCAPED_UNICODE para inmunidad al bug futuro
            $hl_clean = wp_json_encode($decoded, JSON_UNESCAPED_UNICODE);
            update_post_meta($pid, '_nv_headline_lines', $hl_clean);

            $resultados['reparados'][] = [
                'id'            => $pid,
                'titulo'        => get_the_title($pid),
                'antes_preview' => substr($hl_raw, 0, 150),
                'despues'       => substr($hl_clean, 0, 150),
            ];
        }

        return rest_ensure_response([
            'success'    => true,
            'mensaje'    => 'Reparación completada. Para que el cambio sea visible en la imagen, llama a POST /reaplicar-overlay/{id} para cada post reparado (re-pinta el texto sin volver a generar la imagen base, no consume crédito OpenAI).',
            'resultados' => $resultados,
        ]);
    }

    /**
     * v1.0.40 — Diagnóstico: ejecuta todo el flow de generar_imagen_publicacion
     * EXCEPTO la llamada a OpenAI. Devuelve lo que se habría hecho.
     * GET /wp-json/nv/v1/test-imagen-publicacion/{id}
     */
    public static function test_imagen_publicacion($request) {
        $post_id = (int) $request['id'];
        $post = get_post($post_id);
        if (!$post || $post->post_type !== 'nv_publicacion') {
            return new WP_Error('invalid_post', 'Publicación no encontrada', ['status' => 404]);
        }

        $diag = ['post_id' => $post_id, 'post_title' => $post->post_title];

        // Cliente
        $cli_terms = wp_get_object_terms($post_id, 'nv_cliente');
        $cliente = (!empty($cli_terms) && !is_wp_error($cli_terms)) ? $cli_terms[0] : null;
        $diag['cliente'] = $cliente ? ['slug' => $cliente->slug, 'name' => $cliente->name, 'term_id' => $cliente->term_id] : null;

        // Brand colors
        $diag['brand_colors'] = $cliente && class_exists('NV_Cliente_Meta')
            ? NV_Cliente_Meta::get_brand_colors($cliente->term_id)
            : null;

        // Style guide cacheada
        if ($cliente && class_exists('NV_Cliente_Meta')) {
            $diag['style_guide_cached'] = [
                'exists' => !empty(NV_Cliente_Meta::get_style_guide_cached($cliente->term_id)),
                'is_stale' => NV_Cliente_Meta::is_style_guide_stale($cliente->term_id),
                'length' => strlen(NV_Cliente_Meta::get_style_guide_cached($cliente->term_id)),
            ];
        }

        // Logo
        $diag['logo'] = [];
        if ($cliente && class_exists('NV_Cliente_Meta')) {
            $logo_path = NV_Cliente_Meta::get_logo_path($cliente->term_id);
            $diag['logo']['path'] = $logo_path;
            $diag['logo']['exists'] = $logo_path && file_exists($logo_path);
        }

        // Fuente
        $diag['font'] = [];
        if ($cliente && class_exists('NV_Cliente_Meta')) {
            $font_path = NV_Cliente_Meta::get_font_path($cliente->term_id);
            $diag['font']['path'] = $font_path;
            $diag['font']['exists'] = $font_path && file_exists($font_path);
        }

        // Image opts
        $stored_opts_raw = get_post_meta($post_id, '_nv_img_opts', true);
        $stored_opts = is_string($stored_opts_raw) ? json_decode($stored_opts_raw, true) : [];
        if (!is_array($stored_opts)) $stored_opts = [];
        $defaults = ['add_logo' => true, 'add_text' => true, 'add_data' => false, 'add_cta' => false, 'tone_emotivo' => false, 'tone_comercial' => false];
        $diag['img_opts'] = array_merge($defaults, $stored_opts);

        // Headline / lines / dato / cta
        $diag['meta'] = [
            'headline_plain' => (string) get_post_meta($post_id, '_nv_headline', true),
            'headline_lines_raw' => (string) get_post_meta($post_id, '_nv_headline_lines', true),
            'dato' => (string) get_post_meta($post_id, '_nv_dato_destacado', true),
            'cta'  => (string) get_post_meta($post_id, '_nv_cta_visible', true),
            'image_prompt' => (string) get_post_meta($post_id, '_nv_image_prompt', true),
            'image_style_guide' => (string) get_post_meta($post_id, '_nv_image_style_guide', true),
            'text_placement' => (string) get_post_meta($post_id, '_nv_text_placement', true),
            'text_align' => (string) get_post_meta($post_id, '_nv_text_align', true),
            'overlay_debug' => (string) get_post_meta($post_id, '_nv_overlay_debug', true),
            // v1.0.58: meta nuevos de v1.0.57 (refs automáticas) — para diagnóstico
            'image_endpoint_used'  => (string) get_post_meta($post_id, '_nv_image_endpoint_used', true),
            'image_refs_used'      => (string) get_post_meta($post_id, '_nv_image_refs_used', true),
            'image_refs_detection' => (string) get_post_meta($post_id, '_nv_image_refs_detection', true),
            // v1.0.59: meta de refs categorizadas y percent_targets
            'image_forced_types'   => (string) get_post_meta($post_id, '_nv_image_forced_types', true),
            'ref_relevance'        => (string) get_post_meta($post_id, '_nv_ref_relevance', true),
            'pct_targets_genmes'   => (string) get_post_meta($post_id, '_nv_pct_targets_genmes', true),
            'image_pct_resolved'   => (string) get_post_meta($post_id, '_nv_image_pct_resolved', true),
        ];
        $diag['meta']['headline_lines_parsed_count'] = is_array(json_decode($diag['meta']['headline_lines_raw'], true))
            ? count(json_decode($diag['meta']['headline_lines_raw'], true))
            : 0;

        // OpenAI key check (sin llamar)
        $openai_key = get_option('nv_dashboard_openai_api_key', '');
        $diag['openai_key_configured'] = !empty($openai_key);

        // PHP env
        $diag['php'] = [
            'version' => PHP_VERSION,
            'memory_limit' => ini_get('memory_limit'),
            'max_execution_time' => ini_get('max_execution_time'),
            'gd_loaded' => extension_loaded('gd'),
            'gd_freetype' => function_exists('imagettftext'),
        ];

        return rest_ensure_response(['success' => true, 'diag' => $diag]);
    }

    /**
     * v1.0.47 — Health check público para verificar el estado del plugin.
     * GET /wp-json/nv/v1/health
     */
    public static function health_check($request) {
        global $wp_rest_server;
        $routes = [];
        if ($wp_rest_server) {
            foreach ($wp_rest_server->get_routes() as $route => $endpoints) {
                if (strpos($route, '/nv/v1/') === 0) {
                    $methods = [];
                    foreach ($endpoints as $ep) {
                        if (isset($ep['methods'])) {
                            foreach ($ep['methods'] as $m => $on) {
                                if ($on) $methods[] = $m;
                            }
                        }
                    }
                    $routes[] = ['route' => $route, 'methods' => array_unique($methods)];
                }
            }
        }
        return rest_ensure_response([
            'success'    => true,
            'plugin'     => 'nv-dashboard',
            'version'    => defined('NV_DASHBOARD_VERSION') ? NV_DASHBOARD_VERSION : 'unknown',
            'php'        => PHP_VERSION,
            'wp'         => get_bloginfo('version'),
            'time'       => current_time('mysql'),
            'routes_count' => count($routes),
            'routes'     => $routes,
        ]);
    }

    /**
     * v1.0.46 — Analiza la web del cliente con IA y detecta:
     *   - Logo (mejor candidato entre favicon, apple-touch-icon, og:image, header img)
     *   - Color primario y de acento (extraídos de CSS inline + linked + analizados por Claude)
     *   - Fuente principal (font-family detectado en CSS)
     *
     * POST /wp-json/nv/v1/analizar-web-cliente
     * Body: { term_id, website_url, save (bool, opcional, default false) }
     *
     * Si save=true, persiste los valores detectados al term_meta del cliente.
     */
    public static function analizar_web_cliente($request) {
        $term_id      = (int) $request->get_param('term_id');
        $website_url  = (string) $request->get_param('website_url');
        $save         = (bool) $request->get_param('save');

        if ($term_id <= 0) {
            return new WP_Error('bad_request', 'term_id requerido', ['status' => 400]);
        }
        if (empty($website_url)) {
            // Si no se pasó, intentar leer del meta
            $website_url = (string) get_term_meta($term_id, 'nv_cliente_website', true);
        }
        if (empty($website_url)) {
            return new WP_Error('no_url', 'No hay URL de web para este cliente. Introdúcela primero.', ['status' => 400]);
        }
        // Validar URL
        $website_url = esc_url_raw($website_url);
        if (!filter_var($website_url, FILTER_VALIDATE_URL)) {
            return new WP_Error('invalid_url', 'La URL no es válida: ' . $website_url, ['status' => 400]);
        }

        // ─── 1) Fetch HTML ────────────────────────────────────────────────────
        $response = wp_remote_get($website_url, [
            'timeout'     => 30,
            'redirection' => 5,
            'user-agent'  => 'Mozilla/5.0 (compatible; NVDashboard/1.0; +https://negociovivo.com)',
            'sslverify'   => false, // Algunos hostings tienen certs raros
        ]);
        if (is_wp_error($response)) {
            return new WP_Error('fetch_failed', 'No se pudo descargar la web: ' . $response->get_error_message(), ['status' => 502]);
        }
        $http_code = wp_remote_retrieve_response_code($response);
        if ($http_code < 200 || $http_code >= 400) {
            return new WP_Error('fetch_failed', 'La web devolvió HTTP ' . $http_code, ['status' => 502]);
        }
        $html = wp_remote_retrieve_body($response);
        if (empty($html)) {
            return new WP_Error('empty_html', 'La web devolvió HTML vacío', ['status' => 502]);
        }

        // ─── 2) Extraer candidatos del HTML ──────────────────────────────────
        $candidates = self::extract_brand_candidates_from_html($html, $website_url);

        // ─── 3) Pedir a Anthropic que decida los mejores ─────────────────────
        $api_key = get_option('nv_dashboard_anthropic_api_key', '');
        if (empty($api_key)) {
            return new WP_Error('no_api_key', 'Falta la API key de Anthropic en Configuración', ['status' => 500]);
        }
        $modelo = get_option('nv_dashboard_anthropic_model', 'claude-sonnet-4-5');

        $system_prompt = "Eres un experto en branding analizando una web para detectar la identidad visual del negocio. "
                       . "Recibirás candidatos extraídos automáticamente del HTML/CSS. Tu tarea es seleccionar los MEJORES "
                       . "valores para representar la marca. Responde SOLO con JSON válido, sin explicaciones, sin markdown.";

        $user_prompt = "Analiza estos candidatos extraídos de la web " . $website_url . ":\n\n"
                     . wp_json_encode($candidates, JSON_PRETTY_PRINT) . "\n\n"
                     . "Devuelve un JSON con esta estructura EXACTA:\n"
                     . "{\n"
                     . '  "logo_url": "URL absoluta del mejor candidato a logo (preferir apple-touch-icon o og:image >300px sobre favicon pequeño). null si ninguno parece logo de marca.",' . "\n"
                     . '  "primary_color": "#HEX del color corporativo principal (suele ser el más usado en headers, botones primarios). null si no hay pista clara.",' . "\n"
                     . '  "accent_color": "#HEX del color de acento secundario (links, CTAs, highlights). null si no hay pista clara.",' . "\n"
                     . '  "text_color": "#HEX recomendado para texto sobre primario (suele ser #FFFFFF o un color claro). default \"#FFFFFF\".",' . "\n"
                     . '  "font_family": "Nombre de la fuente principal detectada (ej: \"Poppins\", \"Roboto\", \"Montserrat\"). null si solo hay genéricas (sans-serif).",' . "\n"
                     . '  "confidence": "alta | media | baja",' . "\n"
                     . '  "reasoning": "1-2 frases explicando la selección"' . "\n"
                     . "}\n\n"
                     . "REGLAS:\n"
                     . "- Si hay un logo claro y de buena resolución, úsalo.\n"
                     . "- Para colores: descarta blancos, negros y grises neutros (NO son corporativos). Busca el color de marca real.\n"
                     . "- Si los colores candidatos son todos blanco/negro/gris → devuelve null.\n"
                     . "- Para la fuente: ignora 'sans-serif', 'serif', 'system-ui'. Solo nombres específicos.\n"
                     . "- Si dudas, mejor null que adivinar mal.";

        $body = [
            'model'      => $modelo,
            'max_tokens' => 800,
            'system'     => $system_prompt,
            'messages'   => [
                ['role' => 'user', 'content' => $user_prompt],
            ],
        ];

        $resp = wp_remote_post('https://api.anthropic.com/v1/messages', [
            'timeout' => 60,
            'headers' => [
                'Content-Type'      => 'application/json',
                'x-api-key'         => $api_key,
                'anthropic-version' => '2023-06-01',
            ],
            'body'    => wp_json_encode($body),
        ]);
        if (is_wp_error($resp)) {
            return new WP_Error('anthropic_failed', 'Anthropic API: ' . $resp->get_error_message(), ['status' => 502]);
        }
        $code = wp_remote_retrieve_response_code($resp);
        $data = json_decode(wp_remote_retrieve_body($resp), true);
        if ($code !== 200 || empty($data['content'][0]['text'])) {
            return new WP_Error('anthropic_failed', 'Anthropic devolvió HTTP ' . $code . ': ' . wp_remote_retrieve_body($resp), ['status' => 502]);
        }

        $text = $data['content'][0]['text'];
        // Extraer JSON (quitar code fences si hay)
        $text_clean = preg_replace('/^```(?:json)?\s*|\s*```$/m', '', trim($text));
        $detected = json_decode($text_clean, true);
        if (!is_array($detected)) {
            return new WP_Error('parse_failed', 'Respuesta de Anthropic no parseable como JSON: ' . substr($text, 0, 300), ['status' => 502]);
        }

        // Sanitizar valores
        $logo_url      = isset($detected['logo_url']) ? esc_url_raw($detected['logo_url']) : '';
        $primary_color = isset($detected['primary_color']) ? self::sanitize_hex_strict($detected['primary_color']) : '';
        $accent_color  = isset($detected['accent_color'])  ? self::sanitize_hex_strict($detected['accent_color'])  : '';
        $text_color    = isset($detected['text_color'])    ? self::sanitize_hex_strict($detected['text_color'])    : '';
        $font_family   = isset($detected['font_family']) && is_string($detected['font_family']) ? sanitize_text_field($detected['font_family']) : '';
        $confidence    = isset($detected['confidence']) ? sanitize_text_field($detected['confidence']) : 'baja';
        $reasoning     = isset($detected['reasoning']) ? sanitize_text_field($detected['reasoning']) : '';

        $result = [
            'logo_url'      => $logo_url,
            'primary_color' => $primary_color,
            'accent_color'  => $accent_color,
            'text_color'    => $text_color ?: '#FFFFFF',
            'font_family'   => $font_family,
            'confidence'    => $confidence,
            'reasoning'     => $reasoning,
            'website_url'   => $website_url,
            'candidates'    => $candidates, // para debugging
        ];

        // ─── 4) Si save=true, persistir y descargar el logo ──────────────────
        if ($save) {
            // Persistir URL de la web (por si vino directo, no del form)
            update_term_meta($term_id, 'nv_cliente_website', $website_url);
            // Persistir colores si la IA los detectó
            if (!empty($primary_color)) update_term_meta($term_id, 'nv_brand_color_primary', $primary_color);
            if (!empty($accent_color))  update_term_meta($term_id, 'nv_brand_color_accent',  $accent_color);
            if (!empty($text_color))    update_term_meta($term_id, 'nv_brand_color_text',    $text_color);

            // Descargar el logo y guardarlo como attachment
            if (!empty($logo_url)) {
                $logo_attachment_id = self::download_logo_to_attachment($logo_url, $term_id);
                if ($logo_attachment_id) {
                    update_term_meta($term_id, 'nv_logo_attachment_id', $logo_attachment_id);
                    $result['logo_attachment_id'] = $logo_attachment_id;
                }
            }
            $result['saved'] = true;
        }

        return rest_ensure_response(['success' => true, 'detected' => $result]);
    }

    /**
     * v1.0.53 — Análisis de competencia.
     *
     * POST /wp-json/nv/v1/analizar-competencia/{term_id}
     *
     * Lee los competidores configurados en el cliente (term_meta `nv_competidores`).
     * Si hay → llama a Claude con web_search activado para que los analice y
     * proponga temas concretos sobre los que el cliente puede publicar.
     * Si NO hay → pide a Claude que busque en web competidores del sector y
     * geografía del cliente, y proponga temas a partir de ese análisis.
     *
     * Devuelve: { temas: [{ tema, justificacion, fuente }], cliente_name, mode }
     *   mode = 'configured' | 'web_discovery'
     */
    public static function analizar_competencia($request) {
        @set_time_limit(180);

        $term_id = (int) $request['id'];
        if ($term_id <= 0) {
            return new WP_Error('bad_request', 'term_id requerido', ['status' => 400]);
        }
        $term = get_term($term_id, 'nv_cliente');
        if (!$term || is_wp_error($term)) {
            return new WP_Error('invalid_term', 'Cliente no encontrado', ['status' => 404]);
        }

        $api_key = get_option('nv_dashboard_anthropic_api_key', '');
        if (empty($api_key)) {
            return new WP_Error('no_api_key', 'API key Anthropic no configurada', ['status' => 500]);
        }
        $modelo = get_option('nv_dashboard_anthropic_model', 'claude-sonnet-4-5');

        // Leer contexto del cliente
        $competidores = class_exists('NV_Cliente_Meta') ? NV_Cliente_Meta::get_competidores($term_id) : [];
        $brand_brief = class_exists('NV_Cliente_Meta') ? NV_Cliente_Meta::get_brand_brief($term_id) : '';
        $website_url = (string) get_term_meta($term_id, 'nv_cliente_website', true);

        $mode = !empty($competidores) ? 'configured' : 'web_discovery';

        // Construir prompt
        $sistema = "Eres un experto en marketing digital y análisis de competencia para redes sociales. "
                 . "Tu trabajo es analizar la competencia de un cliente y proponer temas concretos sobre los que publicar. "
                 . "Devuelves SIEMPRE JSON válido sin markdown, sin explicaciones externas.";

        $usuario = "ANÁLISIS DE COMPETENCIA PARA: " . $term->name . "\n\n";
        if ($website_url !== '') {
            $usuario .= "Web del cliente: " . $website_url . "\n";
        }
        if (!empty($brand_brief)) {
            $usuario .= "Brief de marca: " . mb_substr(trim($brand_brief), 0, 700) . "\n";
        }
        $usuario .= "\n";

        if ($mode === 'configured') {
            $usuario .= "COMPETIDORES configurados (analízalos específicamente, usa web_search si necesitas datos actuales sobre ellos):\n";
            foreach ($competidores as $i => $c) {
                $usuario .= ($i + 1) . ". " . $c . "\n";
            }
            $usuario .= "\nPara cada competidor, identifica qué tipo de contenido publica en redes sociales (temas, ángulos, formatos). "
                      . "A partir de ese análisis, propón temas que " . $term->name . " puede publicar — "
                      . "tanto temas similares (donde la competencia ha demostrado interés del público) como ángulos diferenciadores (donde " . $term->name . " puede destacar).\n";
        } else {
            $usuario .= "NO HAY COMPETIDORES CONFIGURADOS. Tu tarea:\n"
                      . "1. Usa web_search para identificar 4-6 competidores reales del sector y zona geográfica del cliente "
                      . "(infiere sector y geografía del nombre del cliente, su web y su brief). Si el brief es escueto, asume que el cliente "
                      . "opera en la Costa del Sol / Marbella (España) salvo evidencia contraria.\n"
                      . "2. Investiga qué tipo de contenido publican esos competidores en redes (puedes inferir del SEO de sus webs).\n"
                      . "3. Propón temas para " . $term->name . " basados en ese análisis.\n";
        }

        $usuario .= "\nDEVUELVE este JSON exacto (sin markdown, sin texto antes ni después):\n"
                  . "{\n"
                  . '  "competidores_analizados": ["lista de competidores que has tenido en cuenta — los configurados o los que has descubierto en web"],' . "\n"
                  . '  "temas": [' . "\n"
                  . '    {' . "\n"
                  . '      "tema": "un tema concreto y publicable, en una frase de 5-15 palabras",' . "\n"
                  . '      "justificacion": "por qué este tema funcionaría — basado en lo que hace la competencia o en un hueco que detectaste — máximo 25 palabras",' . "\n"
                  . '      "fuente": "nombre del competidor o \"hueco detectado\" si es un ángulo diferenciador",' . "\n"
                  . '      "tipo_sugerido": "imagen | reel | carrusel | story"' . "\n"
                  . '    }' . "\n"
                  . '  ]' . "\n"
                  . "}\n\n"
                  . "REGLAS:\n"
                  . "- Genera entre 8 y 15 temas, todos concretos y diferenciados.\n"
                  . "- Evita temas genéricos tipo 'felicitar la Navidad' — sé específico al sector del cliente.\n"
                  . "- Mezcla temas de marca (qué hacemos), de producto/servicio, de comunidad, de educativos y de oferta/promo.\n"
                  . "- Idioma: español de España (es-ES).\n"
                  . "- NO uses markdown ni code fences. Devuelve SOLO el JSON.";

        // Llamar a Claude con web_search activado
        $body = [
            'model'      => $modelo,
            'max_tokens' => 4000,
            'system'     => $sistema,
            'messages'   => [['role' => 'user', 'content' => $usuario]],
            'tools'      => [[
                'type' => 'web_search_20250305',
                'name' => 'web_search',
                'max_uses' => 8,
            ]],
        ];

        $resp = wp_remote_post('https://api.anthropic.com/v1/messages', [
            'timeout' => 150,
            'headers' => [
                'Content-Type'      => 'application/json',
                'x-api-key'         => $api_key,
                'anthropic-version' => '2023-06-01',
            ],
            'body' => wp_json_encode($body),
        ]);

        if (is_wp_error($resp)) {
            return new WP_Error('anthropic_failed', 'Anthropic: ' . $resp->get_error_message(), ['status' => 502]);
        }
        $code = wp_remote_retrieve_response_code($resp);
        $raw_body = wp_remote_retrieve_body($resp);
        $data = json_decode($raw_body, true);
        if ($code !== 200) {
            $msg = isset($data['error']['message']) ? $data['error']['message'] : ('HTTP ' . $code);
            return new WP_Error('anthropic_failed', 'Anthropic devolvió error: ' . $msg, ['status' => 502]);
        }

        // Concatenar todos los bloques de texto del response (con web_search puede haber varios)
        $text_full = '';
        if (!empty($data['content']) && is_array($data['content'])) {
            foreach ($data['content'] as $block) {
                if (isset($block['type']) && $block['type'] === 'text' && isset($block['text'])) {
                    $text_full .= $block['text'];
                }
            }
        }
        if (trim($text_full) === '') {
            return new WP_Error('empty_response', 'Anthropic devolvió respuesta vacía', ['status' => 502]);
        }

        // Extraer JSON: tolerar code fences y prefijos/sufijos. Buscar el primer { y el último }.
        $clean = trim($text_full);
        $clean = preg_replace('/^```(?:json)?\s*|\s*```$/m', '', $clean);
        $first_brace = strpos($clean, '{');
        $last_brace  = strrpos($clean, '}');
        if ($first_brace !== false && $last_brace !== false && $last_brace > $first_brace) {
            $clean = substr($clean, $first_brace, $last_brace - $first_brace + 1);
        }
        $parsed = json_decode($clean, true);
        if (!is_array($parsed) || empty($parsed['temas'])) {
            return new WP_Error('parse_failed', 'No se pudo parsear el JSON de temas. Respuesta: ' . mb_substr($text_full, 0, 400), ['status' => 502]);
        }

        // Sanitizar y validar cada tema
        $temas_clean = [];
        foreach ($parsed['temas'] as $t) {
            if (!is_array($t)) continue;
            $tema = isset($t['tema']) ? sanitize_text_field((string) $t['tema']) : '';
            if (mb_strlen($tema) < 4) continue;
            $temas_clean[] = [
                'tema'           => $tema,
                'justificacion'  => isset($t['justificacion']) ? sanitize_text_field((string) $t['justificacion']) : '',
                'fuente'         => isset($t['fuente']) ? sanitize_text_field((string) $t['fuente']) : '',
                'tipo_sugerido'  => isset($t['tipo_sugerido']) && in_array($t['tipo_sugerido'], ['imagen','reel','carrusel','story','video'], true)
                                    ? $t['tipo_sugerido']
                                    : 'imagen',
            ];
        }

        if (empty($temas_clean)) {
            return new WP_Error('no_themes', 'Anthropic no devolvió temas válidos. Reintenta.', ['status' => 502]);
        }

        $competidores_analizados = isset($parsed['competidores_analizados']) && is_array($parsed['competidores_analizados'])
            ? array_map('sanitize_text_field', $parsed['competidores_analizados'])
            : [];

        return rest_ensure_response([
            'success'                => true,
            'cliente_name'           => $term->name,
            'cliente_term_id'        => $term_id,
            'mode'                   => $mode,
            'competidores_analizados' => $competidores_analizados,
            'temas'                  => $temas_clean,
        ]);
    }

    /**
     * v1.0.54 — Diagnóstico de pre-requisitos del hosting para el pipeline
     * de generación de reels (Fase 1 antes de empezar la integración).
     *
     * GET /wp-json/nv/v1/reel-prereq-check
     *
     * Devuelve un JSON con el estado de:
     *   - ffmpeg / ffprobe (CLI accesible desde PHP)
     *   - exec / shell_exec / proc_open (¿están deshabilitados por disable_functions?)
     *   - memory_limit y max_execution_time
     *   - espacio en disco en uploads
     *   - GD freetype y mbstring (ya validados pero se confirman aquí)
     *   - permisos de escritura en wp-content/uploads
     *
     * Sin esto, no podemos arrancar el pipeline. Si ffmpeg falta o exec
     * está bloqueado, la única salida es procesar el render fuera del
     * hosting de WordPress (ej: Railway worker).
     */
    public static function reel_prereq_check($request) {
        $checks = [];

        // ─── 1) Funciones CLI disponibles (exec, shell_exec, proc_open) ───
        $disabled_raw = (string) ini_get('disable_functions');
        $disabled = array_map('trim', explode(',', $disabled_raw));
        $can_exec       = function_exists('exec')       && !in_array('exec', $disabled, true);
        $can_shell_exec = function_exists('shell_exec') && !in_array('shell_exec', $disabled, true);
        $can_proc_open  = function_exists('proc_open')  && !in_array('proc_open', $disabled, true);

        $checks['exec_functions'] = [
            'exec_available'       => $can_exec,
            'shell_exec_available' => $can_shell_exec,
            'proc_open_available'  => $can_proc_open,
            'disabled_functions'   => $disabled_raw,
            'verdict'              => ($can_proc_open || $can_shell_exec || $can_exec)
                                       ? 'ok'
                                       : 'critical: ninguna función exec/shell_exec/proc_open disponible — sin esto no se puede invocar ffmpeg desde PHP. Pide al hosting habilitar al menos proc_open o cambiar a hosting con SSH.',
        ];

        // ─── 2) ffmpeg / ffprobe ───
        $ffmpeg_info  = self::probe_cli_binary('ffmpeg', ['-version']);
        $ffprobe_info = self::probe_cli_binary('ffprobe', ['-version']);
        $checks['ffmpeg'] = $ffmpeg_info;
        $checks['ffprobe'] = $ffprobe_info;

        // ─── 3) Memoria y tiempo ───
        $mem_limit_raw = (string) ini_get('memory_limit');
        $mem_limit_bytes = self::parse_size($mem_limit_raw);
        $max_exec = (int) ini_get('max_execution_time');
        $checks['php_limits'] = [
            'memory_limit'        => $mem_limit_raw,
            'memory_limit_bytes'  => $mem_limit_bytes,
            'memory_limit_mb'     => round($mem_limit_bytes / 1048576, 0),
            'max_execution_time'  => $max_exec,
            'verdict_memory'      => $mem_limit_bytes >= 512 * 1048576 ? 'ok'
                                      : 'warn: memory_limit < 512M — algunos clips Seedance grandes podrían fallar',
            'verdict_time'        => ($max_exec === 0 || $max_exec >= 180) ? 'ok'
                                      : 'warn: max_execution_time < 180s — los reels se procesan en background, igual debería bastar',
        ];

        // ─── 4) Espacio en disco en uploads ───
        $upload_dir = wp_upload_dir();
        $base = isset($upload_dir['basedir']) ? $upload_dir['basedir'] : ABSPATH;
        $free_bytes = @disk_free_space($base);
        $total_bytes = @disk_total_space($base);
        $checks['disk_uploads'] = [
            'path'             => $base,
            'free_bytes'       => $free_bytes,
            'free_gb'          => $free_bytes ? round($free_bytes / 1073741824, 2) : null,
            'total_gb'         => $total_bytes ? round($total_bytes / 1073741824, 2) : null,
            'writable'         => is_writable($base),
            'verdict'          => ($free_bytes && $free_bytes >= 5 * 1073741824 && is_writable($base))
                                   ? 'ok'
                                   : 'warn: <5GB libres o no escribible. Un reel intermedio ocupa 200-500MB temporales.',
        ];

        // ─── 5) GD + mbstring (ya validados antes pero confirmar) ───
        $checks['php_extensions'] = [
            'gd'             => extension_loaded('gd'),
            'gd_freetype'    => function_exists('imagettftext'),
            'mbstring'       => extension_loaded('mbstring'),
            'curl'           => extension_loaded('curl'),
            'json'           => extension_loaded('json'),
        ];

        // ─── 6) Capacidad de WP Cron / wp-cron.php ───
        $wp_cron_disabled = defined('DISABLE_WP_CRON') && DISABLE_WP_CRON;
        $checks['wp_cron'] = [
            'wp_cron_disabled' => $wp_cron_disabled,
            'verdict'          => $wp_cron_disabled
                                   ? 'info: WP_CRON deshabilitado. Si está reemplazado por crontab del sistema (lo recomendado en hostings serios), perfecto. Si no, los reels en background no van a despachar.'
                                   : 'ok: WP_CRON activo (default WordPress). Atención: WP_CRON en sitios con poco tráfico puede tardar en disparar.',
        ];

        // ─── 7) APIs externas necesarias ───
        $checks['external_apis'] = [
            'anthropic_key_set' => !empty(get_option('nv_dashboard_anthropic_api_key', '')),
            'openai_key_set'    => !empty(get_option('nv_dashboard_openai_api_key', '')),
            'freepik_key_known' => false, // El plugin no guarda la freepik key — está en código del flujo externo de David
            'elevenlabs_key_known' => false, // Idem
            'note' => 'Freepik (Seedance Pro) y ElevenLabs no están integrados aún en el plugin. Se añadirán como settings en una próxima versión.',
        ];

        // ─── Veredicto global ───
        $global_critical = [];
        $global_warn = [];
        if ($checks['exec_functions']['verdict'] !== 'ok') $global_critical[] = 'exec functions bloqueadas';
        if (empty($ffmpeg_info['ok'])) $global_critical[] = 'ffmpeg no disponible';
        if (empty($ffprobe_info['ok'])) $global_critical[] = 'ffprobe no disponible';
        if (strpos($checks['php_limits']['verdict_memory'], 'warn') === 0) $global_warn[] = 'memory_limit bajo';
        if (strpos($checks['disk_uploads']['verdict'], 'warn') === 0) $global_warn[] = 'disco';

        return rest_ensure_response([
            'success' => true,
            'verdict' => empty($global_critical) ? 'ok' : 'critical',
            'critical_issues' => $global_critical,
            'warnings' => $global_warn,
            'recommendation' => empty($global_critical)
                ? 'Hosting OK para pipeline de reels server-side.'
                : 'Hosting NO compatible con ffmpeg/exec. Recomendación: externalizar el render a Railway worker (puedes reutilizar tu infraestructura nv-audit-api añadiendo un endpoint /reels). El plugin orquesta y consume el resultado.',
            'checks' => $checks,
            'plugin_version' => NV_DASHBOARD_VERSION,
        ]);
    }

    /**
     * Helper: ejecuta un binario CLI (ffmpeg, ffprobe) con un argumento simple
     * y devuelve si está disponible, qué versión y qué codecs soporta.
     */
    private static function probe_cli_binary($binary, $args = []) {
        if (!function_exists('proc_open') && !function_exists('shell_exec')) {
            return ['ok' => false, 'reason' => 'no exec function available', 'binary' => $binary];
        }

        // Intentar localizar el binario con `which` o `command -v`
        $which_out = '';
        if (function_exists('shell_exec')) {
            $which_out = trim((string) @shell_exec('command -v ' . escapeshellarg($binary) . ' 2>/dev/null'));
            if (empty($which_out)) {
                $which_out = trim((string) @shell_exec('which ' . escapeshellarg($binary) . ' 2>/dev/null'));
            }
        }

        // Probar ejecución directa (puede estar en el PATH aunque `which` no lo encuentre)
        $cmd = escapeshellcmd($binary) . ' ' . implode(' ', array_map('escapeshellarg', $args)) . ' 2>&1';
        $output = '';
        if (function_exists('shell_exec')) {
            $output = (string) @shell_exec($cmd);
        }

        $ok = !empty($output) && (stripos($output, 'version') !== false || stripos($output, $binary) !== false);
        $version = '';
        if ($ok && preg_match('/version\s+(\S+)/i', $output, $m)) {
            $version = $m[1];
        }

        $result = [
            'ok'             => $ok,
            'binary'         => $binary,
            'path'           => $which_out,
            'version'        => $version,
            'output_snippet' => mb_substr($output, 0, 240),
        ];

        // Para ffmpeg, también detectar codecs clave (libx264, aac, mp3)
        if ($ok && $binary === 'ffmpeg' && function_exists('shell_exec')) {
            $codecs = (string) @shell_exec('ffmpeg -codecs 2>&1');
            $result['has_libx264'] = (bool) preg_match('/\blibx264\b/', $codecs);
            $result['has_aac']     = (bool) preg_match('/\baac\b/', $codecs);
            $result['has_mp3']     = (bool) preg_match('/\b(libmp3lame|mp3)\b/', $codecs);
            $protocols = (string) @shell_exec('ffmpeg -protocols 2>&1');
            $result['has_https']   = (bool) preg_match('/\bhttps\b/', $protocols);
        }

        return $result;
    }

    /** Convierte "512M" / "1G" / "256K" a bytes. */
    private static function parse_size($size) {
        $size = trim((string) $size);
        if ($size === '' || $size === '-1') return PHP_INT_MAX;
        $unit = strtolower(substr($size, -1));
        $num  = (float) $size;
        switch ($unit) {
            case 'g': return (int) ($num * 1073741824);
            case 'm': return (int) ($num * 1048576);
            case 'k': return (int) ($num * 1024);
            default:  return (int) $num;
        }
    }

    /**
     * v1.0.46 — Extrae candidatos de logo, colores y fuentes desde el HTML.
     * No interpreta ni decide — solo enumera. La decisión la toma Claude.
     */
    private static function extract_brand_candidates_from_html($html, $base_url) {
        $candidates = [
            'logos' => [],
            'colors' => [],
            'fonts' => [],
            'meta' => [],
        ];

        // Resolver URLs relativas
        $resolve = function($url) use ($base_url) {
            if (empty($url)) return '';
            if (preg_match('|^(?:https?:)?//|i', $url)) {
                return preg_match('|^//|', $url) ? 'https:' . $url : $url;
            }
            $parts = wp_parse_url($base_url);
            $scheme = $parts['scheme'] ?? 'https';
            $host = $parts['host'] ?? '';
            if (!empty($url) && $url[0] === '/') return $scheme . '://' . $host . $url;
            return $scheme . '://' . $host . '/' . ltrim($url, './');
        };

        // ─ Logos: favicon, apple-touch-icon, og:image ─
        if (preg_match_all('/<link[^>]+rel=["\']?(?:icon|shortcut icon|apple-touch-icon)[^"\'>]*["\']?[^>]*href=["\']([^"\']+)["\'][^>]*>/i', $html, $m)) {
            foreach ($m[1] as $url) {
                $candidates['logos'][] = ['type' => 'favicon/apple', 'url' => $resolve($url)];
            }
        }
        // og:image
        if (preg_match('/<meta[^>]+property=["\']og:image["\'][^>]*content=["\']([^"\']+)["\']/i', $html, $m)) {
            $candidates['logos'][] = ['type' => 'og:image', 'url' => $resolve($m[1])];
        }
        // primer <img> dentro de <header> o con clase logo
        if (preg_match('/<(?:header|nav)[^>]*>(.*?)<\/(?:header|nav)>/is', $html, $hm)) {
            if (preg_match('/<img[^>]+src=["\']([^"\']+)["\']/i', $hm[1], $im)) {
                $candidates['logos'][] = ['type' => 'header-img', 'url' => $resolve($im[1])];
            }
        }
        if (preg_match('/<img[^>]*(?:class|alt)=["\'][^"\']*logo[^"\']*["\'][^>]+src=["\']([^"\']+)["\']/i', $html, $m)
            || preg_match('/<img[^>]+src=["\']([^"\']+)["\'][^>]*(?:class|alt)=["\'][^"\']*logo/i', $html, $m)) {
            $candidates['logos'][] = ['type' => 'logo-class', 'url' => $resolve($m[1])];
        }

        // ─ Colors: extraer hex y rgb de inline + <style> ─
        $color_pool = [];
        // Inline styles
        if (preg_match_all('/style=["\'][^"\']*(?:color|background[\w-]*):\s*([^;"\']+)/i', $html, $m)) {
            foreach ($m[1] as $c) $color_pool[] = trim($c);
        }
        // <style> blocks
        if (preg_match_all('/<style[^>]*>(.*?)<\/style>/is', $html, $m)) {
            foreach ($m[1] as $css) {
                if (preg_match_all('/(?:color|background[\w-]*|border[\w-]*-color|fill|stroke):\s*([^;{}]+)/i', $css, $cm)) {
                    foreach ($cm[1] as $c) $color_pool[] = trim($c);
                }
                // CSS custom properties (--primary, --brand)
                if (preg_match_all('/--[\w-]*(?:primary|brand|accent|main|color)[\w-]*:\s*([^;}]+)/i', $css, $vm)) {
                    foreach ($vm[1] as $c) $color_pool[] = trim($c);
                }
            }
        }
        // Normalizar y agrupar
        $hex_freq = [];
        foreach ($color_pool as $c) {
            $hex = self::normalize_color_to_hex($c);
            if ($hex && !self::is_neutral_color($hex)) {
                $hex_freq[$hex] = ($hex_freq[$hex] ?? 0) + 1;
            }
        }
        arsort($hex_freq);
        $top_colors = array_slice(array_keys($hex_freq), 0, 8);
        $candidates['colors'] = array_map(function($h) use ($hex_freq) {
            return ['hex' => $h, 'frequency' => $hex_freq[$h]];
        }, $top_colors);

        // ─ Fonts: font-family declarations ─
        $font_pool = [];
        if (preg_match_all('/font-family:\s*([^;}"\']+)/i', $html, $m)) {
            foreach ($m[1] as $f) {
                $names = array_map('trim', explode(',', $f));
                foreach ($names as $name) {
                    $name = trim($name, '"\' ');
                    if (!empty($name) && !in_array(strtolower($name), ['sans-serif', 'serif', 'monospace', 'system-ui', 'inherit', 'initial', 'cursive', 'fantasy', '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'helvetica', 'arial'], true)) {
                        $font_pool[strtolower($name)] = $name; // dedup case-insensitive
                    }
                }
            }
        }
        // Google Fonts links
        if (preg_match_all('/fonts\.googleapis\.com\/css2?\?family=([^"\'&]+)/i', $html, $m)) {
            foreach ($m[1] as $f) {
                $name = urldecode(explode(':', $f)[0]);
                $name = str_replace('+', ' ', $name);
                $font_pool[strtolower($name)] = $name;
            }
        }
        $candidates['fonts'] = array_values($font_pool);

        // ─ Meta: title, og:site_name ─
        if (preg_match('/<meta[^>]+property=["\']og:site_name["\'][^>]*content=["\']([^"\']+)["\']/i', $html, $m)) {
            $candidates['meta']['og_site_name'] = trim($m[1]);
        }
        if (preg_match('/<title[^>]*>(.*?)<\/title>/is', $html, $m)) {
            $candidates['meta']['title'] = trim(strip_tags($m[1]));
        }
        if (preg_match('/<meta[^>]+name=["\']theme-color["\'][^>]*content=["\']([^"\']+)["\']/i', $html, $m)) {
            $candidates['meta']['theme_color'] = trim($m[1]);
        }

        return $candidates;
    }

    /** Normaliza cualquier formato de color CSS a #RRGGBB. */
    private static function normalize_color_to_hex($css_color) {
        $c = trim(strtolower($css_color));
        // #RGB → #RRGGBB
        if (preg_match('/^#([0-9a-f]{3})$/', $c, $m)) {
            $h = $m[1];
            return '#' . strtoupper($h[0] . $h[0] . $h[1] . $h[1] . $h[2] . $h[2]);
        }
        // #RRGGBB
        if (preg_match('/^#([0-9a-f]{6})$/', $c, $m)) {
            return '#' . strtoupper($m[1]);
        }
        // rgb() / rgba()
        if (preg_match('/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/', $c, $m)) {
            return sprintf('#%02X%02X%02X', (int)$m[1], (int)$m[2], (int)$m[3]);
        }
        return null;
    }

    /** True si el color es blanco, negro o gris muy neutro (no es corporativo). */
    private static function is_neutral_color($hex) {
        if (!preg_match('/^#([0-9A-F]{6})$/i', $hex, $m)) return true;
        $r = hexdec(substr($m[1], 0, 2));
        $g = hexdec(substr($m[1], 2, 2));
        $b = hexdec(substr($m[1], 4, 2));
        // Blanco / casi blanco
        if ($r > 240 && $g > 240 && $b > 240) return true;
        // Negro / casi negro
        if ($r < 25 && $g < 25 && $b < 25) return true;
        // Gris neutro (R=G=B aproximadamente)
        $max = max($r, $g, $b); $min = min($r, $g, $b);
        if (($max - $min) < 12) return true;
        return false;
    }

    /** Sanitiza hex aceptando #RGB o #RRGGBB, devuelve #RRGGBB o ''. */
    private static function sanitize_hex_strict($s) {
        if (!is_string($s)) return '';
        $s = trim($s);
        if (preg_match('/^#([0-9a-f]{3})$/i', $s, $m)) {
            $h = $m[1];
            return '#' . strtoupper($h[0] . $h[0] . $h[1] . $h[1] . $h[2] . $h[2]);
        }
        if (preg_match('/^#([0-9a-f]{6})$/i', $s, $m)) {
            return '#' . strtoupper($m[1]);
        }
        return '';
    }

    /**
     * Descarga una URL externa y la guarda como attachment de WP.
     * Devuelve attachment_id o 0 en error.
     */
    private static function download_logo_to_attachment($url, $term_id) {
        if (!function_exists('media_handle_sideload')) {
            require_once ABSPATH . 'wp-admin/includes/file.php';
            require_once ABSPATH . 'wp-admin/includes/media.php';
            require_once ABSPATH . 'wp-admin/includes/image.php';
        }
        $tmp = download_url($url, 30);
        if (is_wp_error($tmp)) {
            error_log('[NV] download_logo failed: ' . $tmp->get_error_message());
            return 0;
        }
        // Detectar extensión
        $ext = pathinfo(parse_url($url, PHP_URL_PATH), PATHINFO_EXTENSION);
        if (empty($ext) || strlen($ext) > 4) $ext = 'png';
        $filename = 'logo-cliente-' . $term_id . '-' . time() . '.' . $ext;
        $file_array = ['name' => $filename, 'tmp_name' => $tmp];
        $aid = media_handle_sideload($file_array, 0, 'Logo auto-detectado del cliente ' . $term_id);
        @unlink($tmp);
        if (is_wp_error($aid)) {
            error_log('[NV] sideload failed: ' . $aid->get_error_message());
            return 0;
        }
        return (int) $aid;
    }

    /**
     * v1.0.49 — Localiza wp-config.php (en ABSPATH o un nivel arriba).
     */
    private static function locate_wp_config() {
        $candidates = [
            ABSPATH . 'wp-config.php',
            dirname(ABSPATH) . '/wp-config.php',
        ];
        foreach ($candidates as $p) {
            if (file_exists($p) && is_readable($p)) return $p;
        }
        return null;
    }

    /**
     * v1.0.49 — Analiza wp-config.php buscando defines duplicados.
     * Devuelve diagnóstico SIN modificar nada.
     */
    public static function wp_config_analyze($request) {
        $path = self::locate_wp_config();
        if (!$path) {
            return new WP_Error('not_found', 'No se encontró wp-config.php', ['status' => 404]);
        }
        if (!is_writable($path)) {
            return rest_ensure_response([
                'success'    => true,
                'path'       => $path,
                'writable'   => false,
                'error'      => 'wp-config.php existe pero NO es escribible. Cambia permisos o edita manualmente.',
                'duplicates' => [],
            ]);
        }
        $content = file_get_contents($path);
        if ($content === false) {
            return new WP_Error('read_failed', 'No se pudo leer wp-config.php', ['status' => 500]);
        }

        $analysis = self::detect_duplicate_defines($content);

        return rest_ensure_response([
            'success'    => true,
            'path'       => $path,
            'writable'   => true,
            'size'       => strlen($content),
            'duplicates' => $analysis['duplicates'],
            'preview'    => $analysis['preview'], // Diff visual de qué se eliminaría
        ]);
    }

    /**
     * v1.0.49 — Detecta defines duplicados en el contenido de wp-config.php.
     * Devuelve estructura con detalles para presentar al usuario.
     */
    private static function detect_duplicate_defines($content) {
        $lines = explode("\n", $content);
        $by_constant = []; // constant_name → array of ['line' => N, 'text' => '...']

        foreach ($lines as $i => $line) {
            // Match: define('NAME', ...) o define( "NAME", ...)
            if (preg_match('/^\s*define\s*\(\s*[\'"]([A-Z_][A-Z0-9_]*)[\'"]\s*,/i', $line, $m)) {
                $name = strtoupper($m[1]);
                if (!isset($by_constant[$name])) $by_constant[$name] = [];
                $by_constant[$name][] = ['line' => $i + 1, 'text' => rtrim($line)];
            }
        }

        $duplicates = [];
        $preview_lines_to_remove = [];
        foreach ($by_constant as $name => $occurrences) {
            if (count($occurrences) > 1) {
                $duplicates[] = [
                    'constant'    => $name,
                    'count'       => count($occurrences),
                    'occurrences' => $occurrences,
                    // Plan: mantener la primera, eliminar las demás
                    'will_keep'   => $occurrences[0],
                    'will_remove' => array_slice($occurrences, 1),
                ];
                foreach (array_slice($occurrences, 1) as $occ) {
                    $preview_lines_to_remove[] = $occ['line'];
                }
            }
        }

        return [
            'duplicates' => $duplicates,
            'preview'    => [
                'lines_to_remove' => $preview_lines_to_remove,
                'total_removals'  => count($preview_lines_to_remove),
            ],
        ];
    }

    /**
     * v1.0.49 — Aplica el fix con backup automático.
     * POST /wp-json/nv/v1/wp-config-fix
     */
    public static function wp_config_fix($request) {
        $path = self::locate_wp_config();
        if (!$path) {
            return new WP_Error('not_found', 'No se encontró wp-config.php', ['status' => 404]);
        }
        if (!is_writable($path)) {
            return new WP_Error('not_writable', 'wp-config.php no es escribible. Cambia permisos o edita manualmente.', ['status' => 403]);
        }
        $content = file_get_contents($path);
        if ($content === false) {
            return new WP_Error('read_failed', 'No se pudo leer wp-config.php', ['status' => 500]);
        }

        $analysis = self::detect_duplicate_defines($content);
        if (empty($analysis['duplicates'])) {
            return rest_ensure_response([
                'success'      => true,
                'changed'      => false,
                'message'      => 'No hay defines duplicados. wp-config.php está limpio.',
            ]);
        }

        // ─── 1) BACKUP a wp-content/uploads/nv-backups/ ───
        $upload_dir = wp_upload_dir();
        $backup_dir = trailingslashit($upload_dir['basedir']) . 'nv-backups';
        if (!file_exists($backup_dir)) {
            wp_mkdir_p($backup_dir);
            // Proteger directorio de listado público
            @file_put_contents($backup_dir . '/index.html', '<!-- silence is golden -->');
            @file_put_contents($backup_dir . '/.htaccess', "Order Deny,Allow\nDeny from all\n");
        }
        $timestamp = date('Y-m-d_His');
        $backup_file = $backup_dir . '/wp-config_' . $timestamp . '.bak';
        $bytes_written = @file_put_contents($backup_file, $content);
        if ($bytes_written === false || $bytes_written !== strlen($content)) {
            return new WP_Error('backup_failed', 'No se pudo crear el backup. Aborto sin tocar nada.', ['status' => 500]);
        }

        // ─── 2) Construir nuevo contenido ───
        $lines_to_remove = array_flip($analysis['preview']['lines_to_remove']);
        $original_lines = explode("\n", $content);
        $new_lines = [];
        $removed_lines_log = [];
        foreach ($original_lines as $i => $line) {
            $line_num = $i + 1;
            if (isset($lines_to_remove[$line_num])) {
                $removed_lines_log[] = ['line' => $line_num, 'text' => rtrim($line)];
                continue; // Skip esta línea
            }
            $new_lines[] = $line;
        }
        $new_content = implode("\n", $new_lines);

        // ─── 3) Validación: el nuevo contenido debe parsear como PHP ───
        $tokens = @token_get_all($new_content, TOKEN_PARSE);
        if ($tokens === false || empty($tokens)) {
            return new WP_Error('parse_failed', 'El resultado no parsearía como PHP válido. Aborto sin tocar el archivo. Backup guardado en: ' . $backup_file, ['status' => 500]);
        }
        // Validación estructural: debe seguir empezando con <?php y tener al menos 1 define
        if (strpos(ltrim($new_content), '<?php') !== 0) {
            return new WP_Error('parse_failed', 'El resultado no empieza con <?php. Aborto.', ['status' => 500]);
        }
        if (substr_count($new_content, 'define(') < 5) {
            return new WP_Error('parse_failed', 'El resultado tiene muy pocos defines (<5). Algo raro. Aborto.', ['status' => 500]);
        }

        // ─── 4) Escritura atómica: tmp → rename ───
        $tmp_file = $path . '.nv-tmp-' . $timestamp;
        $bw = @file_put_contents($tmp_file, $new_content);
        if ($bw === false || $bw !== strlen($new_content)) {
            @unlink($tmp_file);
            return new WP_Error('write_failed', 'No se pudo escribir el archivo temporal. wp-config.php intacto.', ['status' => 500]);
        }
        if (!@rename($tmp_file, $path)) {
            @unlink($tmp_file);
            return new WP_Error('rename_failed', 'No se pudo renombrar el archivo temporal a wp-config.php. Comprueba permisos.', ['status' => 500]);
        }

        // ─── 5) Verificación post-write ───
        clearstatcache();
        $verify = file_get_contents($path);
        if ($verify === false || strpos(ltrim($verify), '<?php') !== 0) {
            // ¡Catástrofe! Restaurar desde backup
            @file_put_contents($path, $content);
            return new WP_Error('verify_failed', 'Verificación post-escritura falló. Restaurado al estado anterior. Backup: ' . $backup_file, ['status' => 500]);
        }

        return rest_ensure_response([
            'success'         => true,
            'changed'         => true,
            'path'            => $path,
            'backup_file'     => $backup_file,
            'backup_url'      => trailingslashit($upload_dir['baseurl']) . 'nv-backups/wp-config_' . $timestamp . '.bak',
            'removed_lines'   => $removed_lines_log,
            'duplicates_fixed' => count($analysis['duplicates']),
            'message'         => 'wp-config.php corregido. ' . count($removed_lines_log) . ' línea(s) duplicada(s) eliminada(s). Backup creado.',
        ]);
    }

    /**
     * v1.0.67: Diagnóstico de refs categorizadas — saber qué tipos están cubiertos
     * y cuáles faltan. Útil cuando el operador pide forced_types y la imagen
     * sale rara: con este endpoint se ve si las refs están subidas y bien tipadas.
     *
     * GET /wp-json/nv/v1/diag-refs/{slug}
     */
    public static function diag_refs($request) {
        if (!class_exists('NV_Cliente_Meta')) {
            return new WP_Error('no_meta', 'NV_Cliente_Meta no disponible', ['status' => 500]);
        }
        $slug = $request->get_param('slug');
        $term = get_term_by('slug', $slug, 'nv_cliente');
        if (!$term) {
            return new WP_Error('cliente_no_existe', "Cliente '{$slug}' no encontrado", ['status' => 404]);
        }

        $items = NV_Cliente_Meta::get_reference_images_typed($term->term_id);
        $counts = ['persona_destacada' => 0, 'equipo' => 0, 'instalaciones' => 0, 'pacientes_usuarios' => 0, 'productos' => 0, 'logo_brand' => 0, 'general' => 0];
        $detalle = [];
        foreach ($items as $it) {
            $type = $it['type'] ?? 'general';
            if (isset($counts[$type])) $counts[$type]++;
            $detalle[] = [
                'id' => $it['id'],
                'type' => $type,
                'person_name' => $it['person_name'] ?? '',
                'title' => get_the_title($it['id']),
                'url' => wp_get_attachment_url($it['id']),
            ];
        }

        // Warnings — qué tipos están vacíos
        $warnings = [];
        if ($counts['persona_destacada'] === 0) $warnings[] = 'Sin refs de CEO/Persona destacada — si fuerzas persona_destacada en un lote, no habrá referencia visual';
        if ($counts['equipo'] === 0) $warnings[] = 'Sin refs de Equipo — si fuerzas equipo en un lote, OpenAI inventará caras genéricas (no son tus trabajadores reales)';
        if ($counts['instalaciones'] === 0) $warnings[] = 'Sin refs de Instalaciones — si fuerzas instalaciones, OpenAI inventará un local genérico';
        if ($counts['pacientes_usuarios'] === 0) $warnings[] = 'Sin refs de Pacientes/Usuarios (aviso — puede ser intencional por RGPD)';

        return rest_ensure_response([
            'cliente_slug' => $slug,
            'cliente_name' => $term->name,
            'term_id' => $term->term_id,
            'total_refs' => count($items),
            'counts_by_type' => $counts,
            'detalle' => $detalle,
            // v1.0.68: roster con personas identificadas (con person_name)
            'roster' => NV_Cliente_Meta::get_team_roster($term->term_id),
            'warnings' => $warnings,
            'instrucciones' => 'Si quieres pedir forced_types[\'equipo\'] al generar publicaciones, primero sube fotos de tu equipo a la ficha del cliente y categorízalas como "Equipo / Trabajadores". Sin refs del tipo solicitado, OpenAI inventará caras nuevas. Para evitar que invente caras adicionales, añade el nombre de cada persona en el campo "Nombre" debajo de cada foto.',
        ]);
    }
}
