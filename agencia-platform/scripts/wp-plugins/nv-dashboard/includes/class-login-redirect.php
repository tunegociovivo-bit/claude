<?php
/**
 * NV Dashboard — Redirección tras login.
 *
 * v1.0.76: David quiere que tras loguearse con el botón "Sign in with Google"
 * de Site Kit, WordPress le lleve directamente a una URL concreta (la portada
 * del NV Dashboard, normalmente) en lugar del default /wp-admin.
 *
 * Site Kit Sign in with Google no expone una opción nativa para esto — sigue
 * el comportamiento estándar de WP. Pero todos los plugins de auth bien
 * implementados (Site Kit incluido) respetan el filter `login_redirect` de
 * core. Esa es la palanca correcta: cubre login con Google, login con
 * password estándar, y cualquier otro método futuro sin acoplarse a un
 * plugin concreto.
 *
 * Restricciones aplicadas:
 *  - Solo redirige a usuarios con capability edit_posts o superior. Si en el
 *    futuro David abre el sitio a suscriptores (clientes, p.ej.), éstos
 *    seguirán yendo a su destino por defecto y no al NV Dashboard.
 *  - Si el flujo de login ya trae un redirect_to explícito a un sitio externo
 *    no permitido por wp_safe_redirect, deja que WP siga su flujo normal y
 *    NO sobreescribe (evita open-redirect).
 *  - Si la opción está vacía, no hace nada — comportamiento WP default.
 */

if (!defined('ABSPATH')) exit;

class NV_Login_Redirect {

    const OPTION_KEY = 'nv_dashboard_login_redirect_url';

    public static function init() {
        // Prioridad 100 para ir DESPUÉS de cualquier otro filter (Site Kit,
        // WooCommerce, etc.). Si otro plugin decide a dónde mandar al usuario
        // por una razón legítima (p.ej. "redirect_to" en query string), no le
        // pisamos sin necesidad — solo redirigimos cuando el destino sería
        // el default /wp-admin.
        add_filter('login_redirect', [__CLASS__, 'filter_redirect'], 100, 3);
    }

    /**
     * Devuelve la URL configurada por David, o '' si no hay nada configurado.
     * Resuelve rutas relativas tipo "/wp-admin/admin.php?page=nv-dashboard"
     * contra home_url() para que el resultado sea siempre absoluto.
     */
    public static function get_configured_url() {
        $raw = trim((string) get_option(self::OPTION_KEY, ''));
        if ($raw === '') return '';
        // Aceptar tanto absoluta (https://...) como relativa (/wp-admin/...).
        if (preg_match('#^https?://#i', $raw)) {
            return esc_url_raw($raw);
        }
        // Relativa: anclar a home_url
        if (strpos($raw, '/') === 0) {
            return esc_url_raw(home_url($raw));
        }
        // Cualquier otra cosa (texto suelto), tratar como path
        return esc_url_raw(home_url('/' . ltrim($raw, '/')));
    }

    /**
     * Hook login_redirect.
     *
     * @param string           $redirect_to           URL a la que WordPress iba
     *                                                a redirigir por defecto.
     * @param string           $requested_redirect_to URL solicitada explícitamente
     *                                                vía query string (?redirect_to=).
     * @param WP_User|WP_Error $user                  Usuario autenticado o error.
     * @return string URL final.
     */
    public static function filter_redirect($redirect_to, $requested_redirect_to, $user) {
        // Error de auth → no tocar (WP mostrará el error)
        if (is_wp_error($user) || !($user instanceof WP_User)) {
            return $redirect_to;
        }

        // Solo aplicar a usuarios con permisos editoriales (admin, editor, author).
        // Si David abre el sitio a suscriptores algún día, éstos seguirán su
        // flujo normal sin ser redirigidos al NV Dashboard.
        if (!user_can($user, 'edit_posts')) {
            return $redirect_to;
        }

        // Si el flujo trae un redirect_to explícito (p.ej. el usuario entró a
        // un edit-post y WP le mandó al login con ese destino), respetarlo.
        // Solo sobreescribimos cuando el destino sería el dashboard genérico
        // de WP, que es lo que David quiere evitar.
        $default_admin = admin_url();
        $is_default = (
            empty($requested_redirect_to) ||
            untrailingslashit($redirect_to) === untrailingslashit($default_admin)
        );
        if (!$is_default) {
            return $redirect_to;
        }

        $target = self::get_configured_url();
        if ($target === '') {
            return $redirect_to;
        }

        return $target;
    }
}

NV_Login_Redirect::init();
