/**
 * GET /api/v1/me/external-calendars/events?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Descarga TODOS los calendarios externos del usuario en paralelo,
 * filtra por rango de fechas, y devuelve un array unificado de eventos
 * coloreados por calendario para pintar en la grid.
 *
 * Si una URL falla, se anota en lastError de ese calendario y se sigue
 * con los demás (no se rompe la vista entera).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { fetchAndParseIcs } from "@/lib/calendar/ics-parser";

const FETCH_TIMEOUT_MS = 15000;

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  if (!api.userId) throw new ApiError(401, "unauthorized", "No hay usuario");

  const url = new URL(req.url);
  const fromStr = url.searchParams.get("from"); // YYYY-MM-DD
  const toStr = url.searchParams.get("to");
  const from = fromStr ? new Date(fromStr + "T00:00:00Z") : null;
  const to = toStr ? new Date(toStr + "T23:59:59Z") : null;

  const cals = await prisma.userExternalCalendar.findMany({
    where: { userId: api.userId, workspaceId: api.workspaceId, enabled: true }
  });

  if (cals.length === 0) {
    return NextResponse.json({ events: [], calendars: [] });
  }

  const results = await Promise.all(
    cals.map(async (cal) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const events = await fetchAndParseIcs(cal.icsUrl, controller.signal);
        clearTimeout(timer);
        await prisma.userExternalCalendar
          .update({
            where: { id: cal.id },
            data: { lastSyncedAt: new Date(), lastError: null }
          })
          .catch(() => {});
        return { cal, events, error: null as string | null };
      } catch (e: any) {
        clearTimeout(timer);
        const errMsg = String(e?.message ?? e).slice(0, 200);
        await prisma.userExternalCalendar
          .update({
            where: { id: cal.id },
            data: { lastError: errMsg }
          })
          .catch(() => {});
        return { cal, events: [], error: errMsg };
      }
    })
  );

  // Aplanar y filtrar por rango.
  const merged: any[] = [];
  for (const { cal, events } of results) {
    for (const ev of events) {
      const start = new Date(ev.startIso);
      if (from && start < from) continue;
      if (to && start > to) continue;
      merged.push({
        id: `${cal.id}::${ev.uid}`,
        calendarId: cal.id,
        calendarName: cal.name,
        color: cal.color,
        title: ev.summary,
        description: ev.description,
        location: ev.location,
        startIso: ev.startIso,
        endIso: ev.endIso,
        allDay: ev.allDay,
        date: ev.startIso.slice(0, 10),
        time: ev.allDay ? undefined : ev.startIso.slice(11, 16),
        external: true
      });
    }
  }

  return NextResponse.json({
    events: merged,
    calendars: results.map(({ cal, error }) => ({
      id: cal.id,
      name: cal.name,
      color: cal.color,
      error
    }))
  });
});
