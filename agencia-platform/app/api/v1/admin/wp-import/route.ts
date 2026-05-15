/**
 * Importa configuración y datos desde un WordPress que tenga instalado
 * el plugin "Agencia Hub Exporter" (scripts/wp-exporter/agencia-exporter.php).
 *
 * Cada sección se importa en su propio try/catch y se reporta independiente,
 * así un error en una no aborta las demás. La salida incluye un campo
 * "errors" con qué falló y por qué.
 *
 * Solo accesible a ADMIN del workspace.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { encryptSecret, decryptSecret } from "@/lib/ai/crypto";

const inputSchema = z.object({
  // Si no se pasan, usa los guardados en
  // workspace.settings.integrations.wordpress.
  wpUrl: z.string().url().optional(),
  wpUser: z.string().min(1).optional(),
  appPassword: z.string().min(8).optional(),
  sections: z
    .array(z.enum(["generador_resenas", "voice_reviews", "nv_dashboard", "nv_leads_pro"]))
    .optional(),
  dryRun: z.boolean().default(false)
});

const MAX_PENDING_BYTES = 2 * 1024 * 1024; // tope ~2MB por sección "en cola"

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

function basicAuth(user: string, pass: string): string {
  return Buffer.from(`${user}:${pass.replace(/\s+/g, "")}`).toString("base64");
}

async function callWp(opts: {
  wpUrl: string;
  wpUser: string;
  appPassword: string;
  path: string;
}): Promise<any> {
  const base = opts.wpUrl.replace(/\/+$/, "");
  const url = `${base}${opts.path}`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Basic ${basicAuth(opts.wpUser, opts.appPassword)}`,
      Accept: "application/json"
    },
    cache: "no-store"
  });
  if (!resp.ok) {
    let body = "";
    try {
      body = await resp.text();
    } catch {}
    throw new Error(`WP ${resp.status} ${resp.statusText} en ${opts.path}: ${body.slice(0, 200)}`);
  }
  return await resp.json();
}

function safeSize(value: any): { json: any; bytes: number; truncated: boolean } {
  const json = value ?? null;
  const str = JSON.stringify(json);
  const bytes = Buffer.byteLength(str, "utf8");
  return { json, bytes, truncated: false };
}

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  await requireAdmin(api.workspaceId, api.userId);

  const body = await req.json().catch(() => null);
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  let { wpUrl, wpUser, appPassword } = parsed.data;
  const { sections, dryRun } = parsed.data;

  // Si no llegan en el body, leerlas de workspace.settings.integrations.wordpress
  if (!wpUrl || !wpUser || !appPassword) {
    const ws0 = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
    const saved: any = (ws0?.settings as any)?.integrations?.wordpress ?? {};
    if (!wpUrl && saved.url) wpUrl = saved.url;
    if (!wpUser && saved.user) wpUser = saved.user;
    if (!appPassword && saved.appPasswordEncrypted) {
      try {
        appPassword = decryptSecret(saved.appPasswordEncrypted) ?? undefined;
      } catch {}
    }
  }
  if (!wpUrl || !wpUser || !appPassword) {
    throw new ApiError(
      400,
      "missing_wp_credentials",
      "Faltan credenciales de WordPress. Configúralas en /admin/seguridad o pásalas en el body."
    );
  }
  const wpCreds = { wpUrl, wpUser, appPassword };

  // 1. Ping primero — falla rápido si la auth es mala
  let ping: any;
  try {
    ping = await callWp({ ...wpCreds, path: "/wp-json/agencia-export/v1/ping" });
  } catch (e: any) {
    throw new ApiError(502, "wp_unreachable", e.message ?? "No se pudo contactar con WP");
  }

  if (dryRun) {
    return NextResponse.json({ ok: true, dryRun: true, wp: ping });
  }

  const sectionsToRun = sections ?? ["generador_resenas", "voice_reviews", "nv_dashboard", "nv_leads_pro"];

  const report: Record<string, any> = {
    site: ping.wp_site,
    keysImported: 0,
    reviewClients: 0,
    voiceBusinesses: 0,
    pendingNvDashboard: 0,
    pendingNvLeads: 0,
    sections: {} as Record<string, { ok: boolean; message?: string; bytes?: number }>,
    errors: [] as string[]
  };

  // Cargamos settings actuales y los iremos mutando por sección.
  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const settings: any = ((ws?.settings as any) ?? {});
  settings.ai ??= {};
  settings.integrations ??= {};
  settings.pendingImport ??= {};

  // ──────────────────────────────────────────────────────────
  // 2a. Generador Reseñas
  if (sectionsToRun.includes("generador_resenas")) {
    try {
      const data = await callWp({ ...wpCreds, path: "/wp-json/agencia-export/v1/dump?include=generador_resenas" });
      const gr = data.generador_resenas;
      if (gr) {
        if (gr.api_key && typeof gr.api_key === "string" && gr.api_key.startsWith("sk-")) {
          settings.ai.openaiApiKey = encryptSecret(gr.api_key);
          report.keysImported++;
        }
        const clientes = gr.clientes && typeof gr.clientes === "object" ? gr.clientes : {};
        const history = gr.history && typeof gr.history === "object" ? gr.history : {};
        for (const [slug, raw] of Object.entries<any>(clientes)) {
          if (!raw || typeof raw !== "object") continue;
          const cleanSlug = slugify(String(slug));
          if (!cleanSlug) continue;
          const destinationUrl = String(raw.url_destino ?? "");
          if (!destinationUrl) continue;
          const cdata = {
            workspaceId: api.workspaceId,
            slug: cleanSlug,
            name: String(raw.nombre ?? slug).slice(0, 120),
            webUrl: raw.url_web ? String(raw.url_web).slice(0, 500) : null,
            destinationUrl: destinationUrl.slice(0, 500),
            topics: String(raw.temas ?? "Experiencia general"),
            bannedWords: raw.palabras_prohibidas ? String(raw.palabras_prohibidas) : null,
            recommendedWords: raw.palabras_recomendadas ? String(raw.palabras_recomendadas) : null,
            extraInstructions: raw.instrucciones_extra ? String(raw.instrucciones_extra) : null,
            model: ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo"].includes(raw.modelo) ? raw.modelo : "gpt-4o-mini"
          };
          const result = await prisma.reviewClient.upsert({
            where: { workspaceId_slug: { workspaceId: api.workspaceId, slug: cleanSlug } },
            create: cdata,
            update: cdata
          });
          const items = history[slug];
          if (Array.isArray(items) && items.length > 0) {
            const existing = await prisma.reviewHistory.count({ where: { clientId: result.id } });
            if (existing === 0) {
              await prisma.reviewHistory.createMany({
                data: items
                  .filter((i: any) => typeof i === "string" && i.trim())
                  .slice(0, 5)
                  .map((bodyText: any) => ({ clientId: result.id, body: String(bodyText) }))
              });
            }
          }
          report.reviewClients++;
        }
        report.sections.generador_resenas = { ok: true };
      } else {
        report.sections.generador_resenas = { ok: true, message: "Sin datos de Generador Reseñas en WP" };
      }
    } catch (e: any) {
      console.error("[wp-import] generador_resenas error:", e);
      report.sections.generador_resenas = { ok: false, message: e?.message ?? String(e) };
      report.errors.push(`generador_resenas: ${e?.message ?? e}`);
    }
  }

  // ──────────────────────────────────────────────────────────
  // 2b. Voice Reviews
  if (sectionsToRun.includes("voice_reviews")) {
    try {
      const data = await callWp({ ...wpCreds, path: "/wp-json/agencia-export/v1/dump?include=voice_reviews" });
      const vr = data.voice_reviews;
      if (vr) {
        const s = (vr.settings ?? {}) as any;
        const env = (vr.env ?? {}) as any;
        const openaiKey = s.openai_key ?? env.openai;
        const anthropicKey = s.anthropic_key ?? env.anthropic;
        if (openaiKey && String(openaiKey).startsWith("sk-") && !settings.ai.openaiApiKey) {
          settings.ai.openaiApiKey = encryptSecret(String(openaiKey));
          report.keysImported++;
        }
        if (anthropicKey && String(anthropicKey).startsWith("sk-ant-") && !settings.ai.anthropicApiKey) {
          settings.ai.anthropicApiKey = encryptSecret(String(anthropicKey));
          report.keysImported++;
        }
        const businesses = Array.isArray(vr.businesses) ? vr.businesses : [];
        for (const b of businesses) {
          if (!b || !b.slug || !b.name) continue;
          const cleanSlug = slugify(String(b.slug));
          if (!cleanSlug) continue;
          const bdata: any = {
            workspaceId: api.workspaceId,
            slug: cleanSlug,
            name: String(b.name_meta || b.name).slice(0, 120),
            location: b.location ? String(b.location).slice(0, 200) : null,
            googleUrl: b.google_url ? String(b.google_url).slice(0, 500) : null,
            trustpilotUrl: b.trustpilot_url ? String(b.trustpilot_url).slice(0, 500) : null,
            introText: b.intro_text ? String(b.intro_text) : null,
            disclaimer: b.disclaimer ? String(b.disclaimer) : null,
            customPrompt: b.custom_prompt ? String(b.custom_prompt) : null,
            maxSeconds: Math.max(5, Math.min(120, Number(b.max_seconds) || 30)),
            aiProvider: "anthropic"
          };
          await prisma.voiceBusiness.upsert({
            where: { workspaceId_slug: { workspaceId: api.workspaceId, slug: cleanSlug } },
            create: bdata,
            update: bdata
          });
          report.voiceBusinesses++;
        }
        report.sections.voice_reviews = { ok: true };
      } else {
        report.sections.voice_reviews = { ok: true, message: "Sin datos de Voice Reviews en WP" };
      }
    } catch (e: any) {
      console.error("[wp-import] voice_reviews error:", e);
      report.sections.voice_reviews = { ok: false, message: e?.message ?? String(e) };
      report.errors.push(`voice_reviews: ${e?.message ?? e}`);
    }
  }

  // ──────────────────────────────────────────────────────────
  // 2c. NV Dashboard (parking en settings + keys cifradas)
  if (sectionsToRun.includes("nv_dashboard")) {
    try {
      const data = await callWp({ ...wpCreds, path: "/wp-json/agencia-export/v1/dump?include=nv_dashboard" });
      const nvd = data.nv_dashboard;
      if (nvd) {
        const o = (nvd.options ?? {}) as any;
        if (o.anthropic_api_key && String(o.anthropic_api_key).startsWith("sk-ant-") && !settings.ai.anthropicApiKey) {
          settings.ai.anthropicApiKey = encryptSecret(String(o.anthropic_api_key));
          report.keysImported++;
        }
        if (o.openai_api_key && String(o.openai_api_key).startsWith("sk-") && !settings.ai.openaiApiKey) {
          settings.ai.openaiApiKey = encryptSecret(String(o.openai_api_key));
          report.keysImported++;
        }
        settings.integrations.metricool ??= {};
        if (o.metricool_brand) settings.integrations.metricool.brand = String(o.metricool_brand);
        if (o.metricool_token) {
          settings.integrations.metricool.tokenEnc = encryptSecret(String(o.metricool_token));
          report.keysImported++;
        }
        if (o.metricool_blog_id) settings.integrations.metricool.blogId = String(o.metricool_blog_id);
        settings.integrations.drive ??= {};
        if (o.refs_drive_folders) settings.integrations.drive.folderRefs = o.refs_drive_folders;

        // Tope de tamaño para no inflar el JSON de settings
        const pubs = Array.isArray(nvd.publications) ? nvd.publications : [];
        const clienteMeta = Array.isArray(nvd.cliente_meta) ? nvd.cliente_meta : [];
        const sized = safeSize({
          publications: pubs,
          clientesTaxonomy: nvd.clientes_taxonomy ?? [],
          clienteConfigs: nvd.cliente_configs ?? {},
          clienteMeta
        });
        if (sized.bytes > MAX_PENDING_BYTES) {
          // Recortamos publications hasta caber (cliente_meta se mantiene
          // siempre porque es pequeño y crítico)
          const trimmedPubs: any[] = [];
          let runningBytes = 1024 + JSON.stringify(clienteMeta).length;
          for (const p of pubs) {
            const piece = JSON.stringify(p);
            runningBytes += piece.length;
            if (runningBytes > MAX_PENDING_BYTES) break;
            trimmedPubs.push(p);
          }
          settings.pendingImport.nvDashboard = {
            publications: trimmedPubs,
            clientesTaxonomy: nvd.clientes_taxonomy ?? [],
            clienteConfigs: nvd.cliente_configs ?? {},
            clienteMeta,
            importedAt: new Date().toISOString(),
            truncated: true,
            originalCount: pubs.length,
            storedCount: trimmedPubs.length
          };
          report.pendingNvDashboard = trimmedPubs.length;
          report.sections.nv_dashboard = {
            ok: true,
            message: `Truncado: ${pubs.length} → ${trimmedPubs.length} publicaciones (tope 2 MB). cliente_meta: ${clienteMeta.length}`,
            bytes: MAX_PENDING_BYTES
          };
        } else {
          settings.pendingImport.nvDashboard = {
            publications: pubs,
            clientesTaxonomy: nvd.clientes_taxonomy ?? [],
            clienteConfigs: nvd.cliente_configs ?? {},
            clienteMeta,
            importedAt: new Date().toISOString()
          };
          report.pendingNvDashboard = pubs.length;
          report.sections.nv_dashboard = { ok: true, bytes: sized.bytes, clienteMetaCount: clienteMeta.length };
        }
      } else {
        report.sections.nv_dashboard = { ok: true, message: "Sin datos de NV Dashboard" };
      }
    } catch (e: any) {
      console.error("[wp-import] nv_dashboard error:", e);
      report.sections.nv_dashboard = { ok: false, message: e?.message ?? String(e) };
      report.errors.push(`nv_dashboard: ${e?.message ?? e}`);
    }
  }

  // ──────────────────────────────────────────────────────────
  // 2d. NV Leads (parking + keys)
  if (sectionsToRun.includes("nv_leads_pro")) {
    try {
      const data = await callWp({ ...wpCreds, path: "/wp-json/agencia-export/v1/dump?include=nv_leads_pro" });
      const nvl = data.nv_leads_pro;
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

        const tables = nvl.tables ?? {};
        const sized = safeSize(tables);
        let storedTables = tables;
        let truncated = false;
        if (sized.bytes > MAX_PENDING_BYTES) {
          // Truncamos cada tabla hasta caber
          storedTables = {} as any;
          const tableNames = Object.keys(tables);
          let runningBytes = 1024;
          for (const t of tableNames) {
            const rows = Array.isArray(tables[t]) ? tables[t] : [];
            const trimmed: any[] = [];
            for (const row of rows) {
              const piece = JSON.stringify(row);
              if (runningBytes + piece.length > MAX_PENDING_BYTES) break;
              trimmed.push(row);
              runningBytes += piece.length;
            }
            (storedTables as any)[t] = trimmed;
            if (trimmed.length < rows.length) truncated = true;
          }
        }

        settings.pendingImport.nvLeads = {
          tables: storedTables,
          importedAt: new Date().toISOString(),
          truncated
        };
        const rowsCount = Object.values(storedTables as any).reduce(
          (acc: number, arr: any) => acc + (Array.isArray(arr) ? arr.length : 0),
          0
        );
        report.pendingNvLeads = rowsCount;
        report.sections.nv_leads_pro = {
          ok: true,
          bytes: sized.bytes,
          ...(truncated ? { message: "Truncado por tope 2 MB" } : {})
        };
      } else {
        report.sections.nv_leads_pro = { ok: true, message: "Sin datos de NV Leads" };
      }
    } catch (e: any) {
      console.error("[wp-import] nv_leads_pro error:", e);
      report.sections.nv_leads_pro = { ok: false, message: e?.message ?? String(e) };
      report.errors.push(`nv_leads_pro: ${e?.message ?? e}`);
    }
  }

  // ──────────────────────────────────────────────────────────
  // 3. Persistir settings
  try {
    await prisma.workspace.update({
      where: { id: api.workspaceId },
      data: { settings }
    });
  } catch (e: any) {
    console.error("[wp-import] save settings failed:", e);
    report.errors.push(`save_settings: ${e?.message ?? e}`);
    return NextResponse.json({ ok: false, report }, { status: 500 });
  }

  return NextResponse.json({ ok: true, report });
});
