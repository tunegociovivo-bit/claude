import { prisma } from "@/lib/prisma";
import { deleteObjectsWithPrefix } from "@/lib/storage/r2";

/**
 * Tras borrar una publicación del Editorial, elimina sus imágenes/vídeos si
 * ninguna otra publicación del negocio los sigue usando (p. ej. un mes
 * duplicado reutiliza las imágenes del original). Nunca lanza.
 */
export async function cleanupEditorialPostFiles(workspaceId: string, postId: string): Promise<void> {
  try {
    const marker = `/editorial/${postId}/`;
    const stillUsed = await prisma.editorialPost.count({
      where: { workspaceId, OR: [{ thumbnail: { contains: marker } }, { mediaUrls: { contains: marker } }] },
    });
    if (stillUsed > 0) return;
    await deleteObjectsWithPrefix(`${workspaceId}/editorial/${postId}/`);
  } catch (error) {
    console.warn("[cleanup] editorial", postId, (error as Error).message);
  }
}

/** Imágenes de un artículo del Publicador SEO (ya subidas a WordPress si se publicó). */
export async function cleanupSeoPostFiles(workspaceId: string, postId: string): Promise<void> {
  try {
    await deleteObjectsWithPrefix(`${workspaceId}/seoblog_post/${postId}/`);
  } catch (error) {
    console.warn("[cleanup] seo", postId, (error as Error).message);
  }
}
