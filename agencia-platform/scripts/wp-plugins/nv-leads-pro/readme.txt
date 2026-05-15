=== Negocio Vivo Leads ===
Contributors: negociovivo
Tags: leads, google my business, gmb, scraping, prospección, whatsapp
Requires at least: 5.8
Tested up to: 6.5
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Plataforma de captación de leads desde Google My Business para la agencia Negocio Vivo.

== Descripción ==

Plugin que permite buscar fichas de Google My Business por palabra clave y localidad (incluyendo "Toda España"), almacenar los resultados en base de datos, identificar competidores que aparecen por encima del lead en el ranking, y preparar mensajes personalizados de WhatsApp con un clic.

= Funcionalidades =

* Búsqueda por keyword + localidad (provincia única, localidad libre o las 52 provincias de España).
* Procesamiento en background vía WP-Cron por lotes (configurable).
* Integración con Google Places API (Text Search + Place Details).
* Panel CRM con filtros, paginación y estados de contacto.
* Detalle de lead con competidores por encima.
* Sistema de plantillas de mensaje con variables tipo {{nombre_negocio}}, {{competidor_top}}, {{posicion}}.
* Botón "Enviar por WhatsApp" que abre wa.me con texto pre-rellenado.
* Exportación de leads a CSV.

= Requisitos =

1. Cuenta de Google Cloud Platform con la **Places API** habilitada y facturación activa.
2. API key con acceso a Places API. La key se configura en Negocio Vivo Leads > Ajustes.
3. WP-Cron funcionando (suele venir activo por defecto; en hostings que lo desactivan, se puede ejecutar manualmente con el botón "Forzar siguiente lote" o mediante un cron de sistema).

== Instalación ==

1. Sube el archivo `.zip` desde Plugins > Añadir nuevo > Subir plugin.
2. Activa el plugin.
3. Ve a "NV Leads > Ajustes" e introduce tu API key de Google Places.
4. Pulsa "Probar API key" para verificar.
5. Ve a "NV Leads > Nueva búsqueda" y crea la primera.

== Aviso legal ==

* La extracción de datos se realiza a través de la API oficial de Google Places, lo cual cumple los términos de servicio de Google.
* El envío de mensajes por WhatsApp se realiza de forma **manual** (clic en el botón) para evitar incumplir los términos de servicio de WhatsApp Business.
* El envío de comunicaciones comerciales en España está regulado por el RGPD y la LSSI. El uso del plugin para prospección outbound debe respetar la normativa: identificación clara, mecanismo de opt-out y respeto a las solicitudes de baja.

== Changelog ==

= 1.0.0 =
* Versión inicial. Búsqueda por palabra clave/localidad, panel CRM, plantillas WhatsApp, exportación CSV.
