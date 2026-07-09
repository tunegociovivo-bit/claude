<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

class AIWD_Schema_Generator {

    public function build( $project_id ) {
        $data    = AIWD_CPT_Project::get_project_data( $project_id );
        $b       = $data['briefing'] ?? [];
        $c       = $data['contact']  ?? [];
        $type    = $data['seo']['schema_type'] ?? 'LocalBusiness';

        $schema = [
            '@context' => 'https://schema.org',
            '@type'    => $type,
            'name'     => $b['business_name'] ?? get_bloginfo( 'name' ),
            'description'=> $b['description'] ?? '',
            'url'      => $c['domain'] ?? home_url(),
            'telephone'=> $c['phone']  ?? '',
            'email'    => $c['email']  ?? '',
            'address'  => $c['address'] ? [ '@type' => 'PostalAddress', 'streetAddress' => $c['address'] ] : null,
            'openingHours' => $c['schedule'] ?? '',
            'sameAs'   => array_values( array_filter( $c['social'] ?? [] ) ),
        ];

        return array_filter( $schema );
    }

    public function emit( $project_id ) {
        $schema = $this->build( $project_id );
        return '<script type="application/ld+json">' . wp_json_encode( $schema, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) . '</script>';
    }
}
