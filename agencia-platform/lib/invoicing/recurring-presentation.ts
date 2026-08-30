type RecurringDelivery = {
  nextRunAt: string | null;
  recipientEmail: string | null;
  bccEmails: string[];
};

export function recurringDeliverySummary(delivery: RecurringDelivery) {
  const bccEmails = Array.isArray(delivery.bccEmails)
    ? [...new Set(delivery.bccEmails.map((email) => email.trim().toLowerCase()).filter(Boolean))]
    : [];
  const nextRunAt = delivery.nextRunAt ? new Date(delivery.nextRunAt) : null;

  return {
    date: !nextRunAt ? "—" : Number.isFinite(nextRunAt.getTime())
      ? new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid" }).format(nextRunAt)
      : "Fecha inválida",
    recipient: delivery.recipientEmail?.trim() || "Sin correo configurado",
    bcc: bccEmails.length ? bccEmails.join(", ") : null
  };
}
