# Backlog de mejoras (pendientes de implementar)

> Recordatorio: el usuario quiere implementar estas ideas **más adelante**.
> Cuando se retome el trabajo sobre Bubui, recordarle este backlog.

---

## 🔴 Red de recomendación cruzada Bubui — capas nuevas sobre lo ya existente

**Contexto (lo que YA está construido, no rehacer):**
La mecánica base de cupón cruzado ya existe:
- `lib/bubui/core.ts` → `unlockOffersForPurchase()`: al comprar en A, crea cupones
  para comercios cercanos (<3 km) de **otra categoría**, filtrando por
  `visibilityScore >= 20` (karma) y priorizando los de plan **Pro/Premium**.
- `haversineMeters()` para la distancia.
- `BubuiOffer.source = "cross"`, canje en `app/api/bubui/purchase/confirm`.
- Tracking en el dashboard del comercio ("ofertas cruzadas recibidas/canjeadas").
- Presets de descuento (`cuponCruzado`) y copy editorial que lo menciona.

El usuario aprobó **3 capas nuevas** encima de esto (implementar más adelante):

### A. Reparto que APRENDE por conversión (contextual bandit, no solo karma)
- **Problema actual:** el orden de `unlockOffersForPurchase` es estático
  (distancia + karma + plan de pago). No usa si el cupón se canjea de verdad.
- **Qué hacer:** un `crossConversionScore` por par
  `(categoría origen → negocio destino)` que **sube con cada `BubuiOffer.redeemed`**
  y **decae con el tiempo**. Ponderar con él el orden de candidatos.
- **Dónde:** nueva tabla/campo agregado + ordenar en `unlockOffersForPurchase`.
- **Impacto:** 2-3× más canjes reales sin repartir más cupones. La red se
  auto-optimiza.
- **Esfuerzo/impacto:** ⭐ el mejor ratio (aprovecha datos que YA se guardan).

### B. SUBASTA local de cupones cruzados (nueva línea de ingresos)
- **Problema actual:** "los de pago aparecen primero" es un ranking, no un mercado.
- **Qué hacer:** convertirlo en subasta **CPA (pay-per-canje)**:
  - Campos nuevos en `BubuiBusiness`: `crossBidCents`, `crossMaxPerDay`.
  - El orden pondera **puja × conversión** (combina con A).
  - Se cobra **por canje real** (visita conseguida), con tope diario.
- **Impacto:** monetiza la red que ya existe. Es un "Google Ads de barrio" con
  resultados garantizados → el modelo más defendible.
- **Nota:** requiere pensar cobro (¿Stripe? ver `docs/BUBUI_STRIPE_SETUP.md`).

### C. Balance de red / anti-gorrón (dar-recibir)
- **Problema actual:** nada garantiza que un comercio APORTE además de RECIBIR.
- **Qué hacer:** ledger `crossGiven` / `crossReceived` por negocio. Si el ratio
  recibido/dado supera un umbral, baja su prioridad en la red hasta que
  reactive/mejore su propio cupón cruzado.
- **Impacto:** evita la degradación de la red (tragedia de los comunes) y da
  argumento de venta: "aporta para recibir".

### (D. Panel de grafo de red — opcional, mencionada pero no confirmada)
- Panel visible por comercio: "enviaste 34 clientes a la cafetería · recibiste 21
  de la peluquería · saldo neto +8 visitas / +160 €". Retención pura.

**Orden sugerido de implementación:** A (rápida, aprovecha datos) → C (fairness,
prepara la subasta) → B (monetización, la de mayor techo económico).

---

## Otras ideas propuestas (hub Negocio Vivo) — por si se retoman

Estas se propusieron como "extraordinarias" y quedaron sin decidir:

1. **Motor de intención local predictivo** — snapshots periódicos de cada
   `placeId` (rating, reseñas, competidores) y detectar la *derivada*
   (empeora → dolor ahora). Lead scoring temporal, no estático.
2. **Panel "esto es el dinero que te generé"** — atribución de ingresos cruzando
   Bubui (compras/canjes) + reseñas GMB + call-tracking. Ataca el churn.
3. **Recepcionista IA para el negocio final** — WhatsApp/tel con IA que atiende a
   los clientes del comercio 24/7, reserva citas, escala calientes. Reutiliza
   "Sonia" + WAHA. Nueva línea de ingresos recurrente.
4. **Fábrica de propuestas en 1 clic** — desde un lead, PDF/landing con su ranking
   vs. competencia, mockup GMB, ROI estimado, firmable.
5. **Motor de subvenciones → solicitud autogenerada** — casa convocatorias BDNS
   con el CNAE del cliente y genera el borrador de solicitud con IA.
6. **Registro de consentimiento auditable** (consent ledger con sello temporal)
   para blindar el cold outreach (LSSI/GDPR) y venderlo como garantía.
7. **Autopiloto editorial por sector** — calendario que se genera solo por
   cliente/temporada, publica en GMB/redes, mide y reescribe lo que no funciona.
8. **Gemelo digital del negocio local** — simulador de acciones (+reseñas, posts,
   ads) sobre el ranking local estimado, con histórico real de otros negocios.
9. **Detector de churn de los CLIENTES de la agencia** — avisa qué cliente va a
   darse de baja (menos logins/aperturas de informes, resultados planos).
