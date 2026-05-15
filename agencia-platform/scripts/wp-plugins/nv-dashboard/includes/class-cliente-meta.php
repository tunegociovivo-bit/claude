<?php
/**
 * NV Cliente Meta — gestión de configuración Drive por cliente (v1.0.21)
 *
 * Sustituye la opción global `nv_dashboard_refs_drive_folders` (que hasta v1.0.20
 * tenía todos los clientes en una sola entrada) por term meta atada a cada
 * término de la taxonomía `nv_cliente`. Ventajas:
 *
 *  - Cada cliente lleva sus propios datos en su registro, sobreviven a borrar
 *    o renombrar el término.
 *  - Permite estado por cliente: configurado / no_drive_refs / pending.
 *  - Subcarpetas con tipos semánticos (persona_destacada, equipo, productos…)
 *    para que el prompt al Claude externo sea preciso ("usa la subcarpeta
 *    marcada como persona_destacada") en lugar de buscar por nombre libre.
 *
 * Term meta keys:
 *   nv_drive_mode       : "configured" | "no_drive_refs" | "pending"  (default "pending")
 *   nv_drive_root_id    : string (Drive folder ID, 20-50 chars [a-zA-Z0-9_-])
 *   nv_drive_subfolders : JSON array de { name, id, type }
 *
 * @package NV_Dashboard
 * @since 1.0.21
 */

if (!defined('ABSPATH')) {
    exit;
}

class NV_Cliente_Meta {

    /**
     * Tipos semánticos disponibles para subcarpetas.
     * El "type" se inyecta en el prompt para que Claude sepa qué pedir.
     */
    const SUBFOLDER_TYPES = [
        'persona_destacada' => '👤 Persona destacada (CEO, fundador, cara visible)',
        'equipo'            => '👥 Equipo / trabajadores',
        'pacientes_usuarios'=> '🧍 Pacientes / usuarios (CON consentimiento RGPD)',
        'instalaciones'     => '🏢 Instalaciones / oficina / clínica',
        'productos'         => '📦 Productos',
        'logo_brand'        => '🎨 Logo / paleta / brand assets',
        'otros'             => '📁 Otros',
    ];

    const DRIVE_MODES = [
        'configured'     => '✅ Sí, refs configuradas',
        'pending'        => '⏳ Sí, pero pendientes de configurar',
        'no_drive_refs'  => '🚫 Este cliente no usa Drive refs',
    ];

    /**
     * Bootstrap.
     */
    public static function init() {
        // Form fields en add/edit term
        add_action('nv_cliente_add_form_fields',  [__CLASS__, 'render_add_form'], 10, 1);
        add_action('nv_cliente_edit_form_fields', [__CLASS__, 'render_edit_form'], 10, 1);

        // Save term meta
        add_action('created_nv_cliente', [__CLASS__, 'save_term_meta'], 10, 1);
        add_action('edited_nv_cliente',  [__CLASS__, 'save_term_meta'], 10, 1);

        // v1.0.46: enqueue inline JS para botón "Analizar web con IA" en edit-term
        add_action('admin_footer-term.php', [__CLASS__, 'render_analyze_web_js']);

        // A3: normalizar slug a underscore (formato histórico de NV)
        add_action('created_nv_cliente', [__CLASS__, 'normalize_slug'], 5, 1);

        // B1: columna de estado en la lista de clientes
        add_filter('manage_edit-nv_cliente_columns',         [__CLASS__, 'add_status_column']);
        add_filter('manage_nv_cliente_custom_column',        [__CLASS__, 'render_status_column'], 10, 3);

        // A4: admin notice si hay clientes pendientes
        add_action('admin_notices', [__CLASS__, 'admin_notice_pending_clients']);

        // Migración una sola vez del JSON global v1.0.17-v1.0.20 → term meta
        add_action('admin_init', [__CLASS__, 'migrate_from_options'], 5);

        // v1.0.22: enqueue Drive Picker JS solo en pantallas de term de nv_cliente
        add_action('admin_enqueue_scripts', [__CLASS__, 'enqueue_picker_assets']);

        // v1.0.27: permitir subir TTF/OTF para fuentes personalizadas
        add_filter('upload_mimes', [__CLASS__, 'allow_font_uploads']);
    }

    /**
     * v1.0.27: añade TTF y OTF a los MIME types permitidos por WP.
     */
    public static function allow_font_uploads($mimes) {
        if (!isset($mimes['ttf'])) $mimes['ttf'] = 'font/ttf';
        if (!isset($mimes['otf'])) $mimes['otf'] = 'font/otf';
        return $mimes;
    }

    /**
     * Cargar drive-picker.js solo en edit-tags.php?taxonomy=nv_cliente y term.php para nv_cliente.
     */
    public static function enqueue_picker_assets($hook) {
        // v1.0.29: detección más robusta — el screen es lo más fiable
        $screen = function_exists('get_current_screen') ? get_current_screen() : null;
        $is_cliente_page = (
            in_array($hook, ['edit-tags.php', 'term.php'], true)
            && isset($_GET['taxonomy']) && $_GET['taxonomy'] === 'nv_cliente'
        );
        if (!$is_cliente_page && $screen) {
            // Fallback: detectar por screen->taxonomy
            if (!empty($screen->taxonomy) && $screen->taxonomy === 'nv_cliente') {
                $is_cliente_page = true;
            }
        }
        if (!$is_cliente_page) return;

        // v1.0.27 + v1.0.29: media uploader para logo, fuente, refs visuales
        wp_enqueue_media();

        $client_id = get_option('nv_dashboard_google_client_id', '');
        $api_key   = get_option('nv_dashboard_google_api_key', '');

        // Aunque no haya credenciales, registramos el script igual; el JS se autoabortará.
        wp_enqueue_script(
            'nv-drive-picker',
            NV_DASHBOARD_URL . 'admin/js/drive-picker.js',
            [],
            NV_DASHBOARD_VERSION,
            true
        );
        wp_localize_script('nv-drive-picker', 'nvDrivePicker', [
            'clientId' => $client_id,
            'apiKey'   => $api_key,
            'siteUrl'  => home_url('/'),
        ]);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Helpers de lectura
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Devuelve el modo Drive del cliente, con default seguro.
     */
    public static function get_drive_mode($term_id) {
        $mode = get_term_meta($term_id, 'nv_drive_mode', true);
        if (!isset(self::DRIVE_MODES[$mode])) return 'pending';
        return $mode;
    }

    public static function get_drive_root_id($term_id) {
        return (string) get_term_meta($term_id, 'nv_drive_root_id', true);
    }

    /**
     * v1.0.23: Brief de marca del cliente (textarea libre).
     * Se usa para que la generación AI multi-cliente adapte el tono.
     */
    public static function get_brand_brief($term_id) {
        return (string) get_term_meta($term_id, 'nv_brand_brief', true);
    }

    /**
     * v1.0.27: Branding del cliente — logo + fuente + posicionamiento.
     */
    public static function get_logo_attachment_id($term_id) {
        return (int) get_term_meta($term_id, 'nv_logo_attachment_id', true);
    }
    public static function get_logo_position($term_id) {
        $pos = (string) get_term_meta($term_id, 'nv_logo_position', true);
        return in_array($pos, ['tl','tr','bl','br'], true) ? $pos : 'br';
    }
    public static function get_font_attachment_id($term_id) {
        return (int) get_term_meta($term_id, 'nv_font_attachment_id', true);
    }

    /**
     * v1.0.63: Devuelve el array de fuentes tipadas del cliente.
     * Formato nuevo: [{id, weight, path}, ...]
     * Soporta storage nuevo (array JSON en nv_font_attachments) y legacy
     * (un único ID en nv_font_attachment_id, asumido como weight=regular).
     */
    public static function get_fonts_typed($term_id) {
        $fonts = [];
        $raw = get_term_meta($term_id, 'nv_font_attachments', true);
        if (!empty($raw)) {
            $arr = is_string($raw) ? json_decode($raw, true) : (is_array($raw) ? $raw : []);
            if (is_array($arr)) {
                foreach ($arr as $entry) {
                    if (!is_array($entry)) continue;
                    $id = isset($entry['id']) ? (int) $entry['id'] : 0;
                    $weight = isset($entry['weight']) ? (string) $entry['weight'] : 'regular';
                    if (!in_array($weight, ['regular', 'bold'], true)) $weight = 'regular';
                    if ($id <= 0) continue;
                    $path = get_attached_file($id);
                    if ($path && file_exists($path)) {
                        $fonts[] = ['id' => $id, 'weight' => $weight, 'path' => $path];
                    }
                }
            }
        }
        // Backward compat: si no hay storage nuevo, leer legacy como regular
        if (empty($fonts)) {
            $legacy_id = (int) get_term_meta($term_id, 'nv_font_attachment_id', true);
            if ($legacy_id > 0) {
                $path = get_attached_file($legacy_id);
                if ($path && file_exists($path)) {
                    $fonts[] = ['id' => $legacy_id, 'weight' => 'regular', 'path' => $path];
                }
            }
        }
        return $fonts;
    }

    /**
     * v1.0.63: Devuelve la ruta de fuente para un weight concreto.
     *   1) Match exacto del weight pedido
     *   2) Si no, primera fuente disponible
     *   3) Si no hay fuentes, Poppins-Bold default del plugin
     */
    public static function get_font_path_by_weight($term_id, $weight = 'regular') {
        $fonts = self::get_fonts_typed($term_id);
        foreach ($fonts as $f) {
            if ($f['weight'] === $weight) return $f['path'];
        }
        if (!empty($fonts)) return $fonts[0]['path'];
        $default = NV_DASHBOARD_PATH . 'assets/fonts/Poppins-Bold.ttf';
        return file_exists($default) ? $default : null;
    }

    /**
     * Devuelve la ruta del archivo de fuente. Si el cliente no tiene
     * una fuente subida, devuelve la fuente Poppins-Bold del plugin.
     *
     * v1.0.63: ahora delega en get_font_path_by_weight() para soportar
     * múltiples fuentes. Retrocompat: comportamiento idéntico para
     * callsites antiguos (devuelve la primera disponible o regular).
     */
    public static function get_font_path($term_id) {
        return self::get_font_path_by_weight($term_id, 'regular');
    }
    /**
     * Devuelve la ruta del logo en disco, o null si no hay.
     */
    public static function get_logo_path($term_id) {
        $aid = self::get_logo_attachment_id($term_id);
        if (!$aid) return null;
        $path = get_attached_file($aid);
        return ($path && file_exists($path)) ? $path : null;
    }

    /**
     * v1.0.28: Imágenes de referencia visual del cliente.
     * Claude (Anthropic vision) las analiza para extraer estilo (colores,
     * tipografía, fotografía, composición) y construir un "image style guide"
     * que se inyecta en el prompt de gpt-image-2.
     *
     * v1.0.59: el storage ahora soporta DOS formatos:
     *   - Legacy: [12, 34, 56]  (IDs sueltos, todos tratados como type='general')
     *   - Tipado: [{"id":12,"type":"persona_destacada"}, {"id":34,"type":"equipo"}, ...]
     *
     * Esta función mantiene compatibilidad: devuelve SOLO los IDs (sin tipo)
     * para que el código existente no se rompa. Para obtener tipo, usar
     * get_reference_images_typed().
     *
     * @return int[]  array de attachment IDs
     */
    public static function get_reference_images($term_id) {
        $items = self::get_reference_images_typed($term_id);
        $ids = [];
        foreach ($items as $item) {
            if (!empty($item['id'])) $ids[] = (int) $item['id'];
        }
        return $ids;
    }

    /**
     * v1.0.59: Devuelve las refs con su tipo semántico.
     *
     * Tipos válidos (alineados con Drive subfolders):
     *   - 'persona_destacada' → CEO/Director (ej. Rochar)
     *   - 'equipo'            → Trabajadores
     *   - 'instalaciones'     → Local/Clínica/Negocio
     *   - 'pacientes_usuarios'→ Pacientes (consentimiento RGPD)
     *   - 'productos'         → Productos
     *   - 'general'           → Sin categorizar (fallback)
     *
     * @return array  [['id' => int, 'type' => string], ...]
     */
    public static function get_reference_images_typed($term_id) {
        $raw = get_term_meta($term_id, 'nv_reference_images', true);
        if (empty($raw)) return [];
        $arr = is_string($raw) ? json_decode($raw, true) : (is_array($raw) ? $raw : []);
        if (!is_array($arr)) return [];

        $valid_types = ['persona_destacada', 'equipo', 'instalaciones', 'pacientes_usuarios', 'productos', 'logo_brand', 'general'];
        $items = [];
        foreach ($arr as $entry) {
            if (is_int($entry) || (is_string($entry) && ctype_digit($entry))) {
                // Formato legacy: ID suelto → tipo 'general'
                $id = (int) $entry;
                if ($id > 0 && get_post($id)) {
                    $items[] = ['id' => $id, 'type' => 'general', 'person_name' => ''];
                }
            } elseif (is_array($entry) && !empty($entry['id'])) {
                // Formato nuevo: { id, type, person_name? }
                $id = (int) $entry['id'];
                if ($id <= 0 || !get_post($id)) continue;
                $type = isset($entry['type']) ? (string) $entry['type'] : 'general';
                if (!in_array($type, $valid_types, true)) $type = 'general';
                // v1.0.68: person_name opcional — para identificar a quién corresponde
                // cada foto del equipo/CEO. Permite que la AI sepa que 3 fotos de "Dra
                // Angie Bech" + 2 de "Asistente Carmen" + 4 de "Rochar" son 3 personas
                // distintas, no 9 personas distintas. Vacío = sin identificar (genérico).
                $person_name = isset($entry['person_name']) ? sanitize_text_field((string) $entry['person_name']) : '';
                $items[] = ['id' => $id, 'type' => $type, 'person_name' => $person_name];
            }
        }
        return $items;
    }

    /**
     * v1.0.68: Devuelve el roster único de personas identificadas en las refs del cliente.
     * Útil para inyectar al system prompt el listado real de quiénes forman el equipo.
     *
     * Formato de retorno:
     * [
     *   ['name' => 'Rochar', 'type' => 'persona_destacada', 'photo_count' => 3],
     *   ['name' => 'Dra Angie Bech', 'type' => 'equipo', 'photo_count' => 2],
     *   ['name' => 'Asistente Carmen', 'type' => 'equipo', 'photo_count' => 1],
     * ]
     *
     * Solo incluye personas con name no vacío. Refs sin person_name se ignoran.
     *
     * @param int $term_id
     * @param array|null $only_types  Si se pasa, filtra solo esos tipos (ej: ['persona_destacada','equipo']).
     * @return array
     */
    public static function get_team_roster($term_id, $only_types = null) {
        $items = self::get_reference_images_typed($term_id);
        $roster = [];
        $person_types = ['persona_destacada', 'equipo', 'pacientes_usuarios'];
        if (is_array($only_types) && !empty($only_types)) {
            $person_types = array_values(array_intersect($person_types, $only_types));
        }
        foreach ($items as $item) {
            if (empty($item['person_name'])) continue;
            if (!in_array($item['type'], $person_types, true)) continue;
            $key = strtolower($item['person_name']) . '|' . $item['type'];
            if (!isset($roster[$key])) {
                $roster[$key] = [
                    'name' => $item['person_name'],
                    'type' => $item['type'],
                    'photo_count' => 0,
                ];
            }
            $roster[$key]['photo_count']++;
        }
        return array_values($roster);
    }

    /**
     * v1.0.59: Devuelve attachment IDs filtrados por tipo(s).
     *
     * @param int $term_id
     * @param string|array $types  Tipo o array de tipos a filtrar. Si está vacío, devuelve todos.
     * @return int[]
     */
    public static function get_reference_images_by_type($term_id, $types = []) {
        $items = self::get_reference_images_typed($term_id);
        if (empty($types)) {
            $ids = [];
            foreach ($items as $item) $ids[] = $item['id'];
            return $ids;
        }
        if (is_string($types)) $types = [$types];
        $ids = [];
        foreach ($items as $item) {
            if (in_array($item['type'], $types, true)) $ids[] = $item['id'];
        }
        return $ids;
    }

    /**
     * v1.0.59: Cuenta cuántas refs hay de cada tipo (para mostrar en UI).
     *
     * @return array  ['persona_destacada' => 3, 'equipo' => 2, ...]
     */
    public static function get_reference_images_counts_by_type($term_id) {
        $items = self::get_reference_images_typed($term_id);
        $counts = [];
        foreach ($items as $item) {
            $t = $item['type'];
            $counts[$t] = ($counts[$t] ?? 0) + 1;
        }
        return $counts;
    }

    /**
     * Devuelve los IDs + URLs + tipo de las refs para mostrar en el formulario.
     * v1.0.59: incluye campo 'type' para el selector de categoría.
     */
    public static function get_reference_images_data($term_id) {
        $items = self::get_reference_images_typed($term_id);
        $data = [];
        foreach ($items as $item) {
            $id = $item['id'];
            $thumb = wp_get_attachment_image_url($id, 'thumbnail');
            $full  = wp_get_attachment_image_url($id, 'large');
            if ($thumb) $data[] = [
                'id' => $id,
                'thumb' => $thumb,
                'full' => $full ?: $thumb,
                'type' => $item['type'],
                'person_name' => $item['person_name'] ?? '',
            ];
        }
        return $data;
    }

    /**
     * v1.0.33: hash de la lista actual de refs (para detectar si la cache está stale).
     */
    public static function get_reference_images_hash($term_id) {
        $ids = self::get_reference_images($term_id);
        return empty($ids) ? '' : md5(implode(',', $ids));
    }

    // ─────────────────────────────────────────────────────────────────────
    // v1.0.35: Brand colors por cliente — usados por el compositing de overlays
    // ─────────────────────────────────────────────────────────────────────

    /** Sanitiza un hex y devuelve string '#RRGGBB' o '' si inválido */
    public static function sanitize_hex($hex) {
        $hex = trim((string) $hex);
        if (!preg_match('/^#?([0-9A-Fa-f]{6})$/', $hex, $m)) return '';
        return '#' . strtoupper($m[1]);
    }

    /** Devuelve los colores brand explícitamente configurados en term_meta (sin fallback) */
    public static function get_brand_colors_explicit($term_id) {
        return [
            'primary'         => self::sanitize_hex(get_term_meta($term_id, 'nv_brand_color_primary', true)),
            'accent'          => self::sanitize_hex(get_term_meta($term_id, 'nv_brand_color_accent', true)),
            'text_on_primary' => self::sanitize_hex(get_term_meta($term_id, 'nv_brand_color_text', true)),
        ];
    }

    /** Extrae hex de la guía de estilo cacheada (Anthropic suele citar paleta en hex) */
    public static function extract_colors_from_style_guide($term_id) {
        $guide = self::get_style_guide_cached($term_id);
        if (empty($guide)) return [];
        if (!preg_match_all('/#([0-9A-Fa-f]{6})\b/', $guide, $matches)) return [];
        $hexes = array_values(array_unique(array_map(function($h){ return '#' . strtoupper($h); }, $matches[1])));
        return array_slice($hexes, 0, 6);
    }

    /**
     * Devuelve los 3 colores brand resueltos en cascada:
     *   1. term_meta explícito (configurado por el usuario en la ficha)
     *   2. extracción automática de la guía de estilo cacheada
     *   3. paleta neutra profesional por defecto (gris carbón / blanco / azul)
     *
     * Siempre devuelve los 3 keys con valores hex válidos.
     */
    public static function get_brand_colors($term_id) {
        $explicit = self::get_brand_colors_explicit($term_id);
        $extracted = (count(array_filter($explicit)) < 3) ? self::extract_colors_from_style_guide($term_id) : [];

        $primary = $explicit['primary'] ?: ($extracted[0] ?? '#1F2937'); // gris carbón
        $accent  = $explicit['accent']  ?: ($extracted[1] ?? '#2563EB'); // azul profesional
        $text    = $explicit['text_on_primary'] ?: '#FFFFFF';

        // Si text === primary (improbable pero posible), forzar contraste
        if (strtoupper($text) === strtoupper($primary)) {
            $text = self::is_dark_color($primary) ? '#FFFFFF' : '#1A1A1A';
        }

        return [
            'primary'         => $primary,
            'accent'          => $accent,
            'text_on_primary' => $text,
            'source'          => count(array_filter($explicit)) === 3 ? 'explicit' : (!empty($extracted) ? 'extracted' : 'default'),
        ];
    }

    /** True si el hex es oscuro (luminance < 0.5) — para decidir contraste */
    public static function is_dark_color($hex) {
        $hex = self::sanitize_hex($hex);
        if (empty($hex)) return true;
        $r = hexdec(substr($hex, 1, 2)) / 255;
        $g = hexdec(substr($hex, 3, 2)) / 255;
        $b = hexdec(substr($hex, 5, 2)) / 255;
        // Luminance relativa (sRGB)
        $lum = 0.2126 * $r + 0.7152 * $g + 0.0722 * $b;
        return $lum < 0.5;
    }

    /**
     * v1.0.52: patrón visual del cliente (clean | frame).
     * Por defecto 'clean' si no está configurado.
     */
    public static function get_visual_pattern($term_id) {
        $p = (string) get_term_meta($term_id, 'nv_visual_pattern', true);
        return in_array($p, ['clean', 'frame'], true) ? $p : 'clean';
    }

    /**
     * v1.0.53: fidelidad a refs visuales (0-100). Default 50%.
     */
    public static function get_refs_fidelity($term_id) {
        $v = get_term_meta($term_id, 'nv_refs_fidelity', true);
        if ($v === '' || $v === false || $v === null) return 50;
        $i = (int) $v;
        if ($i < 0) return 0;
        if ($i > 100) return 100;
        return $i;
    }

    /**
     * v1.0.53: lista de competidores (array de strings, una entrada por línea
     * del textarea). Líneas vacías filtradas. Devuelve array vacío si no hay.
     */
    public static function get_competidores($term_id) {
        $raw = (string) get_term_meta($term_id, 'nv_competidores', true);
        if (trim($raw) === '') return [];
        $lines = preg_split('/\r\n|\r|\n/', $raw);
        $out = [];
        foreach ($lines as $line) {
            $line = trim($line);
            if ($line !== '') $out[] = $line;
        }
        return $out;
    }

    // ════════════════════════════════════════════════════════════════════
    // v1.0.71 — DIMENSIONES POR FORMATO (imagen, reel, carrusel, story, video)
    //
    // Cada cliente puede sobrescribir el preset estándar de cada tipo de
    // publicación. Si no configura nada → defaults profesionales (1080x1350
    // imagen, 1080x1920 reel/story, 1080x1080 carrusel, 1920x1080 video).
    //
    // Storage: term_meta 'nv_dimensiones_formatos' (JSON).
    //   {
    //     "imagen":   { "width": 1080, "height": 1350, "preset": "ig_feed_4_5" },
    //     "reel":     { "width": 1080, "height": 1920, "preset": "ig_reel_9_16" },
    //     "carrusel": { "width": 1080, "height": 1080, "preset": "ig_square_1_1" },
    //     "story":    { "width": 1080, "height": 1920, "preset": "ig_story_9_16" },
    //     "video":    { "width": 1920, "height": 1080, "preset": "yt_16_9" }
    //   }
    // ════════════════════════════════════════════════════════════════════

    /**
     * Presets pre-configurados (preset_key => { label, w, h }).
     */
    public static function get_dimension_presets() {
        return [
            'ig_feed_4_5'       => ['label' => '📷 Instagram Feed (4:5) — 1080×1350', 'w' => 1080, 'h' => 1350],
            'ig_square_1_1'     => ['label' => '⬜ Instagram Cuadrado (1:1) — 1080×1080', 'w' => 1080, 'h' => 1080],
            'ig_reel_9_16'      => ['label' => '🎬 Reel / Story (9:16) — 1080×1920', 'w' => 1080, 'h' => 1920],
            'ig_landscape_16_9' => ['label' => '🖥️ Apaisado (16:9) — 1920×1080', 'w' => 1920, 'h' => 1080],
            'ig_story_9_16'     => ['label' => '📱 Instagram Story (9:16) — 1080×1920', 'w' => 1080, 'h' => 1920],
            'tiktok_9_16'       => ['label' => '🎵 TikTok (9:16) — 1080×1920', 'w' => 1080, 'h' => 1920],
            'yt_16_9'           => ['label' => '▶️ YouTube (16:9) — 1920×1080', 'w' => 1920, 'h' => 1080],
            'yt_short_9_16'     => ['label' => '⏫ YouTube Shorts (9:16) — 1080×1920', 'w' => 1080, 'h' => 1920],
            'pinterest_2_3'     => ['label' => '📌 Pinterest (2:3) — 1000×1500', 'w' => 1000, 'h' => 1500],
            'linkedin_1_91_1'   => ['label' => '💼 LinkedIn (1.91:1) — 1200×627', 'w' => 1200, 'h' => 627],
            'fb_link_1_91_1'    => ['label' => '👤 Facebook link (1.91:1) — 1200×630', 'w' => 1200, 'h' => 630],
            'twitter_16_9'      => ['label' => '🐦 X / Twitter (16:9) — 1600×900', 'w' => 1600, 'h' => 900],
            'custom'            => ['label' => '✏️ Personalizado (introduce W×H)', 'w' => 0, 'h' => 0],
        ];
    }

    /**
     * Defaults profesionales si el cliente no configuró nada.
     */
    public static function get_default_dimensions() {
        return [
            'imagen'   => ['width' => 1080, 'height' => 1350, 'preset' => 'ig_feed_4_5'],
            'reel'     => ['width' => 1080, 'height' => 1920, 'preset' => 'ig_reel_9_16'],
            'carrusel' => ['width' => 1080, 'height' => 1080, 'preset' => 'ig_square_1_1'],
            'story'    => ['width' => 1080, 'height' => 1920, 'preset' => 'ig_story_9_16'],
            'video'    => ['width' => 1920, 'height' => 1080, 'preset' => 'yt_16_9'],
        ];
    }

    /**
     * Devuelve TODAS las dimensiones configuradas del cliente (mezcla defaults
     * + lo que tenga guardado). Siempre devuelve los 5 tipos.
     */
    public static function get_dimensions_all($term_id) {
        $defaults = self::get_default_dimensions();
        if (!$term_id) return $defaults;
        $raw = (string) get_term_meta($term_id, 'nv_dimensiones_formatos', true);
        $stored = $raw !== '' ? json_decode($raw, true) : null;
        if (!is_array($stored)) return $defaults;
        $out = [];
        foreach ($defaults as $tipo => $def) {
            if (isset($stored[$tipo]) && is_array($stored[$tipo])) {
                $w = (int) ($stored[$tipo]['width']  ?? 0);
                $h = (int) ($stored[$tipo]['height'] ?? 0);
                $p = (string) ($stored[$tipo]['preset'] ?? '');
                if ($w >= 256 && $h >= 256 && $w <= 4096 && $h <= 4096) {
                    $out[$tipo] = ['width' => $w, 'height' => $h, 'preset' => $p];
                } else {
                    $out[$tipo] = $def;
                }
            } else {
                $out[$tipo] = $def;
            }
        }
        return $out;
    }

    /**
     * Dimensiones de un tipo concreto. Devuelve siempre ['width','height','preset'].
     */
    public static function get_dimensions_for_tipo($term_id, $tipo) {
        $tipo = (string) $tipo;
        $all = self::get_dimensions_all($term_id);
        if (isset($all[$tipo])) return $all[$tipo];
        return ['width' => 1080, 'height' => 1080, 'preset' => 'ig_square_1_1'];
    }

    /**
     * Convierte W×H del cliente al "size" más cercano que soporta gpt-image-2.
     * OpenAI solo acepta 1024x1024 / 1024x1536 / 1536x1024. Luego el resize
     * final al tamaño exacto lo hace composite_overlays_on_image().
     */
    public static function get_openai_size_for_dimensions($width, $height) {
        $width  = max(1, (int) $width);
        $height = max(1, (int) $height);
        $ratio = $width / $height;
        if ($ratio >= 1.25) return '1536x1024';
        if ($ratio <= 0.80) return '1024x1536';
        return '1024x1024';
    }

    /**
     * Convierte W×H al aspect_ratio Freepik más cercano.
     */
    public static function get_freepik_aspect_for_dimensions($width, $height) {
        $width  = max(1, (int) $width);
        $height = max(1, (int) $height);
        $ratio = $width / $height;
        $candidates = [
            'social_story_9_16' => 9/16,
            'traditional_3_4'   => 3/4,
            'square_1_1'        => 1.0,
            'classic_4_3'       => 4/3,
            'widescreen_16_9'   => 16/9,
        ];
        $best = 'square_1_1';
        $best_diff = INF;
        foreach ($candidates as $name => $r) {
            $diff = abs($ratio - $r);
            if ($diff < $best_diff) {
                $best = $name;
                $best_diff = $diff;
            }
        }
        return $best;
    }

    /**
     * v1.0.33: guía de estilo cacheada (texto en inglés generado por Claude vision
     * a partir de las refs visuales del cliente). Calculada UNA vez al cambiar refs,
     * leída en cada generación de copy. Evita el coste de vision por publicación.
     */
    public static function get_style_guide_cached($term_id) {
        return (string) get_term_meta($term_id, 'nv_style_guide_cached', true);
    }
    public static function get_style_guide_hash($term_id) {
        return (string) get_term_meta($term_id, 'nv_style_guide_hash', true);
    }
    public static function set_style_guide_cached($term_id, $guide, $hash) {
        update_term_meta($term_id, 'nv_style_guide_cached', (string) $guide);
        update_term_meta($term_id, 'nv_style_guide_hash', (string) $hash);
    }
    /**
     * @return bool true si la cache está obsoleta (refs han cambiado desde la última vez)
     *              o si no existe cache pero sí hay refs.
     */
    public static function is_style_guide_stale($term_id) {
        $current_hash = self::get_reference_images_hash($term_id);
        if (empty($current_hash)) return false; // sin refs, no aplica
        $cached_hash = self::get_style_guide_hash($term_id);
        return $current_hash !== $cached_hash;
    }

    /**
     * Subcarpetas como array de { name, id, type }, siempre array (vacío si no hay).
     */
    public static function get_drive_subfolders($term_id) {
        $raw = get_term_meta($term_id, 'nv_drive_subfolders', true);
        if (empty($raw)) return [];
        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) return [];
        // Normaliza estructura
        $out = [];
        foreach ($decoded as $row) {
            if (!is_array($row)) continue;
            $out[] = [
                'name' => isset($row['name']) ? (string) $row['name'] : '',
                'id'   => isset($row['id'])   ? (string) $row['id']   : '',
                'type' => (isset($row['type']) && isset(self::SUBFOLDER_TYPES[$row['type']])) ? $row['type'] : 'otros',
            ];
        }
        return $out;
    }

    /**
     * Devuelve la config completa de un cliente para el prompt / UI.
     * Equivalente al "cliente_folder" que se exponía antes en cliente_config.
     */
    public static function get_cliente_drive_config($term_id_or_slug) {
        if (is_numeric($term_id_or_slug)) {
            $term_id = (int) $term_id_or_slug;
        } else {
            $slug = (string) $term_id_or_slug;
            $term = get_term_by('slug', $slug, 'nv_cliente');
            if (!$term || is_wp_error($term)) {
                // intenta con underscore/dash flip
                $alt = strpos($slug, '-') !== false ? str_replace('-', '_', $slug) : str_replace('_', '-', $slug);
                $term = get_term_by('slug', $alt, 'nv_cliente');
            }
            if (!$term || is_wp_error($term)) return null;
            $term_id = $term->term_id;
        }
        $mode = self::get_drive_mode($term_id);
        return [
            'drive_mode'  => $mode,
            'root_id'     => $mode === 'configured' ? self::get_drive_root_id($term_id) : '',
            'subfolders'  => $mode === 'configured' ? self::get_drive_subfolders($term_id) : [],
        ];
    }

    /**
     * Validación de formato de Drive ID.
     * IDs reales son ~33 chars [a-zA-Z0-9_-]; toleramos 20-60 por seguridad.
     */
    public static function is_valid_drive_id($id) {
        return (bool) preg_match('/^[a-zA-Z0-9_-]{20,60}$/', (string) $id);
    }

    /**
     * Extrae el ID de una URL Drive o devuelve la cadena tal cual si ya parece un ID.
     */
    public static function extract_drive_id($input) {
        $input = trim((string) $input);
        if (empty($input)) return '';
        // Pega URL típica: https://drive.google.com/drive/folders/<ID>?usp=sharing
        // o https://drive.google.com/drive/u/0/folders/<ID>
        if (preg_match('#/folders/([a-zA-Z0-9_-]{20,60})#', $input, $m)) {
            return $m[1];
        }
        if (self::is_valid_drive_id($input)) return $input;
        return ''; // no se reconoce
    }

    // ─────────────────────────────────────────────────────────────────────
    // A1: Render de formulario en add/edit
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Form en pantalla "Añadir cliente" (no hay term object aún).
     */
    public static function render_add_form() {
        self::render_form_fields(null, true);
    }

    /**
     * Form en pantalla "Editar cliente".
     */
    public static function render_edit_form($term) {
        self::render_form_fields($term, false);
    }

    /**
     * Renderiza el HTML del formulario (compartido add/edit).
     *
     * @param WP_Term|null $term  null en add; objeto en edit.
     * @param bool $is_add  true si es el form de añadir (HTML estructura distinta).
     */
    private static function render_form_fields($term, $is_add) {
        $term_id = $term ? (int) $term->term_id : 0;
        $mode    = $term_id ? self::get_drive_mode($term_id) : 'pending';
        $root_id = $term_id ? self::get_drive_root_id($term_id) : '';
        $subfolders = $term_id ? self::get_drive_subfolders($term_id) : [];
        $brand_brief = $term_id ? self::get_brand_brief($term_id) : '';

        // Wrapper distinto en add (div) vs edit (tr)
        $wrap_open  = $is_add ? '<div class="form-field nv-drive-config-card" style="border:1px solid #c5d2e2; background:#f7f9fc; border-radius:6px; padding:14px 18px; margin-top:18px;">' : '';
        $wrap_close = $is_add ? '</div>' : '';
        $row_open   = $is_add ? '<div class="form-field" style="margin:10px 0;">' : '<tr class="form-field"><th scope="row">';
        $row_mid    = $is_add ? '' : '</th><td>';
        $row_close  = $is_add ? '</div>' : '</td></tr>';

        // ─────────────────────────────────────────────
        // v1.0.23: Brief de marca (textarea libre, opcional)
        // ─────────────────────────────────────────────
        if (!$is_add) {
            echo '<tr><th colspan="2" style="padding-top:24px;"><h2 style="margin:0; font-size:15px; color:#0a0a0a;">📝 Brief de marca</h2><p class="description" style="margin:4px 0 0; font-weight:normal;">Resumen del posicionamiento, tono y audiencia. Se usa para adaptar el copy generado por IA en publicaciones multi-cliente. Opcional pero muy recomendado.</p></th></tr>';
        } else {
            echo '<div class="form-field nv-drive-config-card" style="border:1px solid #c5d2e2; background:#f7f9fc; border-radius:6px; padding:14px 18px; margin-top:18px;">';
            echo '<h2 style="margin:0 0 6px; font-size:15px; color:#0a0a0a;">📝 Brief de marca</h2>';
            echo '<p class="description" style="margin:0 0 14px;">Posicionamiento, tono y audiencia. Se usa para adaptar el copy generado por IA. Opcional pero muy recomendado.</p>';
        }

        echo $row_open;
        if (!$is_add) echo '<label for="nv_brand_brief">Brief de marca</label>' . $row_mid;
        echo '<textarea name="nv_brand_brief" id="nv_brand_brief" rows="6" style="width:100%; max-width:700px; font-size:13px; line-height:1.5;" placeholder="Ej: Clínica de medicina estética en Marbella. Tono cálido, profesional y cercano. Audiencia: mujeres 30-55 años, residentes en Costa del Sol. Eslogan: &quot;En Clínica March cuidamos de ti&quot;. Evitar: lenguaje agresivo de venta, antes/después sin consentimiento RGPD.">' . esc_textarea($brand_brief) . '</textarea>';
        echo '<p class="description" style="margin-top:4px;">Cuanto más concreto, mejor adaptará la IA. Sugerencia: incluye sector + tono + audiencia + eslóganes + cosas a evitar.</p>';
        echo $row_close;

        if ($is_add) echo '</div>'; // cierra el card de Brief en add

        // ─────────────────────────────────────────────
        // v1.0.27: Branding (logo + fuente) — solo en edit (necesita term_id)
        // ─────────────────────────────────────────────
        if (!$is_add) {
            $logo_id    = self::get_logo_attachment_id($term_id);
            $logo_pos   = self::get_logo_position($term_id);
            $font_id    = self::get_font_attachment_id($term_id);
            $logo_url   = $logo_id ? wp_get_attachment_image_url($logo_id, 'medium') : '';
            $font_name  = $font_id ? get_the_title($font_id) : '';

            echo '<tr><th colspan="2" style="padding-top:24px;"><h2 style="margin:0; font-size:15px; color:#0a0a0a;">🎨 Branding</h2><p class="description" style="margin:4px 0 0; font-weight:normal;">Logo, fuente y colores corporativos que se aplican al post-procesar las imágenes generadas en multi-cliente. Si dejas algún color en blanco, se intentará extraer automáticamente de la guía de estilo (refs visuales) o se usará un default neutro.</p></th></tr>';

            // v1.0.46: web del cliente + auto-analizador con IA
            $cliente_website = (string) get_term_meta($term_id, 'nv_cliente_website', true);
            echo '<tr class="form-field"><th scope="row"><label for="nv_cliente_website">Página web del cliente</label></th><td>';
            echo '<div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">';
            echo '<input type="url" id="nv_cliente_website" name="nv_cliente_website" value="' . esc_attr($cliente_website) . '" placeholder="https://www.ejemplo.com" style="width:340px;" />';
            echo '<button type="button" id="nv-analyze-web-btn" class="button button-secondary" data-term-id="' . (int) $term_id . '" style="background:#fef3c7; border-color:#f59e0b;">🤖 Analizar web con IA</button>';
            echo '<span id="nv-analyze-web-status" style="font-size:12px; color:#666;"></span>';
            echo '</div>';
            echo '<p class="description" style="margin-top:6px;">Introduce la URL de la web del cliente y pulsa <strong>Analizar web con IA</strong>. La IA detectará automáticamente el logo, los colores corporativos y la fuente, y los rellenará abajo. <em>Después puedes editarlos manualmente.</em></p>';
            echo '<div id="nv-analyze-web-result" style="display:none; margin-top:10px; padding:12px; background:#f0f9ff; border-left:3px solid #0073aa; border-radius:4px; font-size:13px;"></div>';
            echo '</td></tr>';

            // v1.0.35: brand colors (primary / accent / text_on_primary)
            $bc_primary = NV_Cliente_Meta::sanitize_hex(get_term_meta($term_id, 'nv_brand_color_primary', true));
            $bc_accent  = NV_Cliente_Meta::sanitize_hex(get_term_meta($term_id, 'nv_brand_color_accent', true));
            $bc_text    = NV_Cliente_Meta::sanitize_hex(get_term_meta($term_id, 'nv_brand_color_text', true));
            $auto_colors = (empty($bc_primary) || empty($bc_accent) || empty($bc_text)) ? NV_Cliente_Meta::extract_colors_from_style_guide($term_id) : [];

            echo '<tr class="form-field"><th scope="row"><label>Colores corporativos</label></th><td>';
            echo '<div style="display:flex; gap:18px; flex-wrap:wrap;">';

            // Primary
            echo '<div>';
            echo '<label style="display:block; font-size:12px; font-weight:600; margin-bottom:4px;">Color primario</label>';
            echo '<input type="color" name="nv_brand_color_primary" value="' . esc_attr($bc_primary ?: '#1F2937') . '" style="width:60px; height:36px; padding:0; border:1px solid #ccc; border-radius:4px; cursor:pointer; vertical-align:middle;" />';
            echo ' <input type="text" name="nv_brand_color_primary_text" value="' . esc_attr($bc_primary) . '" placeholder="' . esc_attr($auto_colors[0] ?? '(auto)') . '" maxlength="7" style="width:90px; vertical-align:middle; font-family:monospace; text-transform:uppercase;" />';
            echo '<p class="description" style="margin:4px 0 0; font-size:11px;">Banda principal, fondo de tarjeta</p>';
            echo '</div>';

            // Accent
            echo '<div>';
            echo '<label style="display:block; font-size:12px; font-weight:600; margin-bottom:4px;">Color de acento</label>';
            echo '<input type="color" name="nv_brand_color_accent" value="' . esc_attr($bc_accent ?: '#2563EB') . '" style="width:60px; height:36px; padding:0; border:1px solid #ccc; border-radius:4px; cursor:pointer; vertical-align:middle;" />';
            echo ' <input type="text" name="nv_brand_color_accent_text" value="' . esc_attr($bc_accent) . '" placeholder="' . esc_attr($auto_colors[1] ?? '(auto)') . '" maxlength="7" style="width:90px; vertical-align:middle; font-family:monospace; text-transform:uppercase;" />';
            echo '<p class="description" style="margin:4px 0 0; font-size:11px;">CTA, dato destacado, highlights</p>';
            echo '</div>';

            // Text on primary
            echo '<div>';
            echo '<label style="display:block; font-size:12px; font-weight:600; margin-bottom:4px;">Texto sobre primario</label>';
            echo '<input type="color" name="nv_brand_color_text" value="' . esc_attr($bc_text ?: '#FFFFFF') . '" style="width:60px; height:36px; padding:0; border:1px solid #ccc; border-radius:4px; cursor:pointer; vertical-align:middle;" />';
            echo ' <input type="text" name="nv_brand_color_text_text" value="' . esc_attr($bc_text) . '" placeholder="(auto)" maxlength="7" style="width:90px; vertical-align:middle; font-family:monospace; text-transform:uppercase;" />';
            echo '<p class="description" style="margin:4px 0 0; font-size:11px;">Texto encima del primario (normalmente blanco o negro)</p>';
            echo '</div>';

            echo '</div>';

            if (!empty($auto_colors)) {
                echo '<div style="margin-top:10px; padding:8px; background:#f0f6fc; border-left:3px solid #0073aa; font-size:12px;">';
                echo '<strong>🎨 Hex detectados automáticamente en la guía de estilo:</strong> ';
                foreach ($auto_colors as $hex) {
                    echo '<span style="display:inline-flex; align-items:center; gap:4px; margin-right:8px;"><span style="display:inline-block; width:14px; height:14px; background:' . esc_attr($hex) . '; border:1px solid #ccc; border-radius:2px; vertical-align:middle;"></span><code style="font-size:11px;">' . esc_html($hex) . '</code></span>';
                }
                echo '<br><span style="color:#666;">Click en el cuadrito de color para usarlo, o copia el hex en el campo correspondiente.</span>';
                echo '</div>';
            }

            echo '<p class="description" style="margin-top:8px;">💡 Si dejas todos los campos vacíos, el plugin usa los colores extraídos automáticamente de la guía de estilo, o una paleta neutra como fallback.</p>';
            echo '</td></tr>';

            // v1.0.52: Selector de patrón visual (clean | frame)
            $visual_pattern = (string) get_term_meta($term_id, 'nv_visual_pattern', true);
            if (empty($visual_pattern)) $visual_pattern = 'clean';
            echo '<tr class="form-field"><th scope="row"><label for="nv_visual_pattern">Patrón visual</label></th><td>';
            echo '<select name="nv_visual_pattern" id="nv_visual_pattern" style="min-width:340px;">';
            $patterns = [
                'clean' => '🪶 Limpio — texto sobre la imagen sin chrome (default)',
                'frame' => '🟩 Frame — franja diagonal de color brand + cápsulas para texto (estilo Guardamuebles Reva)',
            ];
            foreach ($patterns as $val => $lbl) {
                echo '<option value="' . esc_attr($val) . '"' . selected($visual_pattern, $val, false) . '>' . esc_html($lbl) . '</option>';
            }
            echo '</select>';
            echo '<p class="description" style="margin-top:6px;">';
            echo '<strong>Limpio</strong>: texto plano (blanco o brand) directamente sobre la foto. Aspecto editorial sutil.<br>';
            echo '<strong>Frame</strong>: replica el patrón del calendario editorial de Guardamuebles Reva — triángulo diagonal en color primario + cápsulas con fondo opaco para cada línea de texto. Útil para clientes con identidad visual fuerte.';
            echo '</p>';
            echo '</td></tr>';

            // v1.0.53: Slider de fidelidad a refs visuales (0-100%).
            // Persistente por cliente, default 50%. En el modal de generación
            // hay override puntual.
            $refs_fidelity = (int) get_term_meta($term_id, 'nv_refs_fidelity', true);
            if ($refs_fidelity < 0 || $refs_fidelity > 100) $refs_fidelity = 50;
            echo '<tr class="form-field"><th scope="row"><label for="nv_refs_fidelity">Fidelidad a refs visuales</label></th><td>';
            echo '<div style="display:flex; align-items:center; gap:14px; max-width:560px;">';
            echo '<input type="range" name="nv_refs_fidelity" id="nv_refs_fidelity" min="0" max="100" step="5" value="' . esc_attr($refs_fidelity) . '" style="flex:1;" oninput="document.getElementById(\'nv_refs_fidelity_val\').textContent = this.value + \'%\';" />';
            echo '<output id="nv_refs_fidelity_val" style="font-weight:600; min-width:48px; text-align:right; font-family:monospace;">' . esc_html($refs_fidelity) . '%</output>';
            echo '</div>';
            echo '<div style="margin-top:10px; padding:10px; background:#f6f7f7; border-radius:4px; font-size:12px; line-height:1.55;">';
            echo '<div style="display:grid; grid-template-columns:60px 1fr; gap:8px 14px; align-items:start;">';
            echo '<strong style="color:#777;">0–30%</strong><span><em>Libertad total.</em> La IA ignora las imágenes de referencia y compone visualmente desde cero según el copy y los colores brand.</span>';
            echo '<strong style="color:#999;">30–70%</strong><span><em>Inspiración suave</em> (default). La IA se inspira en mood, paleta y composición de las refs sin copiarlas.</span>';
            echo '<strong style="color:#0a7d3a;">70–100%</strong><span><em>Replicación estricta.</em> La IA copia fielmente el patrón visual de las refs (franja, badges, posición del logo, distribución del texto). Útil para clientes con plantilla muy definida.</span>';
            echo '</div></div>';
            echo '<p class="description" style="margin-top:6px;">Este valor es el <strong>default</strong> del cliente. En el modal de generación hay un slider para hacer override puntual sin cambiar el default.</p>';
            echo '</td></tr>';

            // v1.0.53: Campo competidores (textarea, una URL o nombre por línea).
            // Si está vacío, el endpoint de análisis pide a la IA que busque
            // competidores del sector automáticamente.
            $competidores = (string) get_term_meta($term_id, 'nv_competidores', true);
            echo '<tr class="form-field"><th scope="row"><label for="nv_competidores">Competidores</label></th><td>';
            echo '<textarea name="nv_competidores" id="nv_competidores" rows="5" style="width:560px; font-family:monospace; font-size:12px;" placeholder="Una URL o nombre por línea, por ejemplo:&#10;https://www.competidor1.com&#10;@instagramcompetidor2&#10;Mudanzas García Marbella">' . esc_textarea($competidores) . '</textarea>';
            echo '<p class="description">Lista de competidores que se analizarán cuando pulses <strong>🔍 Analizar competencia</strong> en el modal de generación. Si dejas el campo vacío, la IA buscará competidores del sector en la web automáticamente. Recomendado: 3–8 competidores.</p>';
            echo '</td></tr>';

            // ─────────────────────────────────────────────
            // v1.0.71: 📐 Dimensiones por formato
            // ─────────────────────────────────────────────
            $dimensiones = self::get_dimensions_all($term_id);
            $presets     = self::get_dimension_presets();
            $tipo_labels = [
                'imagen'   => '📷 Imagen (feed)',
                'reel'     => '🎬 Reel',
                'carrusel' => '🎴 Carrusel',
                'story'    => '📱 Story',
                'video'    => '🎥 Video',
            ];

            echo '<tr><th colspan="2" style="padding-top:24px;"><h2 style="margin:0; font-size:15px; color:#0a0a0a;">📐 Dimensiones por formato</h2>';
            echo '<p class="description" style="margin:4px 0 0; font-weight:normal;">Tamaño exacto al que se generan las imágenes para cada tipo de publicación. Los defaults cubren el 95% de los casos (Instagram, Reel, Story, etc.). Si el cliente necesita otro ratio (Pinterest 2:3, LinkedIn 1.91:1, custom), sobrescríbelo aquí. El modelo de IA usa el ratio más cercano que soporta y luego se reescala/recorta al tamaño exacto que indiques.</p></th></tr>';

            foreach ($tipo_labels as $tipo => $label) {
                $d = $dimensiones[$tipo];
                $current_preset = $d['preset'] ?: 'custom';
                echo '<tr class="form-field nv-dim-row" data-tipo="' . esc_attr($tipo) . '">';
                echo '<th scope="row"><label>' . esc_html($label) . '</label></th>';
                echo '<td>';
                echo '<div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">';

                // Selector de preset
                echo '<select class="nv-dim-preset" name="nv_dim_preset[' . esc_attr($tipo) . ']" style="min-width:300px;">';
                foreach ($presets as $pkey => $p) {
                    $sel = ($pkey === $current_preset) ? ' selected' : '';
                    echo '<option value="' . esc_attr($pkey) . '" data-w="' . (int) $p['w'] . '" data-h="' . (int) $p['h'] . '"' . $sel . '>' . esc_html($p['label']) . '</option>';
                }
                echo '</select>';

                // Width × Height (siempre visibles para que el usuario vea/edite)
                echo ' <input type="number" class="nv-dim-w" name="nv_dim_w[' . esc_attr($tipo) . ']" value="' . (int) $d['width'] . '" min="256" max="4096" step="1" style="width:90px; text-align:right;" /> ';
                echo ' <span style="color:#888;">×</span> ';
                echo ' <input type="number" class="nv-dim-h" name="nv_dim_h[' . esc_attr($tipo) . ']" value="' . (int) $d['height'] . '" min="256" max="4096" step="1" style="width:90px; text-align:right;" /> ';
                echo ' <span style="color:#888; font-size:12px;">px</span>';
                echo ' <span class="nv-dim-ratio" style="color:#666; font-size:12px; min-width:60px; font-family:monospace;"></span>';
                echo '</div>';
                echo '</td></tr>';
            }

            // JS de la sección: cambiar preset → sobrescribe W×H; cambiar W×H → marca "custom"; calcula ratio
            ?>
            <script>
            (function($){
                function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }
                function ratioLabel(w, h) {
                    w = parseInt(w, 10); h = parseInt(h, 10);
                    if (!w || !h) return '';
                    var g = gcd(w, h);
                    return (w/g) + ':' + (h/g);
                }
                function refreshRatio($row) {
                    var w = $row.find('.nv-dim-w').val();
                    var h = $row.find('.nv-dim-h').val();
                    $row.find('.nv-dim-ratio').text(ratioLabel(w, h) || '');
                }
                $('.nv-dim-row').each(function(){ refreshRatio($(this)); });
                $(document).on('change', '.nv-dim-preset', function(){
                    var $row = $(this).closest('.nv-dim-row');
                    var $opt = $(this).find('option:selected');
                    var w = parseInt($opt.data('w'), 10);
                    var h = parseInt($opt.data('h'), 10);
                    if (w > 0 && h > 0) {
                        $row.find('.nv-dim-w').val(w);
                        $row.find('.nv-dim-h').val(h);
                    }
                    refreshRatio($row);
                });
                $(document).on('input change', '.nv-dim-w, .nv-dim-h', function(){
                    var $row = $(this).closest('.nv-dim-row');
                    // Al editar manualmente, marcar como "custom"
                    $row.find('.nv-dim-preset').val('custom');
                    refreshRatio($row);
                });
            })(jQuery);
            </script>
            <?php

            ?>
            <script>
            // v1.0.35: sincroniza el input color con el text al editar cualquiera
            (function($){
                ['primary', 'accent', 'text'].forEach(function(key){
                    var nameC = 'nv_brand_color_' + key;
                    var nameT = 'nv_brand_color_' + key + '_text';
                    $(document).on('input change', '[name="' + nameC + '"]', function(){
                        $('[name="' + nameT + '"]').val($(this).val().toUpperCase());
                    });
                    $(document).on('input change', '[name="' + nameT + '"]', function(){
                        var v = $(this).val().trim();
                        if (/^#?[0-9A-Fa-f]{6}$/.test(v)) {
                            if (v[0] !== '#') v = '#' + v;
                            $('[name="' + nameC + '"]').val(v);
                        }
                    });
                });
            })(jQuery);
            </script>
            <?php

            // Logo upload
            echo '<tr class="form-field"><th scope="row"><label>Logo corporativo</label></th><td>';
            echo '<div id="nv-logo-preview-wrap" style="margin-bottom:8px;">';
            if ($logo_url) {
                echo '<img id="nv-logo-preview" src="' . esc_url($logo_url) . '" style="max-height:80px; max-width:200px; background:#ddd; padding:4px; border-radius:4px; display:inline-block; vertical-align:middle;" />';
            } else {
                echo '<span id="nv-logo-preview-empty" style="color:#888; font-style:italic;">Sin logo asignado</span>';
            }
            echo '</div>';
            echo '<input type="hidden" name="nv_logo_attachment_id" id="nv_logo_attachment_id" value="' . esc_attr($logo_id) . '" />';
            echo '<button type="button" class="button" id="nv-logo-upload-btn">📷 Seleccionar / subir logo</button>';
            if ($logo_id) {
                echo ' <button type="button" class="button" id="nv-logo-clear-btn">❌ Quitar</button>';
            }
            echo '<p class="description">Recomendado: PNG con fondo transparente, mín 400px de ancho. Si subes un JPG con fondo blanco se verá feo en imágenes oscuras.</p>';
            echo '</td></tr>';

            // Logo position
            echo '<tr class="form-field"><th scope="row"><label for="nv_logo_position">Posición del logo</label></th><td>';
            echo '<select name="nv_logo_position" id="nv_logo_position">';
            $positions = [
                'br' => '↘️ Esquina inferior derecha (recomendado)',
                'bl' => '↙️ Esquina inferior izquierda',
                'tr' => '↗️ Esquina superior derecha',
                'tl' => '↖️ Esquina superior izquierda',
            ];
            foreach ($positions as $val => $label) {
                $sel = ($logo_pos === $val) ? ' selected' : '';
                echo '<option value="' . esc_attr($val) . '"' . $sel . '>' . esc_html($label) . '</option>';
            }
            echo '</select>';
            echo '</td></tr>';

            // Font upload — v1.0.63 multi-fuente con weight
            $fonts_typed = self::get_fonts_typed($term_id);
            $fonts_json = wp_json_encode(array_map(function($f) {
                return [
                    'id' => $f['id'],
                    'weight' => $f['weight'],
                    'name' => get_the_title($f['id']),
                ];
            }, $fonts_typed));

            echo '<tr class="form-field"><th scope="row"><label>Fuentes personalizadas</label></th><td>';
            echo '<div id="nv-fonts-list" style="margin-bottom:10px;"></div>';
            echo '<input type="hidden" name="nv_font_attachments_json" id="nv_font_attachments_json" value="' . esc_attr($fonts_json) . '" />';
            echo '<button type="button" class="button button-primary" id="nv-font-add-btn">🔤 Añadir fuente (TTF/OTF)</button>';
            echo '<p class="description"><strong>Recomendado:</strong> sube al menos <strong>2 fuentes</strong> — una <em>Regular/Thin</em> y otra <em>Bold</em>. La AI compone los headlines combinando ambas (líneas <code>weight:bold</code> usan la Bold, el resto la Regular). Ejemplo Clínica March: Montserrat-Regular + Montserrat-Bold.</p>';
            echo '<p class="description" style="font-size:11px; color:#666;">Si solo subes 1 fuente, se usa para todo. Si no subes ninguna, se usa Poppins Bold por defecto.</p>';
            echo '</td></tr>';

            // JS uploaders
            ?>
            <script>
            // v1.0.29: event delegation + lazy wp.media check para evitar race condition.
            // El script anterior hacía early return si wp.media no estaba listo todavía,
            // dejando los botones sin handlers. Ahora delegamos en document y comprobamos
            // wp.media solo cuando se hace click.
            (function($){
                function nvEnsureMedia(cb){
                    if (typeof wp !== 'undefined' && wp.media) { cb(); return; }
                    var attempts = 0;
                    var iv = setInterval(function(){
                        if (typeof wp !== 'undefined' && wp.media) {
                            clearInterval(iv); cb();
                        } else if (++attempts > 50) {
                            clearInterval(iv);
                            alert('NV Dashboard: el media uploader de WordPress no se cargó. Intenta recargar la página. Si persiste, hay un conflicto con otro plugin.');
                        }
                    }, 100);
                }

                // ───── v1.0.63: Fonts (múltiples) — gestión array ─────
                var nvFontsList = [];
                try {
                    nvFontsList = JSON.parse($('#nv_font_attachments_json').val() || '[]') || [];
                } catch(e) { nvFontsList = []; }
                if (!Array.isArray(nvFontsList)) nvFontsList = [];

                function nvSyncFontsHidden() {
                    $('#nv_font_attachments_json').val(JSON.stringify(nvFontsList));
                }

                function nvRenderFonts() {
                    var $box = $('#nv-fonts-list');
                    $box.empty();
                    if (nvFontsList.length === 0) {
                        $box.html('<span style="color:#888; font-style:italic;">Sin fuentes personalizadas — se usa Poppins Bold por defecto.</span>');
                        return;
                    }
                    nvFontsList.forEach(function(f, idx) {
                        var $row = $('<div></div>').css({
                            display: 'flex', alignItems: 'center', gap: '10px',
                            padding: '8px 10px', marginBottom: '6px',
                            background: '#f8f9fa', border: '1px solid #dde0e3', borderRadius: '4px'
                        });
                        $row.append('<span style="flex:0 0 auto; font-size:18px;">🔤</span>');
                        $row.append('<strong style="flex:1; font-size:13px; word-break:break-all;">' + (f.name || ('Fuente #' + f.id)) + '</strong>');
                        var $sel = $('<select></select>').css({width: '120px', flex: '0 0 auto'});
                        $sel.append('<option value="regular"' + (f.weight === 'regular' ? ' selected' : '') + '>Regular / Thin</option>');
                        $sel.append('<option value="bold"' + (f.weight === 'bold' ? ' selected' : '') + '>Bold</option>');
                        $sel.on('change', function(){
                            nvFontsList[idx].weight = $(this).val();
                            nvSyncFontsHidden();
                        });
                        $row.append($sel);
                        var $rem = $('<button type="button" class="button button-link-delete">❌ Quitar</button>');
                        $rem.on('click', function(e){
                            e.preventDefault();
                            nvFontsList.splice(idx, 1);
                            nvSyncFontsHidden();
                            nvRenderFonts();
                        });
                        $row.append($rem);
                        $box.append($row);
                    });
                }
                nvRenderFonts(); // initial render

                $(document).on('click', '#nv-font-add-btn', function(e){
                    e.preventDefault();
                    nvEnsureMedia(function(){
                        var frame = wp.media({
                            title: 'Selecciona o sube la fuente (TTF/OTF)',
                            button: { text: 'Usar esta fuente' },
                            library: {},
                            multiple: false
                        });
                        frame.on('select', function(){
                            var att = frame.state().get('selection').first().toJSON();
                            var name = (att.filename || att.title || '').toLowerCase();
                            if (!/\.(ttf|otf)$/.test(name)) {
                                alert('La fuente debe ser TTF u OTF. Has seleccionado: ' + (att.filename || att.title));
                                return;
                            }
                            // Evitar duplicados por id
                            if (nvFontsList.some(function(f){ return f.id === att.id; })) {
                                alert('Esa fuente ya está añadida.');
                                return;
                            }
                            // Heurística: si el nombre incluye "bold" → weight=bold, sino regular
                            var weight = /bold/i.test(att.title || att.filename || '') ? 'bold' : 'regular';
                            // Si ya hay una regular y la nueva no tiene "bold" en el nombre,
                            // sugerir bold para no acabar con dos regular
                            if (weight === 'regular' && nvFontsList.some(function(f){ return f.weight === 'regular'; })) {
                                weight = 'bold';
                            }
                            nvFontsList.push({
                                id: att.id,
                                weight: weight,
                                name: att.title || att.filename
                            });
                            nvSyncFontsHidden();
                            nvRenderFonts();
                        });
                        frame.open();
                    });
                });

                // Logo uploader — event delegation
                $(document).on('click', '#nv-logo-upload-btn', function(e){
                    e.preventDefault();
                    nvEnsureMedia(function(){
                        var frame = wp.media({
                            title: 'Selecciona o sube el logo',
                            button: { text: 'Usar este logo' },
                            library: { type: 'image' },
                            multiple: false
                        });
                        frame.on('select', function(){
                            var att = frame.state().get('selection').first().toJSON();
                            $('#nv_logo_attachment_id').val(att.id);
                            $('#nv-logo-preview-wrap').html('<img id="nv-logo-preview" src="' + att.url + '" style="max-height:80px; max-width:200px; background:#ddd; padding:4px; border-radius:4px; display:inline-block; vertical-align:middle;" />');
                            if (!$('#nv-logo-clear-btn').length) {
                                $('#nv-logo-upload-btn').after(' <button type="button" class="button" id="nv-logo-clear-btn">❌ Quitar</button>');
                            }
                        });
                        frame.open();
                    });
                });
                $(document).on('click', '#nv-logo-clear-btn', function(e){
                    e.preventDefault();
                    $('#nv_logo_attachment_id').val('');
                    $('#nv-logo-preview-wrap').html('<span id="nv-logo-preview-empty" style="color:#888; font-style:italic;">Sin logo asignado (recordar guardar)</span>');
                    $(this).remove();
                });

                // Font uploader v1.0.63 vive arriba en este mismo bloque
                // (gestión array nvFontsList con render dinámico).
            })(jQuery);
            </script>
            <?php
        }

        // ─────────────────────────────────────────────
        // v1.0.28: Imágenes de referencia visual — Claude las analiza
        // ─────────────────────────────────────────────
        if (!$is_add) {
            $refs_data = self::get_reference_images_data($term_id);
            $refs_ids  = array_map(function($r){ return $r['id']; }, $refs_data);

            echo '<tr><th colspan="2" style="padding-top:24px;"><h2 style="margin:0; font-size:15px; color:#0a0a0a;">📚 Imágenes de referencia visual</h2><p class="description" style="margin:4px 0 0; font-weight:normal;">Sube fotos del cliente y <strong>categoriza cada una</strong> (CEO, Equipo, Instalaciones, Pacientes, Productos). Al generar publicaciones podrás forzar qué tipos quieres que aparezcan. La IA también analiza estas refs para extraer el ADN visual de la marca.</p></th></tr>';

            echo '<tr class="form-field"><th scope="row"><label>Imágenes de referencia</label></th><td>';
            // v1.0.59: storage en JSON con tipo. v1.0.68: incluye person_name opcional.
            $refs_json_for_input = wp_json_encode(array_map(function($r){
                return [
                    'id' => (int) $r['id'],
                    'type' => (string) $r['type'],
                    'person_name' => (string) ($r['person_name'] ?? ''),
                ];
            }, $refs_data));
            echo '<input type="hidden" name="nv_reference_images" id="nv_reference_images" value="' . esc_attr($refs_json_for_input) . '" />';

            // Tipos disponibles (alineados con Drive subfolders + general como fallback)
            $ref_types_labels = [
                'persona_destacada'  => '👤 CEO / Persona destacada',
                'equipo'             => '👥 Equipo / Trabajadores',
                'instalaciones'      => '🏢 Local / Clínica / Negocio',
                'pacientes_usuarios' => '🧑 Paciente / Usuario',
                'productos'          => '📦 Producto',
                'general'            => '⚪ Sin categorizar',
            ];

            // Tipos que admiten person_name
            $person_capable_types = ['persona_destacada', 'equipo', 'pacientes_usuarios'];

            // Grid de thumbnails con selector de tipo + nombre opcional
            echo '<div id="nv-refs-grid" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap:12px; margin-bottom:10px; max-width:900px;">';
            foreach ($refs_data as $r) {
                $needs_name = in_array($r['type'], $person_capable_types, true);
                echo '<div class="nv-ref-tile" data-id="' . esc_attr($r['id']) . '" data-type="' . esc_attr($r['type']) . '" style="display:flex; flex-direction:column; gap:4px;">';
                echo '<div style="position:relative; aspect-ratio:1/1; background:#f0f0f0 url(\'' . esc_url($r['thumb']) . '\') center/cover no-repeat; border-radius:4px; border:1px solid #ddd;">';
                echo '<button type="button" class="nv-ref-remove" title="Quitar de las referencias" style="position:absolute; top:2px; right:2px; width:22px; height:22px; border-radius:50%; background:#c00; color:#fff; border:none; cursor:pointer; font-size:14px; line-height:1; padding:0;">×</button>';
                echo '</div>';
                echo '<select class="nv-ref-type-select" style="width:100%; font-size:11px; padding:2px;">';
                foreach ($ref_types_labels as $val => $label) {
                    $sel = ($r['type'] === $val) ? 'selected' : '';
                    echo '<option value="' . esc_attr($val) . '" ' . $sel . '>' . esc_html($label) . '</option>';
                }
                echo '</select>';
                // v1.0.68: input person_name solo visible si el tipo es de persona
                $hidden_style = $needs_name ? '' : 'display:none;';
                $person_name_val = esc_attr($r['person_name'] ?? '');
                echo '<input type="text" class="nv-ref-person-name" placeholder="Nombre (ej: Dra Angie)" value="' . $person_name_val . '" style="width:100%; font-size:11px; padding:3px 5px; ' . $hidden_style . '" maxlength="60" />';
                echo '</div>';
            }
            echo '</div>';

            echo '<button type="button" class="button" id="nv-refs-add-btn">📷 Añadir imágenes de referencia</button>';
            echo ' <span id="nv-refs-count" style="margin-left:8px; color:#666; font-size:12px;">' . count($refs_data) . ' imagen' . (count($refs_data) === 1 ? '' : 'es') . ' actualmente</span>';
            echo '<p class="description" style="margin-top:6px;">⚠️ Formatos: JPG, PNG, WEBP. <strong>Categoriza cada imagen</strong> con el desplegable. Para fotos de personas (CEO, equipo, pacientes), <strong>añade el nombre</strong> en el campo que aparece debajo (ej: "Rochar", "Dra Angie Bech", "Asistente Carmen"). Así la AI sabe que 3 fotos de "Dra Angie" son de la MISMA persona y no inventa caras nuevas. Las imágenes "Sin categorizar" se usan como refs generales.</p>';
            echo '</td></tr>';

            // v1.0.33: cache de guía de estilo
            $cached_guide = self::get_style_guide_cached($term_id);
            $is_stale     = self::is_style_guide_stale($term_id);
            $rest_url     = esc_url_raw(rest_url('nv/v1/actualizar-guia-estilo/' . $term_id));
            $nonce        = wp_create_nonce('wp_rest');

            echo '<tr class="form-field"><th scope="row"><label>Guía de estilo (cache)</label></th><td>';
            if (empty($refs_data)) {
                echo '<p style="color:#888; font-style:italic; margin:0;">Sube imágenes de referencia primero para poder generar una guía de estilo.</p>';
            } else {
                if (!empty($cached_guide) && !$is_stale) {
                    echo '<div style="background:#f0f9ee; border:1px solid #2ea043; border-radius:4px; padding:10px; margin-bottom:8px;">';
                    echo '<strong style="color:#2ea043;">✓ Guía de estilo cacheada</strong> ';
                    echo '<span style="color:#666; font-size:12px;">(' . strlen($cached_guide) . ' caracteres)</span>';
                    echo '<details style="margin-top:6px;"><summary style="cursor:pointer; font-size:12px;">Ver contenido</summary>';
                    echo '<pre style="background:#fff; padding:10px; border-radius:3px; font-size:11px; white-space:pre-wrap; word-break:break-word; max-height:200px; overflow:auto; margin:6px 0 0;">' . esc_html($cached_guide) . '</pre>';
                    echo '</details></div>';
                } elseif (!empty($cached_guide) && $is_stale) {
                    echo '<div style="background:#fffbe5; border:1px solid #dba000; border-radius:4px; padding:10px; margin-bottom:8px;">';
                    echo '<strong style="color:#dba000;">⚠️ Guía de estilo obsoleta</strong> ';
                    echo '<span style="color:#666; font-size:12px;">— las imágenes han cambiado desde la última vez. Refresca para que la próxima generación use la nueva guía.</span>';
                    echo '</div>';
                } else {
                    echo '<div style="background:#fff5f5; border:1px solid #c00; border-radius:4px; padding:10px; margin-bottom:8px;">';
                    echo '<strong style="color:#c00;">✗ Sin guía de estilo cacheada</strong> ';
                    echo '<span style="color:#666; font-size:12px;">— hasta que generes una, las publicaciones se crean sin guía de estilo (más rápido pero la imagen no respetará tu paleta).</span>';
                    echo '</div>';
                }
                echo '<button type="button" class="button button-primary" id="nv-style-guide-btn" data-rest="' . esc_attr($rest_url) . '" data-nonce="' . esc_attr($nonce) . '">🔄 Generar/actualizar guía de estilo</button>';
                echo ' <span id="nv-style-guide-status" style="margin-left:8px; color:#0073aa; font-size:12px;"></span>';
                echo '<p class="description" style="margin-top:6px;">Tarda 10-25s. Se calcula UNA vez por cliente y se reutiliza en cada generación. Vuelve a pulsar si añades/quitas refs visuales.</p>';
            }
            echo '</td></tr>';

            ?>
            <script>
            // v1.0.33: handler del botón "Generar guía de estilo"
            (function($){
                $(document).on('click', '#nv-style-guide-btn', function(e){
                    e.preventDefault();
                    var $btn = $(this);
                    var $status = $('#nv-style-guide-status');
                    var url = $btn.data('rest');
                    var nonce = $btn.data('nonce');
                    $btn.prop('disabled', true);
                    $status.html('<span style="color:#0073aa;">⏳ Llamando a Claude vision con las refs… (10-25s)</span>');
                    fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': nonce },
                        body: '{}'
                    }).then(function(r){
                        var ctype = r.headers.get('content-type') || '';
                        if (!ctype.includes('json')) {
                            return r.text().then(function(t){
                                throw new Error('Servidor devolvió HTML (HTTP ' + r.status + '): ' + t.substr(0, 200));
                            });
                        }
                        return r.json().then(function(d){
                            if (!r.ok || !d || d.code) throw new Error((d && d.message) ? d.message : 'HTTP ' + r.status);
                            return d;
                        });
                    }).then(function(d){
                        $status.html('<span style="color:#2ea043;">✓ Guía actualizada (' + (d.length || 0) + ' caracteres). Recarga para verla.</span>');
                        setTimeout(function(){ location.reload(); }, 1500);
                    }).catch(function(err){
                        $status.html('<span style="color:#c00;">❌ ' + err.message + '</span>');
                        $btn.prop('disabled', false);
                    });
                });
            })(jQuery);
            </script>
            <?php

            ?>
            <script>
            // v1.0.29: event delegation + lazy wp.media check (mismo motivo que logo/font arriba)
            (function($){
                function nvEnsureMediaRefs(cb){
                    if (typeof wp !== 'undefined' && wp.media) { cb(); return; }
                    var attempts = 0;
                    var iv = setInterval(function(){
                        if (typeof wp !== 'undefined' && wp.media) {
                            clearInterval(iv); cb();
                        } else if (++attempts > 50) {
                            clearInterval(iv);
                            alert('NV Dashboard: el media uploader de WordPress no se cargó. Intenta recargar la página.');
                        }
                    }, 100);
                }

                function nvRefsSyncHidden() {
                    // v1.0.59: storage JSON con tipo. v1.0.68: + person_name opcional.
                    var items = $('.nv-ref-tile').map(function(){
                        var $tile = $(this);
                        var $sel = $tile.find('.nv-ref-type-select');
                        var $name = $tile.find('.nv-ref-person-name');
                        return {
                            id: parseInt($tile.data('id'), 10),
                            type: $sel.length ? $sel.val() : 'general',
                            person_name: $name.length ? ($name.val() || '').trim() : ''
                        };
                    }).get().filter(function(it){ return it.id > 0; });
                    $('#nv_reference_images').val(JSON.stringify(items));
                    var n = items.length;
                    $('#nv-refs-count').text(n + ' imagen' + (n === 1 ? '' : 'es') + ' actualmente (recordar guardar)');
                }

                // v1.0.68: tipos que admiten person_name
                var personCapableTypes = ['persona_destacada', 'equipo', 'pacientes_usuarios'];

                $(document).on('click', '#nv-refs-add-btn', function(e){
                    e.preventDefault();
                    nvEnsureMediaRefs(function(){
                        var frame = wp.media({
                            title: 'Selecciona o sube imágenes de referencia',
                            button: { text: 'Añadir como referencias' },
                            library: { type: 'image' },
                            multiple: true
                        });
                        frame.on('select', function(){
                            var sel = frame.state().get('selection');
                            var existing = $('.nv-ref-tile').map(function(){ return parseInt($(this).data('id'),10); }).get();
                            // v1.0.59: lista de tipos para el selector (debe coincidir con $ref_types_labels en PHP)
                            var typeOptions = [
                                {v:'persona_destacada',  l:'👤 CEO / Persona destacada'},
                                {v:'equipo',             l:'👥 Equipo / Trabajadores'},
                                {v:'instalaciones',      l:'🏢 Local / Clínica / Negocio'},
                                {v:'pacientes_usuarios', l:'🧑 Paciente / Usuario'},
                                {v:'productos',          l:'📦 Producto'},
                                {v:'general',            l:'⚪ Sin categorizar'}
                            ];
                            sel.each(function(att){
                                var a = att.toJSON();
                                if (existing.indexOf(a.id) !== -1) return;
                                var thumb = (a.sizes && a.sizes.thumbnail && a.sizes.thumbnail.url) ? a.sizes.thumbnail.url : a.url;
                                var optsHtml = typeOptions.map(function(o){
                                    var defSel = (o.v === 'general') ? ' selected' : '';
                                    return '<option value="' + o.v + '"' + defSel + '>' + o.l + '</option>';
                                }).join('');
                                // v1.0.68: input person_name oculto por defecto (tipo inicial = general)
                                var tileHtml =
                                    '<div class="nv-ref-tile" data-id="' + a.id + '" data-type="general" style="display:flex; flex-direction:column; gap:4px;">' +
                                      '<div style="position:relative; aspect-ratio:1/1; background:#f0f0f0 url(\'' + thumb + '\') center/cover no-repeat; border-radius:4px; border:1px solid #ddd;">' +
                                        '<button type="button" class="nv-ref-remove" title="Quitar de las referencias" style="position:absolute; top:2px; right:2px; width:22px; height:22px; border-radius:50%; background:#c00; color:#fff; border:none; cursor:pointer; font-size:14px; line-height:1; padding:0;">×</button>' +
                                      '</div>' +
                                      '<select class="nv-ref-type-select" style="width:100%; font-size:11px; padding:2px;">' + optsHtml + '</select>' +
                                      '<input type="text" class="nv-ref-person-name" placeholder="Nombre (ej: Dra Angie)" value="" style="width:100%; font-size:11px; padding:3px 5px; display:none;" maxlength="60" />' +
                                    '</div>';
                                $('#nv-refs-grid').append(tileHtml);
                            });
                            nvRefsSyncHidden();
                        });
                        frame.open();
                    });
                });

                $(document).on('click', '.nv-ref-remove', function(e){
                    e.preventDefault();
                    $(this).closest('.nv-ref-tile').remove();
                    nvRefsSyncHidden();
                });

                // v1.0.59: cuando cambia el tipo de una ref, sincronizar.
                // v1.0.68: además, mostrar/ocultar el input de nombre según el tipo.
                $(document).on('change', '.nv-ref-type-select', function(){
                    var $sel = $(this);
                    var $tile = $sel.closest('.nv-ref-tile');
                    var $name = $tile.find('.nv-ref-person-name');
                    var newType = $sel.val();
                    $tile.attr('data-type', newType);
                    if (personCapableTypes.indexOf(newType) !== -1) {
                        $name.show();
                    } else {
                        $name.hide().val(''); // limpiamos si ya no aplica
                    }
                    nvRefsSyncHidden();
                });

                // v1.0.68: input de nombre — sincronizar al perder foco o al escribir
                $(document).on('input', '.nv-ref-person-name', function(){
                    nvRefsSyncHidden();
                });
            })(jQuery);
            </script>
            <?php
        }

        // ─────────────────────────────────────────────
        // Drive refs (v1.0.21)
        // ─────────────────────────────────────────────
        if (!$is_add) {
            // Wrapper visual en edit: una row entera con título
            echo '<tr><th colspan="2" style="padding-top:24px;"><h2 style="margin:0; font-size:15px; color:#0a0a0a;">📁 Refs visuales de Google Drive</h2><p class="description" style="margin:4px 0 0; font-weight:normal;">Configuración obligatoria para que Claude pueda regenerar imágenes con refs canónicas del cliente.</p></th></tr>';
        } else {
            echo $wrap_open;
            echo '<h2 style="margin:0 0 6px; font-size:15px; color:#0a0a0a;">📁 Refs visuales de Google Drive</h2>';
            echo '<p class="description" style="margin:0 0 14px;">Indica si este cliente usará refs visuales de Drive para que Claude regenere imágenes. Si lo dejas en "Pendiente" podrás completarlo después editando el cliente.</p>';
        }

        // Modo Drive (radio)
        echo $row_open;
        if (!$is_add) echo '<label>Modo Drive refs <span style="color:#c00;">*</span></label>' . $row_mid;
        echo '<fieldset class="nv-drive-mode-fieldset">';
        if ($is_add) echo '<legend style="font-weight:600; margin-bottom:6px;">¿Este cliente usa refs visuales de Drive?</legend>';
        foreach (self::DRIVE_MODES as $val => $label) {
            $checked = ($mode === $val) ? 'checked' : '';
            echo '<label style="display:block; margin:6px 0; cursor:pointer;">';
            echo '<input type="radio" name="nv_drive_mode" value="' . esc_attr($val) . '" ' . $checked . ' class="nv-drive-mode-radio" /> ';
            echo esc_html($label);
            echo '</label>';
        }
        echo '</fieldset>';
        echo $row_close;

        // Subcontenedor que se muestra/oculta según modo
        echo '<div class="nv-drive-config-fields" style="' . ($mode === 'configured' ? '' : 'display:none;') . '">';

        // Carpeta raíz
        echo $row_open;
        if (!$is_add) echo '<label for="nv_drive_root_id">Carpeta raíz del cliente (URL o ID) <span style="color:#c00;">*</span></label>' . $row_mid;
        if ($is_add) echo '<label for="nv_drive_root_id" style="font-weight:600;">Carpeta raíz del cliente (URL o ID Drive)</label>';
        echo '<input type="text" name="nv_drive_root_id" id="nv_drive_root_id" value="' . esc_attr($root_id) . '" placeholder="https://drive.google.com/drive/folders/... o ID directo" style="width:100%; max-width:600px; font-family:monospace; font-size:12px;" class="nv-drive-id-input" />';
        echo '<p class="description nv-drive-id-feedback" style="margin-top:4px; min-height:18px;"></p>';
        echo $row_close;

        // Subcarpetas — repeater
        echo $row_open;
        if (!$is_add) echo '<label>Subcarpetas (opcional pero recomendado)</label>' . $row_mid;
        if ($is_add) echo '<label style="font-weight:600;">Subcarpetas (opcional pero recomendado)</label>';
        echo '<p class="description">Cada subcarpeta tiene un nombre libre, una URL/ID Drive y un tipo semántico para que Claude sepa cuándo usarla.</p>';

        echo '<div class="nv-drive-subfolders-list" style="margin:8px 0;">';
        if (!empty($subfolders)) {
            foreach ($subfolders as $idx => $sf) {
                self::render_subfolder_row($idx, $sf);
            }
        }
        echo '</div>';

        echo '<button type="button" class="button nv-drive-add-subfolder">+ Añadir subcarpeta</button>';
        echo $row_close;

        echo '</div>'; // .nv-drive-config-fields

        // JS y CSS inline (encapsulado para que no choque con otros scripts)
        echo self::render_form_js_css(count($subfolders));

        echo $wrap_close;
    }

    /**
     * Renderiza UNA row del repeater de subcarpetas.
     */
    private static function render_subfolder_row($idx, $data = ['name' => '', 'id' => '', 'type' => 'otros']) {
        $name = isset($data['name']) ? $data['name'] : '';
        $id   = isset($data['id'])   ? $data['id']   : '';
        $type = isset($data['type']) ? $data['type'] : 'otros';
        ?>
        <div class="nv-drive-subfolder-row" data-idx="<?php echo (int) $idx; ?>" style="display:grid; grid-template-columns: 1.2fr 2fr 1.4fr auto; gap:8px; margin-bottom:6px; align-items:center;">
            <input type="text" name="nv_drive_subfolders[<?php echo (int) $idx; ?>][name]"
                value="<?php echo esc_attr($name); ?>"
                placeholder="Nombre (ej: Rochar CEO)"
                style="font-size:12px;" />
            <input type="text" name="nv_drive_subfolders[<?php echo (int) $idx; ?>][id]"
                value="<?php echo esc_attr($id); ?>"
                placeholder="URL Drive o ID directo"
                class="nv-drive-id-input"
                style="font-family:monospace; font-size:12px;" />
            <select name="nv_drive_subfolders[<?php echo (int) $idx; ?>][type]" style="font-size:12px;">
                <?php foreach (self::SUBFOLDER_TYPES as $val => $label): ?>
                    <option value="<?php echo esc_attr($val); ?>" <?php selected($type, $val); ?>>
                        <?php echo esc_html($label); ?>
                    </option>
                <?php endforeach; ?>
            </select>
            <button type="button" class="button-link-delete nv-drive-remove-subfolder" style="color:#c00;">✕</button>
        </div>
        <?php
    }

    /**
     * JS + CSS inline para el form: toggle modo, repeater, validación de ID.
     */
    private static function render_form_js_css($initial_count) {
        $types_json = wp_json_encode(self::SUBFOLDER_TYPES);
        ob_start();
        ?>
        <style>
        .nv-drive-config-card label { font-weight:600; }
        .nv-drive-id-feedback.error { color:#c00; }
        .nv-drive-id-feedback.ok { color:#2ea043; }
        .nv-drive-id-input.invalid { border-color:#c00 !important; background:#fff5f5; }
        .nv-drive-id-input.valid { border-color:#2ea043 !important; }
        </style>
        <script>
        (function(){
            'use strict';
            var TYPES = <?php echo $types_json; ?>;
            var nextIdx = <?php echo (int) $initial_count; ?>;

            // Toggle de modo Drive
            document.addEventListener('change', function(e){
                if (e.target && e.target.classList && e.target.classList.contains('nv-drive-mode-radio')) {
                    var fields = document.querySelector('.nv-drive-config-fields');
                    if (!fields) return;
                    fields.style.display = (e.target.value === 'configured') ? '' : 'none';
                }
            });

            // Validación inline de IDs Drive
            function extractAndValidate(input) {
                var v = (input.value || '').trim();
                var fb = input.parentElement.querySelector('.nv-drive-id-feedback');
                if (v === '') {
                    input.classList.remove('valid', 'invalid');
                    if (fb) { fb.textContent = ''; fb.className = 'description nv-drive-id-feedback'; }
                    return;
                }
                var m = v.match(/\/folders\/([a-zA-Z0-9_-]{20,60})/);
                var id = m ? m[1] : (v.match(/^[a-zA-Z0-9_-]{20,60}$/) ? v : null);
                if (id) {
                    if (m) input.value = id; // auto-extract de URL completa
                    input.classList.remove('invalid');
                    input.classList.add('valid');
                    if (fb) { fb.textContent = '✓ ID Drive válido: ' + id; fb.className = 'description nv-drive-id-feedback ok'; }
                } else {
                    input.classList.remove('valid');
                    input.classList.add('invalid');
                    if (fb) { fb.textContent = '✗ Formato no reconocido. Pega URL completa de Drive o un ID de 20-60 caracteres.'; fb.className = 'description nv-drive-id-feedback error'; }
                }
            }
            document.addEventListener('blur', function(e){
                if (e.target && e.target.classList && e.target.classList.contains('nv-drive-id-input')) {
                    extractAndValidate(e.target);
                }
            }, true);
            // Validación inicial
            document.querySelectorAll('.nv-drive-id-input').forEach(extractAndValidate);

            // Add subfolder row
            document.addEventListener('click', function(e){
                if (e.target && e.target.classList && e.target.classList.contains('nv-drive-add-subfolder')) {
                    e.preventDefault();
                    var list = document.querySelector('.nv-drive-subfolders-list');
                    if (!list) return;
                    var row = document.createElement('div');
                    row.className = 'nv-drive-subfolder-row';
                    row.style.cssText = 'display:grid; grid-template-columns: 1.2fr 2fr 1.4fr auto; gap:8px; margin-bottom:6px; align-items:center;';
                    var typeOptions = '';
                    for (var k in TYPES) { if (Object.prototype.hasOwnProperty.call(TYPES, k)) {
                        typeOptions += '<option value="' + k + '"' + (k === 'otros' ? ' selected' : '') + '>' + TYPES[k] + '</option>';
                    } }
                    row.innerHTML =
                        '<input type="text" name="nv_drive_subfolders[' + nextIdx + '][name]" placeholder="Nombre (ej: Rochar CEO)" style="font-size:12px;" />' +
                        '<input type="text" name="nv_drive_subfolders[' + nextIdx + '][id]" placeholder="URL Drive o ID directo" class="nv-drive-id-input" style="font-family:monospace; font-size:12px;" />' +
                        '<select name="nv_drive_subfolders[' + nextIdx + '][type]" style="font-size:12px;">' + typeOptions + '</select>' +
                        '<button type="button" class="button-link-delete nv-drive-remove-subfolder" style="color:#c00;">✕</button>';
                    list.appendChild(row);
                    nextIdx++;
                }
                if (e.target && e.target.classList && e.target.classList.contains('nv-drive-remove-subfolder')) {
                    e.preventDefault();
                    var r = e.target.closest('.nv-drive-subfolder-row');
                    if (r) r.remove();
                }
            });
        })();
        </script>
        <?php
        return ob_get_clean();
    }

    // ─────────────────────────────────────────────────────────────────────
    // Save: hooks created_/edited_nv_cliente
    // ─────────────────────────────────────────────────────────────────────

    public static function save_term_meta($term_id) {
        // Solo en formularios admin
        if (!is_admin() || !current_user_can('manage_categories')) return;

        // v1.0.46: Página web del cliente
        if (isset($_POST['nv_cliente_website'])) {
            $url = trim((string) wp_unslash($_POST['nv_cliente_website']));
            if (empty($url)) {
                delete_term_meta($term_id, 'nv_cliente_website');
            } else {
                $clean = esc_url_raw($url);
                if (!empty($clean)) {
                    update_term_meta($term_id, 'nv_cliente_website', $clean);
                }
            }
        }

        // v1.0.23: Brief de marca (textarea libre, opcional)
        if (isset($_POST['nv_brand_brief'])) {
            $brief = sanitize_textarea_field(wp_unslash($_POST['nv_brand_brief']));
            if (empty($brief)) {
                delete_term_meta($term_id, 'nv_brand_brief');
            } else {
                update_term_meta($term_id, 'nv_brand_brief', $brief);
            }
        }

        // v1.0.35: brand colors. Priorizamos el text input (más explícito) sobre el color picker
        // por si el usuario quiere dejar un color en blanco para que el plugin lo extraiga.
        $color_keys = [
            'nv_brand_color_primary' => 'primario',
            'nv_brand_color_accent'  => 'acento',
            'nv_brand_color_text'    => 'texto sobre primario',
        ];
        foreach ($color_keys as $meta_key => $_label) {
            $text_field = $meta_key . '_text';
            $raw = '';
            if (isset($_POST[$text_field])) {
                $raw = trim((string) wp_unslash($_POST[$text_field]));
            }
            // Si el text está vacío, NO usamos el color picker (que siempre tiene valor por defecto en el HTML)
            if ($raw === '') {
                delete_term_meta($term_id, $meta_key);
                continue;
            }
            $clean = self::sanitize_hex($raw);
            if (!empty($clean)) {
                update_term_meta($term_id, $meta_key, $clean);
            } else {
                // Hex inválido: dejar como está (no romper)
                delete_term_meta($term_id, $meta_key);
            }
        }

        // v1.0.52: Patrón visual (clean | frame)
        if (isset($_POST['nv_visual_pattern'])) {
            $pattern = sanitize_text_field(wp_unslash($_POST['nv_visual_pattern']));
            if (in_array($pattern, ['clean', 'frame'], true)) {
                update_term_meta($term_id, 'nv_visual_pattern', $pattern);
            }
        }

        // v1.0.53: Fidelidad a refs visuales (entero 0-100)
        if (isset($_POST['nv_refs_fidelity'])) {
            $fidelity = (int) wp_unslash($_POST['nv_refs_fidelity']);
            if ($fidelity < 0) $fidelity = 0;
            if ($fidelity > 100) $fidelity = 100;
            update_term_meta($term_id, 'nv_refs_fidelity', $fidelity);
        }

        // v1.0.53: Competidores (textarea, una entrada por línea)
        if (isset($_POST['nv_competidores'])) {
            $raw = (string) wp_unslash($_POST['nv_competidores']);
            // Permitimos URLs, @handles y texto libre — sanitize_textarea_field
            // preserva saltos de línea pero strip-ea HTML
            $clean = sanitize_textarea_field($raw);
            if (trim($clean) === '') {
                delete_term_meta($term_id, 'nv_competidores');
            } else {
                update_term_meta($term_id, 'nv_competidores', $clean);
            }
        }

        // v1.0.71: Dimensiones por formato — guardamos width/height/preset por tipo.
        // El formulario envía 3 arrays paralelos: nv_dim_w[tipo], nv_dim_h[tipo], nv_dim_preset[tipo].
        if (isset($_POST['nv_dim_w']) && is_array($_POST['nv_dim_w'])) {
            $w_arr   = wp_unslash($_POST['nv_dim_w']);
            $h_arr   = isset($_POST['nv_dim_h'])      && is_array($_POST['nv_dim_h'])      ? wp_unslash($_POST['nv_dim_h'])      : [];
            $p_arr   = isset($_POST['nv_dim_preset']) && is_array($_POST['nv_dim_preset']) ? wp_unslash($_POST['nv_dim_preset']) : [];
            $valid_tipos    = ['imagen', 'reel', 'carrusel', 'story', 'video'];
            $valid_presets  = array_keys(self::get_dimension_presets());
            $payload = [];
            foreach ($valid_tipos as $tipo) {
                $w = isset($w_arr[$tipo]) ? (int) $w_arr[$tipo] : 0;
                $h = isset($h_arr[$tipo]) ? (int) $h_arr[$tipo] : 0;
                $p = isset($p_arr[$tipo]) ? sanitize_text_field((string) $p_arr[$tipo]) : '';
                if (!in_array($p, $valid_presets, true)) $p = 'custom';
                if ($w < 256) $w = 256;
                if ($h < 256) $h = 256;
                if ($w > 4096) $w = 4096;
                if ($h > 4096) $h = 4096;
                $payload[$tipo] = ['width' => $w, 'height' => $h, 'preset' => $p];
            }
            self::set_dimensions_all($term_id, $payload);
        }

        // v1.0.27: Branding — logo + font + position
        if (isset($_POST['nv_logo_attachment_id'])) {
            $aid = (int) $_POST['nv_logo_attachment_id'];
            if ($aid > 0 && get_post($aid)) {
                update_term_meta($term_id, 'nv_logo_attachment_id', $aid);
            } else {
                delete_term_meta($term_id, 'nv_logo_attachment_id');
            }
        }
        if (isset($_POST['nv_logo_position'])) {
            $pos = sanitize_text_field(wp_unslash($_POST['nv_logo_position']));
            if (in_array($pos, ['tl','tr','bl','br'], true)) {
                update_term_meta($term_id, 'nv_logo_position', $pos);
            }
        }
        // v1.0.63: Fuentes múltiples tipadas. Storage: array JSON [{id, weight}, ...]
        // Acepta el campo nuevo nv_font_attachments_json. Si llega vacío o sin él,
        // como fallback se acepta el campo legacy nv_font_attachment_id.
        // Al guardar formato nuevo, también borramos el legacy para evitar dual storage.
        if (isset($_POST['nv_font_attachments_json'])) {
            $raw = (string) wp_unslash($_POST['nv_font_attachments_json']);
            $clean = [];
            if ($raw !== '') {
                $arr = json_decode($raw, true);
                if (is_array($arr)) {
                    $valid_weights = ['regular', 'bold'];
                    $seen = [];
                    foreach ($arr as $entry) {
                        if (!is_array($entry)) continue;
                        $id = isset($entry['id']) ? (int) $entry['id'] : 0;
                        $weight = isset($entry['weight']) ? (string) $entry['weight'] : 'regular';
                        if (!in_array($weight, $valid_weights, true)) $weight = 'regular';
                        if ($id <= 0) continue;
                        if (in_array($id, $seen, true)) continue; // dedup
                        if (!get_post($id)) continue; // attachment debe existir
                        $clean[] = ['id' => $id, 'weight' => $weight];
                        $seen[] = $id;
                    }
                }
            }
            if (!empty($clean)) {
                update_term_meta($term_id, 'nv_font_attachments', wp_json_encode($clean));
                delete_term_meta($term_id, 'nv_font_attachment_id'); // limpiar legacy
            } else {
                delete_term_meta($term_id, 'nv_font_attachments');
                delete_term_meta($term_id, 'nv_font_attachment_id');
            }
        } elseif (isset($_POST['nv_font_attachment_id'])) {
            // Compat: form legacy (v1.0.62 o anterior)
            $fid = (int) $_POST['nv_font_attachment_id'];
            if ($fid > 0 && get_post($fid)) {
                update_term_meta($term_id, 'nv_font_attachment_id', $fid);
            } else {
                delete_term_meta($term_id, 'nv_font_attachment_id');
            }
        }

        // v1.0.59: Imágenes de referencia con tipo semántico.
        // Formato nuevo (JSON): [{"id":12,"type":"persona_destacada"}, ...]
        // Compat legacy: si llega CSV "12,34,56" (formularios antiguos), se convierte
        // a tipo='general' por defecto.
        if (isset($_POST['nv_reference_images'])) {
            // No usamos sanitize_text_field aquí porque comerá las comillas del JSON.
            // Hacemos validación manual estricta.
            $raw = (string) wp_unslash($_POST['nv_reference_images']);
            $valid_types = ['persona_destacada', 'equipo', 'instalaciones', 'pacientes_usuarios', 'productos', 'logo_brand', 'general'];
            $items = [];

            // Detectar formato: JSON array de objetos vs CSV legacy
            $trimmed = trim($raw);
            if ($trimmed === '' || $trimmed === '[]') {
                $items = [];
            } elseif (substr($trimmed, 0, 1) === '[') {
                // Formato JSON
                $decoded = json_decode($trimmed, true);
                if (is_array($decoded)) {
                    $seen = [];
                    foreach ($decoded as $entry) {
                        if (!is_array($entry) || empty($entry['id'])) continue;
                        $id = (int) $entry['id'];
                        if ($id <= 0 || isset($seen[$id]) || !get_post($id)) continue;
                        $type = isset($entry['type']) ? (string) $entry['type'] : 'general';
                        if (!in_array($type, $valid_types, true)) $type = 'general';
                        // v1.0.68: person_name opcional, solo se persiste si el tipo lo admite
                        $person_name = '';
                        if (in_array($type, ['persona_destacada', 'equipo', 'pacientes_usuarios'], true)) {
                            $person_name = isset($entry['person_name']) ? sanitize_text_field((string) $entry['person_name']) : '';
                            if (mb_strlen($person_name) > 60) $person_name = mb_substr($person_name, 0, 60);
                        }
                        $items[] = ['id' => $id, 'type' => $type, 'person_name' => $person_name];
                        $seen[$id] = true;
                    }
                }
            } else {
                // Compat: formato CSV legacy → todos como 'general'
                $seen = [];
                foreach (explode(',', $trimmed) as $part) {
                    $id = (int) trim($part);
                    if ($id <= 0 || isset($seen[$id]) || !get_post($id)) continue;
                    $items[] = ['id' => $id, 'type' => 'general', 'person_name' => ''];
                    $seen[$id] = true;
                }
            }

            if (empty($items)) {
                delete_term_meta($term_id, 'nv_reference_images');
            } else {
                update_term_meta($term_id, 'nv_reference_images', wp_json_encode($items));
            }
        }

        // Modo Drive
        $mode = isset($_POST['nv_drive_mode']) ? sanitize_text_field(wp_unslash($_POST['nv_drive_mode'])) : 'pending';
        if (!isset(self::DRIVE_MODES[$mode])) $mode = 'pending';
        update_term_meta($term_id, 'nv_drive_mode', $mode);

        if ($mode === 'configured') {
            // Root ID — extraer de URL si es necesario
            $root_raw = isset($_POST['nv_drive_root_id']) ? wp_unslash($_POST['nv_drive_root_id']) : '';
            $root_id  = self::extract_drive_id($root_raw);
            update_term_meta($term_id, 'nv_drive_root_id', $root_id);

            // Subcarpetas
            $sub_raw = isset($_POST['nv_drive_subfolders']) ? (array) wp_unslash($_POST['nv_drive_subfolders']) : [];
            $clean = [];
            foreach ($sub_raw as $row) {
                if (!is_array($row)) continue;
                $name = isset($row['name']) ? sanitize_text_field($row['name']) : '';
                $id_raw = isset($row['id']) ? $row['id'] : '';
                $id = self::extract_drive_id($id_raw);
                $type = isset($row['type']) ? sanitize_key($row['type']) : 'otros';
                if (!isset(self::SUBFOLDER_TYPES[$type])) $type = 'otros';
                if (empty($name) && empty($id)) continue; // saltar rows vacías
                $clean[] = ['name' => $name, 'id' => $id, 'type' => $type];
            }
            update_term_meta($term_id, 'nv_drive_subfolders', wp_json_encode($clean));

            // Si el modo es configured pero falta root_id, degradar a pending con admin notice
            if (empty($root_id)) {
                update_term_meta($term_id, 'nv_drive_mode', 'pending');
                set_transient('nv_drive_save_warning_' . $term_id, 'Marcaste el cliente como "configurado" pero la carpeta raíz no es válida. Lo he dejado en "pendiente" — vuelve a editar el cliente cuando tengas la URL Drive lista.', 60);
            }
        } else {
            // No configured: limpiar root y subfolders
            delete_term_meta($term_id, 'nv_drive_root_id');
            delete_term_meta($term_id, 'nv_drive_subfolders');
        }
    }

    /**
     * A3: normalizar slug a underscore en cada cliente nuevo.
     */
    public static function normalize_slug($term_id) {
        $term = get_term($term_id, 'nv_cliente');
        if (!$term || is_wp_error($term)) return;
        if (strpos($term->slug, '-') !== false) {
            wp_update_term($term_id, 'nv_cliente', [
                'slug' => str_replace('-', '_', $term->slug),
            ]);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // B1: columna de estado en la lista de clientes
    // ─────────────────────────────────────────────────────────────────────

    public static function add_status_column($columns) {
        // Insertar antes de "count"
        $new = [];
        foreach ($columns as $key => $label) {
            if ($key === 'posts') {
                $new['nv_drive_status'] = '📁 Drive';
                $new['nv_drive_subs']   = 'Sub';
            }
            $new[$key] = $label;
        }
        return $new;
    }

    public static function render_status_column($content, $column_name, $term_id) {
        if ($column_name === 'nv_drive_status') {
            $mode = self::get_drive_mode($term_id);
            switch ($mode) {
                case 'configured':
                    $root_id = self::get_drive_root_id($term_id);
                    if (!self::is_valid_drive_id($root_id)) {
                        return '<span title="ID Drive inválido" style="color:#c00;">🔴 Inválido</span>';
                    }
                    return '<span title="Configurado" style="color:#2ea043;">🟢 Configurado</span>';
                case 'no_drive_refs':
                    return '<span title="No usa Drive refs" style="color:#888;">⚪ Sin Drive</span>';
                case 'pending':
                default:
                    return '<span title="Pendiente de configurar" style="color:#dba000;">🟡 Pendiente</span>';
            }
        }
        if ($column_name === 'nv_drive_subs') {
            $count = count(self::get_drive_subfolders($term_id));
            return $count > 0 ? '<strong>' . $count . '</strong>' : '<span style="color:#999;">—</span>';
        }
        return $content;
    }

    // ─────────────────────────────────────────────────────────────────────
    // A4: admin notice si hay clientes pendientes
    // ─────────────────────────────────────────────────────────────────────

    public static function admin_notice_pending_clients() {
        $screen = function_exists('get_current_screen') ? get_current_screen() : null;
        if (!$screen) return;

        // Notice solo en pantallas relevantes para no saturar
        $relevant_screens = [
            'edit-nv_cliente',           // listado de clientes
            'edit-nv_publicacion',       // listado de publicaciones
            'nv_publicacion',            // edit publicación
            'toplevel_page_nv-dashboard',
        ];
        if (!in_array($screen->id, $relevant_screens, true) && strpos($screen->id, 'nv-dashboard') === false) {
            return;
        }

        // Buscar clientes pendientes
        $pending = get_terms([
            'taxonomy'   => 'nv_cliente',
            'hide_empty' => false,
            'meta_query' => [
                'relation' => 'OR',
                [
                    'key'     => 'nv_drive_mode',
                    'value'   => 'pending',
                    'compare' => '=',
                ],
                [
                    'key'     => 'nv_drive_mode',
                    'compare' => 'NOT EXISTS',
                ],
            ],
        ]);

        if (empty($pending) || is_wp_error($pending)) return;

        $items = [];
        foreach ($pending as $term) {
            $url = admin_url('term.php?taxonomy=nv_cliente&tag_ID=' . $term->term_id);
            $items[] = '<a href="' . esc_url($url) . '">' . esc_html($term->name) . '</a>';
        }

        echo '<div class="notice notice-warning is-dismissible"><p>';
        echo '<strong>📁 NV Dashboard:</strong> ';
        echo count($items) === 1 ? 'Hay un cliente sin configurar Drive refs: ' : 'Hay ' . count($items) . ' clientes sin configurar Drive refs: ';
        echo implode(' · ', $items);
        echo '. Hasta que lo completes, Claude no podrá usar refs canónicas para estos clientes.';
        echo '</p></div>';

        // Si vienes de un guardado degradado, mostrar también ese warning específico
        foreach ($pending as $term) {
            $w = get_transient('nv_drive_save_warning_' . $term->term_id);
            if ($w) {
                echo '<div class="notice notice-warning is-dismissible"><p><strong>' . esc_html($term->name) . ':</strong> ' . esc_html($w) . '</p></div>';
                delete_transient('nv_drive_save_warning_' . $term->term_id);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Migración del JSON global v1.0.17-v1.0.20 → term meta
    // ─────────────────────────────────────────────────────────────────────

    public static function migrate_from_options() {
        if (get_option('nv_dashboard_drive_refs_migrated_to_term_meta', false)) return;

        $opt_raw = get_option('nv_dashboard_refs_drive_folders', '');
        if (empty($opt_raw)) {
            update_option('nv_dashboard_drive_refs_migrated_to_term_meta', true);
            return;
        }
        $opt = json_decode($opt_raw, true);
        if (!is_array($opt) || empty($opt['clientes'])) {
            update_option('nv_dashboard_drive_refs_migrated_to_term_meta', true);
            return;
        }

        foreach ($opt['clientes'] as $slug => $data) {
            // Slug en JSON podría estar en cualquier formato — buscar en ambos
            $term = get_term_by('slug', $slug, 'nv_cliente');
            if (!$term) {
                $alt = strpos($slug, '-') !== false ? str_replace('-', '_', $slug) : str_replace('_', '-', $slug);
                $term = get_term_by('slug', $alt, 'nv_cliente');
            }
            if (!$term || is_wp_error($term)) continue;

            $tid = $term->term_id;

            // Si ya tiene metadatos, no pisar (algún edit manual)
            $existing_mode = get_term_meta($tid, 'nv_drive_mode', true);
            if (!empty($existing_mode)) continue;

            $root_id = isset($data['root_id']) ? (string) $data['root_id'] : '';
            update_term_meta($tid, 'nv_drive_mode', $root_id ? 'configured' : 'pending');
            update_term_meta($tid, 'nv_drive_root_id', $root_id);

            // Convertir subfolders: { "Nombre": "ID" } → [{name, id, type}]
            $subfolders = [];
            if (!empty($data['subfolders']) && is_array($data['subfolders'])) {
                foreach ($data['subfolders'] as $name => $id) {
                    $subfolders[] = [
                        'name' => (string) $name,
                        'id'   => (string) $id,
                        'type' => self::infer_type_from_name($name),
                    ];
                }
            }
            update_term_meta($tid, 'nv_drive_subfolders', wp_json_encode($subfolders));
        }

        update_option('nv_dashboard_drive_refs_migrated_to_term_meta', true);
    }

    /**
     * Heurística para inferir el tipo semántico de una subcarpeta a partir de su nombre.
     * Solo se usa en la migración del JSON viejo, donde no había tipos.
     */
    private static function infer_type_from_name($name) {
        $n = mb_strtolower($name);
        if (preg_match('/(ceo|founder|fundador|director|cara|principal|destacad)/u', $n)) return 'persona_destacada';
        if (preg_match('/(equipo|trabajador|empleado|staff|team)/u', $n)) return 'equipo';
        if (preg_match('/(paciente|usuario|cliente.*final|customer)/u', $n)) return 'pacientes_usuarios';
        if (preg_match('/(instalaci|oficina|local|cl[ií]nica|edificio|sede)/u', $n)) return 'instalaciones';
        if (preg_match('/(producto|product|catalog|asset.*producto)/u', $n)) return 'productos';
        if (preg_match('/(logo|brand|marca|paleta|identidad)/u', $n)) return 'logo_brand';
        return 'otros';
    }

    /**
     * v1.0.46 — Inyecta el JS que maneja el botón "🤖 Analizar web con IA"
     * en la página de edición del término.
     */
    public static function render_analyze_web_js() {
        // Solo en taxonomy=nv_cliente
        $screen = get_current_screen();
        if (!$screen || $screen->taxonomy !== 'nv_cliente') return;

        $rest_url = esc_js(rest_url('nv/v1/'));
        $nonce    = esc_js(wp_create_nonce('wp_rest'));
        ?>
        <script>
        (function(){
            const btn = document.getElementById('nv-analyze-web-btn');
            if (!btn) return;
            const $url = document.getElementById('nv_cliente_website');
            const $status = document.getElementById('nv-analyze-web-status');
            const $result = document.getElementById('nv-analyze-web-result');

            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                const websiteUrl = ($url.value || '').trim();
                if (!websiteUrl) {
                    $status.textContent = '⚠️ Introduce primero la URL de la web.';
                    $status.style.color = '#c00';
                    $url.focus();
                    return;
                }
                if (!/^https?:\/\//.test(websiteUrl)) {
                    $status.textContent = '⚠️ La URL debe empezar por https:// o http://';
                    $status.style.color = '#c00';
                    return;
                }
                const termId = parseInt(btn.dataset.termId, 10);
                if (!termId) {
                    $status.textContent = '⚠️ Guarda el cliente primero (debe existir en BD).';
                    $status.style.color = '#c00';
                    return;
                }

                btn.disabled = true;
                $status.style.color = '#0073aa';
                $status.textContent = '⏳ Analizando web…';
                $result.style.display = 'none';

                try {
                    const r = await fetch('<?php echo $rest_url; ?>analizar-web-cliente', {
                        method: 'POST',
                        headers: {
                            'X-WP-Nonce': '<?php echo $nonce; ?>',
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            term_id: termId,
                            website_url: websiteUrl,
                            save: false, // no persistir aún — el usuario decide
                        }),
                    });
                    const ctype = (r.headers.get('content-type') || '').toLowerCase();
                    if (!ctype.includes('json')) {
                        const txt = await r.text();
                        throw new Error('Respuesta no-JSON (HTTP ' + r.status + '): ' + txt.replace(/<[^>]+>/g, ' ').substr(0, 300));
                    }
                    const data = await r.json();
                    if (!r.ok || data.code) throw new Error(data.message || ('HTTP ' + r.status));

                    const det = data.detected || {};
                    fillFormWithDetected(det);
                    showResultPanel(det);
                    $status.style.color = '#2ea043';
                    $status.textContent = '✓ Análisis completado (confianza: ' + (det.confidence || '?') + ')';
                } catch (err) {
                    $status.style.color = '#c00';
                    $status.textContent = '❌ ' + err.message;
                } finally {
                    btn.disabled = false;
                }
            });

            function fillFormWithDetected(det) {
                // Auto-rellenar los campos del form. El usuario puede sobrescribir antes de guardar.
                if (det.primary_color) {
                    setColorField('nv_brand_color_primary', det.primary_color);
                }
                if (det.accent_color) {
                    setColorField('nv_brand_color_accent', det.accent_color);
                }
                if (det.text_color) {
                    setColorField('nv_brand_color_text', det.text_color);
                }
            }

            function setColorField(name, hex) {
                const colorInput = document.querySelector('input[type="color"][name="' + name + '"]');
                const textInput = document.querySelector('input[type="text"][name="' + name + '_text"]');
                if (colorInput) colorInput.value = hex;
                if (textInput) textInput.value = hex.toUpperCase();
            }

            function showResultPanel(det) {
                const rows = [];
                if (det.logo_url) {
                    rows.push('<div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;"><strong style="min-width:120px;">🖼️ Logo detectado:</strong><img src="' + escAttr(det.logo_url) + '" style="max-height:48px; border:1px solid #ddd; border-radius:4px; padding:4px; background:#fff;" /><a href="' + escAttr(det.logo_url) + '" target="_blank" style="font-size:11px;">ver</a><button type="button" id="nv-aw-save-logo" class="button button-small" style="margin-left:auto;">📥 Descargar y usar este logo</button></div>');
                } else {
                    rows.push('<div style="margin-bottom:8px;"><strong>🖼️ Logo:</strong> <em style="color:#888;">No detectado. Súbelo manualmente abajo.</em></div>');
                }
                rows.push('<div style="margin-bottom:8px;"><strong>🎨 Colores aplicados al formulario:</strong></div>');
                if (det.primary_color)  rows.push(colorChip('Primario', det.primary_color));
                if (det.accent_color)   rows.push(colorChip('Acento', det.accent_color));
                if (det.text_color)     rows.push(colorChip('Texto sobre primario', det.text_color));
                if (!det.primary_color && !det.accent_color) {
                    rows.push('<div style="color:#888; font-style:italic;">No se detectaron colores claros. Ajústalos manualmente abajo.</div>');
                }
                if (det.font_family) {
                    rows.push('<div style="margin-top:8px;"><strong>🔤 Fuente detectada:</strong> ' + escAttr(det.font_family) + ' <em style="font-size:11px; color:#888;">(la fuente del plugin debe subirse manualmente como TTF abajo si quieres usar exactamente esta)</em></div>');
                }
                if (det.reasoning) {
                    rows.push('<div style="margin-top:8px; padding-top:8px; border-top:1px solid #cce; font-size:12px; color:#555;"><strong>💭 Razonamiento IA:</strong> ' + escAttr(det.reasoning) + '</div>');
                }
                rows.push('<div style="margin-top:10px; padding-top:8px; border-top:1px solid #cce; font-size:11px; color:#666;">⚠️ Estos valores están aplicados al formulario pero <strong>aún no se han guardado</strong>. Pulsa <strong>Actualizar</strong> abajo para persistirlos. Puedes editarlos antes de guardar.</div>');
                $result.innerHTML = rows.join('');
                $result.style.display = 'block';

                // Hook para el botón de descargar logo
                const saveLogoBtn = document.getElementById('nv-aw-save-logo');
                if (saveLogoBtn) {
                    saveLogoBtn.addEventListener('click', async () => {
                        saveLogoBtn.disabled = true;
                        saveLogoBtn.textContent = '⏳ Descargando…';
                        try {
                            const r = await fetch('<?php echo $rest_url; ?>analizar-web-cliente', {
                                method: 'POST',
                                headers: { 'X-WP-Nonce': '<?php echo $nonce; ?>', 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    term_id: parseInt(btn.dataset.termId, 10),
                                    website_url: ($url.value || '').trim(),
                                    save: true, // ← persistir todo: web url + colors + descarga logo
                                }),
                            });
                            const data = await r.json();
                            if (!r.ok || data.code) throw new Error(data.message || ('HTTP ' + r.status));
                            saveLogoBtn.textContent = '✓ Logo guardado — recarga la página';
                            saveLogoBtn.style.background = '#d1fae5';
                            // Auto-recargar tras 2s para ver el logo nuevo
                            setTimeout(() => { window.location.reload(); }, 2000);
                        } catch (err) {
                            saveLogoBtn.disabled = false;
                            saveLogoBtn.textContent = '🔄 Reintentar';
                            alert('Error: ' + err.message);
                        }
                    });
                }
            }

            function colorChip(label, hex) {
                return '<div style="display:flex; align-items:center; gap:8px; margin:3px 0; font-size:13px;">'
                     + '<span style="display:inline-block; width:24px; height:24px; background:' + escAttr(hex) + '; border:1px solid #ddd; border-radius:3px;"></span>'
                     + '<span style="font-family:monospace;">' + escAttr(hex) + '</span>'
                     + '<span style="color:#666;">— ' + escAttr(label) + '</span>'
                     + '</div>';
            }

            function escAttr(s) {
                return String(s || '').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
            }
        })();
        </script>
        <?php
    }
}
