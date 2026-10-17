# Pruebas web asistidas (F-moviles)

## Alcance

Plantillas para distintas webs, guardadas en el navegador y separadas por el
ambito de usuario existente. Cada plantilla admite hasta 20 URLs HTTPS de un
unico origen y una duracion de 30 a 900 segundos. Se usa el panel de cada movil
USB conectado en modo diagnostico, sin trabajador automatico activo. No hay
ejecucion programada ni coordinacion simultanea de flotas en esta primera version.

La apertura de Google es explicita, por movil. El operador elige el resultado y
hace clic manualmente. No se comprueba el ranking ni se pulsan resultados o
anuncios automaticamente. Preparar el recorrido abre de nuevo la URL configurada
con un identificador sintetico: no mide ni conserva la atribucion del clic previo
de Google. No presentar estos recorridos como comportamiento de clientes reales.

## Instalacion

En cada sitio autorizado, antes de cerrar `</body>`, instalar:

```html
<script defer src="https://hub.negociovivo.app/nv-web-qa.js"></script>
```

Tambien puede alojarse una copia del archivo en el propio sitio. Debe cargarse en
todas las paginas permitidas. Ajustar la politica CSP del sitio si procede.
El script no actua para visitas ordinarias. Una prueba se prepara con una
configuracion en el fragmento de URL, se valida otra vez en la web y exige pulsar
"Iniciar prueba" en el telefono. No elude los avisos de consentimiento del sitio.

## Recorrido e informe

El reloj comienza con el inicio manual y no se reinicia entre paginas. Hay pausas,
desplazamientos y navegacion aleatoria entre enlaces presentes en la pagina cuyo
destino coincide exactamente con una URL autorizada. No se ejecutan manejadores de
clic de la web, botones, formularios, descargas ni destinos externos. Las URLs con
parametros, fragmentos o rutas sensibles no se aceptan en las plantillas.

La pestana oculta suspende acciones; el reloj sigue corriendo. Limites adicionales:
30 paginas y 295 eventos antes de detenerse. No se intenta evadir protecciones del
navegador ni restricciones del sitio. Una redireccion a una pagina sin script o a
otro origen impide continuar; no hay control remoto fuera de paginas instaladas.

El control flotante permite detener y descargar un JSON en el telefono. Incluye
el identificador, URLs configuradas, tiempos, paginas, desplazamientos solicitados
y errores genericos (sin capturar mensajes, contenido de formularios ni datos de
usuarios). El informe permanece en sessionStorage de esa pestana, como maximo una
hora para reactivacion. No se sube al hub ni se comparte entre telefonos. Cerrar la
pestana elimina su almacenamiento de sesion. Descargar antes de cerrarla.

## Analiticas

No hay proveedor de mapas de calor configurado. Las visitas llevan `nv_test=UUID`,
exponen `window.NV_WEB_QA = { synthetic: true, id }` y emiten el evento `nv:web-qa`.
Estas marcas NO excluyen por si solas las sesiones de Google Analytics, Clarity,
Hotjar u otras herramientas. Configurar la exclusión/segmentacion en cada sitio
antes de instalar analiticas o activar estas pruebas sobre una web ya medida.
La integracion concreta con mapas de calor queda pendiente de elegir herramienta.

No se promete diagnostico UX de usuarios reales a partir de navegacion aleatoria.
Los informes sirven para revisar instrumentacion y recorridos tecnicos.
