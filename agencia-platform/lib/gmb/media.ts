/**
 * Cola multimedia — helpers PUROS de deduplicación por hash. El hash identifica una imagen para no
 * subir/programar duplicados. Sin red.
 */
import { createHash } from "node:crypto";

/** Hash estable de una imagen a partir de su URL o contenido (sha1). */
export function mediaHash(input: string): string {
  return createHash("sha1").update(String(input)).digest("hex");
}

export type MediaItem = { id: string; url: string; hash?: string | null };

/** Marca duplicados por hash (o por URL si no hay hash). Devuelve ids duplicados (los que repiten). */
export function findDuplicateMedia(items: MediaItem[]): Set<string> {
  const seen = new Map<string, string>(); // hash → primer id
  const dups = new Set<string>();
  for (const it of items) {
    const key = (it.hash && it.hash.trim()) || mediaHash(it.url);
    if (seen.has(key)) dups.add(it.id);
    else seen.set(key, it.id);
  }
  return dups;
}

/** ¿Ya existe un item con este hash en la colección? (para evitar altas duplicadas). */
export function isDuplicateHash(items: MediaItem[], hash: string): boolean {
  return items.some((it) => ((it.hash && it.hash.trim()) || mediaHash(it.url)) === hash);
}
