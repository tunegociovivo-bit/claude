# Agente local de Móviles

Aplicación de bandeja para Windows que mantiene el ejecutor del Hub independiente de las pestañas de Chrome. Al cerrar su ventana continúa funcionando. «Salir y detener la ejecución» lo detiene. El ordenador debe permanecer encendido y con la sesión de Windows iniciada.

Usa la misma cola, aprobaciones y protección de envíos inciertos del servidor. No guarda contraseñas en archivos ni crea API keys: el usuario inicia sesión directamente en el Hub, en un perfil aislado y persistente. El contenido remoto está aislado de Node y del sistema de archivos.

Primera puesta en marcha:

1. Cierra las pantallas USB del Hub en Chrome para liberar los móviles.
2. Abre el agente e inicia sesión en el Hub.
3. Usa «Conectar otro móvil» para elegir cada Android. Acepta en el teléfono la nueva huella USB si la solicita.
4. Solo se reconectan dispositivos autorizados, activos y asociados al inventario del Hub. La cola mantiene la aprobación humana de cada mensaje.
5. Cierra la ventana para dejarlo en segundo plano. El icono de la bandeja permite recuperarla o salir.

La versión inicial aún necesita validación física. No sustituye la lectura Android por un servicio persistente en el teléfono. Facebook puede seguir requerir revisión cuando no expone sus controles o cuando no se confirma un envío. Las cuentas con un inicio de sesión externo no disponible en la ventana restringida requieren adaptar y validar ese flujo antes de usarlo.

Instalación en Windows: ejecutar `npm ci`, `npm test` y `powershell -File install-windows.ps1` desde esta carpeta. Se instala en LocalAppData/Programs/NegocioVivoMoviles y crea accesos directos en el escritorio e Inicio. No requiere administrador. Para desactivar el inicio automático, elimina el acceso directo «Negocio Vivo Moviles» de la carpeta Inicio de Windows. Para actualizar, salir primero desde la bandeja y repetir la instalación. No se actualiza solo.

Desarrollo: `npm ci`, `npm test`, `npm start`. Runtime fijado en el lockfile. Las autorizaciones USB se limitan al origen HTTPS exacto y al identificador del dispositivo elegido. La suspensión de la aplicación se inhibe mientras funciona; apagar el ordenador, cerrar la sesión o forzar la suspensión interrumpe el trabajo. La reconexión se detiene ante un bloqueo de PIN para evitar intentos repetidos.

El modo `?diagnostic=1` desactiva el ejecutor de la cola en esa ventana. El modo `?runner=desktop` reconecta móviles autorizados y actualiza el inventario cada minuto. Los mensajes pendientes de revisión o aprobación mantienen ese estado.
