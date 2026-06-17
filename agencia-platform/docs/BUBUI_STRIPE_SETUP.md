# Configurar Stripe para cobrar en Bubui

El código de pagos de Bubui ya está hecho (suscripciones Pro/Premium, Push
del Día y Banner IA). Para empezar a **recibir pagos de verdad** solo falta
configurar la cuenta de Stripe y 4 variables de entorno en Railway. Esta
guía es el paso a paso completo. Tiempo estimado: ~15 min.

> Mientras falten las variables, los endpoints responden `503` limpiamente y
> la app oculta/deshabilita los botones de pago. No se rompe nada.

---

## Qué se cobra hoy

| Producto | Tipo | Importe | Cómo se concede |
|----------|------|---------|-----------------|
| Plan **Pro** | Suscripción | **29 €/mes** | El webhook activa `plan=pro` |
| Plan **Premium** | Suscripción | **99 €/mes** | El webhook activa `plan=premium` |
| **Bubui Plus** (usuario) | Suscripción | **1 €/mes** | El webhook activa `plan=plus` en el cliente |
| **Push del Día** | Pago único | Variable (según alcance/radio) | El webhook lanza el push |
| **Banner IA** (edición extra) | Pago único | 1 € | El webhook suma 1 crédito |

Los pagos únicos (Push del Día y Banner IA) crean el precio al vuelo, así
que **no necesitan** un `price_…` precreado. Las tres suscripciones (Pro,
Premium y Plus) sí lo necesitan, y de eso se encarga el script de abajo.

---

## Paso 1 · Cuenta y clave secreta

1. Entra en <https://dashboard.stripe.com>. Si la cuenta aún no está
   verificada para cobros reales, puedes empezar en **modo test** (botón
   "Test mode" arriba a la derecha) y pasar a live cuando quieras.
2. Ve a **Developers → API keys** y copia la **Secret key**:
   - Test: empieza por `sk_test_…`
   - Live: empieza por `sk_live_…` (hay que pulsar "Reveal")

> Usa primero `sk_test_…` para probar el flujo de punta a punta sin mover
> dinero real. Cuando funcione, repite el Paso 2 y 3 con la clave `sk_live_…`.

---

## Paso 2 · Crear los precios Pro y Premium (automático)

Desde `agencia-platform/`, con la clave del paso anterior:

```bash
BUBUI_STRIPE_SECRET_KEY=sk_test_xxx npm run bubui:stripe-setup
```

El script crea (o reutiliza, es idempotente) los productos **Bubui Pro**
(29 €/mes), **Bubui Premium** (99 €/mes) y **Bubui Plus** (1 €/mes) y te
imprime algo así:

```
BUBUI_STRIPE_PRICE_PRO=price_1AbcD...
BUBUI_STRIPE_PRICE_PREMIUM=price_1EfgH...
BUBUI_STRIPE_PRICE_PLUS=price_1IjkL...
```

Guarda esos tres `price_…`. Si lo ejecutas otra vez no duplica nada (usa
`lookup_key` estables: `bubui_pro_monthly` / `bubui_premium_monthly` /
`bubui_plus_monthly`).

> ¿Prefieres hacerlo a mano? En **Product catalog → Add product** crea dos
> productos recurrentes mensuales en EUR (29 y 99) y copia el id de cada
> precio (`price_…`).

---

## Paso 3 · Crear el webhook

1. En Stripe: **Developers → Webhooks → Add endpoint**.
2. **Endpoint URL:**
   ```
   https://hub.negociovivo.app/api/bubui/stripe/webhook
   ```
3. **Eventos a escuchar** (Select events):
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
4. Crea el endpoint y copia el **Signing secret** (`whsec_…`).

> Importante: el webhook test y el webhook live tienen `whsec_…` distintos.
> Usa el que corresponda al modo de tu clave secreta.

---

## Paso 4 · Variables en Railway

En Railway → servicio del Hub → **Variables**, añade las 5:

```
BUBUI_STRIPE_SECRET_KEY      = sk_test_xxx   (o sk_live_xxx)
BUBUI_STRIPE_WEBHOOK_SECRET  = whsec_xxx     (del paso 3)
BUBUI_STRIPE_PRICE_PRO       = price_xxx     (del paso 2)
BUBUI_STRIPE_PRICE_PREMIUM   = price_xxx     (del paso 2)
BUBUI_STRIPE_PRICE_PLUS      = price_xxx     (del paso 2)
```

Guarda y deja que Railway **redepliegue**. No hace falta migración de BD.
(`BUBUI_STRIPE_PRICE_PLUS` solo si quieres ofrecer la suscripción Plus del
usuario; sin ella, Pro/Premium/Push/Banner siguen funcionando.)

---

## Paso 5 · Probar de punta a punta (modo test)

1. Abre el panel del negocio en Bubui → sección de plan → **Pro · 29 €/mes**.
2. En el Checkout de Stripe usa la tarjeta de prueba **4242 4242 4242 4242**,
   cualquier fecha futura, cualquier CVC y CP.
3. Al volver deberías ver `?upgrade=success` y, en unos segundos, el negocio
   con `plan=pro` (lo activa el webhook `customer.subscription.created`).
4. Comprueba en Stripe **Developers → Webhooks → tu endpoint** que los
   eventos llegan con respuesta `200`.
5. Prueba también un **Push del Día** y una **edición de Banner IA** (1 €).

Si todo va bien en test, repite Pasos 1–4 con las claves `sk_live_…` /
`whsec_…` de modo live y ya estás cobrando de verdad. 🎉

---

## Solución de problemas

| Síntoma | Causa probable |
|---------|----------------|
| Botón de upgrade no aparece / `503 stripe_disabled` | Falta `BUBUI_STRIPE_SECRET_KEY` en Railway o no se redeployó |
| `Price del plan pro no configurado` | Falta `BUBUI_STRIPE_PRICE_PRO` / `…PREMIUM` |
| Webhook responde `503 webhook_not_configured` | Falta `BUBUI_STRIPE_WEBHOOK_SECRET` |
| Webhook responde `400 invalid_signature` | El `whsec_…` no corresponde (mezcla test/live) o se reenvió tarde (>5 min) |
| Pago hecho pero el plan no se activa | Mira en Stripe que el evento `customer.subscription.created` se entregó con `200`; revisa logs del Hub |

El webhook es idempotente (tabla `BubuiProcessedWebhook`): si Stripe reentrega
un evento, no se duplica el crédito ni la activación.
