<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

/**
 * Convierte el blueprint JSON en plantillas y páginas reales de Elementor
 * (post type `elementor_library` + `page`) usando los datos de Elementor (_elementor_data).
 */
class AIWD_Template_Builder {

    public function build_from_blueprint( $project_id, array $blueprint ) {
        $created = [];
        $pages = $blueprint['pages'] ?? [];
        foreach ( $pages as $page ) {
            $created[] = $this->build_page( $project_id, $page, $blueprint );
        }
        update_post_meta( $project_id, '_aiwd_built_pages', $created );
        return $created;
    }

    private function build_page( $project_id, array $page, array $blueprint ) {
        $title = sanitize_text_field( $page['title'] ?? 'Página' );
        $slug  = sanitize_title( $page['slug'] ?? $title );

        $existing = get_page_by_path( $slug );
        $page_id = $existing ? $existing->ID : wp_insert_post( [
            'post_type'   => 'page',
            'post_status' => 'draft',
            'post_title'  => $title,
            'post_name'   => $slug,
        ] );

        if ( is_wp_error( $page_id ) || ! $page_id ) return 0;

        $elementor_data = $this->blueprint_to_elementor( $page['sections'] ?? [], $blueprint );

        update_post_meta( $page_id, '_elementor_edit_mode', 'builder' );
        update_post_meta( $page_id, '_elementor_template_type', 'wp-page' );
        update_post_meta( $page_id, '_elementor_version', '3.20.0' );
        update_post_meta( $page_id, '_elementor_data', wp_slash( wp_json_encode( $elementor_data ) ) );
        update_post_meta( $page_id, '_aiwd_project_id', $project_id );

        return (int) $page_id;
    }

    /**
     * Traduce nuestras "sections" a estructura Elementor (secciones / columnas / widgets).
     */
    private function blueprint_to_elementor( array $sections, array $blueprint ) {
        $brand = $blueprint['brand'] ?? [];
        $primary = $brand['color_primary'] ?? '#0d6efd';

        $output = [];
        foreach ( $sections as $section ) {
            $type   = $section['type']   ?? 'cta';
            $props  = $section['props']  ?? [];
            $method = 'section_' . $type;
            if ( method_exists( $this, $method ) ) {
                $output[] = $this->$method( $props, $primary );
            } else {
                $output[] = $this->section_cta( $props, $primary );
            }
        }
        return $output;
    }

    private function el_section( $elements, $extra = [] ) {
        return array_merge( [
            'id'       => substr( md5( wp_generate_uuid4() ), 0, 7 ),
            'elType'   => 'section',
            'settings' => [ 'structure' => '10', 'gap' => 'default', 'padding' => [ 'unit' => 'px', 'top' => '60', 'bottom' => '60', 'isLinked' => false ] ],
            'elements' => $elements,
            'isInner'  => false,
        ], $extra );
    }

    private function el_column( $widgets, $size = 100 ) {
        return [
            'id'       => substr( md5( wp_generate_uuid4() ), 0, 7 ),
            'elType'   => 'column',
            'settings' => [ '_column_size' => $size, '_inline_size' => null ],
            'elements' => $widgets,
            'isInner'  => false,
        ];
    }

    private function el_widget( $type, $settings ) {
        return [
            'id'         => substr( md5( wp_generate_uuid4() ), 0, 7 ),
            'elType'     => 'widget',
            'settings'   => $settings,
            'elements'   => [],
            'widgetType' => $type,
        ];
    }

    private function section_hero( $p, $color ) {
        $widgets = [
            $this->el_widget( 'heading', [ 'title' => $p['headline'] ?? 'Tu titular aquí', 'size' => 'xl', 'header_size' => 'h1', 'title_color' => '#111' ] ),
            $this->el_widget( 'text-editor', [ 'editor' => '<p>' . esc_html( $p['sub'] ?? '' ) . '</p>' ] ),
            $this->el_widget( 'button', [ 'text' => $p['cta_text'] ?? 'Empezar ahora', 'link' => [ 'url' => $p['cta_url'] ?? '#contacto' ], 'background_color' => $color ] ),
        ];
        return $this->el_section( [ $this->el_column( $widgets ) ] );
    }

    private function section_features( $p, $color ) {
        $cols = [];
        foreach ( ($p['items'] ?? []) as $item ) {
            $cols[] = $this->el_column( [
                $this->el_widget( 'icon-box', [
                    'title_text'       => $item['title'] ?? '',
                    'description_text' => $item['text']  ?? '',
                    'selected_icon'    => [ 'value' => 'fas fa-star', 'library' => 'fa-solid' ],
                    'primary_color'    => $color,
                ] ),
            ], (int) ( 100 / max( 1, count( $p['items'] ?? [ 1 ] ) ) ) );
        }
        return $this->el_section( $cols );
    }

    private function section_about( $p, $color ) {
        return $this->el_section( [ $this->el_column( [
            $this->el_widget( 'heading',     [ 'title' => $p['title'] ?? 'Sobre nosotros', 'header_size' => 'h2' ] ),
            $this->el_widget( 'text-editor', [ 'editor' => '<p>' . wp_kses_post( $p['text'] ?? '' ) . '</p>' ] ),
        ] ) ] );
    }

    private function section_services( $p, $color ) {
        $cols = [];
        foreach ( ( $p['items'] ?? [] ) as $svc ) {
            $cols[] = $this->el_column( [
                $this->el_widget( 'heading',     [ 'title' => $svc['title'] ?? '', 'header_size' => 'h3' ] ),
                $this->el_widget( 'text-editor', [ 'editor' => '<p>' . esc_html( $svc['text'] ?? '' ) . '</p>' ] ),
            ], 33 );
        }
        return $this->el_section( $cols );
    }

    private function section_testimonials( $p, $color ) {
        $cols = [];
        foreach ( ( $p['items'] ?? [] ) as $tm ) {
            $cols[] = $this->el_column( [
                $this->el_widget( 'testimonial', [
                    'testimonial_content' => $tm['text'] ?? '',
                    'testimonial_name'    => $tm['name'] ?? '',
                    'testimonial_job'     => $tm['role'] ?? '',
                ] ),
            ], 33 );
        }
        return $this->el_section( $cols );
    }

    private function section_faq( $p, $color ) {
        $items = [];
        foreach ( ( $p['items'] ?? [] ) as $i => $q ) {
            $items[] = [
                'tab_title'   => $q['q'] ?? '',
                'tab_content' => $q['a'] ?? '',
                '_id'         => 'faq' . $i,
            ];
        }
        return $this->el_section( [ $this->el_column( [
            $this->el_widget( 'accordion', [ 'tabs' => $items ] ),
        ] ) ] );
    }

    private function section_cta( $p, $color ) {
        return $this->el_section( [ $this->el_column( [
            $this->el_widget( 'heading', [ 'title' => $p['headline'] ?? '¿Hablamos?', 'header_size' => 'h2' ] ),
            $this->el_widget( 'button',  [ 'text' => $p['cta_text'] ?? 'Contactar', 'link' => [ 'url' => $p['cta_url'] ?? '#contacto' ], 'background_color' => $color ] ),
        ] ) ] );
    }

    private function section_contact( $p, $color ) {
        return $this->el_section( [ $this->el_column( [
            $this->el_widget( 'heading',  [ 'title' => 'Contacto', 'header_size' => 'h2' ] ),
            $this->el_widget( 'shortcode',[ 'shortcode' => '[contact-form-7 id="aiwd-contact"]' ] ),
        ] ) ] );
    }

    private function section_map( $p, $color ) {
        return $this->el_section( [ $this->el_column( [
            $this->el_widget( 'google_maps', [ 'address' => $p['address'] ?? '' ] ),
        ] ) ] );
    }

    private function section_gallery( $p, $color ) {
        return $this->el_section( [ $this->el_column( [
            $this->el_widget( 'image-gallery', [ 'gallery' => $p['images'] ?? [] ] ),
        ] ) ] );
    }

    private function section_pricing( $p, $color ) {
        $cols = [];
        foreach ( ( $p['plans'] ?? [] ) as $plan ) {
            $cols[] = $this->el_column( [
                $this->el_widget( 'price-table', [
                    'heading'     => $plan['name'] ?? '',
                    'price'       => $plan['price'] ?? '',
                    'period'      => $plan['period'] ?? '/mes',
                    'features_list'=> array_map( fn( $f ) => [ 'item_text' => $f ], $plan['features'] ?? [] ),
                ] ),
            ], 33 );
        }
        return $this->el_section( $cols );
    }

    private function section_team( $p, $color ) {
        $cols = [];
        foreach ( ( $p['members'] ?? [] ) as $m ) {
            $cols[] = $this->el_column( [
                $this->el_widget( 'image',   [ 'image' => [ 'url' => $m['photo'] ?? '' ] ] ),
                $this->el_widget( 'heading', [ 'title' => $m['name'] ?? '', 'header_size' => 'h4' ] ),
                $this->el_widget( 'text-editor', [ 'editor' => '<p>' . esc_html( $m['role'] ?? '' ) . '</p>' ] ),
            ], 25 );
        }
        return $this->el_section( $cols );
    }

    private function section_stats( $p, $color ) {
        $cols = [];
        foreach ( ( $p['items'] ?? [] ) as $s ) {
            $cols[] = $this->el_column( [
                $this->el_widget( 'counter', [ 'starting_number' => 0, 'ending_number' => (int) ( $s['value'] ?? 0 ), 'title' => $s['label'] ?? '' ] ),
            ], 25 );
        }
        return $this->el_section( $cols );
    }

    private function section_blog( $p, $color ) {
        return $this->el_section( [ $this->el_column( [
            $this->el_widget( 'posts', [ 'posts_per_page' => $p['count'] ?? 3 ] ),
        ] ) ] );
    }
}
