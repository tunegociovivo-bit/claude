/**
 * Catálogo de "Regalos Plus": premios/sorpresas exclusivos para los
 * suscriptores de Bubui Plus. Los gestiona el admin (CRUD) y la app solo los
 * muestra a quien tiene el plan plus activo.
 */
import { prisma } from "@/lib/db/prisma";

export type PlusGift = {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  link: string | null;
  order: number;
  active: boolean;
};

const SELECT = {
  id: true,
  title: true,
  description: true,
  imageUrl: true,
  link: true,
  order: true,
  active: true
} as const;

/** Regalos activos (para la app), ordenados. */
export async function getActivePlusGifts(): Promise<PlusGift[]> {
  return prisma.bubuiPlusGift.findMany({
    where: { active: true },
    orderBy: [{ order: "asc" }, { createdAt: "desc" }],
    select: SELECT
  });
}

/** Todos los regalos (para el admin), ordenados. */
export async function listPlusGifts(): Promise<PlusGift[]> {
  return prisma.bubuiPlusGift.findMany({
    orderBy: [{ order: "asc" }, { createdAt: "desc" }],
    select: SELECT
  });
}

export async function createPlusGift(data: {
  title: string;
  description?: string;
  imageUrl?: string;
  link?: string;
  order?: number;
  active?: boolean;
}): Promise<PlusGift> {
  return prisma.bubuiPlusGift.create({
    data: {
      title: data.title,
      description: data.description || null,
      imageUrl: data.imageUrl || null,
      link: data.link || null,
      order: data.order ?? 0,
      active: data.active ?? true
    },
    select: SELECT
  });
}

export async function updatePlusGift(
  id: string,
  data: Partial<{ title: string; description: string; imageUrl: string; link: string; order: number; active: boolean }>
): Promise<PlusGift> {
  return prisma.bubuiPlusGift.update({
    where: { id },
    data: {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.description !== undefined ? { description: data.description || null } : {}),
      ...(data.imageUrl !== undefined ? { imageUrl: data.imageUrl || null } : {}),
      ...(data.link !== undefined ? { link: data.link || null } : {}),
      ...(data.order !== undefined ? { order: data.order } : {}),
      ...(data.active !== undefined ? { active: data.active } : {})
    },
    select: SELECT
  });
}

export async function deletePlusGift(id: string): Promise<void> {
  await prisma.bubuiPlusGift.delete({ where: { id } });
}
