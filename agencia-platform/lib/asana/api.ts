/**
 * Cliente mínimo de la API REST de Asana. Sólo lo que necesitamos
 * para importar las subtareas de la tarea CLIENTES con sus accesos.
 */

const BASE = "https://app.asana.com/api/1.0";

export type AsanaTask = {
  gid: string;
  name: string;
  notes?: string;
};

async function asanaGet(token: string, path: string, signal?: AbortSignal): Promise<any> {
  const r = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Asana ${r.status} ${path}: ${txt.slice(0, 200)}`);
  }
  const data = await r.json();
  return data.data;
}

/** Lista de subtareas (sólo gid+name) de un task. */
export async function listSubtasks(token: string, taskId: string, signal?: AbortSignal): Promise<AsanaTask[]> {
  return asanaGet(token, `/tasks/${taskId}/subtasks?opt_fields=name`, signal);
}

/** Subtareas con notes incluidos (1 sola llamada por padre). */
export async function listSubtasksWithNotes(token: string, taskId: string, signal?: AbortSignal): Promise<AsanaTask[]> {
  return asanaGet(token, `/tasks/${taskId}/subtasks?opt_fields=name,notes`, signal);
}

/**
 * Concurrencia limitada — corre fn sobre cada item con max N en paralelo.
 */
export async function mapLimited<T, U>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<U>
): Promise<U[]> {
  const results: U[] = new Array(items.length);
  let cursor = 0;
  const workers: Promise<void>[] = [];
  const next = async (): Promise<void> => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  };
  for (let i = 0; i < Math.min(limit, items.length); i++) workers.push(next());
  await Promise.all(workers);
  return results;
}
