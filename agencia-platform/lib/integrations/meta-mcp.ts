/**
 * Conector al MCP oficial de Meta Ads (https://mcp.facebook.com/ads) desde
 * el propio Hub, vía la función de "remote MCP server" de la API de
 * Anthropic. Autentica como el USUARIO (acceso total a todas sus cuentas),
 * así resuelve el problema de permisos del token de Usuario del Sistema.
 *
 * Uso: cuando una operación de Meta falla por permisos con el token
 * permanente, Sonia reintenta la gestión describiéndola en lenguaje natural
 * y el modelo la ejecuta con las herramientas del MCP de Meta. 100%
 * automático: no requiere intervención humana en cada tarea.
 *
 * Único requisito de configuración (una vez): un token de autorización del
 * MCP de Meta guardado en Workspace.settings.integrations.metaMcp.tokenEnc
 * (cifrado) o en la env META_MCP_TOKEN.
 */
import { getAnthropicForWorkspace, DEFAULT_MODEL } from "@/lib/ai/anthropic";
import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/ai/crypto";

const FB_MCP_URL = "https://mcp.facebook.com/ads";
const MCP_BETA = "mcp-client-2025-04-04";

export class MetaMcpNotConfiguredError extends Error {
  constructor(msg = "El conector de Meta (MCP) no está configurado en el Hub.") {
    super(msg);
  }
}

async function getMcpToken(workspaceId: string): Promise<string | null> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
  const v = (ws?.settings as any)?.integrations?.metaMcp ?? {};
  if (v.tokenEnc) {
    try {
      const t = decryptSecret(v.tokenEnc);
      if (t) return t;
    } catch {
      /* sigue a env */
    }
  }
  return process.env.META_MCP_TOKEN ?? null;
}

export async function isMetaMcpConfigured(workspaceId: string): Promise<boolean> {
  return !!(await getMcpToken(workspaceId));
}

/**
 * Ejecuta una instrucción de Meta Ads a través del MCP oficial de Meta.
 * Devuelve el texto-resultado del agente (qué hizo / qué encontró).
 */
export async function runMetaViaMcp(opts: {
  workspaceId: string;
  instruction: string;
}): Promise<{ ok: boolean; text: string }> {
  const token = await getMcpToken(opts.workspaceId);
  if (!token) throw new MetaMcpNotConfiguredError();
  const client = await getAnthropicForWorkspace(opts.workspaceId);

  const messages: any[] = [{ role: "user", content: opts.instruction }];
  for (let i = 0; i < 12; i++) {
    const resp = await (client as any).beta.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 4096,
      betas: [MCP_BETA],
      mcp_servers: [
        { type: "url", url: FB_MCP_URL, name: "facebook_ads", authorization_token: token }
      ],
      system:
        "Eres Sonia, la gestora de Meta Ads de la agencia Negocio Vivo. Ejecuta la " +
        "instrucción usando las herramientas de Meta disponibles (autenticadas con acceso " +
        "total del usuario). Sé precisa y reporta SIEMPRE el resultado real. Los cambios que " +
        "gastan dinero (crear/activar/pausar campañas, presupuestos) hazlos SOLO si la " +
        "instrucción lo pide explícitamente; si hay duda, describe lo que harías sin ejecutarlo.",
      messages
    });
    // pause_turn: el conector MCP pausó un turno largo → reanudar.
    if (resp.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: resp.content });
      continue;
    }
    const text = (resp.content || [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n")
      .trim();
    return { ok: true, text: text || "(sin respuesta)" };
  }
  return { ok: false, text: "El agente de Meta (MCP) no terminó a tiempo. Acota la gestión y reintenta." };
}
