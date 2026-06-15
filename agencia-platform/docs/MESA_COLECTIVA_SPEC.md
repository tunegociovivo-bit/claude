# Mesa Colectiva + Hucha de Referidos — Especificación

> Fuente de verdad del diseño de la **Mesa Colectiva** (descuento de grupo viral
> en restauración) y la **hucha de referidos** (descuento acumulable por traer
> amigos reales). Aterrizado sobre el esquema Prisma real (`BubuiBusiness`,
> `BubuiCustomer`, `BubuiTableSession`, `BubuiTableParticipant`).
>
> Última actualización: 2026-06-15.

## 1. Idea de producto

En un restaurante con Mesa Colectiva activa:

1. Un comensal escanea el **QR del local**. La app **no** le aplica el 5% directo:
   le reconoce el restaurante y le ofrece **crear/unirse a una mesa**.
2. Quien crea la mesa es el **capitán**; la app le muestra un **QR de grupo**.
   El resto de comensales escanean **ese** QR para unirse (ventana de unión
   configurable, `mesaJoinWindowMin`, def. 60 min).
3. Cada comensal **desbloquea su parte** del descuento con **una aportación**:
   - **Nuevo** (no tenía la app): aporta **instalándose y dándose de alta**.
     Por defecto eso ya le da el descuento (configurable, ver §4).
   - **Veterano** (ya tenía la app): elige **una** acción del menú que acepte el
     local — **compartir** (abre WhatsApp) **o reseña** (abre Google). Sin acción,
     no cuenta.
4. La acción que **no** eligió se le ofrece ~1 h después por **push**; si la hace,
   se convierte en **cupón de próxima visita** (`mesaNextVisitDays`, def. 15 días).
5. El **dueño cierra la mesa** metiendo el importe → queda registrado para todos
   y se aplica el `finalPct` (limitado por `mesaMaxPct`).

### Hucha de referidos (acumulable)

- Un amigo que se da de alta con tu invitación obtiene un **descuento de bienvenida**
  (def. 5%). Tú, el referidor, **acumulas %** en tu hucha por **cada amigo
  cualificado**.
- **Cualificado** = el amigo (a) se da de alta, (b) **verifica teléfono** y
  (c) hace su **primera visita real** (compra confirmada). Solo entonces se
  abona el % al referidor. Esto evita altas falsas.
- La hucha es un **saldo que se gasta**: al canjear se aplica hasta el **tope de
  la ficha de mesa** (`mesaMaxPct`); si sobra, **el resto queda acumulado** y el
  contador de caducidad sigue corriendo (caducidad **global**, def. 90 días).
- Anti-abuso: el saldo grande es **por persona y yendo solo** (no se reparte
  entre los comensales de una mesa) y con **tope de importe** por canje.

### Realidades técnicas asumidas (honestidad)

- **"Compartir con N amigos" no es verificable**: al abrir WhatsApp el SO no nos
  dice a cuántos envió. Lo medible son las **altas reales** de esos amigos (ya lo
  rastrea `referredById`). Por eso el premio fuerte cuelga de **altas**, no de
  "compartir".
- **La reseña de Google no es verificable**: se abre el enlace y se confía.
- Los **pushes diferidos** y la **atribución de altas a una mesa** requieren
  crons (ya existe infra: `app/api/cron/bubui-*`).

## 2. Estado actual (lo que YA existe)

- **Modelos**: `BubuiTableSession` (code, captainId, status open|verified|redeemed|
  expired, basePct, shareBonusPct, reviewBonusPct, maxPct, minDiners, shareFriends,
  finalPct, expiresAt, verifiedAt, redeemedAt) y `BubuiTableParticipant`
  (isNewUser, contributed, contributionType, sharedCount, sharedDone, reviewDone).
- **Config por negocio** (`BubuiBusiness`): `mesaEnabled`, `mesaBasePct`,
  `mesaMinDiners`, `mesaShareBonusPct`, `mesaShareFriends`, `mesaReviewBonusPct`,
  `mesaReviewPlatform`, `mesaMaxPct`, `mesaJoinWindowMin`, `mesaNextVisitDays`,
  `mesaBonusOnThisVisit`, `mesaVeteranMustContribute`, `mesaVeteranShareFriends`,
  `mesaAutoAdjust`, `mesaActShare/Review/Photo/Follow`, `mesaPerkLabel`,
  `referralEnabled`, `referralReward1/3/5`.
- **Cliente** (`BubuiCustomer`): `referralCode`, `referredById`, `firstBusinessId`,
  `phoneVerified`, `ambassadorLevel`.
- **Infra**: crons (`bubui-share-reminders`, `bubui-review-requests`, …), Web Push,
  ruta de mesa `app/bubui/app/mesa/page.tsx`.

## 3. Lo que falta (gaps a construir)

### Gap A — Toggle de primera descarga (Fase 1)
Nuevo flag en `BubuiBusiness`:
```
mesaNewUserMustContribute Boolean @default(false)
```
`false` (def.) = el comensal nuevo desbloquea descuento **solo con instalarse**.
`true` = aunque sea nuevo, debe completar **también** una acción del menú.

### Gap B — Hucha de referidos numérica (Fase 3)
Nuevos campos en `BubuiCustomer`:
```
referralWalletPct        Int       @default(0)  // saldo % acumulado
referralWalletExpiresAt  DateTime?              // caducidad global
referralQualifiedCount   Int       @default(0)  // amigos cualificados (histórico)
```
Nueva config por negocio (o global en `BubuiSetting`):
```
referralRewardPct   Int @default(1)  // % que gana el referidor por amigo cualificado
referralWelcomePct  Int @default(5)  // descuento de bienvenida del amigo
referralWalletDays  Int @default(90) // caducidad global de la hucha
```

### Gap C — Atribución de altas a la mesa + push viral (Fase 2)
"X amigos se han dado de alta; si llegan al resto, +Y% para todos." Requiere
ligar las altas a la sesión de mesa y un cron del día siguiente.

## 4. Modelo de configuración por restaurante

| Ajuste | Campo | Default |
|---|---|---|
| Mesa activa | `mesaEnabled` | true |
| % base por visita | `mesaBasePct` | 5 |
| **% tope por visita** (limita hucha + bonus) | `mesaMaxPct` | 20 |
| Mínimo de comensales | `mesaMinDiners` | 4 |
| Primera descarga: directo / exige acción | `mesaNewUserMustContribute` *(nuevo)* | false (directo) |
| Veterano debe aportar | `mesaVeteranMustContribute` | true |
| Acciones aceptadas | `mesaActShare/Review/Photo/Follow` | share+review |
| Bonus en esta visita o próxima | `mesaBonusOnThisVisit` | false (próxima) |
| Caducidad cupón próxima visita | `mesaNextVisitDays` | 15 |
| % por referido cualificado | `referralRewardPct` *(nuevo)* | 1 |
| % bienvenida al amigo | `referralWelcomePct` *(nuevo)* | 5 |
| Caducidad hucha (global) | `referralWalletDays` *(nuevo)* | 90 |

## 5. Fases de entrega

### Fase 1 — Flujo nativo de mesa (lo visible)
- Migración: `mesaNewUserMustContribute`.
- Motor de mesa respeta el toggle de primera descarga.
- App móvil: al escanear el QR del local con Mesa activa → pantalla de mesa
  (crear como capitán / mostrar QR grupo / unirse), NO aplica 5% directo.
- Cierre por el dueño → registro para todos (ya existe la base).

### Fase 2 — Retención + viral
- Push diferido (~1 h): la acción no elegida → cupón próxima visita.
- Atribución de altas a la mesa + cron del día siguiente con el push
  "X amigos de alta; si llegan al resto, +Y% para todos".

### Fase 3 — Hucha de referidos
- Migración Gap B.
- Abono de % al referidor cuando el amigo se cualifica (alta + tel. verificado
  + 1ª compra confirmada).
- Canje: aplica hasta `mesaMaxPct`, sobrante acumulado, caducidad global.
- Regla "por persona / yendo solo" + tope de importe.

## 6. Decisiones cerradas
- Quién paga el descuento: **el restaurante hasta su `mesaMaxPct`**; el sobrante
  se acumula en la hucha (no lo regala nadie de más en esa visita).
- Caducidad de la hucha: **contador global** (se renueva con cada acumulación).
- Valor por defecto de primera descarga: **descuento directo** (menos fricción).
