# Agente bancario LOCAL — Negocio Vivo

Agente **local** (Windows + Chrome) que prepara remesas de adeudos SEPA en
**Santander Empresas** reutilizando la remesa recurrente anterior y las deja
**PENDIENTES DE FIRMA**. Se conecta al HUB por HTTPS para recibir trabajos.

## Reglas de oro (no negociables)

- ❌ **Nunca firma, confirma en firme ni ejecuta un cobro** (tampoco en pruebas).
- ❌ **Nunca lee, guarda ni transmite** usuario, contraseña, cookies, OTP o
  secretos del banco. **Tú** inicias sesión y firmas.
- ⏸️ Ante **login / OTP / CAPTCHA / cambio de interfaz / ambigüedad /
  discrepancia** de importe-cliente-IBAN → **pausa** y pide intervención
  (estado `NEEDS_USER` en el HUB).
- 🔒 Solo opera en el **dominio oficial** configurado (allowlist estricta).
- ✅ Antes de cerrar OK, **verifica visualmente** el estado "pendiente de firma".
- 🧾 Logs locales **saneados** (sin datos sensibles).

## Arquitectura

```
HUB (Next.js)  ──HTTPS──▶  Agente local  ──CDP──▶  TU Chrome visible ──▶ Santander
  (cola de           (heartbeat/claim/         (tu sesión;         (portal oficial)
   trabajos)          progress/complete)        tú firmas)
```

- `src/hub-client.ts` — cliente HTTPS del HUB (Bearer token del agente).
- `src/runner.ts` — bucle: heartbeat + claim + conduce el adaptador + reporta.
- `src/santander/` — **adaptador separado de la lógica de negocio**:
  - `types.ts` — máquina de estados + barrera anti-firma.
  - `selectors.ts` — carga selectores **externos** (nunca embebidos).
  - `mock.ts` — adaptador de pruebas/dry-run (inyecta anomalías).
  - `live.ts` — conduce tu Chrome real (pausa ante cualquier riesgo).
  - `record.ts` — **grabación guiada** para mapear el portal contigo.

## Instalación (Windows)

```powershell
# 1) Instalar dependencias + navegador de Playwright + .env
powershell -ExecutionPolicy Bypass -File install\install-windows.ps1
#    (añade -AutoStart para crear la tarea de auto-arranque al iniciar sesión)

# 2) Editar .env: HUB_URL y AGENT_TOKEN (token que te da el HUB al enrolar).
#    El agente se enrola en:  HUB → Facturación → Remesas → Agente bancario → "Enrolar agente".
#    El token se muestra UNA sola vez.

# 3) Comprobar configuración y conexión (sin operar):
npm run doctor
```

## Mapeo del portal (una vez, sesión real supervisada)

Los selectores del portal **no vienen incluidos** (no se inventan). Se mapean
contigo delante:

```powershell
# Abre tu Chrome con depuración remota e inicia sesión TÚ en Santander:
powershell -ExecutionPolicy Bypass -File install\start-chrome.ps1

# En otra terminal, lanza la grabación guiada y ve haciendo clic donde te pida:
npm run record
# → genera selectors.json (revísalo). Ejemplo ilustrativo en fixtures/selectors.example.json
```

## Ejecución

```powershell
# Pruebas sin tocar el banco (recomendado primero): SANTANDER_MODE=mock
npm run dev

# Operación real (cuando el portal esté mapeado y validado): SANTANDER_MODE=live
#   - Requiere tu Chrome abierto (start-chrome.ps1) y tu sesión iniciada.
#   - El HUB debe tener el kill switch ENCENDIDO para que se entreguen trabajos.
npm start        # tras 'npm run build', o 'npm run dev' con tsx
```

## Kill switch

El HUB controla si se entregan trabajos (Facturación → Remesas → Agente
bancario). **Por defecto está apagado**: con el switch en OFF, `claim` no
devuelve trabajos aunque el agente esté online. Es el freno de mano.

## Actualización segura

- El agente vive en el repositorio (versionado). Para actualizar:
  `git pull` en la carpeta → `npm ci` → `npm run build`.
- El agente envía su `version` en cada heartbeat; el HUB la muestra para saber
  qué versión corre cada máquina.
- No hay auto-actualización remota que ejecute código sin tu control: la
  actualización es un paso explícito tuyo (evita ejecución de código no revisado).

## Solución de problemas

| Síntoma | Causa probable | Acción |
|---|---|---|
| `Heartbeat RECHAZADO` | Token revocado o incorrecto | Revoca y enrola de nuevo en el HUB; pon el nuevo `AGENT_TOKEN`. |
| `claim` no da trabajos | Kill switch OFF o no hay trabajos | Enciende el switch en el HUB; aprueba una solicitud. |
| Pausa "No hay sesión" | No has iniciado sesión en Santander | Inicia sesión tú en el Chrome con depuración. |
| Pausa "cambio de interfaz" | Selector no encontrado | Re-mapea con `npm run record`. |
| Pausa "discrepancia" | Importe/cliente no coinciden | Revisa el trabajo; corrige en origen. **No** fuerces. |

## Qué NO hace este agente

No firma, no confirma envíos, no autoriza, no paga, no sube ficheros
automáticamente, no guarda credenciales, no opera fuera del dominio oficial y
no continúa ante nada dudoso: **pausa y te avisa**.
