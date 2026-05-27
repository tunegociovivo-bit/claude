# Negocio Vivo Leads — Guía de instalación y primer uso (v1.2.0)

> **Novedades v1.2.0**:
> - **Scoring automático de leads (0-100)** con bandera de urgencia (crítica/alta/media/baja) que considera posición, rating, % reseñas positivas y negativas, presencia de web, número de reseñas y comparativa con competidores.
> - **% de reseñas positivas y negativas** calculados a partir de Place Details.
> - **Opener personalizado por IA** (Claude o GPT) único para cada lead. Variable `{{opener_ia}}`.
> - **Secuencias de follow-up** con N pasos espaciados. Se detienen solas al recibir respuesta.
> - **Bandeja de entrada de respuestas** vía webhook de Evolution API, con clasificación IA (interesado / pide info / objeción / baja / off-topic).
> - **Validación previa de WhatsApp** antes de enviar, para no quemar mensajes en números sin WA.
> - **Analytics** con funnel, charts y métricas por provincia.

> **v1.1.0**: envío automatizado WhatsApp vía Evolution API con anti-baneo.


## 1. Instalar el plugin en WordPress

1. En tu carpeta `GENERADOR DE LEADS NV` tienes la subcarpeta `negocio-vivo-leads/` con el plugin. Comprímela en un `.zip` (sí, la carpeta `negocio-vivo-leads` entera, no su contenido suelto).
2. En el panel de WordPress entra en **Plugins > Añadir nuevo > Subir plugin**.
3. Selecciona el `.zip` y pulsa **Instalar ahora**.
4. **Activa** el plugin. Al activarse se crearán automáticamente las tablas en la base de datos.

## 2. Configurar la API key de Google Places

Ya tienes la API key. Pégala en **NV Leads > Ajustes**:

- **Google Places API Key**: tu key de GCP.
- **Provincias por lote**: 5 (recomendado para empezar).
- **Enriquecer con Place Details**: actívalo. Sin esto los leads no tendrán teléfono.
- **Competidores por lead**: 3.
- **Código de país por defecto (WhatsApp)**: 34.

Pulsa **Probar API key**. Debería decirte que ha devuelto resultados de prueba. Si te da un error de tipo `REQUEST_DENIED`, revisa en Google Cloud Console:

- Que la API key tenga habilitada la **Places API** (la "legacy", no solo la "New").
- Que la facturación esté activa en el proyecto.
- Que no haya restricciones de IP/HTTP referrer que estén bloqueando las llamadas desde tu servidor de WordPress.

## 3. Lanzar la primera búsqueda

1. Ve a **NV Leads > Nueva búsqueda**.
2. Keyword: por ejemplo, `masajes eróticos`.
3. Alcance: **Toda España** (la opción por defecto).
4. Pulsa **Lanzar búsqueda**.

El procesamiento ocurre en segundo plano. Cada 2 minutos el cron procesará otro lote de provincias (configurable). La página de detalle se refresca sola cada 30 segundos. Si tienes prisa, usa el botón **⏩ Forzar siguiente lote**.

## 4. Revisar leads y enviar WhatsApp

1. Desde el detalle de la búsqueda verás todos los leads ordenados por posición.
2. Filtra por "Sólo con teléfono" para descartar las fichas que no podrás contactar.
3. Pincha en un lead. Verás:
   - Sus datos completos (teléfono, web, valoración, dirección).
   - Los competidores que están por encima en el ranking.
   - Un mensaje WhatsApp personalizado pre-rellenado (con plantilla por defecto).
4. Edita el mensaje si quieres y pulsa **📱 Enviar por WhatsApp**. Se abrirá WhatsApp Web con la conversación lista para enviar — un clic más y queda enviado.
5. Después marca el estado como **Contactado** y añade notas si quieres.

## 5. Personalizar plantillas

En **NV Leads > Plantillas** puedes crear varias plantillas con variables como:

- `{{nombre_negocio}}` — nombre de la ficha del lead
- `{{competidor_top}}` — primer competidor por encima
- `{{posicion}}` — posición actual del lead
- `{{provincia}}` — provincia del lead
- `{{keyword}}` — palabra clave de la búsqueda
- `{{rating}}` y `{{resenas}}` — valoración y número de reseñas
- `{{competidores_lista}}` — todos los competidores en línea

Marca una como **por defecto** y será la que se proponga al abrir cada lead.

## 6. Coste estimado (Google Places)

Con el plan actual (Text Search + Place Details activado):

- Text Search: ~$0,032 por consulta. Una búsqueda "Toda España" = 52 provincias × ~3 paginaciones internas ≈ **~$1,7 / búsqueda nacional**.
- Place Details: ~$0,017 por ficha. Si una búsqueda nacional devuelve 1.000 fichas únicas = **~$17 extra**.

Sin Place Details no tendrás teléfono ni web, pero la búsqueda nacional cuesta ~$1,7. Google da $200 de crédito gratuito al mes en Maps, así que las primeras búsquedas no te cuestan nada.

## 7. Solución de problemas

**El cron no se ejecuta.** Algunos hostings desactivan WP-Cron. Verifica en `wp-config.php` que no tienes `define('DISABLE_WP_CRON', true)`. Si lo tienes, configura un cron de sistema que llame cada 2 minutos a `https://tu-sitio.com/wp-cron.php?doing_wp_cron`. Mientras tanto, usa el botón **Forzar siguiente lote** en el detalle de la búsqueda.

**Los leads salen sin teléfono.** Es porque no has activado "Enriquecer con Place Details" en Ajustes, o porque el negocio no tiene teléfono público en su ficha de Google.

**WhatsApp Web abre con el número rojo / no me deja escribir.** Significa que el número no está dado de alta en WhatsApp. Marca el lead como "Descartado".

**Una búsqueda se quedó atascada.** En la lista de búsquedas pulsa "Forzar siguiente lote" sobre la búsqueda en cuestión. Si sigue sin avanzar, mira el mensaje de error en la columna de estado.

## 8. Cumplimiento legal — leer antes de mandar el primer mensaje

- **RGPD / LSSI**: enviar comunicaciones comerciales no solicitadas a empresas en España es legal con matices. Hay que: identificarse claramente, incluir un mecanismo de baja explícito, y respetar las solicitudes de no contactar. Si te dicen "no me escribas más", márcalo como Descartado y no vuelvas a contactar.
- **WhatsApp ToS**: el envío es manual (un clic) precisamente para minimizar riesgo. No automatices envíos masivos desde tu navegador — eso sí te puede llevar a un baneo.
- **Sectores sensibles**: para palabras clave como "masajes eróticos" hay que tener cuidado con el copy. Mejor enfocarlo en el servicio profesional ("ayudamos a posicionar tu ficha de Google") que en alusiones al negocio en sí.
