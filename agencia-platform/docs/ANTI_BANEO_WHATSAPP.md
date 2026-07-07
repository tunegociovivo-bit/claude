# Guía anti-baneo de WhatsApp — NV Leads Pro

Captación **en frío** por WhatsApp con clientes NO oficiales (WAHA/Evolution).
Objetivo realista: **maximizar la supervivencia de cada número y rotarlos barato**,
no "cero baneos" (imposible en frío sobre WhatsApp, con cualquier proveedor).

> La verdad incómoda: ningún canal de WhatsApp —ni la API oficial— permite escribir
> en frío a desconocidos sin penalización. Lo que sigue **reduce mucho** la tasa de
> baneo; no la elimina. Los **reportes/bloqueos de los destinatarios** son la señal
> nº1 de WhatsApp y eso solo se combate con **buena segmentación de la lista**.

## Los 3 factores que más queman un número (por impacto)

1. **IP de datacenter compartida.** Si todos los números salen por la IP del
   servidor (Railway/Hetzner), WhatsApp lo detecta y los tumba rápido. → **Proxy
   residencial/móvil, 1 IP fija por número.** *(Es el factor nº1.)*
2. **Número "frío" / sin reputación.** Recién creado, sin foto, sin nombre de
   negocio, sin historial humano, enviando a tope el día 1.
3. **Lista mala + opener spam.** Targeting pobre → reportes/bloqueos. Enlaces en
   el primer mensaje. Mismo copy exacto a todos.

## Proxy: qué contratar y cómo configurarlo

**Coste — lee esto primero:** para WhatsApp de **texto** el consumo de datos es
mínimo (KB por mensaje → decenas de MB al mes por número). Por eso los proxies
**residenciales de pago por GB** salen por **céntimos al mes** y los **móviles
dedicados (40-90 €/mes por puerto) son sobreingeniería** salvo a mucho volumen.

**Tipo (recomendado → caro):**
1. **Residencial de pago por GB, sticky** ✅ *recomendado y baratísimo para
   WhatsApp*: DataImpulse (~1 $/GB), IPRoyal Pay-as-you-go (no caduca), Proxy-Cheap.
   Una sola cuenta da muchas sesiones sticky (una por número) del mismo saldo.
2. **Móvil (4G/5G)** — máxima resistencia pero caro; solo compensa a mucho volumen.
   Alternativa DIY: móviles Android + SIMs con datos (~10-15 €/mes/SIM).
3. ❌ **Datacenter** — NO. Es lo que quemaba los números.

**Regla de oro:** 1 IP **fija (sticky)** por número. Nunca compartir IP entre números.
Elige país = país de tus leads (España).

**Formato que acepta la plataforma:**
```
http://usuario:clave@host:puerto
socks5://usuario:clave@host:puerto
```

### DataImpulse — IP fija por número (dos mecanismos)

Datos base: host `gw.dataimpulse.com`, puerto `823` (HTTP/HTTPS) o `824` (SOCKS5).
Los parámetros van **dentro del usuario (login)**, añadidos con `__`, en formato
`clave.valor` y separados por `;`. País España = sufijo `__cr.es`.

**A) `sessid` (session-id) — misma IP ~30 min.** Añade `;sessid.N` al login, con un
número distinto por cada teléfono. Dura ~30 min de media y, según la propia doc de
DataImpulse, **no sustituye al modo sticky**: si la IP residencial se cae, la cambian.
```
http://LOGIN__cr.es;sessid.1:PASSWORD@gw.dataimpulse.com:823   ← número 1
http://LOGIN__cr.es;sessid.2:PASSWORD@gw.dataimpulse.com:823   ← número 2
```

**B) "Pegajoso" (Sticky) por PUERTO — IP estable de larga duración.** En el panel de
DataImpulse activa el radio **"Pegajoso"**: el puerto cambia al rango **10000+**
(cada puerto = una sesión sticky más persistente) y aparece **"Session Interval"
(0-120 min)** que fija cuánto se mantiene la IP antes de rotar — **0 = máxima
persistencia**.

**Recomendación para WhatsApp** (necesita IP fija estable **de larga duración** por
número): usa el **modo Pegajoso con Session Interval = 0**, y además un `sessid`
distinto por número para diferenciarlos. El `sessid.N` solo (mecanismo A, ~30 min)
es demasiado volátil para un número que debe conservar su IP semanas.

**Cómo meter una IP:**
1. En el proveedor, crea un endpoint sticky/móvil en España y copia la cadena.
2. Plataforma → **Ajustes → Leads** → **🛡 Proxy / IP de salida por número**:
   - 1 número → **Proxy global por defecto**.
   - Varios → campo **proxy** de cada número (uno distinto por número; tiene
     prioridad sobre el global).
3. **Guardar**.
4. **Reconecta el número**: 📷 Conectar → **reescanea el QR** con el móvil de esa
   SIM. La sesión solo empieza a salir por el proxy al (re)crearse.
5. Verifica tráfico por esa IP en el proveedor y que la salud del número esté verde.

## Checklist para arrancar un número nuevo sin quemarlo

1. SIM nueva y **dedicada** (nunca un número personal).
2. Crea el WhatsApp con **perfil Business**: foto, nombre de negocio, descripción.
3. Contrata **1 proxy residencial/móvil (España)** para ese número.
4. Config del proxy en Ajustes → **reconecta el QR**.
5. Deja el **warm-up activo** (arranca en 3/día, sube en 45 días). No lo desactives.
6. Unos días de **uso humano real** antes de captar en frío (recibir alguna
   respuesta real ayuda mucho).
7. Lista **bien segmentada**. Opener conversacional, **sin enlaces**, con
   variaciones (no el mismo texto exacto).

## Qué hace la plataforma por ti (ya implementado)

- **Proxy por número** (global + por canal) → `Ajustes → Leads`.
- **Warm-up por teléfono**: rampa desde 3/día durante 45 días, **por número**
  (cada uno desde su fecha de alta; el principal re-calienta al reconectar tras
  un baneo).
- **Defaults conservadores**: tope diario 60, ≤10 conversaciones nuevas/día y
  ≤40% del volumen diario en chats nuevos, cap por hora, cool-down por
  destinatario, ventana horaria, jitter diario.
- **Salud por número + auto-cuarentena**: un número con muchos fallos se aparta
  solo del reparto (`healthy | degraded | quarantined`).
- **Bloqueo de enlaces en el primer mensaje** (`blockLinksInFirstMessage`, ON por
  defecto): el primer mensaje a un número que lleve un link queda como
  `blocked_link` (no se envía ni cuenta como fallo). Quita el link del opener y
  mándalo tras la primera respuesta del lead.
- **Guarda por tasa de respuesta** (`replyRateGuardEnabled`, **OFF por defecto,
  opt-in**): si un número manda mucho (≥40 en 7 días) y no recibe NINGUNA
  respuesta, se marca *degradado* y el reparto prioriza los demás (nunca se
  cuarentena por esto). Actívalo solo cuando confirmes que las respuestas
  entrantes se atribuyen bien a cada número (columna “respuestas” del panel de
  salud); si el webhook no atribuye `instanceName`, daría falsos positivos.
- **Modo recuperación automático**: ante un pico de fallos, endurece límites solo.

## Lo que la plataforma NO puede hacer por ti

- Poner los proxies (los contratas y configuras tú).
- Envejecer/humanizar los números.
- Mejorar la calidad de la lista (los reportes son el mayor castigo).
- Evitar el baneo de un número **ya marcado**: si un número salió de un baneo,
  tenerlo vinculado a un cliente no oficial (WAHA/Evolution) lo re-banea casi con
  cualquier actividad. **Los números quemados, jubílalos** y desvincúlalos desde
  el móvil (WhatsApp → Dispositivos vinculados → cerrar sesión).

## Alternativa ban-proof (si algún día se prioriza volumen estable)

Anuncios **click-to-WhatsApp** → el lead te escribe él → respondes por la **API
oficial** dentro de la ventana de 24h. El contacto es entrante = sin este vector
de baneo. No permite spam en frío, pero es lo único estable a largo plazo.
