# Bubui — evidencia de validación local

## Regresión visual: compra pendiente

RED comprobado el 29-09-2026 en la compilación local y PostgreSQL aislado:
- Una amiga ficticia registra 250 € con un cupón del 20%.
- La base de datos devuelve `pending`, descuento previsto 50 €.
- La web muestra «¡Ahorro aplicado!» y «Te has llevado ... 50.00 €».
- Esperado: «Compra pendiente de confirmación», sin anunciar ahorro consumado.
- Evidencia externa al repositorio: `outputs/bubui-web-pendiente-antes.png`.

Esta comprobación usa una sesión ficticia preparada localmente, no valida el alta por SMS.

GREEN: repetido el mismo circuito en navegador local tras la corrección. La pantalla muestra Compra pendiente de confirmación, ahorro previsto de 50 € y explica que el reto solo cuenta cuando el comercio confirma. Evidencia: outputs/bubui-web-pendiente-corregido.png. Tipos comprobados sin errores.


## Pruebas automáticas

- `npx vitest run`: 2.041 pruebas de la plataforma aprobadas.
- `npm test` en `apps/bubui-mobile`: 78 pruebas aprobadas; tipos sin errores.
- `npx vitest run --config vitest.bubui-integration.config.ts`: 12 recorridos aprobados contra PostgreSQL real aislado. La base debe llamarse `bubui_audit_test` y estar en `127.0.0.1`; cualquier otro destino se rechaza antes de crear datos. Los correos son `example.test`, no hay envíos ni cobros externos.
- La CI prepara una base efímera con ese nombre y ejecuta los recorridos en un trabajo separado. No se ha ejecutado todavía esa nueva configuración en GitHub.
- Cobertura dirigida de los dos módulos nuevos de liquidación y recuperación de retos: 95,45% líneas, 95% ramas, 100% funciones. No es cobertura de toda la app.
- Comprobación visual local adicional: la compra aparece pendiente en el comercio; al confirmar, desaparece de pendientes y aparece una venta de 250 €; ahorro en base de datos: 50 €.

## Condiciones de despliegue

1. Ejecutar la migración aditiva `20260929173000_bubui_purchase_wallet` antes de servir el nuevo código. Añade el presupuesto de hucha, la marca de recuperación del reto y el índice de pendientes. No modifica importes ni pagos históricos.
2. Mantener activo el planificador interno (`DISABLE_INAPP_CRON` sin establecer o distinto de 1) para entregar anuncios pagados a su fecha y recuperar retos interrumpidos.
3. Revisar los checkouts publicitarios anteriores que carezcan de `bubui_ad_id`: se rechazan para conciliación manual; nunca se elige un anuncio por ser el más reciente.
4. Revisar manualmente compras históricas sospechosas: un estado antiguo `confirmed` no acredita retrospectivamente un pago real. Esta corrección no inventa confirmaciones ni revierte ventas de clientes.
5. La recuperación de premios de fidelidad ocurre en la siguiente compra confirmada. Si se desea recuperar todos los premios históricos antes de una nueva visita, hace falta una conciliación controlada adicional.
6. La validación de teléfonos físicos sigue pendiente. Android requiere autorizar el dispositivo conectado y una versión de pruebas que apunte al entorno ficticio. No hay iPhone disponible.

## Límites conocidos del alcance

Se conserva el modo exprés para compras ordinarias cuando el comercio lo configura. Los cupones de amigos, las acciones provisionales, los negocios con reto que exige compra y el modo de doble confirmación requieren intervención del comercio.

Los cambios cierran los seis defectos seleccionados; no cierran por sí solos todos los bloqueos descritos en la auditoría integral. Continúan pendientes el acceso permisivo de otros endpoints, alta antigua sin verificación, push sin autenticar, validación OCR, cierre de mesas/reservas y el circuito de reseñas. Un envío publicitario fallido queda registrado para revisión; no se reenvía automáticamente una entrega ambigua. No se han probado Stripe, SMS, WhatsApp ni push contra cuentas reales.
