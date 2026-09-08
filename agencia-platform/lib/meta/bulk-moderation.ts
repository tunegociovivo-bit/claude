export async function runWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  onProgress?: (completed: number, total: number) => void
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let completed = 0;
  const runner = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index], index);
      completed++;
      onProgress?.(completed, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, runner));
  return results;
}

export function formatBulkModerationStatus(input: { action: "delete_comment" | "reply"; completed: number; total: number; failed?: number }) {
  const { action, completed, total, failed } = input;
  if (failed === undefined) return action === "delete_comment" ? `Eliminando ${completed}/${total}…` : `Publicando ${completed}/${total}…`;
  const succeeded = total - failed;
  if (action === "delete_comment") {
    if (succeeded === 0) return `Meta no permitió eliminar ninguno de los ${total} comentarios. Revisa el motivo mostrado aquí.`;
    if (failed > 0) return `${succeeded} eliminados; ${failed} no se pudieron eliminar y siguen seleccionados.`;
    return `${total} comentarios eliminados y confirmados por Meta.`;
  }
  if (succeeded === 0) return `Meta no permitió publicar ninguna de las ${total} respuestas.`;
  if (failed > 0) return `${succeeded} respuestas publicadas; ${failed} no se pudieron publicar.`;
  return `${total} respuestas publicadas correctamente en Meta.`;
}
