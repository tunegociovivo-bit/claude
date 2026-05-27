/**
 * Dispatcher de webhooks salientes. Cada evento del sistema (creación
 * de tarea, cambio de cliente, comentario nuevo…) puede llamar a
 * dispatchWebhook(workspaceId, "task.created", payload) y se enviará
 * a todas las webhooks activas suscritas a ese evento.
 *
 * Características:
 *  - Async: no bloquea la request principal (se ejecuta en background
 *    sin await en el handler).
 *  - Firmado: cada payload se firma con HMAC-SHA256(secret, body) y
 *    el hash se manda en la cabecera X-Hub-Signature-256. El
 *    receptor verifica con su secret para asegurarse de que viene
 *    de nosotros.
 *  - Reintentos: si el servidor del cliente devuelve 5xx, reintenta
 *    hasta 3 veces con backoff (1s, 4s, 16s). 4xx no se reintenta.
 *  - Cada intento queda registrado en WebhookDelivery.
 *
 * Eventos canónicos:
 *   - task.created / task.updated / task.deleted
 *   - client.created / client.updated / client.deleted / client.mrr_change
 *   - comment.created
 *   - editorial.approved / editorial.rejected
 */

import crypto from "node:crypto";
import { prisma } from "@/lib/db/prisma";

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [1000, 4000, 16000];

export async function dispatchWebhook(
  workspaceId: string,
  event: string,
  payload: Record<string, any>
): Promise<void> {
  // Sin await en el handler que llama: usamos void para fire-and-forget
  // (la promesa se evalúa en background). Si quieres bloquear, usa
  // dispatchWebhookSync.
  void dispatchWebhookSync(workspaceId, event, payload).catch((e) =>
    console.warn("[webhook] dispatch error:", e?.message ?? e)
  );
}

export async function dispatchWebhookSync(
  workspaceId: string,
  event: string,
  payload: Record<string, any>
): Promise<void> {
  const hooks = await prisma.webhook.findMany({
    where: {
      workspaceId,
      active: true,
      events: { has: event }
    }
  });
  if (hooks.length === 0) return;

  // Cuerpo idéntico para todos los suscriptores.
  const body = JSON.stringify({
    event,
    workspaceId,
    timestamp: new Date().toISOString(),
    data: payload
  });

  await Promise.all(
    hooks.map(async (hook) => {
      const signature = sign(hook.secret, body);
      // Registro previo para tener traza incluso si todo el envío falla.
      const delivery = await prisma.webhookDelivery.create({
        data: {
          webhookId: hook.id,
          event,
          payload: payload as any,
          attempts: 0,
          succeeded: false
        }
      });

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const resp = await fetch(hook.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Hub-Event": event,
              "X-Hub-Signature-256": signature,
              "User-Agent": "AgenciaHub-Webhook/1.0"
            },
            body,
            signal: AbortSignal.timeout(10_000)
          });
          await prisma.webhookDelivery.update({
            where: { id: delivery.id },
            data: {
              attempts: attempt,
              statusCode: resp.status,
              response: (await resp.text().catch(() => null))?.slice(0, 500) ?? null,
              succeeded: resp.ok
            }
          });
          if (resp.ok) return; // hecho
          if (resp.status < 500) return; // error 4xx: no reintentamos
        } catch (e: any) {
          await prisma.webhookDelivery.update({
            where: { id: delivery.id },
            data: { attempts: attempt, response: String(e?.message ?? e).slice(0, 500) }
          });
        }
        if (attempt < MAX_ATTEMPTS) {
          await sleep(BACKOFF_MS[attempt - 1] ?? 16_000);
        }
      }
    })
  );
}

function sign(secret: string, body: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const WEBHOOK_EVENTS = [
  "task.created",
  "task.updated",
  "task.deleted",
  "client.created",
  "client.updated",
  "client.deleted",
  "client.mrr_change",
  "comment.created",
  "editorial.approved",
  "editorial.rejected"
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
