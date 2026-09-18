# Negocio Vivo · Control horario para Mac

Estado: compilación universal y 14 pruebas superadas en macOS 15 Intel y Apple Silicon el 18-09-2026. Instalación en /Applications comprobada en ambos entornos. Paquete de prueba aún sin firma Developer ID ni notarización; no distribuir como versión definitiva.

Aplicación nativa SwiftUI/AppKit para macOS 14 o posterior, con compilación universal prevista para Apple Silicon e Intel. Usa la misma API que el agente Windows, sin cambios en el CRM. Icono corporativo, ventana accesible desde el Dock y la barra superior, inicio/pausa/reanudación/finalización, hora de primera entrada y contador diario. Al finalizar, se confirma primero el cierre en el servidor, se conserva el resumen y se muestra cero hasta el próximo día local. Un inicio remoto cancela el cierre local.

La credencial individual se valida antes de guardarla en el Llavero. Solo se pide permiso de grabación de pantalla mediante un botón explícito. No requiere cámara ni micrófono. Actividad cada minuto; capturas por pantalla según política del CRM, con desenfoque local si está activado. Se suspenden al pausar/finalizar, perder conexión, bloquear el equipo o detectar inactividad. Las aplicaciones excluidas suprimen la captura. Los dominios del navegador no se recopilan en esta versión. El cierre diario se marca localmente, igual que en Windows; el servidor conserva las sesiones, no una prohibición global de reabrir el día.

## Compilar y comprobar en Mac

Requiere Xcode/Command Line Tools con Swift 5.9 o posterior. Ejecutar `bash build-mac.sh` desde esta carpeta. El script ejecuta XCTest, compila ambas arquitecturas, genera el icono ICNS y prepara una aplicación ZIP de prueba. No publica nada. La firma ad hoc predeterminada no es una firma de distribución de Apple.

El workflow activo está en `.github/workflows/mac-preview.yml` en la raíz del repositorio, rama `test/macos-time-agent-preview`. No usa secretos de producción, no vincula trabajadores y no publica releases. Los tests interceptan todas sus peticiones de red y usan credenciales ficticias. También renderizan la vista nativa con NSHostingView y rechazan imágenes vacías. La instalación se comprueba mediante el instalador del sistema, verificación de firma ad hoc y comparación del ejecutable instalado.

Evidencia: https://github.com/tunegociovivo-bit/claude/actions/runs/35344608328 — commit 98d4d6d2643f37919bf50afd12fd3cbfbe2bb984. Incluye ciclo de jornada, finalización fallida, reconciliación de conflictos, persistencia de cierre tras sincronización, consultas de fecha y cambios de horario de verano. Las comunicaciones se prueban contra respuestas controladas, no contra cuentas reales del CRM.

`release-mac.sh` prepara el paquete definitivo cuando estén disponibles los certificados Developer ID Application e Installer y el perfil de notarización. Firma, envía a Apple, adjunta los tickets y exige que Gatekeeper apruebe aplicación y paquete. Nunca publica automáticamente.

## Validación pendiente antes de distribuir

- Completado: compilar, ejecutar los 14 tests e instalar en macOS Intel y Apple Silicon.
- Abrir la aplicación empaquetada y verificar Dock, menú superior y recuperación de la ventana cerrada.
- Con una cuenta de prueba autorizada: vincular, iniciar, pausar, reanudar y finalizar; contrastar sesiones, actividad y tiempos en el CRM.
- Permiso de pantalla denegado/concedido/revocado, desenfoque, aplicaciones excluidas, varias pantallas, bloqueo, suspensión y recuperación de conexión.
- Reinicio durante pausa y tras finalizar, cambio de día, cambios remotos, inicio al entrar en macOS y error de servidor al finalizar.
- Firma Developer ID de la empresa y notarización Apple; instalar en un Mac limpio con Gatekeeper activado. No pedir desactivar protecciones.

Solo después de revisar la simulación y validar el paquete se añadirá la nueva descarga Mac al login, proyectos y control horario. La versión Windows y las descargas actuales permanecen intactas.
