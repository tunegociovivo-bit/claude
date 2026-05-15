/**
 * Procesa los datos aparcados en workspace.settings.pendingImport:
 *   - nvDashboard.publications → EditorialPost (upsert por legacyWpId)
 *   - nvDashboard.clientesTaxonomy → matchea por nombre con Client existente
 *   - nvLeads.tables.{nvl_searches,nvl_leads,nvl_competitors,nvl_messages,
 *     nvl_templates,nvl_sequences,nvl_sequence_steps,nvl_lead_sequences,
 *     nvl_inbox,nvl_exclusions,nvl_optouts} → schemas Lead* equivalentes.
 *
 * Idempotente: upsert por legacyWpId / placeId / phone. Llamarlo varias
 * veces es seguro.
 *
 * Solo admins.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

async function requireAdmin(workspaceId: string, userId: string | undefined) {
  if (!userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const me = await prisma.membership.findFirst({ where: { workspaceId, userId } });
  if (!me || me.role !== "ADMIN") throw new ApiError(403, "forbidden", "Solo admins");
}

function parseDate(v: any): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export const POST = withApi({ scope: "*" }, async (_req, { api }) => {
  await requireAdmin(api.workspaceId, api.userId);

  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const settings: any = (ws?.settings as any) ?? {};
  const pending: any = settings.pendingImport ?? {};

  const report: Record<string, any> = {
    editorialPostsCreated: 0,
    editorialPostsUpdated: 0,
    editorialClientsCreated: 0,
    editorialClientsUpdated: 0,
    leadSearchesProcessed: 0,
    leadsProcessed: 0,
    competitorsProcessed: 0,
    templatesProcessed: 0,
    sequencesProcessed: 0,
    inboxProcessed: 0,
    exclusionsProcessed: 0,
    optoutsProcessed: 0,
    errors: [] as string[]
  };

  // ────────────────────────────────────────────────────────────
  // NV Dashboard publicaciones → EditorialPost
  if (pending.nvDashboard) {
    // ── PASO 0: crear / actualizar Clients desde la taxonomía nv_cliente ──
    // El plugin WP guardaba cada cliente como un término de la taxonomía
    // nv_cliente + una opción nv_dashboard_cliente_config_<slug>. Aquí lo
    // mapeamos a filas de la tabla Client (con upsert por nombre para no
    // duplicar si el cliente ya existía en el workspace).
    const taxes = Array.isArray(pending.nvDashboard.clientesTaxonomy)
      ? pending.nvDashboard.clientesTaxonomy
      : [];
    const configs = (pending.nvDashboard.clienteConfigs ?? {}) as Record<string, any>;
    console.log(
      `[process-pending-import] NV Dashboard: ${taxes.length} clientes en taxonomía, ` +
      `${Array.isArray(pending.nvDashboard.publications) ? pending.nvDashboard.publications.length : 0} publicaciones`
    );

    for (const t of taxes) {
      try {
        const name = String(t?.name ?? "").trim();
        if (!name) continue;
        // Buscamos config por convención de nombre de opción del plugin
        const slugCandidates = [
          `nv_dashboard_cliente_config_${t?.slug}`,
          `nv_dashboard_cliente_config_${name.toLowerCase().replace(/\s+/g, "_")}`
        ];
        let cfg: any = null;
        for (const k of slugCandidates) {
          if (configs[k]) { cfg = configs[k]; break; }
        }

        // Notas: si hay configuración del plugin, la metemos en notes
        // como markdown sencillo para que el usuario las vea en el CRM.
        let notes: string | null = null;
        if (cfg && typeof cfg === "object") {
          const lines: string[] = ["**Configuración importada de NV Dashboard:**"];
          for (const [k, v] of Object.entries<any>(cfg)) {
            if (v === null || v === undefined || v === "") continue;
            const val = typeof v === "object" ? JSON.stringify(v) : String(v);
            lines.push(`- ${k}: ${val.slice(0, 200)}`);
          }
          notes = lines.join("\n");
        }

        // Industry y demás se quedan vacíos por ahora; los rellena el user
        const existing = await prisma.client.findFirst({
          where: { workspaceId: api.workspaceId, name, deletedAt: null }
        });
        if (existing) {
          // Solo actualiza notas si están vacías (no pisar las del user)
          if (!existing.notes && notes) {
            await prisma.client.update({ where: { id: existing.id }, data: { notes } });
            report.editorialClientsUpdated++;
          }
        } else {
          await prisma.client.create({
            data: {
              workspaceId: api.workspaceId,
              name,
              notes,
              since: new Date()
            }
          });
          report.editorialClientsCreated++;
        }
      } catch (e: any) {
        report.errors.push(`clientFromTaxonomy[${t?.name ?? "?"}]: ${e?.message ?? e}`);
      }
    }
  }

  if (pending.nvDashboard?.publications && Array.isArray(pending.nvDashboard.publications)) {
    const clients = await prisma.client.findMany({
      where: { workspaceId: api.workspaceId, deletedAt: null }
    });
    const clientByNameLower = new Map(clients.map((c) => [c.name.toLowerCase(), c.id]));

    for (const p of pending.nvDashboard.publications) {
      try {
        const id = Number(p.id) || null;
        const meta = (p.meta ?? {}) as any;
        // Intento de mapeo de cliente: buscar primer término de taxonomía nv_cliente.
        // Si el término no estaba en clientes_taxonomy (export incompleto), creamos
        // el Client al vuelo para no perder la asociación.
        let clientId: string | null = null;
        const pubTaxes = Array.isArray(p.clientes) ? p.clientes : [];
        if (pubTaxes.length > 0) {
          const taxName = String(pubTaxes[0]?.name ?? "").trim();
          const taxNameLower = taxName.toLowerCase();
          clientId = clientByNameLower.get(taxNameLower) ?? null;
          if (!clientId && taxName) {
            const created = await prisma.client.create({
              data: { workspaceId: api.workspaceId, name: taxName, since: new Date() }
            });
            clientByNameLower.set(taxNameLower, created.id);
            clientId = created.id;
            report.editorialClientsCreated++;
          }
        }

        const status = mapStatus(p.status);
        // Fecha: intentamos varios campos ACF habituales del plugin
        const scheduled = parseDate(
          meta?.fecha_publicacion ??
          meta?.fecha ??
          meta?.scheduled_for ??
          meta?.fecha_programada ??
          (meta?.fecha_dia && meta?.hora_publicacion ? `${meta.fecha_dia} ${meta.hora_publicacion}` : null) ??
          p.date
        );

        // Redes: el plugin solía guardarlas como array, CSV o JSON
        let networks: string[] = [];
        const rawNets = meta?.redes ?? meta?.redes_sociales ?? meta?.plataformas ?? meta?.canales;
        if (Array.isArray(rawNets)) {
          networks = rawNets.map(String);
        } else if (typeof rawNets === "string") {
          try {
            const j = JSON.parse(rawNets);
            networks = Array.isArray(j) ? j.map(String) : rawNets.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
          } catch {
            networks = rawNets.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
          }
        }

        const format = meta?.formato ?? meta?.format ?? meta?.tipo ?? meta?.tipo_publicacion ?? null;

        // Copy / texto principal — buscamos en muchos campos ACF candidatos
        const contentCandidates = [
          meta?.copy,
          meta?.copy_principal,
          meta?.texto,
          meta?.texto_publicacion,
          meta?.texto_post,
          meta?.contenido,
          meta?.contenido_publicacion,
          meta?.descripcion,
          meta?.description,
          meta?.cuerpo,
          meta?.post_text,
          meta?.text,
          meta?.caption,
          meta?.copy_facebook,
          meta?.copy_instagram,
          meta?.copy_linkedin,
          meta?.copy_redes
        ];
        let content = (contentCandidates.find(
          (v) => typeof v === "string" && v.trim().length > 0
        ) as string | undefined) ?? null;
        if (!content && typeof p.content === "string" && p.content.trim().length > 0) {
          content = p.content;
        }
        // FALLBACK AGRESIVO: si seguimos sin content, coge el STRING MÁS LARGO
        // de todo meta que no sea URL ni un valor de ACF interno (field_*).
        if (!content) {
          let longest = "";
          for (const [k, v] of Object.entries<any>(meta)) {
            if (k.startsWith("_") || k.startsWith("field_")) continue;
            if (typeof v !== "string") continue;
            if (/^https?:\/\//.test(v)) continue;
            if (v.length > longest.length && v.length > 30) longest = v;
          }
          if (longest) content = longest;
        }

        // Imagen / foto — thumbnail destacada + posibles ACF
        const mediaCandidates: string[] = [];
        if (p.thumbnail) mediaCandidates.push(String(p.thumbnail));
        for (const k of [
          "imagen", "imagen_principal", "imagen_publicacion",
          "foto", "foto_principal", "foto_publicacion",
          "imagen_url", "media", "media_url", "thumbnail", "thumbnail_url",
          "image", "img", "photo", "picture",
          "imagen_instagram", "imagen_facebook", "imagen_linkedin"
        ]) {
          const v = meta?.[k];
          if (typeof v === "string" && /^https?:\/\//.test(v)) mediaCandidates.push(v);
          // ACF a veces guarda objeto image con .url o número (ID de attachment)
          if (v && typeof v === "object" && typeof v.url === "string") mediaCandidates.push(v.url);
        }
        // Imágenes adicionales (galería): claves comunes
        const galleryCandidates = [
          meta?.imagenes,
          meta?.galeria,
          meta?.gallery,
          meta?.images,
          meta?.media_gallery,
          meta?.fotos
        ];
        for (const g of galleryCandidates) {
          if (Array.isArray(g)) {
            for (const item of g) {
              if (typeof item === "string" && /^https?:\/\//.test(item)) mediaCandidates.push(item);
              else if (item && typeof item === "object" && typeof item.url === "string") mediaCandidates.push(item.url);
            }
          }
        }
        // FALLBACK AGRESIVO: scan todas las claves de meta buscando URLs de imagen
        for (const [k, v] of Object.entries<any>(meta)) {
          if (k.startsWith("_") || k.startsWith("field_")) continue;
          if (typeof v === "string" && /^https?:\/\/.+\.(jpe?g|png|gif|webp|svg)(\?|$)/i.test(v)) {
            mediaCandidates.push(v);
          } else if (v && typeof v === "object" && typeof v.url === "string" && /\.(jpe?g|png|gif|webp|svg)(\?|$)/i.test(v.url)) {
            mediaCandidates.push(v.url);
          }
        }
        // dedupe preservando orden
        const seen = new Set<string>();
        const mediaUrls = mediaCandidates.filter((u) => {
          if (seen.has(u)) return false;
          seen.add(u);
          return true;
        });
        const thumbnail = mediaUrls[0] ?? null;

        // Excerpt
        const excerpt = (typeof p.excerpt === "string" && p.excerpt.trim()) ||
          (typeof meta?.excerpt === "string" ? meta.excerpt : null) ||
          (typeof meta?.resumen === "string" ? meta.resumen : null) ||
          null;

        const data = {
          workspaceId: api.workspaceId,
          clientId,
          title: String(p.title ?? "Sin título").slice(0, 200),
          content,
          excerpt,
          scheduledFor: scheduled,
          status,
          format: format ? String(format).slice(0, 40) : null,
          networks: JSON.stringify(networks),
          thumbnail,
          mediaUrls: JSON.stringify(mediaUrls),
          metaJson: meta
        };

        if (id) {
          const upserted = await prisma.editorialPost.upsert({
            where: { legacyWpId: id },
            create: { ...data, legacyWpId: id },
            update: data
          });
          report.editorialPostsCreated++;
        } else {
          await prisma.editorialPost.create({ data });
          report.editorialPostsCreated++;
        }
      } catch (e: any) {
        report.errors.push(`editorial[${p.id ?? "?"}]: ${e?.message ?? e}`);
      }
    }
  }

  // ────────────────────────────────────────────────────────────
  // NV Leads tablas → schemas Lead*
  const tables: any = pending.nvLeads?.tables ?? {};

  // 1. Searches
  if (Array.isArray(tables.nvl_searches)) {
    for (const s of tables.nvl_searches) {
      try {
        const legacyId = Number(s.id) || null;
        const data = {
          workspaceId: api.workspaceId,
          keyword: String(s.keyword ?? ""),
          location: String(s.location ?? ""),
          status: mapLeadSearchStatus(s.status),
          totalResults: Number(s.total_results ?? 0),
          currentProvince: s.current_province ? String(s.current_province) : null,
          startedAt: parseDate(s.started_at),
          completedAt: parseDate(s.completed_at),
          errorMessage: s.error_message ? String(s.error_message) : null
        };
        if (legacyId) {
          await prisma.leadSearch.upsert({
            where: { legacyWpId: legacyId },
            create: { ...data, legacyWpId: legacyId },
            update: data
          });
        } else {
          await prisma.leadSearch.create({ data });
        }
        report.leadSearchesProcessed++;
      } catch (e: any) {
        report.errors.push(`search[${s.id ?? "?"}]: ${e?.message ?? e}`);
      }
    }
  }

  // 2. Leads
  if (Array.isArray(tables.nvl_leads)) {
    const searchByLegacy = await prisma.leadSearch.findMany({
      where: { workspaceId: api.workspaceId, legacyWpId: { not: null } },
      select: { id: true, legacyWpId: true }
    });
    const searchMap = new Map(searchByLegacy.map((s) => [s.legacyWpId!, s.id]));

    for (const l of tables.nvl_leads) {
      try {
        const placeId = String(l.place_id ?? "").trim();
        if (!placeId) continue;
        const legacyId = Number(l.id) || null;
        const searchId = l.search_id ? searchMap.get(Number(l.search_id)) ?? null : null;
        let reviewsJson: any = null;
        try {
          reviewsJson = typeof l.reviews_json === "string" ? JSON.parse(l.reviews_json) : l.reviews_json;
        } catch {}

        const data = {
          workspaceId: api.workspaceId,
          searchId,
          placeId,
          name: String(l.name ?? "Sin nombre"),
          address: l.address ? String(l.address) : null,
          phone: l.phone ? String(l.phone) : null,
          website: l.website ? String(l.website) : null,
          rating: l.rating !== undefined && l.rating !== null ? Number(l.rating) : null,
          reviewsCount: Number(l.reviews_count ?? 0),
          reviewsJson,
          score: l.score !== undefined && l.score !== null ? Number(l.score) : null,
          urgency: l.urgency !== undefined && l.urgency !== null ? Number(l.urgency) : null,
          hasWhatsapp: Boolean(Number(l.has_whatsapp ?? 0)),
          whatsappChecked: Boolean(Number(l.whatsapp_checked ?? 0)),
          aiOpener: l.ai_opener ? String(l.ai_opener) : null,
          contactStatus: mapContactStatus(l.contact_status)
        };

        await prisma.lead.upsert({
          where: { workspaceId_placeId: { workspaceId: api.workspaceId, placeId } },
          create: { ...data, ...(legacyId ? { legacyWpId: legacyId } : {}) },
          update: data
        });
        report.leadsProcessed++;
      } catch (e: any) {
        report.errors.push(`lead[${l.place_id ?? "?"}]: ${e?.message ?? e}`);
      }
    }
  }

  // 3. Templates
  if (Array.isArray(tables.nvl_templates)) {
    for (const t of tables.nvl_templates) {
      try {
        const legacyId = Number(t.id) || null;
        const data = {
          workspaceId: api.workspaceId,
          name: String(t.name ?? "Sin nombre"),
          body: String(t.body ?? ""),
          channel: t.channel ? String(t.channel) : "whatsapp"
        };
        if (legacyId) {
          await prisma.leadTemplate.upsert({
            where: { legacyWpId: legacyId },
            create: { ...data, legacyWpId: legacyId },
            update: data
          });
        } else {
          await prisma.leadTemplate.create({ data });
        }
        report.templatesProcessed++;
      } catch (e: any) {
        report.errors.push(`template[${t.id ?? "?"}]: ${e?.message ?? e}`);
      }
    }
  }

  // 4. Sequences + steps
  if (Array.isArray(tables.nvl_sequences)) {
    for (const s of tables.nvl_sequences) {
      try {
        const legacyId = Number(s.id) || null;
        const data = {
          workspaceId: api.workspaceId,
          name: String(s.name ?? "Sin nombre"),
          description: s.description ? String(s.description) : null,
          active: s.active === undefined ? true : Boolean(Number(s.active))
        };
        if (legacyId) {
          await prisma.leadSequence.upsert({
            where: { legacyWpId: legacyId },
            create: { ...data, legacyWpId: legacyId },
            update: data
          });
        } else {
          await prisma.leadSequence.create({ data });
        }
        report.sequencesProcessed++;
      } catch (e: any) {
        report.errors.push(`sequence[${s.id ?? "?"}]: ${e?.message ?? e}`);
      }
    }

    // Steps: depend on sequence ids
    if (Array.isArray(tables.nvl_sequence_steps)) {
      const seqs = await prisma.leadSequence.findMany({
        where: { workspaceId: api.workspaceId, legacyWpId: { not: null } },
        select: { id: true, legacyWpId: true }
      });
      const seqMap = new Map(seqs.map((s) => [s.legacyWpId!, s.id]));
      for (const st of tables.nvl_sequence_steps) {
        try {
          const seqId = seqMap.get(Number(st.sequence_id));
          if (!seqId) continue;
          await prisma.leadSequenceStep.create({
            data: {
              sequenceId: seqId,
              order: Number(st.step_order ?? st.order ?? 0),
              delayHours: Number(st.delay_hours ?? 24),
              templateBody: String(st.template_body ?? st.body ?? "")
            }
          });
        } catch (e: any) {
          report.errors.push(`step[${st.id ?? "?"}]: ${e?.message ?? e}`);
        }
      }
    }
  }

  // 5. Inbox
  if (Array.isArray(tables.nvl_inbox)) {
    for (const m of tables.nvl_inbox) {
      try {
        await prisma.leadInboxMessage.create({
          data: {
            workspaceId: api.workspaceId,
            leadId: null,
            fromPhone: String(m.from_phone ?? m.phone ?? ""),
            body: String(m.body ?? m.message ?? ""),
            read: Boolean(Number(m.read ?? 0)),
            receivedAt: parseDate(m.received_at) ?? new Date()
          }
        });
        report.inboxProcessed++;
      } catch (e: any) {
        report.errors.push(`inbox[${m.id ?? "?"}]: ${e?.message ?? e}`);
      }
    }
  }

  // 6. Exclusions
  if (Array.isArray(tables.nvl_exclusions)) {
    for (const e of tables.nvl_exclusions) {
      try {
        await prisma.leadExclusion.create({
          data: {
            workspaceId: api.workspaceId,
            placeId: e.place_id ? String(e.place_id) : null,
            phone: e.phone ? String(e.phone) : null,
            reason: e.reason ? String(e.reason) : null
          }
        });
        report.exclusionsProcessed++;
      } catch (err: any) {
        report.errors.push(`exclusion[${e.id ?? "?"}]: ${err?.message ?? err}`);
      }
    }
  }

  // 7. Optouts
  if (Array.isArray(tables.nvl_optouts)) {
    for (const o of tables.nvl_optouts) {
      try {
        const phone = String(o.phone ?? "").trim();
        if (!phone) continue;
        await prisma.leadOptout.upsert({
          where: { workspaceId_phone: { workspaceId: api.workspaceId, phone } },
          create: {
            workspaceId: api.workspaceId,
            phone,
            reason: o.reason ? String(o.reason) : null
          },
          update: { reason: o.reason ? String(o.reason) : null }
        });
        report.optoutsProcessed++;
      } catch (err: any) {
        report.errors.push(`optout[${o.id ?? "?"}]: ${err?.message ?? err}`);
      }
    }
  }

  // Limpia pendingImport una vez procesado correctamente (deja un sello)
  settings.pendingImport ??= {};
  settings.pendingImport.processedAt = new Date().toISOString();
  await prisma.workspace.update({
    where: { id: api.workspaceId },
    data: { settings }
  });

  return NextResponse.json({ ok: true, report });
});

function mapStatus(wp: string | undefined): string {
  const s = String(wp ?? "").toLowerCase();
  if (s === "publish" || s === "published") return "PUBLISHED";
  if (s === "future" || s === "scheduled") return "SCHEDULED";
  if (s === "pending" || s === "approved") return "APPROVED";
  if (s === "review" || s === "in_review") return "REVIEW";
  if (s === "private" || s === "archive") return "ARCHIVED";
  return "DRAFT";
}

function mapLeadSearchStatus(s: any): string {
  const v = String(s ?? "").toUpperCase();
  if (["PENDING", "RUNNING", "COMPLETED", "FAILED"].includes(v)) return v;
  return "PENDING";
}

function mapContactStatus(s: any): string {
  const v = String(s ?? "").toUpperCase();
  if (["NEW", "QUEUED", "CONTACTED", "REPLIED", "CONVERTED", "LOST"].includes(v)) return v;
  return "NEW";
}
