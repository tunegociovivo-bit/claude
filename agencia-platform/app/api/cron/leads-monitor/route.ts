/**
 * Cron de monitorización continua de leads. Revisa las búsquedas marcadas como
 * "monitorizadas" y detecta:
 *   - Negocios NUEVOS en la zona/nicho → se añaden como leads (marcados 🆕).
 *   - Caídas de rating de negocios ya captados → se marcan como calientes 📉.
 *
 * Pensado para correr cada pocas horas. Acotado por run para controlar el coste
 * de Google Places. Seguridad: Authorization: Bearer ${CRON_SECRET} o ?secret=.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { placesTextSearch, placeDetails } from "@/lib/leads/google-places";
import { findProvince } from "@/lib/leads/spain-provinces";

export const dynamic = "force-dynamic";

const SEARCHES_PER_RUN = 15; // tope por ejecución (coste Places)
const DROP_THRESHOLD = 0.2; // bajada de rating que consideramos relevante
const RECHECK_HOURS = 6; // no revisar la misma búsqueda más de cada 6 h

async function authorize(req: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return new URL(req.url).searchParams.get("secret") === secret;
}

export async function GET(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Monitorizadas que tocan revisar (nunca revisadas o hace > RECHECK_HOURS),
  // las más antiguas primero. Así el tick puede llamarse a menudo sin gastar
  // de más: solo actúa sobre las que están "vencidas".
  const due = new Date(Date.now() - RECHECK_HOURS * 60 * 60 * 1000);
  const searches = await prisma.leadSearch.findMany({
    where: {
      monitored: true,
      source: "places",
      OR: [{ lastMonitoredAt: null }, { lastMonitoredAt: { lt: due } }]
    },
    orderBy: [{ lastMonitoredAt: { sort: "asc", nulls: "first" } }],
    take: SEARCHES_PER_RUN
  });

  let newLeads = 0;
  let drops = 0;
  let checked = 0;

  for (const s of searches) {
    try {
      const prov = findProvince(s.location);
      const results = await placesTextSearch({
        workspaceId: s.workspaceId,
        query: `${s.keyword} en ${s.location}`.trim(),
        lat: prov?.lat,
        lng: prov?.lng,
        province: prov?.name ?? s.location,
        maxPages: 1 // 1 página por monitor: barato y suficiente para detectar novedades
      });
      checked++;

      for (const r of results) {
        if (!r.placeId) continue;
        const existing = await prisma.lead.findUnique({
          where: { workspaceId_placeId: { workspaceId: s.workspaceId, placeId: r.placeId } },
          select: { id: true, rating: true, notes: true, contactStatus: true }
        });

        if (!existing) {
          // Negocio nuevo en la zona → lead nuevo, marcado para que destaque.
          await prisma.lead.create({
            data: {
              workspaceId: s.workspaceId,
              searchId: s.id,
              placeId: r.placeId,
              name: r.name,
              address: r.formattedAddress,
              formattedAddress: r.formattedAddress,
              province: r.province ?? prov?.name ?? s.location,
              phone: r.phone,
              internationalPhone: r.internationalPhone,
              website: r.website,
              category: r.category,
              types: r.types,
              latitude: r.latitude,
              longitude: r.longitude,
              gmbUrl: r.gmbUrl,
              businessStatus: r.businessStatus,
              rating: r.rating,
              reviewsCount: r.userRatingCount,
              rawData: r.rawData,
              urgency: "alta",
              contactStatus: "pending",
              notes: "🆕 Detectado por monitorización continua."
            }
          });
          newLeads++;
        } else if (
          r.rating != null &&
          existing.rating != null &&
          r.rating <= existing.rating - DROP_THRESHOLD &&
          !["client", "discarded"].includes(existing.contactStatus)
        ) {
          // Caída de rating → lead caliente (encaje perfecto con el pitch).
          const note = `📉 Rating bajó de ${existing.rating} a ${r.rating} (monitorización).`;
          // Bajamos las reseñas para dejar lista la negativa real ({{resena_negativa}}).
          let reviewData: any = {};
          try {
            const details = await placeDetails({ workspaceId: s.workspaceId, placeId: r.placeId });
            reviewData = {
              reviewsJson: details.reviews ?? [],
              positivePct: details.positivePct,
              negativePct: details.negativePct,
              neutralPct: details.neutralPct
            };
          } catch {
            /* best-effort: sin reseñas, igual marcamos el drop */
          }
          await prisma.lead.update({
            where: { id: existing.id },
            data: {
              rating: r.rating,
              reviewsCount: r.userRatingCount,
              urgency: "critica",
              notes: existing.notes ? `${note}\n${existing.notes}` : note,
              ...reviewData
            }
          });
          drops++;
        } else if (r.rating != null) {
          // Sin novedad relevante: solo refrescamos rating/reseñas.
          await prisma.lead.update({
            where: { id: existing.id },
            data: { rating: r.rating, reviewsCount: r.userRatingCount }
          });
        }
      }

      await prisma.leadSearch.update({
        where: { id: s.id },
        data: { lastMonitoredAt: new Date() }
      });
    } catch (e: any) {
      console.error(`[leads-monitor] búsqueda ${s.id} fallo:`, e?.message ?? e);
    }
  }

  return NextResponse.json({ ok: true, searchesChecked: checked, newLeads, drops });
}
