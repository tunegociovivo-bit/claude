# Control horario nativo de Windows 1.0.7

Agente Windows Forms, .NET 8, Windows x64. La configuración procede del Hub.

## Correcciones

- Botones Iniciar, Pausar/Reanudar y Finalizar por hoy en una zona inferior fija; ventana redimensionable y contenido desplazable.
- Finalizar cierra la sesión en el Hub antes de marcar localmente el día como terminado. Muestra contador cero y total guardado; la marca persiste al reabrir y caduca al cambiar de día. Si el Hub vuelve a mostrar una sesión activa, se elimina la marca local.
- 22 pruebas del agente, incluidos el estado finalizado y el tamaño de controles al 100/150/200 %.

- Primera entrada local y contador diario HH:mm:ss; recupera el acumulado del Hub, excluye pausas y sincroniza tras cada cambio de jornada. Cambia de día según el calendario local, incluidos cambios de horario y sesiones que cruzan medianoche.

- Logo oficial como icono del ejecutable, ventana, bandeja, menú Inicio, escritorio y programas instalados.
- Descarga pública en login y tableros de proyectos; aviso de instalación imprescindible en login.

- Envía formularios de captura compatibles con Node 20 (atributos entre comillas y sin `filename*`).
- Valida la credencial individual con `GET /api/v1/time-tracking/agent-config` antes de guardarla cifrada con DPAPI. El Hub actual no implementa el canje público de códigos antiguos.
- Icono de bandeja, acceso en Inicio, inicio automático administrado por el MSI y control de instancia única.
- Iniciar, pausar, reanudar y terminar jornada. Cerrar la ventana conserva el icono; Salir termina el proceso. El cierre automático de sesiones desconectadas sigue siendo responsabilidad del Hub.
- Reintento de conexión cada minuto, sin llamadas simultáneas desde los temporizadores y botones de jornada.
- Actualiza la política antes de las capturas; detiene las capturas ante un error de conexión, bloqueo de sesión o una aplicación excluida visible. No captura durante inactividad prolongada.
- Respeta las opciones de aplicaciones, títulos e inactividad. No cuenta los intervalos largos de suspensión como actividad observada.

## Compilar y probar

Desde `agencia-platform`:

```powershell
dotnet test windows-time-agent-tests -c Release
dotnet publish windows-time-agent -c Release -o windows-time-agent/publish
# Firmar el EXE con un certificado de firma de código autorizado antes de empaquetar.
wix build windows-time-agent/installer/NegocioVivo.TimeAgent.wxs -arch x64 -o Negocio.Vivo.Control.Horario.Native.1.0.7.msi
# Firmar el MSI y verificar ambas firmas.
```

El MSI utiliza el mismo UpgradeCode que 1.0.1 y crea los accesos del escritorio y menú Inicio y el inicio automático por usuario. El usuario abre Control horario desde Inicio para vincularlo. No se abre automáticamente al terminar la instalación.

## Validación y límites

Doce pruebas de contrato con un servidor simulado verifican la vinculación, preservación de credenciales existentes ante errores, códigos antiguos, políticas incompletas, opciones de privacidad, comandos y formato de actividad. Las pruebas no crean usuarios ni registran jornadas reales.

Verificado el 16/09/2026: instalación por usuario con código MSI 0, proceso activo, vinculación real, actividad aceptada, captura aceptada y visible en el Hub, y jornada de prueba cerrada. Pendiente: validación en otros equipos y antivirus antes de una distribución general.

La firma disponible es autofirmada: una firma válida localmente no implica confianza pública ni aceptación por todos los antivirus. No se añaden certificados de confianza ni excepciones al antivirus.

Este agente no recopila dominios web, no mantiene una cola de actividad sin conexión y no constituye aún una sustitución funcional completa de DeskTime. La actividad de aplicaciones se muestrea una vez por minuto. El instalador de macOS no se ha modificado ni validado.
