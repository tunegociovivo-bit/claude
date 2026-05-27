/**
 * Ejecuta una búsqueda guardada del buscador GMB: geocodifica cada
 * localización, busca negocios cercanos (Maps), detecta cuáles son
 * "reclamables" (ScraperAPI), persiste resultados y actualiza totales.
 * Si aparecen nuevas fichas reclamables, crea notificación + email.
 */
import { prisma } from "@/lib/db/prisma";
import { placesNearby, resolveCoords } from "@/lib/integrations/google-maps";
import { checkClaimable } from "@/lib/integrations/scraperapi";
import { createGmbNotification, getGmbConfig } from "@/lib/integrations/gmb-hub";

export async function runGmbSearch(opts: {
  workspaceId: string;
  search: { id: string; name: string; locations: string; keyword: string; type: string; radiusKm: number };
  verify?: boolean; // detectar reclamables (lento, usa ScraperAPI)
}): Promise<{ found: number; claimable: number; newClaimable: Array<{ name: string; address: string }> }> {
  const { workspaceId } = opts;
  const s = opts.search;
  const locs = s.locations
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const byPlace = new Map<string, any>();
  for (const loc of locs) {
    const coords = await resolveCoords({ workspaceId, query: loc });
    if (!coords) continue;
    const places = await placesNearby({
      workspaceId,
      lat: coords.lat,
      lng: coords.lng,
      radius: (s.radiusKm || 3) * 1000,
      keyword: s.keyword || undefined,
      type: s.type || undefined
    });
    for (const p of places) {
      if (p.placeId && !byPlace.has(p.placeId)) byPlace.set(p.placeId, p);
    }
  }

  const places = Array.from(byPlace.values());
  const newClaimable: Array<{ name: string; address: string }> = [];
  let claimableCount = 0;

  for (const p of places) {
    let isClaimable = false;
    let checked = false;
    if (opts.verify) {
      try {
        const res = await checkClaimable({ workspaceId, placeId: p.placeId, name: p.name });
        if (res === true) isClaimable = true;
        checked = res !== null;
      } catch {
        checked = false;
      }
    }
    if (isClaimable) claimableCount++;

    const existing = await prisma.gmbSearchResult.findUnique({
      where: { searchId_placeId: { searchId: s.id, placeId: p.placeId } },
      select: { id: true, isClaimable: true }
    });
    if (isClaimable && (!existing || !existing.isClaimable)) {
      newClaimable.push({ name: p.name ?? "", address: p.address ?? "" });
    }

    await prisma.gmbSearchResult.upsert({
      where: { searchId_placeId: { searchId: s.id, placeId: p.placeId } },
      create: {
        workspaceId,
        searchId: s.id,
        placeId: p.placeId,
        name: p.name ?? "",
        address: p.address ?? "",
        rating: p.rating ?? 0,
        reviewCount: p.reviewCount ?? 0,
        lat: p.lat ?? 0,
        lng: p.lng ?? 0,
        isClaimable,
        checked,
        checkedAt: checked ? new Date() : null
      },
      update: {
        name: p.name ?? undefined,
        address: p.address ?? undefined,
        rating: p.rating ?? undefined,
        reviewCount: p.reviewCount ?? undefined,
        lat: p.lat ?? undefined,
        lng: p.lng ?? undefined,
        ...(checked ? { isClaimable, checked: true, checkedAt: new Date() } : {})
      }
    });
  }

  await prisma.gmbSearch.update({
    where: { id: s.id },
    data: { totalFound: places.length, totalClaimable: claimableCount, lastRun: new Date() }
  });

  // Avisar de nuevas reclamables
  if (newClaimable.length > 0) {
    await createGmbNotification({
      workspaceId,
      type: "claimable",
      title: `${newClaimable.length} ficha(s) reclamable(s) — ${s.name}`,
      body: newClaimable.slice(0, 10).map((c) => `${c.name} (${c.address})`).join("; "),
      data: { searchId: s.id, count: newClaimable.length }
    }).catch(() => {});

    const cfg = await getGmbConfig(workspaceId);
    if (cfg.notifyEmail) {
      try {
        const { sendEmail, isEmailEnabled } = await import("./email");
        if (isEmailEnabled()) {
          const rows = newClaimable
            .map((c) => `<tr><td style="padding:6px">${esc(c.name)}</td><td style="padding:6px;color:#666">${esc(c.address)}</td></tr>`)
            .join("");
          await sendEmail({
            to: cfg.notifyEmail.split(",").map((x) => x.trim()).filter(Boolean),
            subject: `[GMB Hub] ${newClaimable.length} fichas reclamables — ${s.name}`,
            html: `<div style="font-family:Arial,sans-serif"><h2>Fichas reclamables encontradas</h2><p>Búsqueda: <b>${esc(s.name)}</b></p><table style="border-collapse:collapse">${rows}</table></div>`
          });
        }
      } catch {}
    }
  }

  return { found: places.length, claimable: claimableCount, newClaimable };
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] ?? c));
}
