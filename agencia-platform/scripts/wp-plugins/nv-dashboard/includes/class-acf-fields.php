<?php
/**
 * Registro programático de campos ACF
 * (no requiere ACF Pro - funciona con la versión gratuita)
 */

if (!defined('ABSPATH')) exit;

class NV_ACF_Fields {
    
    public static function init() {
        add_action('acf/init', [__CLASS__, 'register_fields']);
    }
    
    public static function register_fields() {
        if (!function_exists('acf_add_local_field_group')) return;
        
        acf_add_local_field_group([
            'key' => 'group_nv_publicacion',
            'title' => 'Datos de la publicación',
            'fields' => [
                [
                    'key' => 'field_nv_fecha_publicacion',
                    'label' => 'Fecha y hora de publicación',
                    'name' => 'nv_fecha_publicacion',
                    'type' => 'date_time_picker',
                    'display_format' => 'd/m/Y H:i',
                    'return_format' => 'Y-m-d H:i:s',
                    'first_day' => 1,
                    'required' => 1,
                ],
                [
                    'key' => 'field_nv_tipo',
                    'label' => 'Tipo de publicación',
                    'name' => 'nv_tipo',
                    'type' => 'select',
                    'choices' => [
                        'reel' => '🎬 Reel',
                        'imagen' => '📷 Imagen',
                        'carrusel' => '🎴 Carrusel',
                        'story' => '📱 Story',
                    ],
                    'default_value' => 'imagen',
                    'required' => 1,
                ],
                [
                    'key' => 'field_nv_redes',
                    'label' => 'Redes sociales',
                    'name' => 'nv_redes',
                    'type' => 'checkbox',
                    'choices' => [
                        'instagram' => 'Instagram',
                        'facebook' => 'Facebook',
                        'linkedin' => 'LinkedIn',
                        'tiktok' => 'TikTok',
                        'twitter' => 'X (Twitter)',
                        'youtube' => 'YouTube',
                        'pinterest' => 'Pinterest',
                    ],
                    'default_value' => ['instagram', 'facebook'],
                    'layout' => 'horizontal',
                    'required' => 1,
                ],
                [
                    'key' => 'field_nv_estado',
                    'label' => 'Estado',
                    'name' => 'nv_estado',
                    'type' => 'select',
                    'choices' => [
                        'borrador' => 'Borrador',
                        'revision' => 'En revisión',
                        'aprobado' => 'Aprobado',
                        'programado' => 'Programado en Metricool',
                        'publicado' => 'Publicado',
                    ],
                    'default_value' => 'borrador',
                ],
                [
                    'key' => 'field_nv_copy',
                    'label' => 'Texto de la publicación (copy)',
                    'name' => 'nv_copy',
                    'type' => 'textarea',
                    'rows' => 8,
                    'instructions' => 'Texto principal con emojis. Hasta 2200 caracteres para Instagram.',
                    'required' => 1,
                ],
                [
                    'key' => 'field_nv_hashtags',
                    'label' => 'Hashtags',
                    'name' => 'nv_hashtags',
                    'type' => 'text',
                    'instructions' => 'Separados por espacios. Ejemplo: #MarketingDigital #MetaAds #Marbella',
                    'placeholder' => '#MarketingDigital #MetaAds #Marbella',
                ],
                [
                    'key' => 'field_nv_first_comment',
                    'label' => 'Primer comentario (opcional)',
                    'name' => 'nv_first_comment',
                    'type' => 'textarea',
                    'rows' => 3,
                    'instructions' => 'Comentario que se publicará automáticamente bajo el post (típico para hashtags adicionales).',
                ],
                [
                    'key' => 'field_nv_asset_url',
                    'label' => 'URL del asset principal (Drive)',
                    'name' => 'nv_asset_url',
                    'type' => 'url',
                    'instructions' => 'URL pública de Google Drive. DEBE terminar en "?usp=sharing" y tener permiso "Cualquiera con el enlace - Editor".',
                    'placeholder' => 'https://drive.google.com/file/d/XXX/view?usp=sharing',
                    'required' => 1,
                ],
                [
                    'key' => 'field_nv_assets_extras',
                    'label' => 'URLs assets extras (carrusel)',
                    'name' => 'nv_assets_extras',
                    'type' => 'repeater',
                    'instructions' => 'Solo para carruseles: añade aquí los slides 2 a 10. Cada uno con URL pública de Drive.',
                    'min' => 0,
                    'max' => 9,
                    'layout' => 'table',
                    'button_label' => 'Añadir slide',
                    'sub_fields' => [
                        [
                            'key' => 'field_nv_extra_url',
                            'label' => 'URL del slide',
                            'name' => 'url',
                            'type' => 'url',
                        ],
                    ],
                ],
                [
                    'key' => 'field_nv_aprobar_metricool',
                    'label' => '✅ Aprobar para enviar a Metricool',
                    'name' => 'nv_aprobar_metricool',
                    'type' => 'true_false',
                    'instructions' => 'Marca esta casilla cuando esta publicación esté lista para incluirse en el envío masivo a Metricool.',
                    'ui' => 1,
                    'ui_on_text' => 'Aprobado',
                    'ui_off_text' => 'Pendiente',
                ],
                [
                    'key' => 'field_nv_metricool_id',
                    'label' => 'ID en Metricool',
                    'name' => 'nv_metricool_id',
                    'type' => 'text',
                    'instructions' => 'Se rellena automáticamente cuando se programa.',
                    'readonly' => 1,
                ],
                [
                    'key' => 'field_nv_csv_url',
                    'label' => 'CSV exportado',
                    'name' => 'nv_csv_url',
                    'type' => 'url',
                    'instructions' => 'URL del CSV generado en el último export.',
                    'readonly' => 1,
                ],
            ],
            'location' => [[[
                'param' => 'post_type',
                'operator' => '==',
                'value' => 'nv_publicacion',
            ]]],
            'menu_order' => 0,
            'position' => 'normal',
            'style' => 'default',
            'label_placement' => 'top',
        ]);
    }
}
