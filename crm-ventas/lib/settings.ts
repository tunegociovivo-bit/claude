import { prisma } from "@/lib/prisma";

// ---------- Tipos de configuración por workspace (cliente) ----------

export type PipelineColumn = {
  id: string;
  label: string;
  color: string;
  order: number;
};

// La columna "citas" es fija: ahí aterrizan los contactos cuando SONIA agenda una cita.
export const DEFAULT_COLUMNS: PipelineColumn[] = [
  { id: "nuevos", label: "Nuevos", color: "#64748b", order: 0 },
  { id: "conversacion", label: "En conversación", color: "#f59e0b", order: 1 },
  { id: "citas", label: "Citas", color: "#2f6bff", order: 2 },
  { id: "cerrados", label: "Cerrados", color: "#10b981", order: 3 },
];

export type SoniaSettings = {
  businessName: string;
  // Información del negocio que SONIA puede consultar y dar por teléfono/WhatsApp
  businessInfo: string;
  // Horario en texto (SONIA lo comunica y lo tiene en cuenta al proponer citas)
  openingHours: string;
  // Instrucciones extra específicas de este cliente (el "prompt por cliente")
  promptExtra: string;
  // Duración por defecto de las citas
  slotMinutes: number;
  // Saludo inicial de la llamada
  firstMessage: string;
  // Config del asistente de voz en Vapi
  vapiModelProvider: string; // p.ej. "anthropic"
  vapiModel: string;
  vapiVoiceProvider: string; // p.ej. "11labs"
  vapiVoiceId: string;
};

export type WhatsappSettings = {
  wahaUrl: string;
  wahaApiKeyEnc: string; // cifrada
  wahaSession: string;
  countryCode: string; // prefijo por defecto al normalizar (34 = España)
  autoReplyEnabled: boolean; // si SONIA responde automáticamente
};

export type BrandingSettings = {
  // Logo del negocio como data URL (PNG/JPG/WebP ≤ 500KB). Se guarda en BD para
  // no depender del disco efímero de Railway.
  logoDataUrl: string;
};

export type WorkspaceSettings = {
  // "sonia" es el nombre técnico histórico de la config del asistente; el
  // nombre visible del asistente es PAULA.
  sonia: SoniaSettings;
  whatsapp: WhatsappSettings;
  branding: BrandingSettings;
  vapiWebhookToken: string;
  whatsappWebhookToken: string;
  pipeline: { columns: PipelineColumn[] };
};

// Saludo por defecto de la época en que el asistente se llamaba Sonia. Solo
// este texto EXACTO migra al saludo de Paula; cualquier saludo personalizado
// se respeta tal cual.
const LEGACY_DEFAULT_FIRST_MESSAGE =
  "Hola, soy Sonia, la asistente virtual. ¿En qué puedo ayudarte?";

export const DEFAULT_SONIA: SoniaSettings = {
  businessName: "",
  businessInfo: "",
  openingHours: "Lunes a viernes de 9:00 a 18:00",
  promptExtra: "",
  slotMinutes: 30,
  firstMessage: "Hola, soy Paula, la asistente virtual. ¿En qué puedo ayudarte?",
  vapiModelProvider: "anthropic",
  vapiModel: "claude-sonnet-4-5",
  vapiVoiceProvider: "11labs",
  vapiVoiceId: "21m00Tcm4TlvDq8ikWAM",
};

export const DEFAULT_WHATSAPP: WhatsappSettings = {
  wahaUrl: "",
  wahaApiKeyEnc: "",
  wahaSession: "default",
  countryCode: "34",
  autoReplyEnabled: true,
};

export function readSettings(raw: unknown): WorkspaceSettings {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const sonia: SoniaSettings = { ...DEFAULT_SONIA, ...(s.sonia ?? {}) };
  if (sonia.firstMessage === LEGACY_DEFAULT_FIRST_MESSAGE) {
    sonia.firstMessage = DEFAULT_SONIA.firstMessage;
  }
  return {
    sonia,
    whatsapp: { ...DEFAULT_WHATSAPP, ...(s.whatsapp ?? {}) },
    branding: {
      logoDataUrl:
        typeof s.branding?.logoDataUrl === "string" ? s.branding.logoDataUrl : "",
    },
    vapiWebhookToken: typeof s.vapiWebhookToken === "string" ? s.vapiWebhookToken : "",
    whatsappWebhookToken:
      typeof s.whatsappWebhookToken === "string" ? s.whatsappWebhookToken : "",
    pipeline: {
      columns:
        Array.isArray(s.pipeline?.columns) && s.pipeline.columns.length > 0
          ? s.pipeline.columns
          : DEFAULT_COLUMNS,
    },
  };
}

export async function getWorkspaceSettings(workspaceId: string): Promise<WorkspaceSettings> {
  const ws = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { settings: true },
  });
  return readSettings(ws.settings);
}

export async function saveWorkspaceSettings(
  workspaceId: string,
  patch: Partial<WorkspaceSettings>
): Promise<WorkspaceSettings> {
  const current = await getWorkspaceSettings(workspaceId);
  const merged: WorkspaceSettings = {
    ...current,
    ...patch,
    sonia: { ...current.sonia, ...(patch.sonia ?? {}) },
    whatsapp: { ...current.whatsapp, ...(patch.whatsapp ?? {}) },
    branding: { ...current.branding, ...(patch.branding ?? {}) },
    pipeline: patch.pipeline ?? current.pipeline,
  };
  await prisma.workspace.update({
    where: { id: workspaceId },
    data: { settings: merged as any },
  });
  return merged;
}

// Busca el workspace dueño de un token de webhook (Vapi o WhatsApp).
export async function findWorkspaceByToken(
  kind: "vapi" | "whatsapp",
  token: string
): Promise<{ id: string; settings: WorkspaceSettings } | null> {
  if (!token || token.length < 16) return null;
  const field = kind === "vapi" ? "vapiWebhookToken" : "whatsappWebhookToken";
  // El token va indexado dentro del JSON: filtramos en SQL por igualdad de campo JSON.
  const rows = await prisma.workspace.findMany({
    where: { settings: { path: [field], equals: token } },
    select: { id: true, settings: true },
    take: 1,
  });
  const ws = rows[0];
  if (!ws) return null;
  return { id: ws.id, settings: readSettings(ws.settings) };
}

export function publicBaseUrl(): string {
  return (
    process.env.PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}
