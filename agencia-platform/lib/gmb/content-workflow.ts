/**
 * Flujo de CONTENIDO GBP (borradores) — máquina de estados PURA. La publicación externa está
 * adapter-gated y NUNCA es automática sin aprobación: para llegar a `scheduled` hay que pasar por
 * `approved`, y solo entonces el publicador externo puede pasarlo a `published`.
 */
export type PostStatus = "draft" | "pending_approval" | "approved" | "scheduled" | "published" | "failed";
export type PostCommand = "submit" | "approve" | "reject" | "schedule" | "unschedule" | "publish" | "fail" | "revert";
export type PostType = "update" | "offer" | "event";

const TRANSITIONS: Record<PostCommand, { from: PostStatus[]; to: PostStatus }> = {
  submit: { from: ["draft"], to: "pending_approval" },
  approve: { from: ["pending_approval"], to: "approved" },
  reject: { from: ["pending_approval"], to: "draft" },
  schedule: { from: ["approved"], to: "scheduled" },
  unschedule: { from: ["scheduled"], to: "approved" },
  publish: { from: ["scheduled"], to: "published" }, // solo el publicador externo (adapter)
  fail: { from: ["scheduled", "approved"], to: "failed" },
  revert: { from: ["failed", "published"], to: "draft" }
};

export type PostTransition = { ok: boolean; next?: PostStatus; error?: string };

export function computePostTransition(status: PostStatus, command: PostCommand, ctx: { actorId?: string | null; scheduledAt?: string | Date | null } = {}): PostTransition {
  const rule = TRANSITIONS[command];
  if (!rule) return { ok: false, error: `comando desconocido: ${command}` };
  if (!rule.from.includes(status)) return { ok: false, error: `transición inválida ${status} → ${command}` };
  if (command === "approve" && !ctx.actorId) return { ok: false, error: "la aprobación requiere un actor humano" };
  if (command === "schedule" && !ctx.scheduledAt) return { ok: false, error: "programar requiere fecha/hora" };
  return { ok: true, next: rule.to };
}

export type DraftInput = { title?: string | null; content?: string | null; postType?: string | null; cta?: string | null; imageUrl?: string | null; scheduledAt?: string | null };
export type DraftValidation = { ok: boolean; errors: string[]; normalized: { title: string; content: string; postType: PostType; cta: string; imageUrl: string | null; scheduledAt: string | null } };

const VALID_TYPES: PostType[] = ["update", "offer", "event"];

/** Valida y normaliza un borrador de publicación GBP (longitudes, tipo, imagen, fecha). */
export function validateDraft(input: DraftInput, now: Date = new Date(0)): DraftValidation {
  const errors: string[] = [];
  const content = (input.content ?? "").trim();
  const title = (input.title ?? "").trim();
  const postType = (VALID_TYPES.includes(input.postType as PostType) ? input.postType : "update") as PostType;
  if (!content) errors.push("El contenido es obligatorio.");
  if (content.length > 1500) errors.push("El contenido supera el máximo de 1500 caracteres.");
  if (title.length > 120) errors.push("El título supera 120 caracteres.");
  const imageUrl = (input.imageUrl ?? "").trim() || null;
  if (imageUrl && !/^https?:\/\//i.test(imageUrl)) errors.push("La imagen debe ser una URL http(s) válida.");
  let scheduledAt: string | null = null;
  if (input.scheduledAt) {
    const d = new Date(input.scheduledAt);
    if (isNaN(d.getTime())) errors.push("Fecha de programación inválida.");
    else if (now.getTime() > 0 && d.getTime() < now.getTime()) errors.push("La fecha de programación debe ser futura.");
    else scheduledAt = d.toISOString();
  }
  return { ok: errors.length === 0, errors, normalized: { title, content, postType, cta: (input.cta ?? "").trim(), imageUrl, scheduledAt } };
}
