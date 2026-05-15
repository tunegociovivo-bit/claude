/**
 * Importa configuración y datos desde un WordPress que tenga instalado
 * el plugin "Agencia Hub Exporter" (scripts/wp-exporter/agencia-exporter.php).
 *
 * Flow:
 *  1. El cliente envía { wpUrl, wpUser, appPassword, sections[] }.
 *  2. El servidor hace GET a {wpUrl}/wp-json/agencia-export/v1/dump con
 *     Basic Auth (wpUser:appPassword) y descarga el JSON completo.
 *  3. Normaliza cada sección y la persiste:
 *       - API keys → workspace.settings.ai.{anthropicApiKey,openaiApiKey}
 *                  + workspace.settings.googlePlaces, evolution, metricool, drive
 *                  (todas cifradas con AES-256-GCM al estilo del módulo AI).
 *       - generador_resenas.clientes → ReviewClient rows (upsert por slug).
 *       - voice_reviews.businesses → VoiceBusiness rows (upsert por slug).
 *       - nv_dashboard.publications → guardadas raw en workspace.settings.pendingImport.nvDashboard
 *         (no hay schema todavía, se procesará en su migración).
 *       - nv_leads_pro.tables → guardadas raw en workspace.settings.pendingImport.nvLeads.
 *
 *  4. Devuelve un reporte: { keys: N, reviews: N, voice: N, pendingMb: N }.
 *
 * Solo accesible a ADMIN del workspace.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { encryptSecret } from "@/lib/ai/crypto";

const inputSchema = z.object({
  wpUrl: z.string().url(),
  wpUser: z.string().min(1),
  appPassword: z.string().min(8),
  sections: z.array(z.enum(["generador_resenas", "voice_reviews", "nv_dashboard", "nv_leads_pro"])).optional(),
  dryRun: z.boolean().default(false)
});

async function requireAdmin(workspaceId: string, userId: string | undefined) {
  if (!userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const me = await prisma.membership.findFirst({ where: { workspaceId, userId } });
  if (!me || me.role !== "ADMIN") throw new ApiError(403, "forbidden", "Solo admins del workspace");
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

async function callWpDump(wpUrl: string, wpUser: string, appPassword: string, sections?: string[]) {
  const auth = Buffer.from(`${wpUser}:${appPassword.replace(/\s+/g, "")}`).toString("base64");
  const base = wpUrl.replace(/\/+$/, "");
  const qs = sections && sections.length ? `?include=${encodeURIComponent(sections.join(","))}` : "";
  const url = `${base}/wp-json/agencia-export/v1/dump${qs}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    cache: "no-store"
  });
  if (!resp.ok) {
    let body = "";
    try { body = await resp.text(); } catch {}
    throw new ApiError(resp.status, "wp_fetch_error", `WP devolvió ${resp.status}. ¿Está activo el plugin Agencia Hub Exporter? ¿Es el App Password correcto? ${body.slice(0, 300)}`);
  }
  return await resp.json();
}

async function callWpPing(wpUrl: string, wpUser: string, appPassword: string) {
  const auth = Buffer.from(`${wpUser}:${appPassword.replace(/\s+/g, "")}`).toString("base64");
  const base = wpUrl.replace(/\/+$/, "");
  const resp = await fetch(`${base}/wp-json/agencia-export/v1/ping`, {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    cache: "no-store"
  });
  if (!resp.ok) {
    let body = "";
    try { body = await resp.text(); } catch {}
    throw new ApiError(resp.status, "wp_ping_error", `No se pudo contactar con el plugin. HTTP ${resp.status}. ${body.slice(0, 300)}`);
  }
  return await resp.json();
}

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  await requireAdmin(api.workspaceId, api.userId);

  const body = await req.json().catch(() => null);
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const { wpUrl, wpUser, appPassword, sections, dryRun } = parsed.data;

  // 1. Ping primero — falla rápido si la auth es mala
  const ping = await callWpPing(wpUrl, wpUser, appPassword);

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      wp: ping
    });
  }

  // 2. Dump real
  const dump = await callWpDump(wpUrl, wpUser, appPassword, sections);

  const report: Record<string, any> = {
    site: dump.site,
    exportedAt: dump.exported_at,
    keysImported: 0,
    reviewClients: 0,
    voiceBusinesses: 0,
    pendingNvDashboard: 0,
    pendingNvLeads: 0,
    errors: [] as string[]
  };

  // Cargamos settings actuales del workspace
  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const settings = ((ws?.settings as any) ?? {}) as any;
  settings.ai ??= {};
  settings.integrations ??= {};

  // ── 3a. Generador de Reseñas IA ────────────────────────────────────
  const gr = dump.generador_resenas;
  if (gr) {
    if (gr.api_key && typeof gr.api_key === "string" && gr.api_key.startsWith("sk-")) {
      settings.ai.openaiApiKey = encryptSecret(gr.api_key);
      report.keysImported++;
    }
    const clientes = gr.clientes && typeof gr.clientes === "object" ? gr.clientes : {};
    const history = gr.history && typeof gr.history === "object" ? gr.history : {};
    for (const [slug, raw] of Object.entries<any>(clientes)) {
      if (!raw || typeof raw !== "object") continue;
      const data = {
        workspaceId: api.workspaceId,
        slug: slugify(String(slug)),
        name: String(raw.nombre ?? slug),
        webUrl: raw.url_web ? String(raw.url_web) : null,
        destinationUrl: String(raw.url_destino ?? ""),
        topics: String(raw.temas ?? "Experiencia general"),
        bannedWords: raw.palabras_prohibidas ? String(raw.palabras_prohibidas) : null,
        recommendedWords: raw.palabras_recomendadas ? String(raw.palabras_recomendadas) : null,
        extraInstructions: raw.instrucciones_extra ? String(raw.instrucciones_extra) : null,
        model: ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo"].includes(raw.modelo) ? raw.modelo : "gpt-4o-mini"
      };
      if (!data.destinationUrl) continue;
      const result = await prisma.reviewClient.upsert({
        where: { workspaceId_slug: { workspaceId: api.workspaceId, slug: data.slug } },
        create: data,
        update: data
      });
      const items = history[slug];
      if (Array.isArray(items) && items.length > 0) {
        // Solo importamos historial si está vacío en destino
        const existing = await prisma.reviewHistory.count({ where: { clientId: result.id } });
        if (existing === 0) {
          await prisma.reviewHistory.createMany({
            data: items.map((body: any) => ({ clientId: result.id, body: String(body) }))
          });
        }
      }
      report.reviewClients++;
    }
  }

  // ── 3b. Voice Reviews ──────────────────────────────────────────────
  const vr = dump.voice_reviews;
  if (vr) {
    const s = (vr.settings ?? {}) as any;
    const env = (vr.env ?? {}) as any;
    const openaiKey = s.openai_key ?? env.openai;
    const anthropicKey = s.anthropic_key ?? env.anthropic;
    if (openaiKey && String(openaiKey).startsWith("sk-")) {
      if (!settings.ai.openaiApiKey) {
        settings.ai.openaiApiKey = encryptSecret(String(openaiKey));
        report.keysImported++;
      }
    }
    if (anthropicKey && String(anthropicKey).startsWith("sk-ant-")) {
      if (!settings.ai.anthropicApiKey) {
        settings.ai.anthropicApiKey = encryptSecret(String(anthropicKey));
        report.keysImported++;
      }
    }
    const businesses = Array.isArray(vr.businesses) ? vr.businesses : [];
    for (const b of businesses) {
      if (!b.slug || !b.name) continue;
      const slug = slugify(String(b.slug));
      const data: any = {
        workspaceId: api.workspaceId,
        slug,
        name: String(b.name_meta || b.name),
        location: b.location ? String(b.location) : null,
        googleUrl: b.google_url ? String(b.google_url) : null,
        trustpilotUrl: b.trustpilot_url ? String(b.trustpilot_url) : null,
        introText: b.intro_text ? String(b.intro_text) : null,
        disclaimer: b.disclaimer ? String(b.disclaimer) : null,
        customPrompt: b.custom_prompt ? String(b.custom_prompt) : null,
        maxSeconds: Math.max(5, Math.min(120, Number(b.max_seconds) || 30)),
        aiProvider: "anthropic"
      };
      await prisma.voiceBusiness.upsert({
        where: { workspaceId_slug: { workspaceId: api.workspaceId, slug } },
        create: data,
        update: data
      });
      report.voiceBusinesses++;
    }
  }

  // ── 3c. NV Dashboard (sin schema todavía: parking en settings) ────
  const nvd = dump.nv_dashboard;
  if (nvd) {
    const o = (nvd.options ?? {}) as any;
    if (o.anthropic_api_key && o.anthropic_api_key.startsWith("sk-ant-") && !settings.ai.anthropicApiKey) {
      settings.ai.anthropicApiKey = encryptSecret(String(o.anthropic_api_key));
      report.keysImported++;
    }
    if (o.openai_api_key && o.openai_api_key.startsWith("sk-") && !settings.ai.openaiApiKey) {
      settings.ai.openaiApiKey = encryptSecret(String(o.openai_api_key));
      report.keysImported++;
    }
    // Estos no son keys de IA pero los guardamos cifrados también
    settings.integrations.metricool ??= {};
    if (o.metricool_brand) settings.integrations.metricool.brand = String(o.metricool_brand);
    if (o.metricool_token) {
      settings.integrations.metricool.tokenEnc = encryptSecret(String(o.metricool_token));
      report.keysImported++;
    }
    if (o.metricool_blog_id) settings.integrations.metricool.blogId = String(o.metricool_blog_id);
    settings.integrations.drive ??= {};
    if (o.refs_drive_folders) settings.integrations.drive.folderRefs = o.refs_drive_folders;

    // Aparcamos publicaciones y taxonomía para procesar cuando exista schema NV Dashboard
    settings.pendingImport ??= {};
    settings.pendingImport.nvDashboard = {
      publications: nvd.publications ?? [],
      clientesTaxonomy: nvd.clientes_taxonomy ?? [],
      clienteConfigs: nvd.cliente_configs ?? {},
      importedAt: new Date().toISOString()
    };
    report.pendingNvDashboard = Array.isArray(nvd.publications) ? nvd.publications.length : 0;
  }

  // ── 3d. NV Leads Pro (sin schema todavía: parking en settings) ────
  const nvl = dump.nv_leads_pro;
  if (nvl) {
    const o = (nvl.options ?? {}) as any;
    settings.integrations.googlePlaces ??= {};
    if (o.google_api_key) {
      settings.integrations.googlePlaces.apiKeyEnc = encryptSecret(String(o.google_api_key));
      report.keysImported++;
    }
    settings.integrations.evolution ??= {};
    if (o.evolution_api_url) settings.integrations.evolution.url = String(o.evolution_api_url);
    if (o.evolution_api_key) {
      settings.integrations.evolution.apiKeyEnc = encryptSecret(String(o.evolution_api_key));
      report.keysImported++;
    }

    settings.pendingImport ??= {};
    settings.pendingImport.nvLeads = {
      tables: nvl.tables ?? {},
      importedAt: new Date().toISOString()
    };
    const rowsCount = Object.values(nvl.tables ?? {}).reduce(
      (acc: number, arr: any) => acc + (Array.isArray(arr) ? arr.length : 0),
      0
    );
    report.pendingNvLeads = rowsCount;
  }

  // Persistir settings actualizados
  await prisma.workspace.update({
    where: { id: api.workspaceId },
    data: { settings }
  });

  return NextResponse.json({ ok: true, report });
});
