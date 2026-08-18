/**
 * Helpers de negocio para MetaCampaign. Centralizamos aquí:
 *   - Validación del payload de creación (schema zod compartido entre
 *     API y form del wizard).
 *   - Creación de la campaña + ad sets + ads como DRAFT.
 *   - Creación automática de la Task asociada en /tareas con todo el
 *     detalle + enlaces (al admin de Meta, a la fanpage, a la campaña
 *     en el Hub, al escenario de Make si existe).
 *
 * Esta es la "Fase 1": no llama a Meta API ni a OpenAI todavía —
 * solo persiste la planificación. El campo `status` queda DRAFT.
 */

import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import type {
  MetaAdFormat,
  MetaAdsetMode,
  MetaCampaignObjective,
  MetaLeadDestination,
  MetaVisualMode
} from "@prisma/client";

// Schema del payload que viene del wizard. Lo exponemos para que el
// front también lo use (validación cliente).
export const adsetDescriptorSchema = z.object({
  label: z.string().min(1),
  audienceBrief: z.string().nullable().optional(),
  // Por cada formato cuántos anuncios pinta este conjunto.
  adsByFormat: z.object({
    IMAGE: z.number().int().min(0).max(20).default(0),
    CAROUSEL: z.number().int().min(0).max(20).default(0),
    VIDEO: z.number().int().min(0).max(20).default(0)
  })
});

export const formQuestionSchema = z.object({
  question: z.string().min(1),
  type: z.enum(["TEXT", "EMAIL", "PHONE", "NUMBER", "CHOICE"]),
  required: z.boolean().default(true),
  options: z.array(z.string()).optional()
});

export const createCampaignSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  clientId: z.string().nullable().optional(),
  ownerId: z.string().nullable().optional(),

  adsManagerUrl: z.string().url().nullable().optional(),
  fanpageUrl: z.string().url().nullable().optional(),
  fanpageName: z.string().nullable().optional(),

  startDate: z.string().datetime(),
  endDate: z.string().datetime().nullable().optional(),
  dailyBudgetEuros: z.number().positive(),

  objective: z.enum([
    "LEADS", "TRAFFIC", "ENGAGEMENT", "CONVERSIONS", "AWARENESS",
    "SALES", "APP_PROMOTION", "VIDEO_VIEWS", "REACH"
  ]),
  leadDestination: z.enum([
    "INSTANT_FORM", "WEBSITE", "MESSENGER", "WHATSAPP", "PHONE_CALL"
  ]).nullable().optional(),

  metaPoliciesAccepted: z.boolean().refine((v) => v === true, {
    message: "Tienes que aceptar las políticas de Meta para continuar"
  }),

  adsetMode: z.enum(["COLD_ONLY", "COLD_PLUS_REMARKETING", "CUSTOM"]),
  adsets: z.array(adsetDescriptorSchema).min(1),

  segmentationRaw: z.string().min(1, "Describe el público objetivo"),
  locationsIncluded: z.array(z.string()).default([]),
  locationsExcluded: z.array(z.string()).default([]),

  visualMode: z.enum(["USER_UPLOADS", "AI_GENERATES"]),

  formQuestions: z.array(formQuestionSchema).optional(),
  leadEmails: z.array(z.string().email()).default([]),

  reviewAt: z.string().datetime().nullable().optional()
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

/**
 * Crea la campaña + adsets + ads PLACEHOLDER + la Task asociada en
 * una transacción. Devuelve la campaña con sus relaciones.
 */
export async function createCampaign(opts: {
  workspaceId: string;
  actorId: string;
  data: CreateCampaignInput;
}) {
  const d = opts.data;
  const ownerId = d.ownerId ?? opts.actorId;

  // Si es LEADS sin destino → asumimos INSTANT_FORM como default
  // (lo más común). Si no es LEADS, ignoramos leadDestination.
  const leadDestination =
    d.objective === "LEADS"
      ? (d.leadDestination ?? "INSTANT_FORM") as MetaLeadDestination
      : null;

  // Conexión Meta del owner (si existe) — se enlaza para que Fase 2
  // sepa con qué token enviar a Meta API.
  const conn = await prisma.metaConnection.findFirst({
    where: { userId: ownerId, workspaceId: opts.workspaceId },
    orderBy: { updatedAt: "desc" }
  });

  // Cantidad total de anuncios (suma de todos los formatos en todos
  // los adsets). Solo para el resumen de la Task.
  let totalAds = 0;
  for (const a of d.adsets) {
    totalAds += a.adsByFormat.IMAGE + a.adsByFormat.CAROUSEL + a.adsByFormat.VIDEO;
  }

  const result = await prisma.$transaction(async (tx) => {
    const campaign = await tx.metaCampaign.create({
      data: {
        workspaceId: opts.workspaceId,
        clientId: d.clientId ?? null,
        ownerId,
        name: d.name,
        description: d.description ?? null,
        metaConnectionId: conn?.id ?? null,
        adsManagerUrl: d.adsManagerUrl ?? null,
        fanpageUrl: d.fanpageUrl ?? null,
        fanpageName: d.fanpageName ?? null,
        startDate: new Date(d.startDate),
        endDate: d.endDate ? new Date(d.endDate) : null,
        dailyBudgetCents: Math.round(d.dailyBudgetEuros * 100),
        objective: d.objective as MetaCampaignObjective,
        leadDestination,
        metaPoliciesAccepted: true,
        metaPoliciesAcceptedAt: new Date(),
        adsetMode: d.adsetMode as MetaAdsetMode,
        adsetCount: d.adsets.length,
        segmentationRaw: d.segmentationRaw,
        locationsIncluded: d.locationsIncluded,
        locationsExcluded: d.locationsExcluded,
        visualMode: d.visualMode as MetaVisualMode,
        formQuestions: d.formQuestions as any,
        leadEmails: d.leadEmails,
        reviewAt: d.reviewAt ? new Date(d.reviewAt) : null,
        status: "DRAFT"
      }
    });

    // Crea cada adset y sus ads (placeholders).
    for (const adsetIn of d.adsets) {
      const adset = await tx.metaAdset.create({
        data: {
          campaignId: campaign.id,
          label: adsetIn.label,
          audienceBrief: adsetIn.audienceBrief ?? null
        }
      });
      const formats: { fmt: MetaAdFormat; n: number }[] = [
        { fmt: "IMAGE", n: adsetIn.adsByFormat.IMAGE },
        { fmt: "CAROUSEL", n: adsetIn.adsByFormat.CAROUSEL },
        { fmt: "VIDEO", n: adsetIn.adsByFormat.VIDEO }
      ];
      for (const f of formats) {
        for (let i = 0; i < f.n; i++) {
          await tx.metaAd.create({
            data: {
              adsetId: adset.id,
              format: f.fmt,
              contentStatus: "PLACEHOLDER",
              mediaUrls: []
            }
          });
        }
      }
    }

    // Task asociada. Va al proyecto del cliente si hay clientId; si no,
    // queda sin proyecto (el wizard puede pasar projectId más adelante).
    const project = d.clientId
      ? await tx.project.findFirst({
          where: { workspaceId: opts.workspaceId, clientId: d.clientId, deletedAt: null },
          orderBy: { createdAt: "desc" }
        })
      : null;

    const taskBody = buildTaskBody({
      campaign,
      adsets: d.adsets,
      totalAds,
      hostBase: process.env.NEXT_PUBLIC_APP_URL ?? ""
    });

    const task = project
      ? await tx.task.create({
          data: {
            workspaceId: opts.workspaceId,
            projectId: project.id,
            clientId: d.clientId ?? null,
            title: `Campaña Meta: ${d.name}`,
            description: taskBody,
            status: "TODO",
            priority: "MEDIUM",
            assignees: { create: [{ userId: ownerId }] }
          } as any
        })
      : null;

    if (task) {
      await tx.metaCampaign.update({
        where: { id: campaign.id },
        data: { taskId: task.id }
      });
    }

    return await tx.metaCampaign.findUniqueOrThrow({
      where: { id: campaign.id },
      include: { adsets: { include: { ads: true } } }
    });
  });

  return result;
}

function buildTaskBody(opts: {
  campaign: { id: string; name: string; objective: string; dailyBudgetCents: number; startDate: Date; endDate: Date | null };
  adsets: CreateCampaignInput["adsets"];
  totalAds: number;
  hostBase: string;
}): string {
  const c = opts.campaign;
  const link = opts.hostBase ? `${opts.hostBase}/campanas-meta/${c.id}` : `/campanas-meta/${c.id}`;
  const totals = opts.adsets
    .map(
      (a) =>
        `  • ${a.label}: ${a.adsByFormat.IMAGE} imagen / ${a.adsByFormat.CAROUSEL} carrusel / ${a.adsByFormat.VIDEO} vídeo`
    )
    .join("\n");
  return [
    `**Campaña: ${c.name}**`,
    ``,
    `Objetivo: ${c.objective}`,
    `Inversión diaria: ${(c.dailyBudgetCents / 100).toFixed(2)} €`,
    `Inicio: ${c.startDate.toISOString().slice(0, 10)}`,
    `Fin: ${c.endDate ? c.endDate.toISOString().slice(0, 10) : "Sin fecha de finalización"}`,
    `Total de anuncios planificados: ${opts.totalAds}`,
    ``,
    `Conjuntos:`,
    totals,
    ``,
    `Ver campaña en el Hub: ${link}`
  ].join("\n");
}
