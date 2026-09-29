import { prisma } from '@/lib/db/prisma';
import { deleteObject, deleteObjectsWithPrefix, isStorageEnabled } from '@/lib/storage/r2';

/** Accept only this storage origin and paths owned by the verified account. */
export function ownedMediaKey(value: string, customerId: string, purchaseIds: string[], offerIds: string[]): string | null {
  try {
    const url = new URL(value);
    const bases = [process.env.STORAGE_PUBLIC_URL, process.env.STORAGE_ENDPOINT && `${process.env.STORAGE_ENDPOINT}/${process.env.STORAGE_BUCKET}`].filter(Boolean) as string[];
    const base = bases.map(v => new URL(v)).find(b => b.origin === url.origin && url.pathname.startsWith(b.pathname.replace(/\/$/, '') + '/'));
    if (!base) return null;
    const key = decodeURIComponent(url.pathname.slice(base.pathname.replace(/\/$/, '').length + 1));
    if (key.includes('..') || key.includes('\\')) return null;
    const safe = customerId.replace(/[^\w-]+/g, '').slice(0, 40);
    const prefixes = [`bubui/tickets/${safe}/`, ...purchaseIds.map(id => `bubui/pp/${id}/${safe}-`), ...offerIds.map(id => `bubui/challenge/${id}/${safe}-`)];
    return prefixes.some(p => key.startsWith(p)) ? key : null;
  } catch { return null; }
}

/** Remove owned media before removing references; failure leaves a retryable account. */
export async function deleteCustomerMedia(customerId: string): Promise<void> {
  const [tickets, offers, purchases, participants] = await Promise.all([
    prisma.bubuiTicketScan.findMany({ where: { customerId }, select: { ticketUrl: true } }),
    prisma.bubuiOffer.findMany({ where: { customerId }, select: { id: true, activationShotUrl: true } }),
    prisma.bubuiPurchase.findMany({ where: { customerId }, select: { id: true, ticketUrl: true } }),
    prisma.bubuiTableParticipant.findMany({ where: { customerId }, select: { sessionId: true, reviewShotUrl: true, socialShotUrl: true, followShotUrl: true } }),
  ]);
  const urls = [...tickets.map(t => t.ticketUrl), ...offers.map(o => o.activationShotUrl), ...purchases.map(p => p.ticketUrl), ...participants.flatMap(p => [p.reviewShotUrl, p.socialShotUrl, p.followShotUrl])].filter(Boolean) as string[];
  if (!isStorageEnabled()) { if (urls.length) throw new Error('media_storage_unavailable'); return; }
  const safe = customerId.replace(/[^\w-]+/g, '').slice(0, 40);
  if (!safe) throw new Error('invalid_media_owner');
  // Prefix listing also removes uploads rejected by AI before a URL was saved.
  const prefixes = [`bubui/tickets/${safe}/`, ...purchases.map(p => `bubui/pp/${p.id}/${safe}-`), ...offers.map(o => `bubui/challenge/${o.id}/${safe}-`), ...participants.map(p => `bubui/mesa/${p.sessionId}/${safe}-`)];
  for (const prefix of new Set(prefixes)) await deleteObjectsWithPrefix(prefix);
  for (const url of urls) {
    const key = ownedMediaKey(url, customerId, purchases.map(p => p.id), offers.map(o => o.id));
    if (key) await deleteObject(key);
  }
}
