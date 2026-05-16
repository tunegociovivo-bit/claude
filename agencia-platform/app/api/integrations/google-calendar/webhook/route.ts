/**
 * POST /api/integrations/google-calendar/webhook
 *
 * Receptor de las push notifications de Google Calendar API. Google
 * llama aquí cada vez que pasa algo en un calendario que estamos
 * vigilando. El cuerpo siempre está vacío; toda la info viene en
 * cabeceras.
 *
 * Cabeceras relevantes:
 *   X-Goog-Channel-Id        — el id que nosotros generamos al crear el canal
 *   X-Goog-Channel-Token     — el secreto que dimos al crear el canal
 *                              (lo usamos para validar autenticidad)
 *   X-Goog-Resource-State    — "sync" (verificación inicial al crear) |
 *                              "exists" (cambio) | "not_exists" (recurso borrado)
 *   X-Goog-Resource-Id       — id que Google devolvió al crear el canal
 *
 * Google reintenta si no respondemos 200 rápido. Por eso disparamos
 * el pull en background con `void` y respondemos 200 enseguida.
 */

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { pullForConnection } from "@/lib/integrations/google-calendar/sync";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const channelId = req.headers.get("x-goog-channel-id");
  const channelToken = req.headers.get("x-goog-channel-token");
  const resourceState = req.headers.get("x-goog-resource-state");

  if (!channelId) {
    // No es de Google, lo ignoramos.
    return new NextResponse(null, { status: 400 });
  }

  // Para la verificación inicial Google manda resourceState=sync.
  // No hace falta hacer nada, sólo responder 200 para confirmar que
  // estamos vivos.
  if (resourceState === "sync") {
    return new NextResponse(null, { status: 200 });
  }

  // Buscar el canal y validar el token compartido.
  const channel = await prisma.googleCalendarWatchChannel.findUnique({
    where: { channelId },
    include: { connection: true }
  });
  if (!channel) {
    // Canal desconocido (probablemente quedó huérfano tras
    // desconectar). Devolvemos 410 para que Google deje de mandarnos.
    return new NextResponse(null, { status: 410 });
  }
  if (channel.token !== channelToken) {
    return new NextResponse(null, { status: 401 });
  }

  // Pull en background; respondemos rápido. Si pull falla, queda
  // registrado en connection.lastError y el cron de polling lo
  // recogerá en su siguiente pasada.
  void pullForConnection(channel.connection).catch((e) => {
    console.warn("[gcal webhook] pull falló:", e?.message ?? e);
  });

  return new NextResponse(null, { status: 200 });
}
