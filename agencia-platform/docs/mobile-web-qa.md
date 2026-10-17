# Pruebas web desde el Hub, sin instalar scripts

## Configuracion

F-moviles conserva plantillas de varias webs en el navegador, separadas por el
ambito de usuario existente. Cada plantilla admite de 1 a 20 URLs HTTPS de un
unico origen, sin consultas ni fragmentos, y entre 30 y 900 segundos de duracion.
No es necesario instalar scripts, extensiones o mapas de calor en las webs.

El ordenador de los telefonos necesita Chrome con F-moviles actualizado, pantallas
Android abiertas en modo diagnostico y ningun trabajador o tarea en ejecucion.
Las ordenes tambien pueden enviarse desde los paneles remotos de esos moviles.
La estacion anuncia si admite el motor nativo; estaciones antiguas o de escritorio
que no anuncien esa capacidad no deben ofrecer inicio de prueba. No se instala
ni modifica software en el telefono.

## Flujo manual y automatico

1. Guardar una plantilla y elegirla en el panel del telefono.
2. Confirmar autorizacion sobre esas URLs y pulsar Abrir busqueda.
3. Elegir manualmente el resultado de Google en el movil y confirmar el clic.
4. Pulsar Iniciar recorrido desde el Hub. El Hub verifica primero que Chrome
   muestra una URL de la lista permitida; si aun muestra Google, no navega ni
   envia gestos. No automatiza clics sobre resultados ni anuncios.
5. El Hub abre la primera URL con la marca nv_test=UUID, realiza desplazamientos
   y pausas y visita aleatoriamente las otras URLs configuradas.
6. Detener desde el Hub o esperar al limite. Descargar el informe en el ordenador.

Cada gesto se precede de una comprobacion de la URL mediante la barra de Chrome
(Ctrl+L y lectura accesible), y de una comprobacion del area WebView. Si no se puede
leer, la ruta no esta autorizada o hay redireccion externa, se detiene. El Hub no
pulsa botones, enlaces, formularios, compras o anuncios. La navegacion entre URLs
es apertura directa de rutas aprobadas, no clics reales de interlinking.

La automatizacion se ejecuta en el navegador del ordenador conectado por USB,
no como tarea persistente del servidor. No cerrar ni suspender esa ventana.
Al desconectar, cambiar modo o perder permisos locales se cancela. La parada
remota depende de que la estacion reciba la orden; una orden ya enviada al telefono
puede terminar, pero no se emiten nuevas acciones despues de cancelar. Si se pierde
la red, el limite de duracion local sigue vigente.

## Seguridad y limites

Se reutilizan los permisos de operador y la separacion por workspace de la
estacion. Comandos y reportes se validan en el servidor. No se usa la cola de
publicacion social; las pruebas no pueden solaparse con ella en esa ventana.
Las ordenes caducan a los 30 segundos como el resto del control remoto.
Si no hay confirmacion de inicio en 45 segundos, la interfaz lo indica; nunca
convierte el envio a la cola en un resultado completado.

Maximo 20 navegaciones y 190 acciones antes de finalizar. La lectura accesible
puede tardar varios segundos y reducir el numero de gestos. Si una lectura no
responde, la cancelacion y el reloj no esperan indefinidamente. El informe distingue
completado, detenido y fallido. No permite garantizar profundidad de scroll ni
capturar DOM, destinos de enlaces o interacciones reales como un mapa de calor.

## Informes y analiticas

El Hub registra tiempos, rutas, navegaciones solicitadas y gestos enviados, sin
extraer formularios, contenido web ni texto de usuarios. El informe local esta en
memoria; el remoto viaja con las capturas existentes y permanece en la memoria
efimera de la estacion del Hub (no BD ni historial durable). Descargar el JSON antes
de recargar la estacion. No incluye un mapa de calor.

La visita automatica es sintetica y se abre de nuevo tras el clic manual. No mide
la atribucion de Google ni representa comportamiento real de clientes. La marca
nv_test NO excluye automaticamente las visitas de analiticas ya instaladas; esa
segmentacion depende de la herramienta de cada web. El codigo de instalacion web
de la primera version se ha retirado: el motor actual no lo necesita.
