import { z } from "zod";
import { conversationDestination, validCalendarDate } from "./conversation-search";
import { isAutomationWorkflowAllowed } from "@/lib/mobile/automation-catalog";
import { MAX_PAGE_FOLLOW_TARGETS, normalizePageFollowEntries, type PageFollowPlatform } from "@/lib/mobile/page-follow-batch";

export const MOBILE_AUTOMATION_PLATFORMS = [
  "google_maps",
  "instagram",
  "facebook",
  "tiktok",
  "generic"
] as const;

export const MOBILE_AUTOMATION_SOURCE_KINDS = [
  "REAL_REVIEW",
  "OWNED_POST",
  "GENUINE_COMMENT",
  "LINK_SHARE",
  "GROUP_DISCOVERY",
  "GROUP_JOIN_REQUEST",
  "COMMENT_DISCOVERY",
  "COMMENT_REPLY",
  "PAGE_FOLLOW",
  "COMMENT_THREAD"
] as const;

export const MOBILE_AUTOMATION_ACTIONS = [
  "OPEN_URL",
  "COPY_TEXT",
  "OPEN_URL_AND_COPY_TEXT",
  "SEARCH_FACEBOOK_GROUPS",
  "DISCOVER_FACEBOOK_GROUPS",
  "JOIN_FACEBOOK_GROUP_BATCH",
  "DISCOVER_FACEBOOK_CONVERSATIONS",
  "REPLY_FACEBOOK_CONVERSATIONS",
  "FOLLOW_PAGES",
  "POST_THREAD_MESSAGE"
] as const;

export type MobileAutomationPlatform = (typeof MOBILE_AUTOMATION_PLATFORMS)[number];
export type MobileAutomationSourceKind = (typeof MOBILE_AUTOMATION_SOURCE_KINDS)[number];
export type MobileAutomationAction = (typeof MOBILE_AUTOMATION_ACTIONS)[number];

const PLATFORM_HOSTS: Partial<Record<MobileAutomationPlatform, readonly string[]>> = {
  google_maps: ["google.com", "maps.app.goo.gl", "goo.gl"],
  instagram: ["instagram.com"],
  facebook: ["facebook.com", "fb.com", "fb.me"],
  tiktok: ["tiktok.com"]
};

function isHostOrSubdomain(hostname: string, expected: string): boolean {
  return hostname === expected || hostname.endsWith(`.${expected}`);
}

function isPrivateHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  if (hostname === "::1" || hostname === "0.0.0.0") return true;
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!match) return false;
  const [, aRaw, bRaw] = match;
  const a = Number(aRaw);
  const b = Number(bRaw);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

export function validateAutomationTargetUrl(
  platform: MobileAutomationPlatform,
  rawUrl: string
): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("La URL de destino no es válida.");
  }
  if (url.protocol !== "https:") {
    throw new Error("La URL de destino debe usar HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("La URL de destino no puede contener credenciales.");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (isPrivateHostname(hostname)) {
    throw new Error("La URL no puede apuntar a un destino privado.");
  }
  const allowedHosts = PLATFORM_HOSTS[platform];
  if (allowedHosts && !allowedHosts.some((host) => isHostOrSubdomain(hostname, host))) {
    const label = platform === "google_maps" ? "Google Maps" : platform;
    throw new Error(`La URL debe pertenecer a ${label}.`);
  }
  url.hash = "";
  return url.toString();
}

export const mobileAutomationDraftSchema = z
  .object({
    platform: z.enum(MOBILE_AUTOMATION_PLATFORMS),
    sourceKind: z.enum(MOBILE_AUTOMATION_SOURCE_KINDS),
    idempotencyKey: z.string().uuid(),
    phoneKey: z.string().trim().min(1).max(160),
    deviceSerial: z.string().trim().min(1).max(160),
    targetUrl: z.string().trim().max(2048).default(""),
    facts: z.string().trim().max(4000),
    searchMode: z.enum(["groups", "posts"]).optional(),
    searchTerm: z.string().trim().max(200).optional(),
    dateFrom: z.string().refine(validCalendarDate, "Fecha inicial no válida").optional(),
    dateTo: z.string().refine(validCalendarDate, "Fecha final no válida").optional(),
    niche: z.string().trim().max(200).optional(),
    replyGuidance: z.string().trim().max(4000).optional(),
    postsPerGroup: z.number().int().min(1).max(20).optional(),
    commentScreensPerPost: z.number().int().min(1).max(20).optional(),
    lookbackDays: z.union([z.literal(7), z.literal(30), z.literal(90)]).optional(),
    experienceConfirmed: z.boolean().optional().default(false),
    targetName: z.string().trim().max(200).optional(),
    tone: z.string().trim().max(120).optional(),
    membershipAnswers: z.string().trim().max(2000).optional().default(""),
    maxGroups: z.number().int().min(1).max(15).optional().default(10),
    pages: z.array(z.string().trim().max(2048)).max(MAX_PAGE_FOLLOW_TARGETS * 2).optional(),
    scheduledAt: z.string().datetime({ offset: true }).optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (!isAutomationWorkflowAllowed(value.platform, value.sourceKind)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceKind"],
        message: value.sourceKind.startsWith("GROUP_")
          ? "Las acciones de grupos solo están disponibles para Facebook."
          : "Esta acción no está disponible para la plataforma seleccionada."
      });
    }
    if (value.sourceKind === "GROUP_DISCOVERY" && !value.targetName) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetName"],
        message: "Indica el sector o temática que debe buscar Facebook."
      });
    }
    if (value.sourceKind === "REAL_REVIEW") {
      if (!value.experienceConfirmed) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["experienceConfirmed"],
          message: "Debes confirmar que la reseña describe una experiencia real."
        });
      }
      if (value.platform !== "google_maps") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["platform"],
          message: "Las reseñas reales del MVP solo se preparan para Google Maps."
        });
      }
    }
    if (value.sourceKind === "COMMENT_THREAD") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["sourceKind"], message: "Las conversaciones se crean desde el encargo común, con la simulación y la revisión de cada mensaje." });
      return;
    }
    if (value.sourceKind === "PAGE_FOLLOW") {
      let urls: string[] = [];
      try { urls = normalizePageFollowEntries(value.platform as PageFollowPlatform, value.pages ?? []); }
      catch (error) { context.addIssue({ code: z.ZodIssueCode.custom, path: ["pages"], message: error instanceof Error ? error.message : "Lista de páginas no válida." }); return; }
      if (urls.length === 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ["pages"], message: "Añade al menos una página para seguir." });
      if (urls.length > MAX_PAGE_FOLLOW_TARGETS) context.addIssue({ code: z.ZodIssueCode.custom, path: ["pages"], message: `El máximo es de ${MAX_PAGE_FOLLOW_TARGETS} páginas por encargo.` });
      for (const url of urls) {
        try { validateAutomationTargetUrl(value.platform, url); }
        catch (error) { context.addIssue({ code: z.ZodIssueCode.custom, path: ["pages"], message: `${url}: ${error instanceof Error ? error.message : "URL no permitida."}` }); return; }
      }
      return;
    }
    const conversationScan = value.platform === "facebook" && value.sourceKind === "COMMENT_DISCOVERY";
    if (conversationScan && (!value.replyGuidance || value.replyGuidance.length < 3)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["replyGuidance"], message: "Indica el texto base para las respuestas." });
    if (!conversationScan && value.facts.length < 20) context.addIssue({ code: z.ZodIssueCode.custom, path: ["facts"], message: "Aporta al menos 20 caracteres de contexto." });
    if (conversationScan) {
      if (Boolean(value.dateFrom) !== Boolean(value.dateTo) || (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["dateTo"], message: "Selecciona una fecha inicial y final válidas." });
      try {
        const destination = conversationDestination(value.targetUrl, value.searchTerm);
        if (destination.searchTerm.length > 200) context.addIssue({ code: z.ZodIssueCode.custom, path: ["searchTerm"], message: "La palabra clave admite hasta 200 caracteres." });
        if (!destination.targetUrl) return;
      } catch (error) { context.addIssue({ code: z.ZodIssueCode.custom, path: ["targetUrl"], message: error instanceof Error ? error.message : "Destino no válido" }); return; }
    }
    try {
      validateAutomationTargetUrl(value.platform, value.targetUrl);
    } catch (error) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetUrl"],
        message: error instanceof Error ? error.message : "URL no permitida."
      });
    }
  });

export type MobileAutomationDraftInput = z.infer<typeof mobileAutomationDraftSchema>;

export const MOBILE_AUTOMATION_STATUSES = [
  "PENDING_APPROVAL",
  "QUEUED",
  "RUNNING",
  "WAITING_USER",
  "COMPLETED",
  "REJECTED",
  "FAILED",
  "CANCELLED"
] as const;

export type MobileAutomationStatus = (typeof MOBILE_AUTOMATION_STATUSES)[number];
export type MobileAutomationTransition =
  | "APPROVE"
  | "REJECT"
  | "CLAIM"
  | "PREPARED"
  | "FAIL"
  | "COMPLETE"
  | "RETRY"
  | "CANCEL";

const ALLOWED_TRANSITIONS: Record<MobileAutomationStatus, readonly MobileAutomationTransition[]> = {
  PENDING_APPROVAL: ["APPROVE", "REJECT", "CANCEL"],
  QUEUED: ["CLAIM", "CANCEL"],
  RUNNING: ["PREPARED", "FAIL", "CANCEL"],
  WAITING_USER: ["COMPLETE", "RETRY", "CANCEL"],
  COMPLETED: [],
  REJECTED: [],
  FAILED: ["RETRY", "CANCEL"],
  CANCELLED: []
};

export function canTransitionMobileAutomation(
  status: MobileAutomationStatus,
  transition: MobileAutomationTransition
): boolean {
  return ALLOWED_TRANSITIONS[status].includes(transition);
}
