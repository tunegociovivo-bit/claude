# Negocio Vivo · Control horario para Mac

Estado: implementación local de previsualización. No compilada ni probada todavía en macOS. No distribuir a trabajadores hasta completar la validación indicada abajo.

Aplicación nativa SwiftUI/AppKit para macOS 14 o posterior, con compilación universal prevista para Apple Silicon e Intel. Usa la misma API que el agente Windows, sin cambios en el CRM. Icono corporativo, ventana accesible desde el Dock y la barra superior, inicio/pausa/reanudación/finalización, hora de primera entrada y contador diario. Al finalizar, se confirma primero el cierre en el servidor, se conserva el resumen y se muestra cero hasta el próximo día local. Un inicio remoto cancela el cierre local.

La credencial individual se valida antes de guardarla en el Llavero. Solo se pide permiso de grabación de pantalla mediante un botón explícito. No requiere cámara ni micrófono. Actividad cada minuto; capturas por pantalla según política del CRM, con desenfoque local si está activado. Se suspenden al pausar/finalizar, perder conexión, bloquear el equipo o detectar inactividad. Las aplicaciones excluidas suprimen la captura. Los dominios del navegador no se recopilan en esta versión. El cierre diario se marca localmente, igual que en Windows; el servidor conserva las sesiones, no una prohibición global de reabrir el día.

## Compilar y comprobar en Mac

Requiere Xcode/Command Line Tools con Swift 5.9 o posterior. Ejecutar `bash build-mac.sh` desde esta carpeta. El script ejecuta XCTest, compila ambas arquitecturas, genera el icono ICNS y prepara una aplicación ZIP de prueba. No publica nada. La firma ad hoc predeterminada no es una firma de distribución de Apple.

`ci-preview.yml` permite probar en los runners Intel y Apple Silicon de GitHub. Debe copiarse a `.github/workflows/mac-preview.yml` en la raíz del repositorio y subirse solamente a la rama de pruebas autorizada. No usa secretos de producción, no vincula trabajadores y no publica releases. Los tests interceptan todas sus peticiones de red y usan credenciales ficticias.

## Validación pendiente antes de distribuir

- Compilar y ejecutar los 10 tests XCTest en macOS Intel y Apple Silicon; corregir cualquier fallo.
- Abrir la aplicación empaquetada y verificar Dock, menú superior y recuperación de la ventana cerrada.
- Con una cuenta de prueba autorizada: vincular, iniciar, pausar, reanudar y finalizar; contrastar sesiones, actividad y tiempos en el CRM.
- Permiso de pantalla denegado/concedido/revocado, desenfoque, aplicaciones excluidas, varias pantallas, bloqueo, suspensión y recuperación de conexión.
- Reinicio durante pausa y tras finalizar, cambio de día, cambios remotos, inicio al entrar en macOS y error de servidor al finalizar.
- Firma Developer ID de la empresa y notarización Apple; instalar en un Mac limpio con Gatekeeper activado. No pedir desactivar protecciones.

Solo después de revisar la simulación y validar el paquete se añadirá la nueva descarga Mac al login, proyectos y control horario. La versión Windows y las descargas actuales permanecen intactas.
