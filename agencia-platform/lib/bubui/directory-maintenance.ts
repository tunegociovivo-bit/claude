/**
 * Mantenimiento automático del directorio Bubui (lo llama el planificador
 * interno una vez al día): geocodifica negocios que se dieron de alta sin
 * coordenadas, para que aparezcan en el mapa y en la página de su localidad.
 *
 * El contenido editorial IA NO se genera aquí: necesita la clave de IA de un
 * workspace concreto (facturación), así que se lanza manualmente desde el
 * panel /admin/bubui.
 */
import { prisma } from "@/lib/db/prisma";
import { geocodeAddress } from "@/lib/bubui/geocode";

export async function runBubuiGeoBackfill(limit = 20): Promise<{ updated: number; remaining: number }> {
  const pending = await prisma.bubuiBusiness.findMany({
    where: { OR: [{ latitude: null }, { longitude: null }] },
    select: { id: true, address: true, city: true, province: true },
    take: limit
  });
  if (pending.length === 0) return { updated: 0, remaining: 0 };

  let updated = 0;
  for (const b of pending) {
    const query = [b.address, b.city, b.province, "España"].filter(Boolean).join(", ");
    const geo = await geocodeAddress(query);
    if (!geo) continue;
    await prisma.bubuiBusiness.update({
      where: { id: b.id },
      data: {
        latitude: geo.latitude,
        longitude: geo.longitude,
        ...(geo.city ? { city: geo.city } : {}),
        ...(geo.province ? { province: geo.province } : {})
      }
    });
    updated++;
  }

  const remaining = await prisma.bubuiBusiness.count({ where: { OR: [{ latitude: null }, { longitude: null }] } });
  return { updated, remaining };
}
