const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
  "image/jpeg",
  "image/png",
  "image/webp"
]);

export function validateWhatsappAttachment(file: { name: string; type: string; size: number }): string | null {
  if (!file.name.trim()) return "El archivo no tiene nombre.";
  if (file.size <= 0) return "El archivo está vacío.";
  if (file.size > MAX_ATTACHMENT_BYTES) return "El archivo supera el límite de 20 MB.";
  if (!ALLOWED_ATTACHMENT_TYPES.has(file.type.toLowerCase())) {
    return "Tipo de archivo no permitido. Usa PDF, Word, Excel, CSV, texto o imagen.";
  }
  return null;
}

export function buildCommercialReplyAlert(opts: {
  leadName: string | null;
  phone: string;
  taskTitle: string;
  conversationUrl: string;
  messages: Array<{ direction: "in" | "out"; body: string }>;
}): string {
  const transcript = opts.messages
    .map((message) => `${message.direction === "out" ? "Nosotros" : "Lead"}: ${message.body.trim()}`)
    .join("\n\n");
  const available = 3300;
  const visibleTranscript = transcript.length > available
    ? `…\n${transcript.slice(-available)}`
    : transcript;
  return [
    "💬 *Un lead de tu proyecto ha respondido*",
    `*Lead:* ${opts.leadName || opts.phone}`,
    `*Tarea:* ${opts.taskTitle}`,
    "",
    "*Conversación:*",
    visibleTranscript,
    "",
    "👉 *Abrir conversación completa y responder:*",
    opts.conversationUrl
  ].join("\n");
}
