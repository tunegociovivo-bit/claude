import { createHash } from "node:crypto";
import { complete } from "@/lib/ai/anthropic";
import { prisma } from "@/lib/db/prisma";
import { apolloFindDecisionMakers, resolveContactKeys } from "@/lib/leads/enrich-contacts";

type DepartmentProfile = {
  key: "marketing" | "technology";
  label: string;
  titles: string[];
};

type JobLead = {
  id: string;
  workspaceId: string;
  name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  contactStatus: string;
  rawData: unknown;
};

const JOBS_CAMPAIGN_NAME = "Ofertas de empleo · LinkedIn";

function normalized(value: string | null | undefined) {
  return (value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function stableId(prefix: string, value: string) {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

function domainFromWebsite(website: string | null) {
  if (!website) return null;
  try {
    return new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

function splitName(name: string | null) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  return { firstName: parts.shift() || null, lastName: parts.join(" ") || null };
}

function isDirectLinkedInProfile(url: string | null) {
  return Boolean(url && /^https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\//i.test(url));
}

export function jobDepartmentForTitle(jobTitle: string | null | undefined): DepartmentProfile {
  const title = normalized(jobTitle);
  const technology = /\b(ai|ia)\b|artificial intelligence|inteligencia artificial|machine learning|data scientist|cientific[oa] de datos|big data|data engineer|software|automatizacion|automation|prompt engineer/.test(title);
  if (technology) {
    return {
      key: "technology",
      label: "tecnología e innovación",
      titles: ["chief technology officer", "cto", "director de tecnología", "head of technology", "innovation director", "director de innovación", "IT director"]
    };
  }
  return {
    key: "marketing",
    label: "marketing",
    titles: ["marketing director", "head of marketing", "director de marketing", "responsable de marketing", "chief marketing officer", "cmo", "marketing manager"]
  };
}

function linkedInPeopleSearch(company: string, department: DepartmentProfile) {
  const keywords = `${department.label} ${company}`.trim();
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keywords)}`;
}

function fallbackMessage(opts: { firstName: string | null; company: string; jobTitle: string; department: string }) {
  const greeting = opts.firstName ? `Hola ${opts.firstName},` : "Hola,";
  return `${greeting}\n\nHe visto que ${opts.company} está buscando incorporar un perfil de ${opts.jobTitle}. En Negocio Vivo podemos ayudaros a cubrir esa necesidad con un equipo externo especializado en ${opts.department}, sin esperar a completar toda la contratación.\n\n¿Te parece si te envío una propuesta breve aplicada a esta vacante?`;
}

async function resolveDecisionMaker(lead: JobLead, department: DepartmentProfile) {
  const raw = lead.rawData && typeof lead.rawData === "object" && !Array.isArray(lead.rawData)
    ? lead.rawData as Record<string, unknown>
    : {};
  let name = typeof raw.directorName === "string" ? raw.directorName : null;
  let role = typeof raw.directorRole === "string" ? raw.directorRole : null;
  let linkedinUrl = typeof raw.directorLinkedin === "string" ? raw.directorLinkedin : null;
  let source = linkedinUrl ? "lead_enrichment" : "linkedin_search";

  if (!isDirectLinkedInProfile(linkedinUrl)) {
    const domain = domainFromWebsite(lead.website);
    if (domain) {
      try {
        const { apolloKey } = await resolveContactKeys(lead.workspaceId);
        if (apolloKey) {
          const people = await apolloFindDecisionMakers({ domain, apiKey: apolloKey, titles: department.titles, limit: 10 });
          const direct = people.find((person) => isDirectLinkedInProfile(person.linkedin)) || people[0];
          if (direct) {
            name = direct.name || name;
            role = direct.title || role;
            linkedinUrl = direct.linkedin || linkedinUrl;
            source = "apollo";
          }
        }
      } catch {
        // La búsqueda manual de LinkedIn sigue siendo una salida válida.
      }
    }
  }

  const profileResolved = isDirectLinkedInProfile(linkedinUrl);
  return {
    name,
    role: role || `Responsable de ${department.label}`,
    linkedinUrl: profileResolved ? linkedinUrl as string : linkedInPeopleSearch(lead.name, department),
    profileResolved,
    source
  };
}

async function draftLinkedInMessage(opts: {
  workspaceId: string;
  company: string;
  jobTitle: string;
  jobDescription: string | null;
  department: DepartmentProfile;
  decisionMakerName: string | null;
  decisionMakerRole: string;
}) {
  const { firstName } = splitName(opts.decisionMakerName);
  const fallback = fallbackMessage({ firstName, company: opts.company, jobTitle: opts.jobTitle, department: opts.department.label });
  try {
    const result = await complete({
      workspaceId: opts.workspaceId,
      feature: "leads.jobs_linkedin_draft",
      system: "Redacta un mensaje privado de LinkedIn B2B breve y natural, en español de España. Debe mencionar la vacante exacta como señal de necesidad y ofrecer a Negocio Vivo como equipo externo de marketing o IA. No inventes datos, clientes, cifras ni relaciones. Evita repetir la empresa o la vacante. Termina con una sola pregunta de bajo compromiso. Devuelve únicamente el mensaje listo para revisar, sin asunto ni firma.",
      user: [
        `Empresa: ${opts.company}`,
        `Vacante: ${opts.jobTitle}`,
        `Departamento objetivo: ${opts.department.label}`,
        `Responsable: ${opts.decisionMakerName || "sin identificar"}`,
        `Cargo del responsable: ${opts.decisionMakerRole}`,
        opts.jobDescription ? `Descripción disponible: ${opts.jobDescription.slice(0, 1200)}` : null
      ].filter(Boolean).join("\n"),
      maxTokens: 420
    });
    return result.trim() || fallback;
  } catch {
    return fallback;
  }
}

export async function syncJobLeadsToProspecting(opts: { workspaceId: string; searchId?: string; limit?: number }) {
  const leads = await prisma.lead.findMany({
    where: {
      workspaceId: opts.workspaceId,
      ...(opts.searchId ? { searchId: opts.searchId } : {}),
      contactStatus: { in: ["pending", "contacted"] },
      rawData: { path: ["source"], equals: "jobs" }
    } as any,
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(opts.limit ?? 100, 1), 200),
    select: { id: true, workspaceId: true, name: true, email: true, phone: true, website: true, contactStatus: true, rawData: true }
  }) as JobLead[];

  if (!leads.length) return { candidates: 0, drafted: 0, alreadyLinked: 0, unresolvedProfiles: 0 };

  const campaignId = stableId("jobs_campaign", opts.workspaceId);
  const campaign = await prisma.prospectingCampaign.upsert({
    where: { id: campaignId },
    create: {
      id: campaignId,
      workspaceId: opts.workspaceId,
      name: JOBS_CAMPAIGN_NAME,
      source: "linkedin",
      sourceUrl: "/admin/leads?tab=jobs-review",
      status: "active",
      objective: "meeting",
      dailyLimit: 100,
      activeWeekdays: [1, 2, 3, 4, 5],
      teamConfig: { systemCampaign: "jobs_bridge", version: 1 },
      steps: {
        create: [{
          order: 0,
          channel: "linkedin_message",
          delayHours: 0,
          templateBody: "Mensaje específico según la oferta detectada",
          requiresReview: true,
          personalization: "ai_company"
        }]
      }
    },
    update: {},
    include: { steps: { orderBy: { order: "asc" } } }
  });
  const step = campaign.steps[0];
  if (!step) throw new Error("La campaña interna de ofertas no tiene el paso de LinkedIn");

  const keys = leads.map((lead) => `jobs-linkedin:${opts.workspaceId}:${lead.id}`);
  const existing = await prisma.prospectingActivity.findMany({
    where: { idempotencyKey: { in: keys } },
    select: { idempotencyKey: true }
  });
  const handled = new Set(existing.map((activity) => activity.idempotencyKey).filter(Boolean));
  let drafted = 0;
  let unresolvedProfiles = 0;

  for (let offset = 0; offset < leads.length; offset += 5) {
    await Promise.all(leads.slice(offset, offset + 5).map(async (lead) => {
      const idempotencyKey = `jobs-linkedin:${opts.workspaceId}:${lead.id}`;
      if (handled.has(idempotencyKey)) return;
      const raw = lead.rawData && typeof lead.rawData === "object" && !Array.isArray(lead.rawData)
        ? lead.rawData as Record<string, unknown>
        : {};
      const jobTitle = typeof raw.jobTitle === "string" && raw.jobTitle.trim() ? raw.jobTitle.trim() : "marketing o inteligencia artificial";
      const jobDescription = typeof raw.jobDescription === "string" ? raw.jobDescription : null;
      const department = jobDepartmentForTitle(jobTitle);
      const decisionMaker = await resolveDecisionMaker(lead, department);
      const names = splitName(decisionMaker.name);
      const message = await draftLinkedInMessage({
        workspaceId: opts.workspaceId,
        company: lead.name,
        jobTitle,
        jobDescription,
        department,
        decisionMakerName: decisionMaker.name,
        decisionMakerRole: decisionMaker.role
      });
      const prospectId = stableId("jobs_prospect", `${opts.workspaceId}:${lead.id}`);
      const metadata = {
        source: "jobs_bridge",
        profileResolved: decisionMaker.profileResolved,
        decisionMakerSource: decisionMaker.source,
        department: department.label,
        job: {
          title: jobTitle,
          url: typeof raw.jobUrl === "string" ? raw.jobUrl : null,
          board: typeof raw.board === "string" ? raw.board : null,
          description: jobDescription
        }
      };

      await prisma.prospectingProspect.upsert({
        where: { id: prospectId },
        create: {
          id: prospectId,
          workspaceId: opts.workspaceId,
          campaignId: campaign.id,
          leadId: lead.id,
          firstName: names.firstName,
          lastName: names.lastName,
          companyName: lead.name,
          jobTitle: decisionMaker.role,
          linkedinUrl: decisionMaker.linkedinUrl,
          email: lead.email,
          phone: lead.phone,
          website: lead.website,
          companyDomain: domainFromWebsite(lead.website),
          resolutionStatus: decisionMaker.profileResolved ? "resolved" : "manual_required",
          resolutionConfidence: decisionMaker.profileResolved ? 90 : 0,
          status: "waiting_action",
          currentStep: 0,
          nextActionAt: null,
          metadata
        },
        update: {
          firstName: names.firstName,
          lastName: names.lastName,
          companyName: lead.name,
          jobTitle: decisionMaker.role,
          linkedinUrl: decisionMaker.linkedinUrl,
          email: lead.email,
          phone: lead.phone,
          website: lead.website,
          companyDomain: domainFromWebsite(lead.website),
          resolutionStatus: decisionMaker.profileResolved ? "resolved" : "manual_required",
          resolutionConfidence: decisionMaker.profileResolved ? 90 : 0,
          metadata
        }
      });

      await prisma.prospectingActivity.upsert({
        where: { idempotencyKey },
        create: {
          workspaceId: opts.workspaceId,
          campaignId: campaign.id,
          prospectId,
          stepId: step.id,
          idempotencyKey,
          channel: "linkedin_message",
          action: "execute_step",
          status: "awaiting_review",
          detail: message,
          payload: {
            source: "jobs_bridge",
            leadId: lead.id,
            company: lead.name,
            jobTitle,
            jobUrl: typeof raw.jobUrl === "string" ? raw.jobUrl : null,
            linkedinUrl: decisionMaker.linkedinUrl,
            profileResolved: decisionMaker.profileResolved,
            department: department.label
          },
          scheduledAt: new Date()
        },
        update: {}
      });

      if (decisionMaker.profileResolved && (raw.directorLinkedin !== decisionMaker.linkedinUrl || raw.directorName !== decisionMaker.name)) {
        await prisma.lead.update({
          where: { id: lead.id },
          data: { rawData: { ...raw, directorName: decisionMaker.name, directorRole: decisionMaker.role, directorLinkedin: decisionMaker.linkedinUrl } }
        }).catch(() => null);
      }
      drafted++;
      if (!decisionMaker.profileResolved) unresolvedProfiles++;
    }));
  }

  return { candidates: leads.length, drafted, alreadyLinked: handled.size, unresolvedProfiles };
}
