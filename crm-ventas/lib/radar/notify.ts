import "server-only";
import { prisma } from "@/lib/prisma";
import { sendOperationalWhatsapp } from "@/lib/waha";
import { sendOpsEmail } from "@/lib/notify-email";
import { getWorkspaceSettings, publicBaseUrl } from "@/lib/settings";
import { getRadarConfig } from "./settings";
import { formatEuros, formatKm, FUEL_LABELS, type Fuel } from "./normalize";
import { getPortal } from "./portals";
import type { NewMatch } from "./match";

// Avisos de coches encontrados. Agrupa todos los matches nuevos de un pase en un
// solo mensaje por destino (no un WhatsApp por coche). Marca cada match como
// avisado para no repetirlo. Nunca manda credenciales.

type MatchRow = NewMatch & {
  listing: {
    title: string; portal: string; url: string | null; price: number | null; priceLabel: string | null;
    km: number | null; year: number | null; fuel: string | null; location: string | null; auctionEndsAt: Date | null;
  };
};

function line(m: MatchRow): string {
  const l = m.listing;
  const portal = getPortal(l.portal)?.name ?? l.portal;
  const bits = [l.title];
  const specs = [l.year ? String(l.year) : null, l.km !== null ? formatKm(l.km) : null, l.fuel ? FUEL_LABELS[l.fuel as Fuel] ?? l.fuel : null].filter(Boolean);
  if (specs.length) bits.push(specs.join(" · "));
  if (l.price !== null) bits.push(`${l.priceLabel ? l.priceLabel + ": " : ""}${formatEuros(l.price)}`);
  let text = `• ${bits.join(" — ")} [${portal}]`;
  if (l.auctionEndsAt) text += `\n  Termina: ${l.auctionEndsAt.toLocaleString("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`;
  if (l.url) text += `\n  ${l.url}`;
  return text;
}

function buildMessages(matchesBySearch: Map<string, MatchRow[]>): { whatsapp: string; email: Array<[string, string]> } {
  const sections: string[] = [];
  const emailRows: Array<[string, string]> = [];
  for (const [searchName, rows] of matchesBySearch) {
    sections.push(`🔎 ${searchName} — ${rows.length} coche(s):\n${rows.map(line).join("\n")}`);
    emailRows.push([searchName, rows.map((m) => `${m.listing.title} · ${m.listing.price !== null ? formatEuros(m.listing.price) : "—"} · ${getPortal(m.listing.portal)?.name ?? m.listing.portal}${m.listing.url ? ` — ${m.listing.url}` : ""}`).join("\n")]);
  }
  return { whatsapp: sections.join("\n\n"), email: emailRows };
}

/** Avisa de los matches nuevos del pase. Devuelve cuántos se notificaron. */
export async function notifyNewMatches(workspaceId: string, matches: NewMatch[]): Promise<{ notified: number; errors: string[] }> {
  if (matches.length === 0) return { notified: 0, errors: [] };
  const listingIds = [...new Set(matches.map((m) => m.listingId))];
  const listings = await prisma.radarListing.findMany({
    where: { id: { in: listingIds } },
    select: { id: true, title: true, portal: true, url: true, price: true, priceLabel: true, km: true, year: true, fuel: true, location: true, auctionEndsAt: true },
  });
  const byId = new Map(listings.map((l) => [l.id, l] as const));
  const rows: MatchRow[] = matches.map((m) => ({ ...m, listing: byId.get(m.listingId)! })).filter((m) => m.listing);

  const config = await getRadarConfig(workspaceId);
  const [settings, workspace] = await Promise.all([
    getWorkspaceSettings(workspaceId),
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } }),
  ]);

  const errors: string[] = [];
  const base = publicBaseUrl();

  // WhatsApp: solo los matches de búsquedas con aviso por WhatsApp activado.
  const waRows = rows.filter((m) => m.notifyWhatsapp);
  if (waRows.length && config.notifyPhones.length) {
    const grouped = groupBySearch(waRows);
    const { whatsapp } = buildMessages(grouped);
    const header = `🚗 Radar de subastas — ${waRows.length} coche(s) nuevo(s)\n\n`;
    for (const phone of config.notifyPhones) {
      const r = await sendOperationalWhatsapp({ workspaceId, to: phone, text: header + whatsapp }).then(
        () => null,
        (e: Error) => e.message
      );
      if (r) errors.push(`WhatsApp ${phone}: ${r}`);
    }
  }

  // Email: los matches de búsquedas con aviso por email.
  const emailRows = rows.filter((m) => m.notifyEmail);
  if (emailRows.length && config.notifyEmails.length) {
    const grouped = groupBySearch(emailRows);
    const { email } = buildMessages(grouped);
    for (const to of config.notifyEmails) {
      const r = await sendOpsEmail({
        to,
        subject: `Radar de subastas — ${emailRows.length} coche(s) para ${workspace?.name ?? "tu negocio"}`,
        rows: email,
        actionUrl: `${base}/radar`,
        actionLabel: "Ver en el CRM",
      });
      if (!r.ok) errors.push(`Email ${to}: ${r.error}`);
    }
  }

  // Marca todos los matches como avisados (aunque algún canal fallara: se
  // registra el error, pero no se repite el aviso para no saturar al cliente).
  const now = new Date();
  await prisma.radarMatch.updateMany({
    where: { id: { in: rows.map((m) => m.matchId) } },
    data: { notifiedAt: now, notifyError: errors.length ? errors.join(" | ").slice(0, 500) : null },
  });

  return { notified: rows.length, errors };
}

function groupBySearch(rows: MatchRow[]): Map<string, MatchRow[]> {
  const map = new Map<string, MatchRow[]>();
  for (const r of rows) {
    const arr = map.get(r.searchName) ?? [];
    arr.push(r);
    map.set(r.searchName, arr);
  }
  return map;
}
