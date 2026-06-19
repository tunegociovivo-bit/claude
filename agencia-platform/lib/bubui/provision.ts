/**
 * Aprovisionamiento "sin fricción": crea (o refresca) una ficha de Bubui a
 * partir de un lead captado (Google Places) en estado PENDIENTE (active=false,
 * sin contraseña usable) y genera un token de "claim" para el enlace mágico
 * bubui.app/negocios?claim=<token>.
 *
 * El dueño abre el enlace → entra sin contraseña → ve su perfil ya montado →
 * pulsa "Activar" (y fija email + contraseña para volver luego).
 */
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db/prisma";
import { uniqueBusinessSlug } from "@/lib/bubui/core";
import { bubuiUrl } from "@/lib/bubui/url";

const CLAIM_TTL_DAYS = 30;

export type ProvisionResult = {
  businessId: string;
  slug: string;
  claimToken: string;
  claimUrl: string;
  alreadyClaimed: boolean;
  reused: boolean;
};

/** Crea/refresca la ficha Bubui pendiente desde un lead y devuelve el enlace. */
export async function provisionBubuiFromLead(lead: {
  id: string;
  name: string;
  category?: string | null;
  province?: string | null;
  formattedAddress?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  phone?: string | null;
  placeId?: string | null;
}): Promise<ProvisionResult> {
  const claimToken = randomBytes(24).toString("hex");
  const claimExpiresAt = new Date(Date.now() + CLAIM_TTL_DAYS * 24 * 60 * 60 * 1000);

  // ¿Ya existe una ficha de este lead (o del mismo Google Place)? La reusamos
  // y solo refrescamos el token (no duplicamos negocios).
  const existing = await prisma.bubuiBusiness.findFirst({
    where: {
      OR: [
        { provisionedFromLeadId: lead.id },
        ...(lead.placeId ? [{ googlePlaceId: lead.placeId }] : [])
      ]
    },
    select: { id: true, slug: true, claimedAt: true, active: true }
  });

  if (existing) {
    await prisma.bubuiBusiness.update({
      where: { id: existing.id },
      data: { claimToken, claimExpiresAt, provisionedFromLeadId: existing ? lead.id : undefined }
    });
    return {
      businessId: existing.id,
      slug: existing.slug,
      claimToken,
      claimUrl: bubuiUrl(`/negocios?claim=${claimToken}`),
      alreadyClaimed: !!existing.claimedAt,
      reused: true
    };
  }

  const slug = await uniqueBusinessSlug(lead.name);
  // Contraseña no usable hasta que la fije en la activación.
  const unusablePassword = await bcrypt.hash(randomBytes(18).toString("hex"), 10);

  const business = await prisma.bubuiBusiness.create({
    data: {
      slug,
      name: lead.name,
      category: (lead.category ?? "negocio").slice(0, 60),
      address: lead.formattedAddress ?? lead.address ?? null,
      province: lead.province ?? undefined,
      latitude: lead.latitude ?? null,
      longitude: lead.longitude ?? null,
      phone: lead.phone ?? null,
      googlePlaceId: lead.placeId ?? null,
      // Email placeholder único hasta que indique el suyo al activar.
      ownerEmail: `pending+${lead.id}@bubui.app`,
      ownerPasswordHash: unusablePassword,
      active: false, // pendiente: no visible hasta activar
      claimToken,
      claimExpiresAt,
      provisionedFromLeadId: lead.id
    },
    select: { id: true, slug: true }
  });

  return {
    businessId: business.id,
    slug: business.slug,
    claimToken,
    claimUrl: bubuiUrl(`/negocios?claim=${claimToken}`),
    alreadyClaimed: false,
    reused: false
  };
}
