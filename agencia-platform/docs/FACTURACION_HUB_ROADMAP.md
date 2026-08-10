# Facturación HUB — hoja de ruta para sustituir Holded

## Principio de transición

Holded debe funcionar como fuente externa durante la transición, no como núcleo del sistema. El HUB será progresivamente la fuente de verdad y conservará el identificador externo para reconciliar importaciones sin duplicados.

## Capacidades ya disponibles

- Multiempresa emisora y asignación de clientes.
- Facturas, rectificativas, proformas y presupuestos.
- Numeración por serie y ejercicio.
- Datos fiscales congelados al emitir.
- Líneas, impuestos, descuentos, PDF y Facturae.
- Gastos, recurrencia, enlaces Stripe y remesas SEPA.
- Importación desde Holded.
- Cartera propia: cobrado, pendiente, vencido, próximo a vencer y borradores.

## Fase 1 — núcleo fiable

- [x] Informes de cartera independientes de Holded.
- [x] Cobros parciales incluidos en el saldo real.
- [x] Vencimientos y alertas de los próximos siete días.
- [x] Paginación y búsqueda eficiente.
- [x] Registro inmutable de eventos de factura (creación, emisión, cambios de estado, cobro y anulación).
- [ ] Validación fiscal completa antes de emitir, con lista de errores accionable.
- [ ] Bloqueo transaccional de numeración y prueba de concurrencia.

## Fase 2 — operación diaria

- [x] Registro de cobros parciales, método, fecha, referencia, notas y reversos auditables.
- [ ] Conciliación bancaria asistida de los cobros registrados.
- Envío de factura por email desde el HUB y seguimiento de entrega.
- Recordatorios automáticos antes y después del vencimiento.
- Plantillas recurrentes con calendario, vista previa y control de errores.
- Abonos parciales y rectificativas vinculadas correctamente.
- Catálogo de productos/servicios, precios e impuestos habituales.
- Exportación contable y fiscal por trimestre.

## Fase 3 — cumplimiento y automatización

- Adaptación a VeriFactu/SIF según el calendario legal aplicable.
- Facturae firmada y canales de administración pública.
- Cierre de periodos, permisos por rol y auditoría descargable.
- Conciliación bancaria asistida y reglas de asignación de cobros.
- Integración de adeudos SEPA con aprobación humana y trazabilidad completa.

## Fase 4 — retirada de Holded

1. Ejecutar HUB y Holded en paralelo durante al menos dos cierres mensuales.
2. Comparar numeración, bases, impuestos, cobros, vencimientos y rectificativas.
3. Convertir el HUB en fuente primaria; Holded queda solo como réplica.
4. Exportar y archivar todos los documentos y eventos históricos.
5. Desactivar la creación en Holded cuando la conciliación sea estable y esté aprobada por la asesoría.

## Condición de salida

No se retirará Holded hasta que el HUB supere pruebas de concurrencia, cálculo fiscal, PDF/Facturae, restauración de copias, permisos, auditoría y dos cierres mensuales reconciliados sin diferencias materiales.
