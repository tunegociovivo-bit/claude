<?php
/**
 * Generador de CSV con formato oficial Metricool
 */

if (!defined('ABSPATH')) exit;

class NV_CSV_Generator {
    
    /**
     * Genera CSV en /wp-content/uploads/nv-dashboard/{cliente}-{mes}.csv
     */
    public static function generate($posts, $cliente, $mes) {
        $upload_dir = wp_upload_dir();
        $csv_dir = $upload_dir['basedir'] . '/nv-dashboard';
        if (!file_exists($csv_dir)) {
            wp_mkdir_p($csv_dir);
        }
        
        $filename = sprintf('metricool-%s-%s.csv', $cliente, $mes);
        $csv_path = $csv_dir . '/' . $filename;
        
        // Columnas oficiales Metricool 2026
        $headers = [
            'Text', 'Date', 'Time',
            'Facebook', 'Twitter', 'Instagram', 'LinkedIn', 'GoogleMyBusiness',
            'TikTok', 'YouTube', 'Pinterest', 'Bluesky',
            'Picture Url 1', 'Picture Url 2', 'Picture Url 3', 'Picture Url 4', 'Picture Url 5',
            'Picture Url 6', 'Picture Url 7', 'Picture Url 8', 'Picture Url 9', 'Picture Url 10',
            'First Comment Text', 'Brand Name', 'Auto Publish'
        ];
        
        // BOM UTF-8 para que Metricool lea bien los emojis
        $fp = fopen($csv_path, 'w');
        fwrite($fp, "\xEF\xBB\xBF");
        fputcsv($fp, $headers);
        
        $brand_name = get_option('nv_dashboard_metricool_brand_name', 'Negocio Vivo');
        // Si la marca debe coincidir con el nombre del cliente actual:
        $cliente_term = get_term_by('slug', $cliente, 'nv_cliente');
        if ($cliente_term) {
            $brand_name = $cliente_term->name;
        }
        
        foreach ($posts as $post) {
            $copy = get_field('nv_copy', $post->ID);
            $hashtags = get_field('nv_hashtags', $post->ID);
            $text = trim($copy . "\n\n" . $hashtags);
            
            $fecha = get_field('nv_fecha_publicacion', $post->ID);
            $date = date('Y-m-d', strtotime($fecha));
            $time = date('H:i:s', strtotime($fecha));
            
            $redes = get_field('nv_redes', $post->ID) ?: [];
            $redes_map = [
                'Facebook' => in_array('facebook', $redes) ? 'TRUE' : 'FALSE',
                'Twitter' => in_array('twitter', $redes) ? 'TRUE' : 'FALSE',
                'Instagram' => in_array('instagram', $redes) ? 'TRUE' : 'FALSE',
                'LinkedIn' => in_array('linkedin', $redes) ? 'TRUE' : 'FALSE',
                'GoogleMyBusiness' => 'FALSE',
                'TikTok' => in_array('tiktok', $redes) ? 'TRUE' : 'FALSE',
                'YouTube' => in_array('youtube', $redes) ? 'TRUE' : 'FALSE',
                'Pinterest' => in_array('pinterest', $redes) ? 'TRUE' : 'FALSE',
                'Bluesky' => 'FALSE',
            ];
            
            // URLs de assets
            $url_main = get_field('nv_asset_url', $post->ID);
            $extras = get_field('nv_assets_extras', $post->ID) ?: [];
            $extras_urls = array_map(function($e) { return $e['url']; }, $extras);
            
            $all_urls = array_merge([$url_main], $extras_urls);
            $all_urls = array_pad($all_urls, 10, '');
            
            $first_comment = get_field('nv_first_comment', $post->ID) ?: '';
            
            $row = [
                $text,
                $date,
                $time,
                $redes_map['Facebook'],
                $redes_map['Twitter'],
                $redes_map['Instagram'],
                $redes_map['LinkedIn'],
                $redes_map['GoogleMyBusiness'],
                $redes_map['TikTok'],
                $redes_map['YouTube'],
                $redes_map['Pinterest'],
                $redes_map['Bluesky'],
            ];
            
            // 10 columnas Picture Url
            $row = array_merge($row, $all_urls);
            
            $row[] = $first_comment;
            $row[] = $brand_name;
            $row[] = 'TRUE'; // Auto Publish
            
            fputcsv($fp, $row);
        }
        
        fclose($fp);
        
        return $csv_path;
    }
}
