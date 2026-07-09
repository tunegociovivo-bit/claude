<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

/**
 * Presets de proyecto por tipo de cliente típico de la agencia.
 *
 * Un preset pre-rellena: sector, tono, paleta, tipografías, plantilla
 * Elementor, lista de páginas, número de posts iniciales, schema.org,
 * country (legales) y bloques de contenido placeholder.
 *
 * Catálogo built-in editable + custom guardado en setting 'custom_presets' (JSON).
 */
class AIWD_Presets {

    public static function all() {
        $built = self::builtin();
        $custom = self::custom();
        return array_merge( $built, $custom );
    }

    public static function get( $key ) {
        $all = self::all();
        return $all[ $key ] ?? null;
    }

    public static function custom() {
        $raw = aiwd_get_option( 'custom_presets', '' );
        if ( ! $raw ) return [];
        $arr = json_decode( $raw, true );
        return is_array( $arr ) ? $arr : [];
    }

    public static function builtin() {
        return [
            'restaurante_local' => [
                'name'        => __( 'Restaurante local', 'ai-web-designer' ),
                'description' => __( 'Restaurante de barrio con menú, reservas y ubicación.', 'ai-web-designer' ),
                'sector'      => 'restaurant',
                'tone'        => 'friendly',
                'palette'     => [ 'primary' => '#b8331f', 'secondary' => '#2b2b2b', 'accent' => '#f4c241' ],
                'fonts'       => [ 'heading' => 'Playfair Display', 'body' => 'Inter' ],
                'template'    => 'restaurant_modern',
                'pages'       => [ 'home', 'services', 'about', 'contact' ],
                'blog_posts'  => 3,
                'schema_type' => 'Restaurant',
                'country'     => 'ES',
                'content_seed'=> [
                    'hero_headline' => 'La cocina de siempre, en el corazón del barrio',
                    'cta'           => 'Reserva tu mesa',
                ],
            ],
            'abogado_asesoria' => [
                'name'        => __( 'Abogado / Asesoría', 'ai-web-designer' ),
                'description' => __( 'Despacho profesional, áreas de práctica, equipo y contacto.', 'ai-web-designer' ),
                'sector'      => 'legal',
                'tone'        => 'professional',
                'palette'     => [ 'primary' => '#0a2540', 'secondary' => '#3d5a80', 'accent' => '#c9a55c' ],
                'fonts'       => [ 'heading' => 'Merriweather', 'body' => 'Source Sans 3' ],
                'template'    => 'legal_classic',
                'pages'       => [ 'home', 'services', 'about', 'blog', 'contact' ],
                'blog_posts'  => 5,
                'schema_type' => 'LegalService',
                'country'     => 'ES',
                'content_seed'=> [
                    'hero_headline' => 'Asesoría jurídica con experiencia y compromiso',
                    'cta'           => 'Solicita una consulta',
                ],
            ],
            'clinica_dental' => [
                'name'        => __( 'Clínica dental', 'ai-web-designer' ),
                'description' => __( 'Tratamientos, equipo médico, primera visita gratis y reserva online.', 'ai-web-designer' ),
                'sector'      => 'clinic',
                'tone'        => 'friendly',
                'palette'     => [ 'primary' => '#0aa3a3', 'secondary' => '#0d6efd', 'accent' => '#ffffff' ],
                'fonts'       => [ 'heading' => 'Poppins', 'body' => 'Inter' ],
                'template'    => 'clinic_health',
                'pages'       => [ 'home', 'services', 'about', 'booking', 'contact' ],
                'blog_posts'  => 3,
                'schema_type' => 'MedicalClinic',
                'country'     => 'ES',
                'content_seed'=> [
                    'hero_headline' => 'Tu sonrisa, en las mejores manos',
                    'cta'           => 'Pide tu primera visita',
                ],
            ],
            'peluqueria_estetica' => [
                'name'        => __( 'Peluquería / Estética', 'ai-web-designer' ),
                'description' => __( 'Servicios, packs, galería de trabajos y reservas.', 'ai-web-designer' ),
                'sector'      => 'beauty',
                'tone'        => 'luxury',
                'palette'     => [ 'primary' => '#b08968', 'secondary' => '#1a1a1a', 'accent' => '#e8d5b7' ],
                'fonts'       => [ 'heading' => 'Cormorant Garamond', 'body' => 'Lato' ],
                'template'    => 'beauty_spa',
                'pages'       => [ 'home', 'services', 'portfolio', 'booking', 'contact' ],
                'blog_posts'  => 0,
                'schema_type' => 'BeautySalon',
                'country'     => 'ES',
                'content_seed'=> [
                    'hero_headline' => 'El estilo que mereces',
                    'cta'           => 'Reserva tu cita',
                ],
            ],
            'gimnasio_studio' => [
                'name'        => __( 'Gimnasio / Studio', 'ai-web-designer' ),
                'description' => __( 'Horario de clases, entrenadores, tarifas y prueba gratis.', 'ai-web-designer' ),
                'sector'      => 'other',
                'tone'        => 'inspirational',
                'palette'     => [ 'primary' => '#000000', 'secondary' => '#ff3b3b', 'accent' => '#ffffff' ],
                'fonts'       => [ 'heading' => 'Bebas Neue', 'body' => 'Inter' ],
                'template'    => 'tech_saas',
                'pages'       => [ 'home', 'services', 'about', 'contact' ],
                'blog_posts'  => 2,
                'schema_type' => 'HealthClub',
                'country'     => 'ES',
                'content_seed'=> [
                    'hero_headline' => 'Entrena hoy. Cambia mañana.',
                    'cta'           => 'Prueba gratis 7 días',
                ],
            ],
            'inmobiliaria' => [
                'name'        => __( 'Inmobiliaria', 'ai-web-designer' ),
                'description' => __( 'Propiedades destacadas, zonas, agentes y formulario.', 'ai-web-designer' ),
                'sector'      => 'real_estate',
                'tone'        => 'professional',
                'palette'     => [ 'primary' => '#1c3d5a', 'secondary' => '#c19a4b', 'accent' => '#f5f5f5' ],
                'fonts'       => [ 'heading' => 'Montserrat', 'body' => 'Open Sans' ],
                'template'    => 'realestate_pro',
                'pages'       => [ 'home', 'portfolio', 'services', 'about', 'contact' ],
                'blog_posts'  => 3,
                'schema_type' => 'RealEstateAgent',
                'country'     => 'ES',
                'content_seed'=> [
                    'hero_headline' => 'Tu próxima casa empieza aquí',
                    'cta'           => 'Ver propiedades',
                ],
            ],
            'ecommerce_landing' => [
                'name'        => __( 'Landing producto / Ecommerce', 'ai-web-designer' ),
                'description' => __( 'Landing para producto destacado con beneficios, reviews y compra.', 'ai-web-designer' ),
                'sector'      => 'ecommerce',
                'tone'        => 'fun',
                'palette'     => [ 'primary' => '#ff5e3a', 'secondary' => '#1d2027', 'accent' => '#ffe066' ],
                'fonts'       => [ 'heading' => 'Poppins', 'body' => 'Inter' ],
                'template'    => 'ecommerce_landing',
                'pages'       => [ 'home', 'shop', 'about', 'contact' ],
                'blog_posts'  => 0,
                'schema_type' => 'Product',
                'country'     => 'ES',
                'content_seed'=> [
                    'hero_headline' => 'El producto que estabas esperando',
                    'cta'           => 'Cómpralo ahora',
                ],
            ],
            'autonomo_freelance' => [
                'name'        => __( 'Autónomo / Freelance', 'ai-web-designer' ),
                'description' => __( 'Web personal: servicios, portfolio, sobre mí y contacto.', 'ai-web-designer' ),
                'sector'      => 'portfolio',
                'tone'        => 'professional',
                'palette'     => [ 'primary' => '#2563eb', 'secondary' => '#0f172a', 'accent' => '#f59e0b' ],
                'fonts'       => [ 'heading' => 'Inter', 'body' => 'Inter' ],
                'template'    => 'portfolio_minimal',
                'pages'       => [ 'home', 'services', 'portfolio', 'about', 'contact' ],
                'blog_posts'  => 2,
                'schema_type' => 'ProfessionalService',
                'country'     => 'ES',
                'content_seed'=> [
                    'hero_headline' => 'Trabajemos juntos',
                    'cta'           => 'Hablemos de tu proyecto',
                ],
            ],
        ];
    }

    /**
     * Aplica un preset a un proyecto recién creado.
     */
    public static function apply( $project_id, $preset_key ) {
        $preset = self::get( $preset_key );
        if ( ! $preset ) return false;

        $brand = [
            'color_primary'   => $preset['palette']['primary']   ?? '',
            'color_secondary' => $preset['palette']['secondary'] ?? '',
            'color_accent'    => $preset['palette']['accent']    ?? '',
            'font_heading'    => $preset['fonts']['heading']     ?? '',
            'font_body'       => $preset['fonts']['body']        ?? '',
        ];
        $briefing = [
            'sector' => $preset['sector'] ?? 'other',
            'tone'   => $preset['tone']   ?? 'professional',
        ];
        $design = [
            'template' => $preset['template'] ?? '',
        ];
        $pages = [
            'list'       => $preset['pages']      ?? [],
            'blog_posts' => $preset['blog_posts'] ?? 0,
        ];
        $seo = [
            'schema_type' => $preset['schema_type'] ?? 'LocalBusiness',
        ];
        $legal = [
            'country' => $preset['country'] ?? 'ES',
        ];
        $content = $preset['content_seed'] ?? [];

        AIWD_CPT_Project::save_project_data( $project_id, 'brand',    $brand );
        AIWD_CPT_Project::save_project_data( $project_id, 'briefing', $briefing );
        AIWD_CPT_Project::save_project_data( $project_id, 'design',   $design );
        AIWD_CPT_Project::save_project_data( $project_id, 'pages',    $pages );
        AIWD_CPT_Project::save_project_data( $project_id, 'seo',      $seo );
        AIWD_CPT_Project::save_project_data( $project_id, 'legal',    $legal );
        AIWD_CPT_Project::save_project_data( $project_id, 'content',  $content );

        update_post_meta( $project_id, '_aiwd_preset_applied', $preset_key );

        do_action( 'aiwd_preset_applied', $project_id, $preset_key, $preset );
        return true;
    }
}
