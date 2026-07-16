/**
 * GET /api/v1/admin/infrastructure
 *
 * Inventario de TODA la infraestructura externa del proyecto + estado
 * de las credenciales que se pueden validar en vivo + info de backups.
 * Para que el admin tenga una sola pantalla con "dónde está todo" y un
 * runbook de recuperación si algo se rompe.
 *
 * El CÓDIGO se respalda en GitHub (cada push). La BD via /admin/backups
 * + Google Drive. Esta página documenta ambos y el resto de servicios.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { validateWorkspaceCredentials } from "@/lib/credentials/validate";
import { getCronsHealth } from "@/lib/cron-monitor";
import { getLeadChannels, getChannelsHealthMap } from "@/lib/leads/channels";
import { recentErrors } from "@/lib/monitoring/error-log";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "admin" }, async (_req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");

  const ws = await prisma.workspace.findUnique({
    where: { id: api.workspaceId },
    select: { settings: true }
  });
  const s = (ws?.settings as any) ?? {};

  // Estado en vivo de las integraciones validables (Meta/Make/OpenAI…)
  const validation = await validateWorkspaceCredentials({ workspaceId: api.workspaceId }).catch(
    () => ({ valid: [], invalid: [], checked: [] as string[] })
  );
  const liveStatus: Record<string, "ok" | "fail"> = {};
  for (const v of validation.valid) liveStatus[v.integration] = "ok";
  for (const i of validation.invalid) liveStatus[i.integration] = "fail";

  // Último backup de BD
  const lastBackup = await prisma.backupRun
    .findFirst({
      where: { workspaceId: api.workspaceId } as any,
      orderBy: { startedAt: "desc" },
      select: { startedAt: true, sizeBytes: true } as any
    })
    .catch(() => null);

  // Helper: ¿hay credencial guardada para X?
  const has = (path: () => any) => {
    try {
      return !!path();
    } catch {
      return false;
    }
  };

  const githubRepo = process.env.GITHUB_SELF_HEAL_REPO ?? "tunegociovivo-bit/claude";

  const platforms = [
    {
      key: "github",
      name: "GitHub",
      role: "Código fuente — backup automático en cada push. Fuente de verdad para recuperar TODO el proyecto.",
      configured: !!(s.integrations?.selfHeal?.patEnc || process.env.GITHUB_SELF_HEAL_TOKEN),
      dashboard: `https://github.com/${githubRepo}`,
      credentialAt: "Workspace.settings.integrations.selfHeal.patEnc o env GITHUB_SELF_HEAL_TOKEN",
      recovery: `Todo el código vive en github.com/${githubRepo}. Para recuperar: clona el repo, despliega en Railway (o cualquier host Node), configura las env vars y conecta la BD. La rama de desarrollo es claude/internal-project-platform-*.`
    },
    {
      key: "railway",
      name: "Railway",
      role: "Hosting + base de datos Postgres. Despliega automáticamente desde GitHub.",
      configured: true,
      dashboard: "https://railway.app/dashboard",
      credentialAt: "Variables de entorno en el panel de Railway (DATABASE_URL, ANTHROPIC_API_KEY, etc.)",
      recovery: "Si Railway cae: el código está en GitHub y la BD tiene backups en /admin/backups + Google Drive. Crear nuevo proyecto Railway, conectar el repo, restaurar env vars + dump de BD."
    },
    {
      key: "database",
      name: "PostgreSQL (Railway)",
      role: "Base de datos principal. Backups automáticos a R2 + Google Drive.",
      configured: !!process.env.DATABASE_URL,
      dashboard: "/admin/backups",
      internal: true,
      credentialAt: "env DATABASE_URL",
      recovery: "Restaurar desde el último dump JSON en /admin/backups o Google Drive. Los backups corren a diario via cron."
    },
    {
      key: "r2",
      name: "Cloudflare R2 (storage)",
      role: "Almacenamiento de archivos: imágenes/vídeos generados, adjuntos, backups.",
      configured: !!process.env.STORAGE_ENDPOINT,
      dashboard: "https://dash.cloudflare.com",
      credentialAt: "env STORAGE_ENDPOINT / STORAGE_BUCKET / STORAGE_ACCESS_KEY / STORAGE_SECRET",
      recovery: "Bucket independiente. Si se pierde, los archivos generados se pueden regenerar; los adjuntos se re-importan de Asana."
    },
    {
      key: "anthropic",
      name: "Anthropic (Claude)",
      role: "Cerebro de Sonia + el chat asistente. Modelo Opus/Haiku.",
      configured: has(() => s.ai?.anthropicApiKey) || !!process.env.ANTHROPIC_API_KEY,
      live: liveStatus.anthropic,
      dashboard: "https://console.anthropic.com",
      credentialAt: "Workspace.settings.ai.anthropicApiKey o env ANTHROPIC_API_KEY"
    },
    {
      key: "openai",
      name: "OpenAI",
      role: "Imágenes (gpt-image), embeddings (memoria/búsqueda semántica), Whisper (voz a texto).",
      configured: has(() => s.ai?.openaiApiKey),
      live: liveStatus.openai,
      dashboard: "https://platform.openai.com/api-keys",
      credentialAt: "Workspace.settings.ai.openaiApiKey"
    },
    {
      key: "meta_ads",
      name: "Meta Ads",
      role: "Campañas Facebook/Instagram Lead Ads. Token System User (no caduca).",
      configured: has(() => s.adhocCredentials?.META_ADS_TOKEN),
      live: liveStatus.meta_ads,
      dashboard: "https://business.facebook.com/settings/system-users",
      credentialAt: "Workspace.settings.adhocCredentials.META_ADS_TOKEN (pegando el token en una task)"
    },
    {
      key: "make",
      name: "Make.com",
      role: "Automatizaciones (duplicar escenarios de leads por email).",
      configured: has(() => s.integrations?.make?.apiTokenEnc),
      live: liveStatus.make,
      dashboard: "/admin/make-settings",
      internal: true,
      credentialAt: "Workspace.settings.integrations.make.apiTokenEnc"
    },
    {
      key: "fal",
      name: "fal.ai",
      role: "Generación de vídeos del calendario editorial (Veo/Kling).",
      configured: has(() => s.integrations?.fal?.apiKeyEnc) || !!process.env.FAL_KEY,
      dashboard: "https://fal.ai/dashboard/keys",
      credentialAt: "Workspace.settings.integrations.fal.apiKeyEnc"
    },
    {
      key: "elevenlabs",
      name: "ElevenLabs",
      role: "Voz de Sonia (notificaciones habladas).",
      configured: has(() => s.ai?.elevenlabsApiKey),
      live: liveStatus.elevenlabs,
      dashboard: "https://elevenlabs.io/app/settings/api-keys",
      credentialAt: "Workspace.settings.ai.elevenlabsApiKey"
    },
    {
      key: "holded",
      name: "Holded",
      role: "Facturación y contabilidad (Sonia consulta facturas/morosos).",
      configured: has(() => s.integrations?.holded?.apiKeyEnc),
      live: liveStatus.holded,
      dashboard: "https://app.holded.com",
      credentialAt: "Workspace.settings.integrations.holded.apiKeyEnc"
    },
    {
      key: "google_places",
      name: "Google Places API",
      role: "Captación de leads: búsquedas Places (New) por keyword + provincia.",
      configured:
        has(() => s.leads?.googleApiKey) ||
        has(() => s.integrations?.googlePlaces?.apiKeyEnc) ||
        !!process.env.GOOGLE_PLACES_API_KEY,
      dashboard: "https://console.cloud.google.com/apis/credentials",
      credentialAt: "Workspace.settings.leads.googleApiKey (cifrada) — o /admin/leads → Ajustes",
      recovery:
        "Si Google revoca o se borra la key: crea otra en Google Cloud → APIs y servicios → Credenciales, " +
        "habilita 'Places API (New)' en APIs y servicios → Biblioteca, y pégala en /admin/leads → Ajustes."
    },
    {
      key: "waha",
      name: "WAHA (WhatsApp)",
      role: "Envío de WhatsApp a leads + alertas de Sonia.",
      configured: has(() => s.leads?.wahaUrl) || !!process.env.WAHA_URL,
      dashboard: "/admin/leads",
      internal: true,
      credentialAt: "Workspace.settings.leads.wahaUrl + wahaApiKey"
    },
    {
      key: "telegram",
      name: "Telegram (bot alertas)",
      role: "Alertas de Sonia fuera del Hub (más simple que WhatsApp).",
      configured: has(() => s.integrations?.telegram?.botToken),
      dashboard: "/admin/sonia-alerts",
      internal: true,
      credentialAt: "Workspace.settings.integrations.telegram.botToken"
    },
    {
      key: "google",
      name: "Google (Calendar + Drive)",
      role: "Sincronización de calendario + backup de la BD en Drive.",
      configured: has(() => s.integrations?.googleDrive),
      dashboard: "/admin/backups",
      internal: true,
      credentialAt: "Conexiones OAuth + service account en Workspace.settings"
    },
    {
      key: "asana",
      name: "Asana",
      role: "Origen de la migración de proyectos/tareas (modo convivencia).",
      configured: true,
      dashboard: "/admin/asana",
      internal: true,
      credentialAt: "AsanaConnection (token por usuario, cifrado)"
    }
  ];

  // Salud de los crons (global): detecta los que llevan "mudos" más de lo
  // esperado. Es lo que habría avisado del CRON_SECRET desparejado.
  const crons = await getCronsHealth().catch(() => []);

  // Salud de los números de WhatsApp de este workspace (multi-número).
  let whatsapp: { name: string; label: string | null; status: string }[] = [];
  try {
    const channels = await getLeadChannels(api.workspaceId);
    const map = await getChannelsHealthMap(api.workspaceId, channels);
    whatsapp = channels.map((c) => ({ name: c.name, label: c.label ?? null, status: map.get(c.name) ?? "healthy" }));
  } catch {
    whatsapp = [];
  }

  // Estado de los proxies configurados (del barrido periódico / botón Probar).
  const proxies = Object.entries((s.leads?.proxyStatus ?? {}) as Record<string, any>).map(
    ([key, v]) => ({
      key: key === "__global__" ? "global" : key,
      ok: !!v?.ok,
      exitIp: v?.exitIp ?? null,
      error: v?.error ?? null,
      checkedAt: v?.checkedAt ?? null
    })
  );

  // Foto de la cola de envío de WhatsApp (hoy, día natural UTC — aproximación).
  const dayStartUtc = new Date();
  dayStartUtc.setUTCHours(0, 0, 0, 0);
  const [queued, sentToday, failedToday, blockedLink] = await Promise.all([
    prisma.leadMessage.count({ where: { workspaceId: api.workspaceId, status: "queued" } }),
    prisma.leadMessage.count({
      where: {
        workspaceId: api.workspaceId,
        status: { in: ["sent", "delivered", "read"] },
        sentAt: { gte: dayStartUtc }
      }
    }),
    prisma.leadMessage.count({
      where: { workspaceId: api.workspaceId, status: "failed", createdAt: { gte: dayStartUtc } }
    }),
    prisma.leadMessage.count({ where: { workspaceId: api.workspaceId, status: "blocked_link" } })
  ]).catch(() => [0, 0, 0, 0]);

  return NextResponse.json({
    platforms,
    crons,
    whatsapp,
    proxies,
    sendQueue: { queued, sentToday, failedToday, blockedLink },
    recentErrors: recentErrors(50, api.workspaceId),
    codeBackup: {
      provider: "GitHub",
      repo: githubRepo,
      url: `https://github.com/${githubRepo}`,
      note: "Todo el código se respalda automáticamente en GitHub en cada push. Es la fuente de verdad para recuperar el proyecto entero."
    },
    dbBackup: {
      lastAt: (lastBackup as any)?.startedAt ?? null,
      sizeBytes: (lastBackup as any)?.sizeBytes ?? null,
      manageUrl: "/admin/backups"
    }
  });
});
