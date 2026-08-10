# Envío y seguimiento de facturas

## Resend

El HUB utiliza la configuración de Resend guardada para cada workspace. También admite `RESEND_API_KEY` y `EMAIL_FROM` como respaldo del entorno.

Para recibir estados reales de entrega, crea en Resend un webhook con esta URL:

`https://hub.negociovivo.app/api/webhooks/resend/invoices`

Eventos recomendados:

- `email.sent`
- `email.delivered`
- `email.delivery_delayed`
- `email.bounced`
- `email.complained`
- `email.failed`
- `email.suppressed`

Guarda el signing secret que entrega Resend en Railway como `RESEND_WEBHOOK_SECRET`. El endpoint verifica el cuerpo crudo, las cabeceras `svix-*` y una ventana máxima de cinco minutos. Los reintentos se deduplican mediante `svix-id`.

## Recordatorios

Los recordatorios están desactivados inicialmente. Un administrador puede activarlos desde el botón **Recordatorios inactivos** del módulo de facturación.

La cadencia es:

- Tres días antes del vencimiento.
- Un día después del vencimiento.
- Siete días después del vencimiento.
- Quince días después del vencimiento.

Cada aviso tiene una clave única por factura, destinatario y momento de la cadencia. Una factura pagada o anulada no admite recordatorios.
