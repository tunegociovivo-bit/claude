# CRM Ventas — con recepcionista IA (SONIA)

CRM white-label para vender a cualquier negocio. Derivado de la plataforma
Hub.Negociovivo, empaquetado como producto independiente y multi-cliente.

## Módulos (v1)

| Módulo | Qué hace |
|---|---|
| **SONIA · Llamadas** | Recibe las llamadas del negocio (Vapi inbound), da información y **agenda citas en directo** durante la llamada. El prompt de cada cliente vive en el CRM, no en Vapi. Guarda transcripción, resumen y grabación. |
| **SONIA · WhatsApp** | Recibe y envía WhatsApp (WAHA). Responde automáticamente con IA (Claude), da información del negocio y agenda citas. Bandeja de conversaciones con respuesta manual. |
| **Pipeline** | Kanban de contactos con drag & drop. Columnas: Nuevos → En conversación → **Citas** → Cerrados. Cuando SONIA agenda una cita, el contacto pasa automáticamente a «Citas». |
| **Calendario** | Vista mensual con todas las citas (de llamadas, de WhatsApp y manuales). Crear y cancelar citas. |
| **Llamadas** | Registro de llamadas atendidas por SONIA con transcripción y resumen. |
| **Ajustes** | Configuración por cliente: información del negocio, prompt específico, horario, voz, Vapi y WAHA. Genera las URLs de webhook a pegar en Vapi y WAHA. |

## Stack

Next.js 14 (App Router) · TypeScript · Prisma + PostgreSQL · NextAuth ·
Tailwind · `@anthropic-ai/sdk` (agente de WhatsApp) · Vapi (voz) · WAHA (WhatsApp).

Multi-tenant por `Workspace`: una instancia puede alojar varios clientes, cada
uno con su teléfono, su WhatsApp y su prompt.

## Puesta en marcha

```bash
cd crm-ventas
cp .env.example .env   # rellena DATABASE_URL, secretos y ANTHROPIC_API_KEY

npm install
npx prisma db push     # crea las tablas
npm run db:seed        # crea workspace + usuario admin (ver .env)
npm run dev            # http://localhost:3000
```

Login inicial: `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (por defecto
`admin@crm.local` / `admin1234`).

## Alta de un cliente nuevo

1. **Workspace**: crea workspace + usuario (hoy: ejecutando el seed con otras
   variables, o insertando en BD; UI de alta pendiente de la siguiente fase).
2. **Ajustes → Negocio y prompt**: nombre, información del negocio (servicios,
   precios, dirección…), horario e instrucciones específicas. Esto ES el prompt
   de SONIA para ese cliente.
3. **Teléfono (Vapi)**:
   - Compra/importa un número en Vapi para el cliente.
   - En el número (Inbound), deja el asistente vacío y pega como **Server URL**
     la URL que muestra Ajustes → Llamadas.
   - Al recibir una llamada, Vapi pide el asistente al CRM
     (`assistant-request`) y el CRM lo construye con el prompt del cliente y
     las herramientas de agendado (`tool-calls` vuelven al CRM, que crea la
     cita). Al colgar, `end-of-call-report` guarda transcripción y resumen.
4. **WhatsApp (WAHA)**:
   - Levanta una sesión WAHA para el número del cliente y guarda URL/API
     key/sesión en Ajustes → WhatsApp.
   - Configura en WAHA el webhook que muestra Ajustes, con eventos `message`,
     `message.any` y `message.ack`.
5. Llama y escribe al número para probar: las citas aparecerán en la columna
   **Citas** del pipeline y en el **Calendario**.

## Detalles de implementación heredados de Hub.Negociovivo

- **WAHA**: un `sendText` con HTTP 200 pero sin id de mensaje se trata como
  fallo (el motor NOWEB responde 200 con la sesión caída). Los acks se
  identifican por el nombre del evento, no por el campo `ack`. Con
  identificadores `@lid` se responde siempre al chatId original.
- **Citas**: `agendar_cita` comprueba solapes antes de confirmar; si el hueco
  está ocupado, la herramienta devuelve un error explícito con la instrucción
  de NO confirmar la cita al cliente (anti-alucinación).
- **Secretos**: las API keys guardadas en BD van cifradas con AES-256-GCM y una
  clave dedicada (`ENCRYPTION_KEY`), separada del secreto de sesión.
- **Webhooks multi-tenant**: cada workspace tiene tokens aleatorios propios
  para Vapi y WAHA; la búsqueda del token se hace con filtro JSON en SQL (sin
  escanear todos los workspaces en memoria).

## Variables de entorno

Ver `.env.example`. Resumen: `DATABASE_URL`, `NEXTAUTH_URL`,
`NEXTAUTH_SECRET`, `ENCRYPTION_KEY`, `PUBLIC_APP_URL`, `ANTHROPIC_API_KEY`,
`SONIA_MODEL` (opcional), `SEED_*`, `NV_OPERATOR_EMAILS` (operadores del panel
interno de teléfonos; vacío = nadie), `RESEND_API_KEY` + `PHONE_NOTIFY_TO`
(aviso operativo al guardar el teléfono; por defecto `info@negociovivo.com`).

## Ampliaciones previstas

- Alta de workspaces/clientes desde el propio CRM (panel de agencia).
- Recordatorios de cita por WhatsApp.
- Notas y ficha ampliada de contacto, etiquetas y filtros.
- Informes (nº llamadas, citas agendadas, conversión por canal).
