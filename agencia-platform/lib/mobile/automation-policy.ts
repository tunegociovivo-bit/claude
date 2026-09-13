import { z } from "zod";
import { isAutomationWorkflowAllowed } from "@/lib/mobile/automation-catalog";

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
  "COMMENT_REPLY"
] as const;

export const MOBILE_AUTOMATION_ACTIONS = [
  "OPEN_URL",
  "COPY_TEXT",
  "OPEN_URL_AND_COPY_TEXT",
  "SEARCH_FACEBOOK_GROUPS"
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
    targetUrl: z.string().trim().min(1).max(2048),
    facts: z.string().trim().min(20).max(4000),
    experienceConfirmed: z.boolean().optional().default(false),
    targetName: z.string().trim().max(200).optional(),
    tone: z.string().trim().max(120).optional(),
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
