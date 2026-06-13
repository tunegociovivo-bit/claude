/**
 * Botón flotante "Anúnciate" del panel del comercio.
 *
 * Es un CTA fijo y animado que aparece en cualquier pantalla del panel del
 * negocio y lleva a la sección de anuncios (Push del Día). El admin puede
 * encenderlo/apagarlo desde su panel sin necesidad de deploy.
 *
 * Por defecto está ENCENDIDO. Se guarda en BubuiSetting (mismo patrón que el
 * resto de flags de plataforma).
 */
import { prisma } from "@/lib/db/prisma";

const KEY = "anunciate_button_enabled";

export async function getAnunciateButtonEnabled(): Promise<boolean> {
  const row = await prisma.bubuiSetting.findUnique({ where: { key: KEY } });
  // Default: encendido. Solo se considera apagado si está explícitamente en "0".
  return row?.value !== "0";
}

export async function setAnunciateButtonEnabled(enabled: boolean): Promise<boolean> {
  const value = enabled ? "1" : "0";
  await prisma.bubuiSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value },
    update: { value }
  });
  return enabled;
}
