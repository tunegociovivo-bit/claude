# Calendario editorial del Hub

## Preparar un mes

En **Generar mes con IA**, selecciona el cliente y añade hasta ocho enlaces y ocho imágenes en **Referencias y temas de este mes**. Los enlaces deben tener contenido público legible. Si no se pueden leer, la generación informa del error; no ignora silenciosamente una referencia.

Añade los temas obligatorios con **Añadir temas**. Antes de guardar el mes se comprueba que el texto generado cubre cada tema. Cada publicación muestra los temas que cubre. Las referencias y la cobertura quedan guardadas con el mes generado.

El contenido marcado **utilizado**, publicado manualmente o publicado en un canal Meta queda excluido de futuras generaciones. La opción **Permitir reutilizar** es una excepción explícita. La comprobación combina instrucciones al modelo y detección de duplicados textuales; no garantiza detectar toda posible semejanza semántica.

## Crear y adaptar medios

Una publicación nueva permite subir una imagen y escribir el cambio deseado. **Guardar borrador y crear vídeo / adaptar imagen** abre las herramientas completas sin salir del Hub.

La edición mediante instrucciones, el redimensionado y la generación conservan versiones. **Adaptar tamaño** permite previsualizar, usar medidas personalizadas, recortar, encajar o rellenar con fondo difuminado sin deformar el original. El historial permite comparar dos imágenes y seleccionar otra versión.

El vídeo admite imagen actual o instrucciones, formato, estilo, tomas y duración por toma. La generación sigue al cerrar el diálogo y se consulta al volver. Se guarda el resultado en el historial. Requiere los proveedores de IA y almacenamiento configurados. Un reinicio del servidor puede interrumpir el trabajo; el estado permite reintentarlo tras el plazo de recuperación, no se promete reanudación automática.

## Conectar, aprobar y publicar

En la publicación, usa **Conectar / renovar Meta**, concede acceso con la cuenta del cliente y después **Elegir cuentas autorizadas**. El buscador incluye páginas, Instagram profesional y Business Portfolio. Vincula explícitamente las cuentas de ese cliente; desconectar cancela sus destinos pendientes.

Guarda el texto, la fecha y el estado **Aprobada** antes de publicar. Elige destinos Facebook/Instagram y, para carruseles, entre dos y diez imágenes en el orden deseado. Las versiones antiguas no se incluyen automáticamente.

**Publicar ahora / reintentar** respeta destinos ya publicados. **Programar** requiere fecha futura. El planificador integrado revisa los vencimientos cada minuto, siempre que `DISABLE_INAPP_CRON` no sea `1`; el cron externo tiene `/api/cron/editorial-meta-publish` como alternativa.

Cada destino conserva estado, intentos, fecha, enlace, errores e historial de transiciones. Una respuesta ambigua al publicar queda pendiente de revisión en Meta para evitar duplicados. Instagram permite imágenes, carruseles, Reels y Stories compatibles; Facebook permite imágenes, álbumes y vídeos/Reels. Las Stories de Facebook se rechazan explícitamente en esta versión.

Meta requiere una aplicación configurada, permisos de publicación aprobados y autorización de las cuentas. Las pruebas automatizadas no publican contenido en cuentas reales. No es necesario exportar a Metricool; la exportación antigua sigue disponible por compatibilidad.

## Cambio de datos

Se añade únicamente `EditorialPublication.metaJson` (nullable), con migración aditiva `20260924170000_editorial_publication_media`. El arranque Docker habitual sincroniza el esquema con Prisma sin aceptar pérdida de datos. No se borran publicaciones ni versiones existentes.
