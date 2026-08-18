# Suite META — plan de construcción

## Objetivo
Unificar comentarios, supervisión, recomendaciones y creación de publicidad Meta en un único módulo operativo para varios trabajadores.

## Fase 1 — Centro META y supervisión (esta entrega)

- Crear `/meta` como portada con acceso a Campañas Meta y Comentarios Meta.
- Agrupar ambos accesos bajo una única entrada `META` en Plataformas.
- Añadir navegación interna consistente.
- Incorporar panel de campañas activas por cuenta publicitaria.
- Consultar 90 días de resultados, agregados en bloques de 15 días.
- Mostrar leads, gasto, CPL, CTR, impresiones y evolución frente al periodo anterior.
- Generar recomendaciones accionables, sin ejecutar cambios de presupuesto ni publicación sin aprobación.
- Reutilizar el generador existente de campañas, conjuntos y anuncios.

Verificación: Prisma/TypeScript, pruebas, revisión de aislamiento por workspace y despliegue Railway.

## Fase 2 — Automatización y alertas

- Instantáneas programadas y alertas por caída de leads, subida de CPL, gasto sin resultados y entrega detenida.
- Preferencias de email por cliente/cuenta y umbrales configurables.
- Detección de fatiga creativa mediante frecuencia, CTR y tendencia.
- Recomendaciones IA con aprobación y registro de decisiones.

## Fase 3 — Optimización avanzada

- Comparador de anuncios, conjuntos, audiencias y ubicaciones.
- Experimentos A/B guiados y control de significancia.
- Pacing de presupuesto y previsión de cierre mensual.
- Biblioteca de creatividades y aprendizaje por cliente.
- Flujo completo generar → revisar → aprobar → publicar → medir → iterar.

## Invariantes

- Toda consulta y escritura queda aislada por workspace y conexión Meta.
- Ningún cambio económico o publicación se ejecuta sin aprobación humana explícita.
- Los fallos de una conexión no bloquean las demás.
- La desconexión conserva el histórico y deja trazabilidad.

## Rollback

Las rutas existentes `/campanas-meta` y `/admin/meta-comments` permanecen operativas; la nueva portada y navegación pueden retirarse sin borrar campañas, comentarios ni conexiones.
