# Hub Reuniones — Extensión de Chrome (sideload)

Extensión interna de Negocio Vivo que graba el audio de la pestaña de
la reunión (Meet, Teams, Zoom, Whereby, Jitsi, Webex…) y crea
automáticamente una tarea en `hub.negociovivo.app` con la
transcripción + resumen IA de la reunión.

No se sube a la Chrome Web Store: se instala manualmente en cada
navegador del equipo.

---

## 1. Instalar la extensión

1. Descarga la carpeta `chrome-extension/` (zip o `git clone` del repo).
2. Abre Chrome y ve a `chrome://extensions`.
3. Activa el toggle **"Modo de desarrollador"** arriba a la derecha.
4. Pulsa **"Cargar extensión sin empaquetar"** y selecciona la carpeta
   `chrome-extension/`.
5. La extensión aparece en la barra superior como un punto morado.
   Si no la ves, púlsala desde el icono del puzzle 🧩 y fíjala con
   el pin.

> Para actualizar: vuelve a `chrome://extensions`, pulsa el icono ↻
> sobre la extensión. No se actualiza sola — al ser sideload hay que
> recargar manualmente cuando se publique una versión nueva.

## 2. Iniciar sesión

1. Pulsa el icono de la extensión en Chrome.
2. Introduce tu **email y contraseña** del Hub (los mismos que usas
   en hub.negociovivo.app).
3. Si tienes 2FA activado, te pedirá el código de 6 dígitos del
   authenticator.
4. La extensión guarda un token de sesión válido 90 días y queda
   ligada a tu usuario — desde ese momento sabrá quién eres,
   recibirás tus notificaciones y las tareas que cree irán
   asignadas a ti.

Para cerrar sesión: icono ⎋ arriba a la derecha del popup.

## 3. Grabar una reunión

1. Abre la reunión en la pestaña de Chrome (Meet, Teams, Zoom Web,
   Whereby, etc.). El icono de la extensión muestra un **punto rojo**
   cuando detecta una reunión.
2. Pulsa el icono de la extensión → **"⏺ Grabar reunión"**.
3. Chrome muestra arriba una advertencia "Esta pestaña está siendo
   grabada". Es la advertencia del sistema, no la puedes ocultar.
4. Cuando termine la reunión, pulsa el icono → **"⏹ Detener y subir"**.
5. El audio se sube al Hub. Whisper transcribe + Claude resume en
   ~30–90 s. Cuando termina, recibes una notificación con link a la
   tarea creada.

> Importante: durante la grabación, **no cierres la pestaña**. Si la
> cierras antes de pulsar "Detener", se pierde lo grabado.

## 4. Plataformas soportadas

| Plataforma | Soporte | Notas |
|---|---|---|
| Google Meet | ✅ | Pestaña web |
| Microsoft Teams (web) | ✅ | `teams.microsoft.com` |
| Zoom (web client) | ✅ | Solo si abres en el navegador, NO el cliente desktop |
| Whereby | ✅ | |
| Jitsi Meet | ✅ | |
| Webex (web) | ✅ | |
| GoToMeeting (web) | ✅ | |
| Zoom desktop / Teams desktop | ❌ | Las apps nativas no se pueden capturar con `chrome.tabCapture`. Abre la reunión en navegador. |

Para añadir otra plataforma: editar `manifest.json` (campos
`host_permissions` y `content_scripts.matches`) y recargar la
extensión.

## 5. Privacidad y avisos a participantes

Esta extensión graba audio. En España y la UE, según RGPD:

- **El user debe avisar a todos los participantes** de que la
  reunión va a ser grabada y para qué fin (resumen interno con IA
  almacenado en el Hub de Negocio Vivo).
- Todos deben prestar consentimiento explícito antes de empezar.
- La transcripción solo se guarda en el workspace del Hub al que
  pertenece la API key — nunca se comparte fuera.

La extensión NO graba la cámara, NO graba la pantalla, NO graba a
otros participantes individuales por dispositivo: solo captura la
mezcla de audio de la pestaña.

## 6. Troubleshooting

| Problema | Causa probable | Solución |
|---|---|---|
| "Configura el plugin primero ↓" | Sin API key | Pega una en Configuración |
| "Hub respondió 401" | API key revocada o sin scope | Crea una nueva en `/admin/api-keys` con `tasks:write` |
| "Audio demasiado largo" | Reunión > 25 MB (~30 min con 64 kbps) | Detener antes; pronto: subida por chunks (TODO) |
| El icono no se pone rojo en una reunión | El dominio no está en `manifest.json` | Añadirlo a `host_permissions` + `content_scripts.matches` |
| "MediaRecorder error" | Pestaña sin audio o codec sin soporte | Reload de la pestaña y reintentar |

## 7. Arquitectura interna (para devs)

```
chrome-extension/
├── manifest.json              # MV3, permisos tabCapture + offscreen
├── background/
│   └── service-worker.js      # coordina; abre el offscreen y le pasa el streamId
├── offscreen/
│   ├── offscreen.html
│   └── offscreen.js           # MediaRecorder real; sube el blob al Hub
├── content/
│   └── meeting-detector.js    # pinta badge rojo cuando estamos en una reunión
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js               # UI con estados idle/recording/uploading/done/error
└── icons/                     # 16/48/128 px
```

Backend del Hub:

- `POST /api/v1/extension/upload-recording` — auth con API key
  Bearer, recibe multipart con el audio + meetingUrl + meetingTitle.
  Hace Whisper → Claude → crea Task + Comment con el resumen.
  Devuelve `{ taskId, taskUrl, taskTitle, summaryPreview }`.

## 8. Notificaciones del Hub

Mientras la extensión esté activa (Chrome abierto), recibirás
notificaciones nativas del sistema operativo cuando:

- **Te mencionan** en un comentario o tarea (`@tu-nombre`).
- **Te asignan** una tarea nueva.
- **Se acerca el plazo** de una tarea con fecha y hora marcadas
  (recordatorios configurados en `notifyDueRules` de la tarea).
- **Hay un comentario nuevo** en una tarea donde participas.

El polling se hace cada 2 minutos. El badge del icono muestra el
contador de no leídas en rojo. Al hacer click en una notificación
del sistema, se abre directamente la tarea / página del Hub
relacionada.

Para marcar todas como leídas: icono → bloque "🔔 Notificaciones" →
"Marcar todas leídas".

## 9. Pendiente / Roadmap

- [ ] Subida por chunks para reuniones largas (>25 MB).
- [ ] Detección y aviso explícito al iniciar la grabación
      (banner "Estás grabando" embebido en la página).
- [ ] Selección del proyecto destino desde el popup (ahora se usa el
      primero del workspace).
- [ ] Pausar / Reanudar.
- [ ] Empaquetado .crx firmado para distribución por enterprise
      policy (sin tener que activar Modo de desarrollador en cada
      máquina).
