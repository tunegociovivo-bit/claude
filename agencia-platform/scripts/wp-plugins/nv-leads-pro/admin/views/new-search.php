<?php
if ( ! defined( 'WPINC' ) ) { die; }
$provinces = NVL_Spain_Provinces::names();
$error     = isset( $_GET['nvl_error'] ) ? sanitize_text_field( wp_unslash( $_GET['nvl_error'] ) ) : '';
$settings  = get_option( 'nvl_settings', array() );
$has_key   = ! empty( $settings['google_api_key'] );
?>
<div class="wrap nvl-wrap">
    <h1>Nueva búsqueda de leads</h1>
    <p>Indica una palabra clave y elige el alcance geográfico. La plataforma usará Google Places para recopilar fichas y enriquecerlas en segundo plano.</p>

    <?php if ( $error ) : ?>
        <div class="notice notice-error"><p><?php echo esc_html( $error ); ?></p></div>
    <?php endif; ?>

    <?php if ( ! $has_key ) : ?>
        <div class="notice notice-warning">
            <p>Antes de lanzar una búsqueda configura tu API key de Google Places en <a href="<?php echo esc_url( admin_url( 'admin.php?page=nvl-settings' ) ); ?>">Ajustes</a>.</p>
        </div>
    <?php endif; ?>

    <form method="post" action="" class="nvl-form">
        <?php wp_nonce_field( 'nvl_start_search' ); ?>
        <input type="hidden" name="nvl_action" value="start_search">

        <table class="form-table">
            <tr>
                <th><label for="keyword">Palabra clave</label></th>
                <td>
                    <input id="keyword" name="keyword" type="text" class="regular-text" required
                           placeholder="Ej: masajes eróticos, peluquería, taller mecánico">
                    <p class="description">El término que usará Google para buscar fichas.</p>
                </td>
            </tr>
            <tr>
                <th>Alcance geográfico</th>
                <td>
                    <label><input type="radio" name="scope" value="spain" checked> <strong>Toda España</strong> — recorre las 52 provincias</label><br>
                    <label><input type="radio" name="scope" value="province"> Una provincia concreta</label><br>
                    <label><input type="radio" name="scope" value="custom"> Localidad personalizada (ciudad o barrio)</label>
                </td>
            </tr>
            <tr class="nvl-scope-province" style="display:none;">
                <th><label for="province">Provincia</label></th>
                <td>
                    <select id="province" name="province">
                        <?php foreach ( $provinces as $p ) : ?>
                            <option value="<?php echo esc_attr( $p ); ?>"><?php echo esc_html( $p ); ?></option>
                        <?php endforeach; ?>
                    </select>
                </td>
            </tr>
            <tr class="nvl-scope-custom" style="display:none;">
                <th><label for="location">Localidad</label></th>
                <td>
                    <input id="location" name="location" type="text" class="regular-text" placeholder="Ej: Vallecas, Madrid">
                    <p class="description">Texto libre. Se pasará a Google como contexto de búsqueda.</p>
                </td>
            </tr>
        </table>

        <p class="submit">
            <button type="submit" class="button button-primary button-hero" <?php disabled( ! $has_key ); ?>>Lanzar búsqueda</button>
            <a href="<?php echo esc_url( admin_url( 'admin.php?page=' . NVL_Admin::MENU_SLUG ) ); ?>" class="button">Cancelar</a>
        </p>

        <div class="nvl-info-box">
            <strong>¿Cómo funciona?</strong>
            <ul>
                <li>El procesamiento se hace en segundo plano vía WP-Cron. Para "Toda España" tardará unos minutos.</li>
                <li>Google Places limita cada query a ~60 resultados; por eso recorremos provincia a provincia.</li>
                <li>Cada lead guarda su posición y los <em>N</em> competidores que están por encima (configurable en Ajustes).</li>
                <li>Coste estimado: ~0,032 $ por Text Search + ~0,017 $ por Place Details si activas el enriquecimiento.</li>
            </ul>
        </div>
    </form>
</div>

<script>
jQuery(function($){
    $('input[name="scope"]').on('change', function(){
        $('.nvl-scope-province, .nvl-scope-custom').hide();
        $('.nvl-scope-' + $(this).val()).show();
    });
});
</script>
