/**
 * POST /api/bubui/business/[id]/request-poster
 *
 * El negocio pide que le llevemos el cartel/QR impreso GRATIS a su local
 * (alternativa a imprimirlo él mismo). Marca la solicitud en el negocio para
 * que el equipo la vea en el panel admin ("carteles por entregar") y se lo
 * lleve a la dirección indicada. Público (v1): se llama justo tras el alta
 * con el businessId que devuelve el signup.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

const schema = z.object({
  address: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(40).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable()
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation", message: "Indica una dirección de entrega." } },
      { status: 400 }
    );
  }
  const { address, phone, note } = parsed.data;
  try {
    await prisma.bubuiBusiness.update({
      where: { id: params.id },
      data: {
        posterDeliveryRequestedAt: new Date(),
        posterDeliveryAddress: address,
        posterDeliveryPhone: phone ?? undefined,
        posterDeliveryNote: note ?? undefined,
        posterDeliveredAt: null
      }
    });
  } catch {
    return NextResponse.json(
      { error: { code: "not_found", message: "Negocio no encontrado." } },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true });
}
