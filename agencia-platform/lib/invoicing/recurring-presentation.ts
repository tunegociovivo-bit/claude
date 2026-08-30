type RecurringDelivery = {
  nextRunAt: string | null;
  recipientEmail: string | null;
  bccEmails: string[];
};

type RecurringDashboardDelivery = RecurringDelivery & {
  id: string;
  contactName: string | null;
  status: "active" | "paused";
  sendAutomatically: boolean;
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

export function upcomingRecurringDeliveries(deliveries: RecurringDashboardDelivery[], limit = 3) {
  return deliveries
    .filter((delivery) => delivery.status === "active")
    .sort((a, b) => {
      const aTime = a.nextRunAt ? new Date(a.nextRunAt).getTime() : Number.POSITIVE_INFINITY;
      const bTime = b.nextRunAt ? new Date(b.nextRunAt).getTime() : Number.POSITIVE_INFINITY;
      return (Number.isFinite(aTime) ? aTime : Number.POSITIVE_INFINITY) - (Number.isFinite(bTime) ? bTime : Number.POSITIVE_INFINITY);
    })
    .slice(0, Math.max(0, limit))
    .map((delivery) => ({ ...delivery, ...recurringDeliverySummary(delivery) }));
}
