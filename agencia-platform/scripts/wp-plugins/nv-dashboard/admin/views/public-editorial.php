<?php
/**
 * Vista pública: Calendario editorial mensual
 *
 * Variables disponibles desde NV_Public_Dashboard::render():
 *   $clientes        - Array de WP_Term de clientes
 *   $cliente_actual  - Slug del cliente filtrado o 'all'
 *   $base_public_url - URL base pública del dashboard
 *   $can_edit        - bool, si el usuario logueado puede editar
 *
 * @since 1.0.5
 */
if (!defined('ABSPATH')) exit;
?>

<div class="wrap nv-dashboard nv-public-wrap">

    <div class="nv-legend">
        <span class="nv-tag nv-tag-reel">🎬 Reels</span>
        <span class="nv-tag nv-tag-imagen">📷 Imágenes</span>
        <span class="nv-tag nv-tag-carrusel">🎴 Carruseles</span>
        <span class="nv-tag nv-tag-story">📱 Stories</span>
        <span class="nv-legend-sep"></span>
        <span class="nv-status nv-status-pending">○ Pendiente</span>
        <span class="nv-status nv-status-approved">● Aprobada</span>
        <span class="nv-status nv-status-scheduled">▶ Programada</span>
    </div>

    <?php if ($cliente_actual === 'all' && $can_edit): ?>
    <div class="nv-info-box" style="margin-bottom: 16px; padding: 12px 16px;">
        <p style="margin: 0;"><strong>👆 Selecciona un cliente</strong> en el dropdown superior para poder aprobar el mes, duplicar o generar con Claude.</p>
    </div>
    <?php elseif ($can_edit): ?>
    <div style="margin-bottom: 16px; display: flex; gap: 8px; flex-wrap: wrap;">
        <button class="button button-primary nv-button-gold" onclick="nvAbrirGenerarMes()" title="Genera 14 borradores con Claude para un mes en blanco">
            🤖 Generar mes con Claude
        </button>
        <button class="button" onclick="nvDuplicarMes()" title="Duplica todas las publicaciones de un mes a otro">
            📋 Duplicar mes
        </button>
        <button class="button" onclick="nvGenerarImagenesConClaude()" title="Abre claude.ai con prompt para generar imágenes de las publicaciones sin asset">
            🎨 Generar imágenes con Claude
        </button>
        <span style="font-size: 12px; color: #666; align-self: center;">
            Tip: arrastra eventos del calendario para reprogramarlos
        </span>
    </div>
    
    <!-- Modal generar mes (mismo que admin) -->
    <div id="nv-generar-mes-modal" class="nv-modal" style="display:none;">
        <div class="nv-modal-content" style="max-width: 600px;">
            <span class="nv-modal-close" onclick="nvCerrarGenerarMes()">&times;</span>
            <h2 style="margin-top: 0;">🤖 Generar mes con Claude</h2>
            <p style="color: #666; margin-bottom: 18px;">
                Claude generará todos los borradores en ~30-60s. Coste estimado: ~5-8 céntimos.
            </p>
            <label style="display:block; margin-bottom: 12px;">
                <strong>Mes destino</strong>
                <input type="month" id="nv-genmes-mes" class="widefat" style="margin-top: 4px;">
            </label>
            <label style="display:block; margin-bottom: 12px;">
                <strong>Número de publicaciones</strong>
                <input type="number" id="nv-genmes-cantidad" class="widefat" value="14" min="1" max="60" style="margin-top: 4px;">
            </label>
            <label style="display:block; margin-bottom: 12px;">
                <strong>Redes objetivo</strong>
                <div style="display:flex; gap: 12px; flex-wrap: wrap; margin-top: 6px;">
                    <label><input type="checkbox" class="nv-genmes-red" value="facebook" checked> Facebook</label>
                    <label><input type="checkbox" class="nv-genmes-red" value="instagram" checked> Instagram</label>
                    <label><input type="checkbox" class="nv-genmes-red" value="linkedin" checked> LinkedIn</label>
                    <label><input type="checkbox" class="nv-genmes-red" value="tiktok"> TikTok</label>
                    <label><input type="checkbox" class="nv-genmes-red" value="twitter"> X/Twitter</label>
                    <label><input type="checkbox" class="nv-genmes-red" value="google_my_business"> GMB</label>
                </div>
            </label>
            <label style="display:block; margin-bottom: 12px;">
                <strong>Mix de tipos</strong>
                <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 6px;">
                    <label>📷 Imagen <input type="number" id="nv-genmes-mix-imagen" value="6" min="0" style="width: 60px;"></label>
                    <label>🎴 Carrusel <input type="number" id="nv-genmes-mix-carrusel" value="4" min="0" style="width: 60px;"></label>
                    <label>🎬 Reel <input type="number" id="nv-genmes-mix-reel" value="3" min="0" style="width: 60px;"></label>
                    <label>📱 Story <input type="number" id="nv-genmes-mix-story" value="1" min="0" style="width: 60px;"></label>
                </div>
            </label>
            <label style="display:block; margin-bottom: 12px;">
                <strong>Brief del mes</strong>
                <textarea id="nv-genmes-brief" class="widefat" rows="6" placeholder="Ejemplo: foco en automatización IA y casos de éxito clientes..."></textarea>
            </label>
            <div style="display:flex; gap: 8px; flex-direction: column; margin-top: 18px;">
                <button class="button button-primary nv-button-gold" onclick="nvGenerarMesAbrirClaude()">
                    🤖 Generar publicaciones ahora
                </button>
                <button class="button" onclick="nvCerrarGenerarMes()">Cancelar</button>
            </div>
        </div>
    </div>
    <?php endif; ?>

    <div id="nv-calendar"></div>

    <?php if ($can_edit): ?>
    <div class="nv-approve-bar" id="nv-approve-bar">
        <div class="nv-approve-info">
            <p class="nv-approve-title">Listo para enviar a Metricool</p>
            <p class="nv-approve-subtitle">
                <span id="nv-approved-count">0</span> de
                <span id="nv-total-count">0</span> publicaciones aprobadas para
                <strong id="nv-mes-label">cargando...</strong>
            </p>
        </div>
        <button class="button button-primary nv-button-gold" id="nv-approve-month-btn" onclick="nvApproveMonth()">
            ✅ Aprobar mes y generar CSV
        </button>
    </div>
    <?php endif; ?>

    <!-- Modal preview publicación -->
    <div id="nv-preview-modal" class="nv-modal" style="display:none">
        <div class="nv-modal-content">
            <span class="nv-modal-close" onclick="nvClosePreview()">&times;</span>
            <div id="nv-preview-body"></div>
        </div>
    </div>

</div>
