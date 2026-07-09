<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

class AIWD_Template_Library {

    public static function all() {
        return [
            'restaurant_modern' => [
                'name'        => __( 'Restaurante moderno', 'ai-web-designer' ),
                'description' => __( 'Hero con foto del plato estrella, menú, reservas, galería y testimonios.', 'ai-web-designer' ),
                'sections'    => [ 'hero', 'about', 'services', 'gallery', 'testimonials', 'map', 'cta', 'contact' ],
            ],
            'legal_classic' => [
                'name'        => __( 'Abogados / Asesoría', 'ai-web-designer' ),
                'description' => __( 'Estilo serio, áreas de práctica, equipo, casos, FAQ y contacto.', 'ai-web-designer' ),
                'sections'    => [ 'hero', 'services', 'team', 'stats', 'faq', 'cta', 'contact' ],
            ],
            'clinic_health' => [
                'name'        => __( 'Clínica / Salud', 'ai-web-designer' ),
                'description' => __( 'Tratamientos, médicos, testimonios, cita online y mapa.', 'ai-web-designer' ),
                'sections'    => [ 'hero', 'services', 'team', 'testimonials', 'faq', 'cta', 'contact', 'map' ],
            ],
            'ecommerce_landing' => [
                'name'        => __( 'Landing ecommerce', 'ai-web-designer' ),
                'description' => __( 'Producto destacado, beneficios, reviews, comparativa, oferta y CTA.', 'ai-web-designer' ),
                'sections'    => [ 'hero', 'features', 'gallery', 'pricing', 'testimonials', 'faq', 'cta' ],
            ],
            'portfolio_minimal' => [
                'name'        => __( 'Portfolio minimal', 'ai-web-designer' ),
                'description' => __( 'Para creativos. Galería destacada, sobre mí y contacto.', 'ai-web-designer' ),
                'sections'    => [ 'hero', 'gallery', 'about', 'testimonials', 'cta', 'contact' ],
            ],
            'realestate_pro' => [
                'name'        => __( 'Inmobiliaria pro', 'ai-web-designer' ),
                'description' => __( 'Buscador, propiedades destacadas, agentes y zonas.', 'ai-web-designer' ),
                'sections'    => [ 'hero', 'services', 'gallery', 'team', 'cta', 'contact' ],
            ],
            'education_course' => [
                'name'        => __( 'Curso / Academia', 'ai-web-designer' ),
                'description' => __( 'Programa, profesores, testimonios, precios, FAQ.', 'ai-web-designer' ),
                'sections'    => [ 'hero', 'features', 'services', 'team', 'pricing', 'testimonials', 'faq', 'cta' ],
            ],
            'tech_saas' => [
                'name'        => __( 'SaaS / Tech', 'ai-web-designer' ),
                'description' => __( 'Hero con producto, features, integraciones, pricing.', 'ai-web-designer' ),
                'sections'    => [ 'hero', 'features', 'stats', 'pricing', 'testimonials', 'faq', 'cta' ],
            ],
            'beauty_spa' => [
                'name'        => __( 'Belleza / Spa', 'ai-web-designer' ),
                'description' => __( 'Servicios, reservas, galería, packs y testimonios.', 'ai-web-designer' ),
                'sections'    => [ 'hero', 'services', 'gallery', 'pricing', 'testimonials', 'cta', 'contact' ],
            ],
            'construction_pro' => [
                'name'        => __( 'Construcción / Reformas', 'ai-web-designer' ),
                'description' => __( 'Hero con servicio, antes/después, presupuesto y contacto.', 'ai-web-designer' ),
                'sections'    => [ 'hero', 'services', 'gallery', 'stats', 'testimonials', 'cta', 'contact' ],
            ],
            'nonprofit_cause' => [
                'name'        => __( 'ONG / Asociación', 'ai-web-designer' ),
                'description' => __( 'Causa, proyectos, donar, voluntariado, equipo.', 'ai-web-designer' ),
                'sections'    => [ 'hero', 'about', 'services', 'stats', 'team', 'cta', 'contact' ],
            ],
        ];
    }

    public static function get( $key ) {
        $all = self::all();
        return $all[ $key ] ?? null;
    }
}
