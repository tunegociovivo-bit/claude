<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

// Guardado de presets custom
if ( isset( $_POST['aiwd_save_custom_presets'] ) && check_admin_referer( 'aiwd_save_custom_presets' ) && current_user_can( 'manage_options' ) ) {
    $raw = wp_unslash( $_POST['custom_presets_json'] ?? '' );
    $decoded = json_decode( $raw, true );
    if ( $raw !== '' && ! is_array( $decoded ) ) {
        echo '<div class="notice notice-error"><p>' . esc_html__( 'JSON inválido. No guardado.', 'ai-web-designer' ) . '</p></div>';
    } else {
        aiwd_update_option( 'custom_presets', $raw );
        echo '<div class="notice notice-success is-dismissible"><p>' . esc_html__( '✅ Presets guardados.', 'ai-web-designer' ) . '</p></div>';
    }
}

$builtin = AIWD_Presets::builtin();
$custom_raw = aiwd_get_option( 'custom_presets', '' );
?>
<div class="wrap aiwd-wrap">
    <h1><?php esc_html_e( 'Presets de proyecto', 'ai-web-designer' ); ?></h1>
    <p class="description"><?php esc_html_e( 'Plantillas one-click para tipos de cliente recurrentes. Al crear un proyecto, eliges un preset y arranca con sector, paleta, tipografía, plantilla Elementor, páginas y contenido base pre-rellenados.', 'ai-web-designer' ); ?></p>

    <h2><?php esc_html_e( 'Presets integrados', 'ai-web-designer' ); ?></h2>
    <div class="aiwd-presets-grid">
        <?php foreach ( $builtin as $key => $p ) :
            $colors = $p['palette'] ?? []; ?>
            <div class="aiwd-preset-card aiwd-preset-card-static">
                <h3><?php echo esc_html( $p['name'] ); ?></h3>
                <p><?php echo esc_html( $p['description'] ?? '' ); ?></p>
                <div class="aiwd-preset-swatches">
                    <?php foreach ( [ 'primary', 'secondary', 'accent' ] as $sk ) :
                        if ( empty( $colors[ $sk ] ) ) continue; ?>
                        <span style="background:<?php echo esc_attr( $colors[ $sk ] ); ?>" title="<?php echo esc_attr( $colors[ $sk ] ); ?>"></span>
                    <?php endforeach; ?>
                </div>
                <p>
                    <small><strong>Sector:</strong> <?php echo esc_html( $p['sector'] ?? '' ); ?> · <strong>Plantilla:</strong> <?php echo esc_html( $p['template'] ?? '' ); ?></small><br>
                    <small><strong>Tipografía:</strong> <?php echo esc_html( ( $p['fonts']['heading'] ?? '' ) . ' / ' . ( $p['fonts']['body'] ?? '' ) ); ?></small><br>
                    <small><strong>Páginas:</strong> <?php echo esc_html( implode( ', ', $p['pages'] ?? [] ) ); ?></small>
                </p>
                <code style="font-size:11px"><?php echo esc_html( $key ); ?></code>
            </div>
        <?php endforeach; ?>
    </div>

    <h2 style="margin-top:32px"><?php esc_html_e( 'Presets personalizados de la agencia', 'ai-web-designer' ); ?></h2>
    <p class="description"><?php esc_html_e( 'Define tus propios presets en JSON. Mismo formato que los integrados.', 'ai-web-designer' ); ?></p>

    <form method="post">
        <?php wp_nonce_field( 'aiwd_save_custom_presets' ); ?>
        <textarea name="custom_presets_json" rows="20" class="large-text code" placeholder='{
  "negocio_vivo_cliente_estandar": {
    "name": "Cliente estándar NV",
    "description": "Preset por defecto de Negocio Vivo",
    "sector": "other",
    "tone": "professional",
    "palette": { "primary": "#000000", "secondary": "#444444", "accent": "#ffd400" },
    "fonts": { "heading": "Inter", "body": "Inter" },
    "template": "tech_saas",
    "pages": ["home", "services", "about", "contact"],
    "blog_posts": 3,
    "schema_type": "LocalBusiness",
    "country": "ES",
    "content_seed": { "hero_headline": "Hagamos crecer tu negocio", "cta": "Contáctanos" }
  }
}'><?php echo esc_textarea( $custom_raw ); ?></textarea>
        <p><button name="aiwd_save_custom_presets" value="1" class="button button-primary"><?php esc_html_e( 'Guardar presets personalizados', 'ai-web-designer' ); ?></button></p>
    </form>
</div>
