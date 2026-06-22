/**
 * Calentamiento por conversación entre TUS propios teléfonos.
 *
 * Un número recién vinculado gana reputación si tiene actividad "humana" antes
 * de empezar a escribir a desconocidos. Este job hace que los números en
 * calentamiento se manden, muy de vez en cuando y en horario diurno, mensajes
 * cortos y normales a los OTROS números que ya tienes funcionando.
 *
 * Es OPT-IN (settings.leads.warmupChatEnabled) y requiere que cada canal tenga
 * su `phone` (E.164) configurado. Volumen bajo y espaciado para parecer real.
 */
import { prisma } from "@/lib/db/prisma";
import { sendText, normalizePhone } from "./waha";
import { channelWarmupCap } from "./channels";

const MAX_PER_DAY = 6; // mensajes de calentamiento por número y día
const MIN_GAP_MIN = 40; // minutos mínimos entre mensajes de un mismo número
const DAY_START_UTC = 8; // ~09-10 Madrid
const DAY_END_UTC = 20; // ~21-22 Madrid

const PHRASES = [
  "Hola! 👋", "¿Todo bien?", "Buenas, ¿cómo va?", "Genial, gracias 🙌", "Perfecto",
  "Nos vemos 👍", "Vale, hablamos", "Buenos días ☀️", "Todo correcto por aquí",
  "Ok, anotado", "Gracias!", "Estupendo", "Luego te cuento", "👌"
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export async function runWarmupConversations(): Promise<void> {
  const hour = new Date().getUTCHours();
  if (hour < DAY_START_UTC || hour >= DAY_END_UTC) return; // solo horario diurno

  const workspaces = await prisma.workspace.findMany({ select: { id: true } });
  for (const ws of workspaces) {
    try {
      await runForWorkspace(ws.id);
    } catch (e) {
      console.warn("[warmup-chat]", ws.id, (e as Error).message);
    }
  }
}

async function runForWorkspace(workspaceId: string): Promise<void> {
  const w = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  const leads: any = (w?.settings as any)?.leads;
  if (!leads || leads.warmupChatEnabled !== true) return;

  const channels: any[] = (Array.isArray(leads.channels) ? leads.channels : []).filter(
    (c: any) => c && typeof c.name === "string" && c.name.trim() && c.active !== false
  );
  // Destinos posibles: cualquier teléfono tuyo configurado (canales + principal).
  const phones: { name: string; phone: string }[] = [];
  for (const c of channels) if (c.phone) phones.push({ name: c.name, phone: String(c.phone) });
  if (leads.principalPhone) phones.push({ name: "__principal__", phone: String(leads.principalPhone) });
  if (phones.length < 2) return; // hacen falta al menos 2 teléfonos para "hablar"

  // Números en calentamiento (con teléfono) que mandarán los mensajes.
  const warming = channels.filter((c) => c.phone && channelWarmupCap(c, leads).warming);
  if (warming.length === 0) return;

  const today = new Date().toISOString().slice(0, 10);
  const state: Record<string, { day: string; count: number; lastAt: number }> = leads.warmupChat ?? {};
  let changed = false;

  for (const ch of warming) {
    let st = state[ch.name];
    if (!st || st.day !== today) st = { day: today, count: 0, lastAt: 0 };
    if (st.count >= MAX_PER_DAY) continue;
    const gapMs = (MIN_GAP_MIN + Math.floor(Math.random() * 30)) * 60_000;
    if (Date.now() - st.lastAt < gapMs) continue;

    // Destino: otro teléfono distinto del que envía.
    const targets = phones.filter((p) => p.name !== ch.name);
    if (targets.length === 0) continue;
    const target = pick(targets);
    const phoneNormalized = normalizePhone(target.phone);
    if (!phoneNormalized) continue;

    try {
      await sendText({ workspaceId, phoneNormalized, text: pick(PHRASES), session: ch.name });
      st.count += 1;
      st.lastAt = Date.now();
      state[ch.name] = st;
      changed = true;
    } catch (e) {
      console.warn("[warmup-chat] send", ch.name, (e as Error).message);
    }
  }

  if (changed) {
    const settings: any = w!.settings ?? {};
    settings.leads = settings.leads ?? {};
    settings.leads.warmupChat = state;
    await prisma.workspace.update({ where: { id: workspaceId }, data: { settings } });
  }
}
