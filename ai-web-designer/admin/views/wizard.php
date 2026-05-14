<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

$project_id = isset( $_GET['project_id'] ) ? (int) $_GET['project_id'] : 0;
if ( ! $project_id || get_post_type( $project_id ) !== AIWD_CPT_Project::POST_TYPE ) {
    echo '<div class="wrap"><h1>' . esc_html__( 'Proyecto no encontrado', 'ai-web-designer' ) . '</h1></div>';
    return;
}
$data    = AIWD_CPT_Project::get_project_data( $project_id );
$post    = get_post( $project_id );
$tones   = aiwd_tones();
$sectors = aiwd_sectors();
?>
<div class="wrap aiwd-wrap aiwd-wizard" data-project-id="<?php echo esc_attr( $project_id ); ?>">
    <h1>
        <?php echo esc_html( $post->post_title ); ?>
        <span class="aiwd-pill"><?php echo esc_html( aiwd_project_statuses()[ get_post_meta( $project_id, '_aiwd_status', true ) ] ?? '' ); ?></span>
    </h1>

    <nav class="aiwd-steps">
        <ul>
            <li class="active" data-step="1"><?php esc_html_e( '1. Negocio', 'ai-web-designer' ); ?></li>
            <li data-step="2"><?php esc_html_e( '2. Marca y logo', 'ai-web-designer' ); ?></li>
            <li data-step="3"><?php esc_html_e( '3. Contacto y dominio', 'ai-web-designer' ); ?></li>
            <li data-step="4"><?php esc_html_e( '4. Fotos y galería', 'ai-web-designer' ); ?></li>
            <li data-step="5"><?php esc_html_e( '5. Textos / Contenidos', 'ai-web-designer' ); ?></li>
            <li data-step="6"><?php esc_html_e( '6. Referencias visuales', 'ai-web-designer' ); ?></li>
            <li data-step="7"><?php esc_html_e( '7. Páginas y estructura', 'ai-web-designer' ); ?></li>
            <li data-step="8"><?php esc_html_e( '8. SEO y legal', 'ai-web-designer' ); ?></li>
            <li data-step="9"><?php esc_html_e( '9. Integraciones', 'ai-web-designer' ); ?></li>
            <li data-step="10"><?php esc_html_e( '10. Generar diseño', 'ai-web-designer' ); ?></li>
        </ul>
    </nav>

    <form id="aiwd-wizard-form" method="post" enctype="multipart/form-data">
        <?php wp_nonce_field( 'aiwd_save_project' ); ?>
        <input type="hidden" name="project_id" value="<?php echo esc_attr( $project_id ); ?>" />

        <!-- STEP 1: Negocio / Briefing -->
        <section class="aiwd-step" data-step="1">
            <h2><?php esc_html_e( 'Sobre el negocio', 'ai-web-designer' ); ?></h2>
            <p class="description"><?php esc_html_e( 'Cuéntanos qué hace tu negocio. La IA usará esta información para generar contenidos coherentes.', 'ai-web-designer' ); ?></p>

            <div class="aiwd-audio-card" data-project-id="<?php echo esc_attr( $project_id ); ?>" data-endpoint="<?php echo esc_url( rest_url( 'aiwd/v1/project/' . $project_id . '/audio-briefing' ) ); ?>">
                <strong>🎙️ <?php esc_html_e( 'Grabar audio del cliente y rellenar con IA', 'ai-web-designer' ); ?></strong>
                <p style="margin:6px 0"><?php esc_html_e( 'Útil si estás con el cliente en una llamada. La IA transcribirá y rellenará los campos.', 'ai-web-designer' ); ?></p>
                <button type="button" class="button aiwd-rec-start">● <?php esc_html_e( 'Grabar', 'ai-web-designer' ); ?></button>
                <button type="button" class="button button-primary aiwd-rec-stop" style="display:none">■ <?php esc_html_e( 'Parar y procesar', 'ai-web-designer' ); ?></button>
                <input type="file" class="aiwd-rec-upload" accept="audio/*" style="margin-left:10px" />
                <span class="aiwd-rec-status" style="margin-left:10px"></span>
            </div>

            <table class="form-table">
                <tr><th><?php esc_html_e( 'Nombre comercial', 'ai-web-designer' ); ?></th>
                    <td><input type="text" name="data[business_name]" class="regular-text" value="<?php echo esc_attr( $data['briefing']['business_name'] ?? '' ); ?>" /></td></tr>
                <tr><th><?php esc_html_e( 'Sector', 'ai-web-designer' ); ?></th>
                    <td><select name="data[sector]">
                        <?php foreach ( $sectors as $k => $label ) : ?>
                            <option value="<?php echo esc_attr( $k ); ?>" <?php selected( ( $data['briefing']['sector'] ?? '' ), $k ); ?>><?php echo esc_html( $label ); ?></option>
                        <?php endforeach; ?>
                    </select></td></tr>
                <tr><th><?php esc_html_e( 'Descripción del negocio', 'ai-web-designer' ); ?></th>
                    <td>
                        <textarea name="data[description]" rows="4" class="large-text" placeholder="<?php esc_attr_e( 'Qué hacéis, a quién os dirigís, qué os diferencia...', 'ai-web-designer' ); ?>"><?php echo esc_textarea( $data['briefing']['description'] ?? '' ); ?></textarea>
                        <button type="button" class="button aiwd-ai-btn" data-ai="briefing_description"><?php esc_html_e( 'Generar con IA', 'ai-web-designer' ); ?></button>
                    </td></tr>
                <tr><th><?php esc_html_e( 'Público objetivo', 'ai-web-designer' ); ?></th>
                    <td>
                        <textarea name="data[audience]" rows="2" class="large-text"><?php echo esc_textarea( $data['briefing']['audience'] ?? '' ); ?></textarea>
                        <button type="button" class="button aiwd-ai-btn" data-ai="briefing_audience"><?php esc_html_e( 'Sugerir con IA', 'ai-web-designer' ); ?></button>
                    </td></tr>
                <tr><th><?php esc_html_e( 'Tono de comunicación', 'ai-web-designer' ); ?></th>
                    <td><select name="data[tone]">
                        <?php foreach ( $tones as $k => $label ) : ?>
                            <option value="<?php echo esc_attr( $k ); ?>" <?php selected( ( $data['briefing']['tone'] ?? '' ), $k ); ?>><?php echo esc_html( $label ); ?></option>
                        <?php endforeach; ?>
                    </select></td></tr>
                <tr><th><?php esc_html_e( 'Propuesta de valor (USP)', 'ai-web-designer' ); ?></th>
                    <td><textarea name="data[usp]" rows="2" class="large-text"><?php echo esc_textarea( $data['briefing']['usp'] ?? '' ); ?></textarea></td></tr>
                <tr><th><?php esc_html_e( 'Competidores (URLs)', 'ai-web-designer' ); ?></th>
                    <td><textarea name="data[competitors]" rows="2" class="large-text" placeholder="https://..."><?php echo esc_textarea( $data['briefing']['competitors'] ?? '' ); ?></textarea></td></tr>
            </table>
        </section>

        <!-- STEP 2: Marca -->
        <section class="aiwd-step" data-step="2" hidden>
            <h2><?php esc_html_e( 'Marca, logo y paleta', 'ai-web-designer' ); ?></h2>
            <table class="form-table">
                <tr><th><?php esc_html_e( 'Logo', 'ai-web-designer' ); ?></th>
                    <td>
                        <div class="aiwd-media-picker" data-target="logo_id" data-preview="logo_preview">
                            <?php $logo_id = (int) ( $data['brand']['logo_id'] ?? 0 ); ?>
                            <input type="hidden" name="data[logo_id]" value="<?php echo esc_attr( $logo_id ); ?>" />
                            <div class="aiwd-media-preview" id="logo_preview"><?php if ( $logo_id ) echo wp_get_attachment_image( $logo_id, 'medium' ); ?></div>
                            <button type="button" class="button aiwd-media-pick"><?php esc_html_e( 'Subir / seleccionar logo', 'ai-web-designer' ); ?></button>
                            <button type="button" class="button aiwd-ai-btn" data-ai="generate_logo"><?php esc_html_e( 'Generar logo con IA', 'ai-web-designer' ); ?></button>
                        </div>
                    </td></tr>
                <tr><th><?php esc_html_e( 'Colores corporativos', 'ai-web-designer' ); ?></th>
                    <td>
                        <input type="text" name="data[color_primary]"   value="<?php echo esc_attr( $data['brand']['color_primary'] ?? '#0d6efd' ); ?>" placeholder="Primario"/>
                        <input type="text" name="data[color_secondary]" value="<?php echo esc_attr( $data['brand']['color_secondary'] ?? '#6c757d' ); ?>" placeholder="Secundario"/>
                        <input type="text" name="data[color_accent]"    value="<?php echo esc_attr( $data['brand']['color_accent'] ?? '#ffc107' ); ?>" placeholder="Acento"/>
                        <button type="button" class="button aiwd-ai-btn" data-ai="extract_palette_from_logo"><?php esc_html_e( 'Extraer del logo', 'ai-web-designer' ); ?></button>
                    </td></tr>
                <tr><th><?php esc_html_e( 'Tipografías', 'ai-web-designer' ); ?></th>
                    <td>
                        <input type="text" name="data[font_heading]" value="<?php echo esc_attr( $data['brand']['font_heading'] ?? 'Poppins' ); ?>" placeholder="Titulares"/>
                        <input type="text" name="data[font_body]"    value="<?php echo esc_attr( $data['brand']['font_body'] ?? 'Inter' ); ?>" placeholder="Cuerpo"/>
                        <button type="button" class="button aiwd-ai-btn" data-ai="suggest_typography"><?php esc_html_e( 'Sugerir con IA', 'ai-web-designer' ); ?></button>
                    </td></tr>
                <tr><th><?php esc_html_e( 'Eslogan / claim', 'ai-web-designer' ); ?></th>
                    <td>
                        <input type="text" name="data[tagline]" class="regular-text" value="<?php echo esc_attr( $data['brand']['tagline'] ?? '' ); ?>" />
                        <button type="button" class="button aiwd-ai-btn" data-ai="tagline"><?php esc_html_e( 'Generar 5 propuestas', 'ai-web-designer' ); ?></button>
                    </td></tr>
            </table>
        </section>

        <!-- STEP 3: Contacto / Dominio -->
        <section class="aiwd-step" data-step="3" hidden>
            <h2><?php esc_html_e( 'Contacto y dominio', 'ai-web-designer' ); ?></h2>
            <table class="form-table">
                <tr><th><?php esc_html_e( 'Dominio', 'ai-web-designer' ); ?></th>
                    <td>
                        <input type="url" name="data[domain]" class="regular-text" value="<?php echo esc_attr( $data['contact']['domain'] ?? '' ); ?>" placeholder="https://midominio.com" />
                        <button type="button" class="button aiwd-ai-btn" data-ai="scrape_domain"><?php esc_html_e( 'Importar info desde el dominio', 'ai-web-designer' ); ?></button>
                    </td></tr>
                <tr><th><?php esc_html_e( 'Email', 'ai-web-designer' ); ?></th><td><input type="email" name="data[email]" class="regular-text" value="<?php echo esc_attr( $data['contact']['email'] ?? '' ); ?>" /></td></tr>
                <tr><th><?php esc_html_e( 'Teléfono', 'ai-web-designer' ); ?></th><td><input type="text" name="data[phone]" value="<?php echo esc_attr( $data['contact']['phone'] ?? '' ); ?>" /></td></tr>
                <tr><th><?php esc_html_e( 'WhatsApp', 'ai-web-designer' ); ?></th><td><input type="text" name="data[whatsapp]" value="<?php echo esc_attr( $data['contact']['whatsapp'] ?? '' ); ?>" /></td></tr>
                <tr><th><?php esc_html_e( 'Dirección', 'ai-web-designer' ); ?></th><td><input type="text" name="data[address]" class="regular-text" value="<?php echo esc_attr( $data['contact']['address'] ?? '' ); ?>" /></td></tr>
                <tr><th><?php esc_html_e( 'Horario', 'ai-web-designer' ); ?></th><td><input type="text" name="data[schedule]" class="regular-text" value="<?php echo esc_attr( $data['contact']['schedule'] ?? '' ); ?>" placeholder="L-V 9-18h" /></td></tr>
                <tr><th><?php esc_html_e( 'Redes sociales', 'ai-web-designer' ); ?></th>
                    <td>
                        <input type="url" name="data[social][instagram]" placeholder="Instagram" value="<?php echo esc_attr( $data['contact']['social']['instagram'] ?? '' ); ?>" />
                        <input type="url" name="data[social][facebook]"  placeholder="Facebook"  value="<?php echo esc_attr( $data['contact']['social']['facebook']  ?? '' ); ?>" />
                        <input type="url" name="data[social][linkedin]"  placeholder="LinkedIn"  value="<?php echo esc_attr( $data['contact']['social']['linkedin']  ?? '' ); ?>" />
                        <input type="url" name="data[social][youtube]"   placeholder="YouTube"   value="<?php echo esc_attr( $data['contact']['social']['youtube']   ?? '' ); ?>" />
                        <input type="url" name="data[social][tiktok]"    placeholder="TikTok"    value="<?php echo esc_attr( $data['contact']['social']['tiktok']    ?? '' ); ?>" />
                    </td></tr>
                <tr><th><?php esc_html_e( 'Google Maps embed (URL)', 'ai-web-designer' ); ?></th><td><input type="url" name="data[maps_url]" class="regular-text" value="<?php echo esc_attr( $data['contact']['maps_url'] ?? '' ); ?>" /></td></tr>
            </table>
        </section>

        <!-- STEP 4: Fotos -->
        <section class="aiwd-step" data-step="4" hidden>
            <h2><?php esc_html_e( 'Fotos y galería', 'ai-web-designer' ); ?></h2>
            <p class="description"><?php esc_html_e( 'Sube las fotos disponibles, organízalas por sección, o pide que la IA las genere.', 'ai-web-designer' ); ?></p>

            <div class="aiwd-gallery-grid" id="aiwd-gallery">
                <!-- inyectado por JS -->
            </div>
            <p>
                <button type="button" class="button aiwd-bulk-upload"><?php esc_html_e( 'Subir fotos (masivo)', 'ai-web-designer' ); ?></button>
                <button type="button" class="button button-primary aiwd-ai-btn" data-ai="generate_images"><?php esc_html_e( 'Generar imágenes faltantes con IA', 'ai-web-designer' ); ?></button>
                <button type="button" class="button aiwd-ai-btn" data-ai="remove_backgrounds"><?php esc_html_e( 'Quitar fondos a todas', 'ai-web-designer' ); ?></button>
            </p>
            <input type="hidden" name="data[gallery_json]" value="<?php echo esc_attr( wp_json_encode( $data['brand']['gallery'] ?? [] ) ); ?>" />
        </section>

        <!-- STEP 5: Textos -->
        <section class="aiwd-step" data-step="5" hidden>
            <h2><?php esc_html_e( 'Textos informativos', 'ai-web-designer' ); ?></h2>
            <p class="description"><?php esc_html_e( 'Si no dispones del texto, déjalo vacío y pulsa "Generar con IA".', 'ai-web-designer' ); ?></p>

            <?php
            $blocks = [
                'hero_headline'   => __( 'Titular principal (Hero)', 'ai-web-designer' ),
                'hero_sub'        => __( 'Subtítulo del Hero', 'ai-web-designer' ),
                'about'           => __( 'Sobre nosotros', 'ai-web-designer' ),
                'services'        => __( 'Servicios / Productos', 'ai-web-designer' ),
                'why_us'          => __( '¿Por qué elegirnos?', 'ai-web-designer' ),
                'testimonials'    => __( 'Testimonios', 'ai-web-designer' ),
                'faq'             => __( 'Preguntas frecuentes', 'ai-web-designer' ),
                'cta'             => __( 'Llamada a la acción (CTA)', 'ai-web-designer' ),
            ];
            foreach ( $blocks as $key => $label ) : ?>
                <div class="aiwd-text-block">
                    <label><strong><?php echo esc_html( $label ); ?></strong></label>
                    <textarea name="data[<?php echo esc_attr( $key ); ?>]" rows="4" class="large-text"><?php echo esc_textarea( $data['content'][ $key ] ?? '' ); ?></textarea>
                    <div class="aiwd-actions">
                        <button type="button" class="button aiwd-ai-btn" data-ai="generate_text" data-block="<?php echo esc_attr( $key ); ?>"><?php esc_html_e( 'Generar con IA', 'ai-web-designer' ); ?></button>
                        <button type="button" class="button aiwd-ai-btn" data-ai="variants_text" data-block="<?php echo esc_attr( $key ); ?>"><?php esc_html_e( 'Ver 3 variantes', 'ai-web-designer' ); ?></button>
                    </div>
                </div>
            <?php endforeach; ?>
        </section>

        <!-- STEP 6: Referencias -->
        <section class="aiwd-step" data-step="6" hidden>
            <h2><?php esc_html_e( 'Webs de referencia visual', 'ai-web-designer' ); ?></h2>
            <p class="description"><?php esc_html_e( 'Pega URLs de webs que te gusten. La IA extraerá patrones visuales (colores, tipografías, estructura) y los aplicará — sin copiar.', 'ai-web-designer' ); ?></p>
            <textarea name="data[references]" rows="6" class="large-text" placeholder="https://...&#10;https://..."><?php echo esc_textarea( $data['design']['references'] ?? '' ); ?></textarea>
            <p><button type="button" class="button aiwd-ai-btn" data-ai="analyze_references"><?php esc_html_e( 'Analizar referencias', 'ai-web-designer' ); ?></button></p>
        </section>

        <!-- STEP 7: Páginas y estructura -->
        <section class="aiwd-step" data-step="7" hidden>
            <h2><?php esc_html_e( 'Páginas y estructura del sitio', 'ai-web-designer' ); ?></h2>
            <?php $pages = $data['pages']['list'] ?? [ 'home','services','about','blog','contact' ]; ?>
            <p>
                <?php foreach ( [ 'home' => 'Home', 'services' => 'Servicios', 'about' => 'Sobre nosotros', 'portfolio' => 'Portfolio', 'blog' => 'Blog', 'contact' => 'Contacto', 'shop' => 'Tienda', 'booking' => 'Reservas' ] as $k => $label ) : ?>
                    <label class="aiwd-chk"><input type="checkbox" name="data[pages][]" value="<?php echo esc_attr( $k ); ?>" <?php checked( in_array( $k, $pages, true ) ); ?> /> <?php echo esc_html( $label ); ?></label>
                <?php endforeach; ?>
            </p>
            <h3><?php esc_html_e( 'Posts iniciales de blog (generados por IA)', 'ai-web-designer' ); ?></h3>
            <input type="number" min="0" max="20" name="data[blog_posts]" value="<?php echo esc_attr( $data['pages']['blog_posts'] ?? 5 ); ?>" />
        </section>

        <!-- STEP 8: SEO y Legal -->
        <section class="aiwd-step" data-step="8" hidden>
            <h2><?php esc_html_e( 'SEO y textos legales', 'ai-web-designer' ); ?></h2>
            <table class="form-table">
                <tr><th><?php esc_html_e( 'Keywords objetivo', 'ai-web-designer' ); ?></th>
                    <td>
                        <input type="text" name="data[keywords]" class="regular-text" value="<?php echo esc_attr( $data['seo']['keywords'] ?? '' ); ?>" />
                        <button type="button" class="button aiwd-ai-btn" data-ai="suggest_keywords"><?php esc_html_e( 'Sugerir', 'ai-web-designer' ); ?></button>
                    </td></tr>
                <tr><th><?php esc_html_e( 'Meta title', 'ai-web-designer' ); ?></th><td><input type="text" name="data[meta_title]" class="regular-text" value="<?php echo esc_attr( $data['seo']['meta_title'] ?? '' ); ?>" /></td></tr>
                <tr><th><?php esc_html_e( 'Meta description', 'ai-web-designer' ); ?></th><td><textarea name="data[meta_description]" rows="2" class="large-text"><?php echo esc_textarea( $data['seo']['meta_description'] ?? '' ); ?></textarea></td></tr>
                <tr><th><?php esc_html_e( 'Schema.org', 'ai-web-designer' ); ?></th>
                    <td>
                        <select name="data[schema_type]">
                            <?php foreach ( [ 'LocalBusiness','Restaurant','Product','Service','Organization','MedicalClinic','RealEstateAgent','EducationalOrganization' ] as $t ) : ?>
                                <option value="<?php echo esc_attr( $t ); ?>" <?php selected( ( $data['seo']['schema_type'] ?? '' ), $t ); ?>><?php echo esc_html( $t ); ?></option>
                            <?php endforeach; ?>
                        </select>
                    </td></tr>
                <tr><th><?php esc_html_e( 'País (legales)', 'ai-web-designer' ); ?></th>
                    <td><select name="data[country]">
                        <?php foreach ( [ 'ES'=>'España','MX'=>'México','AR'=>'Argentina','CO'=>'Colombia','PE'=>'Perú','CL'=>'Chile','US'=>'EE.UU.','OTHER'=>'Otro' ] as $k => $v ) : ?>
                            <option value="<?php echo esc_attr( $k ); ?>" <?php selected( ( $data['legal']['country'] ?? 'ES' ), $k ); ?>><?php echo esc_html( $v ); ?></option>
                        <?php endforeach; ?>
                    </select></td></tr>
                <tr><th><?php esc_html_e( 'Generar textos legales', 'ai-web-designer' ); ?></th>
                    <td>
                        <label><input type="checkbox" name="data[gen_legal][privacy]" value="1" checked /> <?php esc_html_e( 'Política de privacidad', 'ai-web-designer' ); ?></label><br>
                        <label><input type="checkbox" name="data[gen_legal][cookies]" value="1" checked /> <?php esc_html_e( 'Política de cookies', 'ai-web-designer' ); ?></label><br>
                        <label><input type="checkbox" name="data[gen_legal][terms]"   value="1" checked /> <?php esc_html_e( 'Aviso legal / Términos', 'ai-web-designer' ); ?></label><br>
                        <label><input type="checkbox" name="data[gen_legal][banner]"  value="1" checked /> <?php esc_html_e( 'Banner de cookies', 'ai-web-designer' ); ?></label>
                    </td></tr>
            </table>
        </section>

        <!-- STEP 9: Integraciones -->
        <section class="aiwd-step" data-step="9" hidden>
            <h2><?php esc_html_e( 'Integraciones externas', 'ai-web-designer' ); ?></h2>
            <table class="form-table">
                <tr><th><?php esc_html_e( 'WhatsApp Business', 'ai-web-designer' ); ?></th>
                    <td><input type="text" name="data[wa_number]" value="<?php echo esc_attr( $data['design']['wa_number'] ?? '' ); ?>" placeholder="+34..." /></td></tr>
                <tr><th><?php esc_html_e( 'Calendly', 'ai-web-designer' ); ?></th>
                    <td><input type="url" name="data[calendly]" class="regular-text" value="<?php echo esc_attr( $data['design']['calendly'] ?? '' ); ?>" /></td></tr>
                <tr><th><?php esc_html_e( 'Google Business Profile', 'ai-web-designer' ); ?></th>
                    <td><input type="text" name="data[gmb_id]" value="<?php echo esc_attr( $data['design']['gmb_id'] ?? '' ); ?>" placeholder="Place ID" /></td></tr>
                <tr><th><?php esc_html_e( 'CRM / Email marketing', 'ai-web-designer' ); ?></th>
                    <td><select name="data[crm]">
                        <?php foreach ( [ 'none' => '—', 'mailchimp' => 'Mailchimp', 'brevo' => 'Brevo', 'activecampaign' => 'ActiveCampaign', 'hubspot' => 'HubSpot' ] as $k => $v ) : ?>
                            <option value="<?php echo esc_attr( $k ); ?>" <?php selected( ( $data['design']['crm'] ?? 'none' ), $k ); ?>><?php echo esc_html( $v ); ?></option>
                        <?php endforeach; ?>
                    </select></td></tr>
                <tr><th><?php esc_html_e( 'Idiomas', 'ai-web-designer' ); ?></th>
                    <td><input type="text" name="data[languages]" class="regular-text" value="<?php echo esc_attr( $data['design']['languages'] ?? 'es' ); ?>" placeholder="es,en,fr" /></td></tr>
                <tr><th><?php esc_html_e( 'Analítica', 'ai-web-designer' ); ?></th>
                    <td><input type="text" name="data[ga4]" value="<?php echo esc_attr( $data['design']['ga4'] ?? '' ); ?>" placeholder="GA4 ID" /></td></tr>
            </table>
        </section>

        <!-- STEP 10: Generar -->
        <section class="aiwd-step" data-step="10" hidden>
            <h2><?php esc_html_e( 'Generar diseño con Claude', 'ai-web-designer' ); ?></h2>
            <p class="description"><?php esc_html_e( 'Vamos a enviar todo el briefing a Claude Design para crear las plantillas Elementor. Podrás revisar sección por sección y aprobar o regenerar.', 'ai-web-designer' ); ?></p>

            <div class="aiwd-generate-actions">
                <button type="button" class="button button-primary button-hero aiwd-generate" data-mode="full"><?php esc_html_e( 'Generar web completa', 'ai-web-designer' ); ?></button>
                <button type="button" class="button button-hero aiwd-generate" data-mode="proposals"><?php esc_html_e( 'Generar 3 propuestas distintas', 'ai-web-designer' ); ?></button>
                <button type="button" class="button aiwd-generate" data-mode="pdf"><?php esc_html_e( 'Generar propuesta PDF', 'ai-web-designer' ); ?></button>
            </div>
            <div id="aiwd-generation-output" class="aiwd-output"></div>
        </section>

        <!-- Navegación -->
        <div class="aiwd-nav">
            <button type="button" class="button aiwd-prev"><?php esc_html_e( 'Anterior', 'ai-web-designer' ); ?></button>
            <button type="button" class="button button-primary aiwd-next"><?php esc_html_e( 'Siguiente', 'ai-web-designer' ); ?></button>
            <button type="button" class="button aiwd-save"><?php esc_html_e( 'Guardar borrador', 'ai-web-designer' ); ?></button>
        </div>
    </form>
</div>
