/**
 * Filtro de compliance pre-ejecución de drafts (Fase 36).
 *
 * Antes de enviar un email/WhatsApp/post a aprobación o auto-aprobación,
 * pasa el contenido por Claude con un prompt acotado a:
 *   - GDPR: datos personales mencionados que no deberían enviarse
 *   - LSSI / opt-out claro en comunicaciones comerciales
 *   - Lenguaje publicitario falso o engañoso (claims no soportados)
 *   - Mención de competidores con afirmaciones potencialmente difamatorias
 *
 * Devuelve { ok: true } si está limpio, o { ok: false, reason, suggestion }
 * si hay un problema. El caller decide: bloquear, marcar como REQUIRES_HUMAN,
 * o reformular pidiéndole a la IA un re-draft.
 *
 * Coste: 1 llamada Claude ~$0.001 por draft. Vale la pena para sectores
 * regulados; en sectores no regulados el workspace puede desactivarlo
 * (settings.aiAgent.compliance.enabled = false, default true).
 */

import { complete } from "@/lib/ai/anthropic";
import { prisma } from "@/lib/db/prisma";

const COMPLIANCE_SYSTEM = `Eres un revisor de COMPLIANCE para comunicaciones comerciales. Tu trabajo es identificar si un mensaje (email/WhatsApp/post) tiene problemas legales o éticos OBVIOS antes de enviarlo.

Categorías de problema:
- GDPR: ¿menciona datos personales de TERCEROS sin justificación? (Email del destinatario es OK; mencionar a otra persona con detalles privados NO.)
- LSSI: si es comunicación comercial a alguien que no es cliente confirmado, ¿incluye opt-out o forma de darse de baja?
- Publicidad falsa: ¿hace claims medibles sin evidencia? ("el mejor", "100% efectivo", "número 1").
- Difamación: ¿menciona competidores con afirmaciones que pueden ser falsas?
- Tono: ¿lenguaje claramente ofensivo/discriminatorio?

NO detectes:
- Errores tipográficos
- Cuestiones de estilo subjetivo
- Frases que un humano normal escribiría

Devuelves SIEMPRE JSON: { "ok": boolean, "reason": string?, "suggestion": string? }
Si no detectas problemas serios, ok=true. Si dudas → ok=true. Solo bloquea cosas claramente problemáticas.`;

export type ComplianceResult = {
  ok: boolean;
  reason?: string;
  suggestion?: string;
};

export async function checkCompliance(opts: {
  workspaceId: string;
  kind: string; // EMAIL | WHATSAPP | EDITORIAL_POST | etc
  contentText: string;
  context?: string;
}): Promise<ComplianceResult> {
  // Opt-out global por workspace
  const ws = await prisma.workspace.findUnique({
    where: { id: opts.workspaceId },
    select: { settings: true }
  });
  const enabled = (ws?.settings as any)?.aiAgent?.compliance?.enabled !== false;
  if (!enabled) return { ok: true };
  if (!opts.contentText || opts.contentText.trim().length < 5) return { ok: true };

  try {
    const user =
      `Tipo: ${opts.kind}\n` +
      (opts.context ? `Contexto: ${opts.context}\n` : "") +
      `\nContenido del mensaje:\n---\n${opts.contentText.slice(0, 8000)}\n---\n\n` +
      `Devuelve JSON con la decisión.`;
    const resp = await complete({
      workspaceId: opts.workspaceId,
      system: COMPLIANCE_SYSTEM,
      user,
      maxTokens: 400,
      feature: "nv-ia-compliance"
    });
    // Parse defensivo — buscamos el primer JSON válido
    const m = resp.match(/\{[\s\S]*?\}/);
    if (!m) return { ok: true };
    const parsed = JSON.parse(m[0]);
    if (typeof parsed.ok !== "boolean") return { ok: true };
    return {
      ok: parsed.ok,
      reason: parsed.reason ?? undefined,
      suggestion: parsed.suggestion ?? undefined
    };
  } catch (e) {
    // Si el filtro falla, NO bloqueamos (fail-open) — la IA y el humano
    // siguen siendo los gatekeepers. Logueamos para debug.
    console.warn("[nv-ia compliance]", (e as Error).message);
    return { ok: true };
  }
}
