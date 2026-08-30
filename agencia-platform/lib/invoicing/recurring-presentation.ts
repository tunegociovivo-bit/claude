type RecurringDelivery = {
  nextRunAt: string | null;
  recipientEmail: string | null;
  bccEmails: string[];
};

export function recurringDeliverySummary(delivery: RecurringDelivery) {
  const bccEmails = Array.isArray(delivery.bccEmails)
    ? delivery.bccEmails.map((email) => email.trim()).filter(Boolean)
    : [];

  return {
    date: delivery.nextRunAt
      ? new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid" }).format(new Date(delivery.nextRunAt))
      : "—",
    recipient: delivery.recipientEmail?.trim() || "Sin correo configurado",
    bcc: bccEmails.length ? bccEmails.join(", ") : null
  };
}
