import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

type Credentials = { clientId: string; clientSecret: string };
type AppointmentLike = {
  id?: string;
  customerName: string;
  customerPhone: string | null;
  startsAt: Date;
  durationMin: number;
  notes: string | null;
  status: string;
  googleEventId?: string | null;
};

export function googleCalendarConfigured(credentials: Credentials = googleCredentials()) {
  return Boolean(credentials.clientId && credentials.clientSecret);
}

export function googleCredentials(): Credentials {
  return {
    clientId: process.env.GOOGLE_CALENDAR_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET || "",
  };
}

export function buildGoogleEvent(appointment: AppointmentLike) {
  const end = new Date(appointment.startsAt.getTime() + appointment.durationMin * 60_000);
  return {
    summary: `Cita · ${appointment.customerName}`,
    description: [
      appointment.customerPhone ? `Teléfono: ${appointment.customerPhone}` : "",
      appointment.notes ? `Notas: ${appointment.notes}` : "",
      "Sincronizado desde CRM Ventas · Negocio Vivo",
    ].filter(Boolean).join("\n"),
    start: { dateTime: appointment.startsAt.toISOString(), timeZone: "Europe/Madrid" },
    end: { dateTime: end.toISOString(), timeZone: "Europe/Madrid" },
    status: appointment.status === "cancelada" ? "cancelled" : "confirmed",
  };
}

async function refreshAccessToken(workspaceId: string) {
  const connection = await prisma.googleCalendarConnection.findUnique({ where: { workspaceId } });
  if (!connection) return null;
  if (connection.accessTokenEnc && connection.expiresAt && connection.expiresAt.getTime() > Date.now() + 60_000) {
    return { token: decryptSecret(connection.accessTokenEnc), connection };
  }
  const credentials = googleCredentials();
  if (!googleCalendarConfigured(credentials)) return null;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: decryptSecret(connection.refreshTokenEnc),
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) throw new Error(`Google OAuth refresh ${response.status}`);
  const tokens = await response.json();
  const expiresAt = new Date(Date.now() + Number(tokens.expires_in ?? 3600) * 1000);
  await prisma.googleCalendarConnection.update({
    where: { workspaceId },
    data: { accessTokenEnc: encryptSecret(tokens.access_token), expiresAt },
  });
  return { token: String(tokens.access_token), connection: { ...connection, expiresAt } };
}

async function googleRequest(workspaceId: string, path: string, init: RequestInit) {
  const auth = await refreshAccessToken(workspaceId);
  if (!auth) return null;
  const response = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    throw new Error(`Google Calendar ${response.status}`);
  }
  return { response, calendarId: auth.connection.calendarId };
}

export async function syncAppointmentToGoogle(workspaceId: string, appointmentId: string) {
  const appointment = await prisma.appointment.findFirst({ where: { id: appointmentId, workspaceId } });
  if (!appointment) return;
  const connection = await prisma.googleCalendarConnection.findUnique({ where: { workspaceId } });
  if (!connection) return;
  if (appointment.status === "cancelada") {
    if (appointment.googleEventId) await deleteAppointmentFromGoogle(workspaceId, appointment.googleEventId);
    return;
  }
  const resource = JSON.stringify(buildGoogleEvent(appointment));
  const encodedCalendar = encodeURIComponent(connection.calendarId);
  if (appointment.googleEventId) {
    await googleRequest(workspaceId, `/calendars/${encodedCalendar}/events/${encodeURIComponent(appointment.googleEventId)}`, { method: "PATCH", body: resource });
    return;
  }
  const result = await googleRequest(workspaceId, `/calendars/${encodedCalendar}/events`, { method: "POST", body: resource });
  if (!result?.response.ok) return;
  const created = await result.response.json();
  if (created.id) await prisma.appointment.update({ where: { id: appointment.id }, data: { googleEventId: created.id } });
}

export async function deleteAppointmentFromGoogle(workspaceId: string, eventId: string) {
  const connection = await prisma.googleCalendarConnection.findUnique({ where: { workspaceId } });
  if (!connection) return;
  await googleRequest(workspaceId, `/calendars/${encodeURIComponent(connection.calendarId)}/events/${encodeURIComponent(eventId)}`, { method: "DELETE" });
}

export async function syncFutureAppointments(workspaceId: string) {
  const appointments = await prisma.appointment.findMany({
    where: { workspaceId, startsAt: { gte: new Date() }, status: { not: "cancelada" } },
    select: { id: true }, take: 500,
  });
  for (const appointment of appointments) await syncAppointmentToGoogle(workspaceId, appointment.id);
}
