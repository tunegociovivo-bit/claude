<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

class AIWD_CPT_Project {

    const POST_TYPE = 'aiwd_project';

    public function register() {
        add_action( 'init', [ $this, 'register_post_type' ] );
        add_action( 'init', [ $this, 'register_taxonomies' ] );
    }

    public function register_post_type() {
        $labels = [
            'name'               => __( 'Proyectos Web IA', 'ai-web-designer' ),
            'singular_name'      => __( 'Proyecto Web', 'ai-web-designer' ),
            'add_new'            => __( 'Nuevo proyecto', 'ai-web-designer' ),
            'add_new_item'       => __( 'Crear proyecto web', 'ai-web-designer' ),
            'edit_item'          => __( 'Editar proyecto', 'ai-web-designer' ),
            'view_item'          => __( 'Ver proyecto', 'ai-web-designer' ),
            'all_items'          => __( 'Todos los proyectos', 'ai-web-designer' ),
        ];

        register_post_type( self::POST_TYPE, [
            'labels'        => $labels,
            'public'        => false,
            'show_ui'       => true,
            'show_in_menu'  => false,
            'show_in_rest'  => true,
            'supports'      => [ 'title', 'author', 'revisions' ],
            'capability_type' => 'post',
            'map_meta_cap'  => true,
        ] );
    }

    public function register_taxonomies() {
        register_taxonomy( 'aiwd_sector', self::POST_TYPE, [
            'label'        => __( 'Sector', 'ai-web-designer' ),
            'public'       => false,
            'show_ui'      => true,
            'show_in_rest' => true,
            'hierarchical' => false,
        ] );
        register_taxonomy( 'aiwd_client', self::POST_TYPE, [
            'label'        => __( 'Cliente', 'ai-web-designer' ),
            'public'       => false,
            'show_ui'      => true,
            'show_in_rest' => true,
            'hierarchical' => false,
        ] );
    }

    public static function get_project_data( $project_id ) {
        return [
            'briefing' => get_post_meta( $project_id, '_aiwd_briefing', true ),
            'brand'    => get_post_meta( $project_id, '_aiwd_brand', true ),
            'contact'  => get_post_meta( $project_id, '_aiwd_contact', true ),
            'content'  => get_post_meta( $project_id, '_aiwd_content', true ),
            'design'   => get_post_meta( $project_id, '_aiwd_design', true ),
            'pages'    => get_post_meta( $project_id, '_aiwd_pages', true ),
            'seo'      => get_post_meta( $project_id, '_aiwd_seo', true ),
            'legal'    => get_post_meta( $project_id, '_aiwd_legal', true ),
            'status'   => get_post_meta( $project_id, '_aiwd_status', true ),
            'cost'     => get_post_meta( $project_id, '_aiwd_cost', true ),
        ];
    }

    public static function save_project_data( $project_id, $section, $data ) {
        $allowed = [ 'briefing', 'brand', 'contact', 'content', 'design', 'pages', 'seo', 'legal', 'status', 'cost' ];
        if ( ! in_array( $section, $allowed, true ) ) {
            return false;
        }
        return update_post_meta( $project_id, '_aiwd_' . $section, $data );
    }
}
