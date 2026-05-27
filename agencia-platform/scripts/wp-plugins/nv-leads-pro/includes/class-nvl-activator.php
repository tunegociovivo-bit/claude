<?php
/**
 * Activacion del plugin: creacion de tablas y datos por defecto.
 */

if ( ! defined( 'WPINC' ) ) {
    die;
}

class NVL_Activator {

    public static function activate() {
        self::create_tables();
        self::set_default_options();
        self::insert_default_templates();
        self::insert_default_sequence();
        self::schedule_cron();
    }

    private static function create_tables() {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $charset_collate = $wpdb->get_charset_collate();

        $sql_searches = "CREATE TABLE {$wpdb->prefix}nvl_searches (
            id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            keyword VARCHAR(255) NOT NULL,
            location VARCHAR(255) NOT NULL,
            scope VARCHAR(50) NOT NULL DEFAULT 'custom',
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            total_provinces INT(11) NOT NULL DEFAULT 0,
            processed_provinces INT(11) NOT NULL DEFAULT 0,
            current_province VARCHAR(100) DEFAULT NULL,
            total_results INT(11) NOT NULL DEFAULT 0,
            error_message TEXT DEFAULT NULL,
            created_by BIGINT(20) UNSIGNED DEFAULT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            completed_at DATETIME DEFAULT NULL,
            PRIMARY KEY (id),
            KEY idx_status (status),
            KEY idx_created (created_at)
        ) {$charset_collate};";

        $sql_leads = "CREATE TABLE {$wpdb->prefix}nvl_leads (
            id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            search_id BIGINT(20) UNSIGNED NOT NULL,
            place_id VARCHAR(255) NOT NULL,
            name VARCHAR(255) NOT NULL,
            formatted_address TEXT,
            province VARCHAR(100) DEFAULT NULL,
            phone VARCHAR(50) DEFAULT NULL,
            international_phone VARCHAR(50) DEFAULT NULL,
            website VARCHAR(500) DEFAULT NULL,
            rating DECIMAL(3,2) DEFAULT NULL,
            reviews_count INT(11) DEFAULT 0,
            reviews_json LONGTEXT,
            positive_pct DECIMAL(5,2) DEFAULT NULL,
            negative_pct DECIMAL(5,2) DEFAULT NULL,
            neutral_pct DECIMAL(5,2) DEFAULT NULL,
            price_level TINYINT(1) DEFAULT NULL,
            category VARCHAR(255) DEFAULT NULL,
            types TEXT,
            latitude DECIMAL(10,7) DEFAULT NULL,
            longitude DECIMAL(10,7) DEFAULT NULL,
            position INT(11) DEFAULT NULL,
            gmb_url VARCHAR(500) DEFAULT NULL,
            business_status VARCHAR(50) DEFAULT NULL,
            raw_data LONGTEXT,
            score INT(11) DEFAULT NULL,
            score_breakdown LONGTEXT,
            urgency VARCHAR(20) DEFAULT NULL,
            ai_opener TEXT,
            ai_opener_generated_at DATETIME DEFAULT NULL,
            has_whatsapp TINYINT(1) DEFAULT NULL,
            whatsapp_checked_at DATETIME DEFAULT NULL,
            contact_status VARCHAR(30) NOT NULL DEFAULT 'pending',
            notes TEXT,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uniq_search_place (search_id, place_id),
            KEY idx_search (search_id),
            KEY idx_place (place_id),
            KEY idx_status (contact_status),
            KEY idx_position (position),
            KEY idx_score (score),
            KEY idx_urgency (urgency),
            KEY idx_hasw (has_whatsapp)
        ) {$charset_collate};";

        $sql_competitors = "CREATE TABLE {$wpdb->prefix}nvl_competitors (
            id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            lead_id BIGINT(20) UNSIGNED NOT NULL,
            competitor_place_id VARCHAR(255) NOT NULL,
            competitor_name VARCHAR(255) NOT NULL,
            competitor_position INT(11) NOT NULL,
            competitor_rating DECIMAL(3,2) DEFAULT NULL,
            competitor_reviews INT(11) DEFAULT 0,
            PRIMARY KEY (id),
            KEY idx_lead (lead_id),
            KEY idx_position (competitor_position)
        ) {$charset_collate};";

        $sql_messages = "CREATE TABLE {$wpdb->prefix}nvl_messages (
            id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            lead_id BIGINT(20) UNSIGNED NOT NULL,
            template_id BIGINT(20) UNSIGNED DEFAULT NULL,
            rendered_message LONGTEXT NOT NULL,
            channel VARCHAR(30) NOT NULL DEFAULT 'whatsapp',
            instance_name VARCHAR(100) DEFAULT NULL,
            phone_normalized VARCHAR(30) DEFAULT NULL,
            status VARCHAR(30) NOT NULL DEFAULT 'queued',
            scheduled_at DATETIME DEFAULT NULL,
            sent_at DATETIME DEFAULT NULL,
            send_attempts INT(11) NOT NULL DEFAULT 0,
            last_error TEXT DEFAULT NULL,
            external_message_id VARCHAR(255) DEFAULT NULL,
            priority INT(11) NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_lead (lead_id),
            KEY idx_status (status),
            KEY idx_scheduled (scheduled_at),
            KEY idx_instance (instance_name)
        ) {$charset_collate};";

        $sql_templates = "CREATE TABLE {$wpdb->prefix}nvl_templates (
            id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            name VARCHAR(100) NOT NULL,
            body LONGTEXT NOT NULL,
            is_default TINYINT(1) NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_default (is_default)
        ) {$charset_collate};";

        $sql_sequences = "CREATE TABLE {$wpdb->prefix}nvl_sequences (
            id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            name VARCHAR(150) NOT NULL,
            description TEXT,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            is_default TINYINT(1) NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_active (is_active),
            KEY idx_default (is_default)
        ) {$charset_collate};";

        $sql_sequence_steps = "CREATE TABLE {$wpdb->prefix}nvl_sequence_steps (
            id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            sequence_id BIGINT(20) UNSIGNED NOT NULL,
            step_order INT(11) NOT NULL DEFAULT 0,
            delay_days INT(11) NOT NULL DEFAULT 3,
            template_body LONGTEXT NOT NULL,
            channel VARCHAR(30) NOT NULL DEFAULT 'whatsapp',
            stop_if_responded TINYINT(1) NOT NULL DEFAULT 1,
            PRIMARY KEY (id),
            KEY idx_seq (sequence_id),
            KEY idx_order (step_order)
        ) {$charset_collate};";

        $sql_lead_sequences = "CREATE TABLE {$wpdb->prefix}nvl_lead_sequences (
            id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            lead_id BIGINT(20) UNSIGNED NOT NULL,
            sequence_id BIGINT(20) UNSIGNED NOT NULL,
            current_step_index INT(11) NOT NULL DEFAULT 0,
            status VARCHAR(30) NOT NULL DEFAULT 'active',
            enrolled_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            completed_at DATETIME DEFAULT NULL,
            stopped_reason VARCHAR(100) DEFAULT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY uniq_lead_seq (lead_id, sequence_id),
            KEY idx_status (status)
        ) {$charset_collate};";

        $sql_inbox = "CREATE TABLE {$wpdb->prefix}nvl_inbox (
            id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            lead_id BIGINT(20) UNSIGNED DEFAULT NULL,
            phone_normalized VARCHAR(30) DEFAULT NULL,
            channel VARCHAR(30) NOT NULL DEFAULT 'whatsapp',
            direction VARCHAR(10) NOT NULL DEFAULT 'in',
            message_text LONGTEXT,
            external_message_id VARCHAR(255) DEFAULT NULL,
            instance_name VARCHAR(100) DEFAULT NULL,
            classification VARCHAR(40) DEFAULT NULL,
            classification_confidence DECIMAL(4,2) DEFAULT NULL,
            classification_reason TEXT,
            is_read TINYINT(1) NOT NULL DEFAULT 0,
            received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_lead (lead_id),
            KEY idx_phone (phone_normalized),
            KEY idx_class (classification),
            KEY idx_read (is_read),
            KEY idx_recv (received_at)
        ) {$charset_collate};";

        $sql_exclusions = "CREATE TABLE {$wpdb->prefix}nvl_exclusions (
            id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            match_type VARCHAR(30) NOT NULL DEFAULT 'name',
            match_value VARCHAR(255) NOT NULL,
            match_mode VARCHAR(20) NOT NULL DEFAULT 'contains',
            reason VARCHAR(255) DEFAULT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_type (match_type),
            KEY idx_value (match_value)
        ) {$charset_collate};";

        $sql_optouts = "CREATE TABLE {$wpdb->prefix}nvl_optouts (
            id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            phone_normalized VARCHAR(30) NOT NULL,
            lead_id BIGINT(20) UNSIGNED DEFAULT NULL,
            reason VARCHAR(255) DEFAULT NULL,
            source VARCHAR(40) NOT NULL DEFAULT 'manual',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uniq_phone (phone_normalized),
            KEY idx_lead (lead_id)
        ) {$charset_collate};";

        dbDelta( $sql_searches );
        dbDelta( $sql_leads );
        dbDelta( $sql_competitors );
        dbDelta( $sql_messages );
        dbDelta( $sql_templates );
        dbDelta( $sql_sequences );
        dbDelta( $sql_sequence_steps );
        dbDelta( $sql_lead_sequences );
        dbDelta( $sql_inbox );
        dbDelta( $sql_exclusions );
        dbDelta( $sql_optouts );

        update_option( 'nvl_db_version', NVL_DB_VERSION );
    }

    private static function set_default_options() {
        $existing = get_option( 'nvl_settings' );
        $defaults = array(
            'google_api_key'          => '',
            'batch_size'              => 5,
            'cron_interval'           => 'nvl_two_minutes',
            'results_per_query'       => 60,
            'fetch_details'           => 1,
            'competitor_count'        => 3,
            'whatsapp_country_code'   => '34',
            'language'                => 'es',
            'region'                  => 'es',
            'evolution_api_url'       => '',
            'evolution_api_key'       => '',
            'evolution_instance'      => '',
            'send_enabled'            => 1,
            'send_delay_min'          => 60,
            'send_delay_max'          => 180,
            'send_window_start'       => '09:00',
            'send_window_end'         => '20:00',
            'send_on_weekends'        => 0,
            'daily_limit'             => 80,
            'enable_variations'       => 1,
            'send_paused'             => 0,
            'ai_provider'             => 'anthropic',
            'ai_api_key'              => '',
            'ai_model_opener'         => 'claude-haiku-4-5-20251001',
            'ai_model_classifier'     => 'claude-haiku-4-5-20251001',
            'ai_enabled_opener'       => 1,
            'ai_enabled_classify'     => 1,
            'validate_wa_before_send' => 1,
            'validate_keyword_match'  => 1,
            'webhook_token'           => '',
        );

        if ( $existing && is_array( $existing ) ) {
            $merged = array_merge( $defaults, $existing );
            if ( empty( $merged['webhook_token'] ) ) {
                $merged['webhook_token'] = wp_generate_password( 24, false, false );
            }
            update_option( 'nvl_settings', $merged );
        } else {
            $defaults['webhook_token'] = wp_generate_password( 24, false, false );
            update_option( 'nvl_settings', $defaults );
        }
    }

    private static function insert_default_templates() {
        global $wpdb;
        $table = $wpdb->prefix . 'nvl_templates';
        $count = (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$table}" );
        if ( $count > 0 ) return;

        // 4 plantillas distintas. El motor las rota aleatoriamente al encolar.
        // Reglas para evitar fingerprinting de WhatsApp:
        //   - Mensajes cortos (< 300 caracteres)
        //   - Sin palabras-flag obvias ("posicionar", "Google My Business", "marketing")
        //   - Tono conversacional, NO comercial directo
        //   - Estructura distinta entre plantillas (no todas empiezan igual)
        //   - CTA suave: pregunta abierta, no "llamada de 10 min"
        $templates = array(
            array(
                'name' => 'Saludo corto + pregunta',
                'body' => "Hola {{nombre_negocio}}, una pregunta rapida sobre vuestra ficha en {{provincia}}.\n\n¿Trabajais ya el tema de la visibilidad online o lo llevais por libre?",
            ),
            array(
                'name' => 'Observacion + ofrecimiento',
                'body' => "Buenas {{nombre_negocio}}. Estaba revisando el sector en {{provincia}} y me he fijado en vuestro perfil.\n\nSi te interesa, te puedo pasar un par de observaciones concretas. ¿Te encaja?",
            ),
            array(
                'name' => 'Directo y breve',
                'body' => "Hola, {{nombre_negocio}}? Soy David.\n\nMe gustaria comentaros un par de cosas que he visto en vuestro perfil online. ¿Tienes 2 minutos esta semana?",
            ),
            array(
                'name' => 'Curiosidad sutil',
                'body' => "Hola {{nombre_negocio}}, estoy mirando el sector en {{provincia}}.\n\n¿Os interesa que os comente brevemente como os ve la gente cuando os busca? Sin compromiso.",
            ),
        );
        foreach ( $templates as $t ) {
            $wpdb->insert( $table, array(
                'name'       => $t['name'],
                'body'       => $t['body'],
                'is_default' => 1,
            ), array( '%s', '%s', '%d' ) );
        }
    }

    private static function insert_default_sequence() {
        global $wpdb;
        $seq_table  = $wpdb->prefix . 'nvl_sequences';
        $step_table = $wpdb->prefix . 'nvl_sequence_steps';
        $existing   = (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$seq_table}" );
        if ( $existing > 0 ) return;

        $wpdb->insert( $seq_table, array(
            'name'        => 'Secuencia GMB estandar (4 pasos)',
            'description' => 'Primer mensaje + 3 follow-ups. Se detiene si el lead responde.',
            'is_active'   => 1,
            'is_default'  => 1,
        ) );
        $seq_id = $wpdb->insert_id;

        $steps = array(
            array( 0, 0, "Hola {{nombre_negocio}},\n\n{{opener_ia}}\n\nSoy David de Negocio Vivo. Os ayudamos a posicionar fichas de Google My Business. Estais en la posicion {{posicion}} para \"{{keyword}}\" en {{provincia}}, mientras que {{competidor_top}} aparece encima.\n\n¿Te vendria bien una llamada de 10 minutos?" ),
            array( 1, 3, "Hola {{nombre_negocio}}, te dejé un mensaje el otro día sobre vuestra posicion en Google para \"{{keyword}}\". Me gustaría enseñarte 2-3 cambios concretos para superar a {{competidor_top}}. ¿Esta semana o la próxima?" ),
            array( 2, 5, "Hola {{nombre_negocio}}, una última idea. Vuestro rating de {{rating}} es mejor que el de competidores que están por encima vuestra. Si quieres una auditoria gratuita por escrito, dimelo y te la envio." ),
            array( 3, 7, "Hola {{nombre_negocio}}, no te molesto mas. Si en el futuro quereis trabajar el posicionamiento de vuestra ficha, estamos a un mensaje. Un saludo." ),
        );
        foreach ( $steps as $s ) {
            $wpdb->insert( $step_table, array(
                'sequence_id'       => $seq_id,
                'step_order'        => $s[0],
                'delay_days'        => $s[1],
                'template_body'     => $s[2],
                'channel'           => 'whatsapp',
                'stop_if_responded' => 1,
            ) );
        }
    }

    private static function schedule_cron() {
        if ( ! wp_next_scheduled( 'nvl_process_pending_searches' ) ) {
            wp_schedule_event( time() + 60, 'nvl_two_minutes', 'nvl_process_pending_searches' );
        }
        if ( ! wp_next_scheduled( 'nvl_process_send_queue' ) ) {
            wp_schedule_event( time() + 30, 'nvl_one_minute', 'nvl_process_send_queue' );
        }
    }
}
