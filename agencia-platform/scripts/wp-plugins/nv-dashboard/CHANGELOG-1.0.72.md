# NV Dashboard 1.0.72 — Hotfix v1.0.71

## Bugs corregidos

### 🐛 "Editar en Claude" no funcionaba en la pantalla de edición de publicación
En v1.0.71 añadí `nv-dashboard-trash-toasts` como dependencia explícita de
`claude-widget.js`. Pero ese script SOLO se enqueua en hooks de admin que
contienen `nv-dashboard` o `nv_publicacion`. En la pantalla
`/wp-admin/post.php?post=NNN&action=edit` el hook es `post.php`, así que
la dependencia no estaba registrada → WordPress se negaba a cargar
`claude-widget.js` entero, rompiendo "Editar en Claude" + "Previsualizar
mensaje" + el resto del widget.

**Fix**: quito la dependencia. `claude-widget.js` ahora trae inline su
propio helper `callAdaptarFormatoEndpoint`. Además localizamos
`window.nvDashboard` (restUrl / restNonce / adminUrl / siteUrl)
directamente sobre `claude-widget.js`.

### 🐛 504 Gateway Time-out al "Adaptar formato"
nginx corta el proxy upstream a los 60 segundos por defecto, pero la
generación de OpenAI gpt-image-2 puede tardar 30-90s.

**Mitigaciones aplicadas**:

1. **Backend**: `ignore_user_abort(true)` en `adaptar_formato_publicacion`
   para que PHP siga procesando aunque el navegador/nginx cierren la
   conexión. La imagen sigue generándose y se asigna al post.

2. **Frontend**: detectamos HTTP 502/504 y mostramos:
   > ⏳ El servidor (nginx) cerró la conexión a los 60s, pero la
   > generación SIGUE en curso. Espera 1-2 min y recarga la página —
   > la nueva imagen debería aparecer.

### Recomendación
Si tu hosting permite tocar nginx, sube el `proxy_read_timeout` a 180s.
