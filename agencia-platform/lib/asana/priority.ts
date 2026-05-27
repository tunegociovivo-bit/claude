/**
 * Mapeo automático de la "prioridad" de Asana a TaskPriority del Hub.
 *
 * Asana no tiene un campo "priority" nativo. La gente lo modela como
 * un Custom Field tipo enum. Los nombres habituales son "Priority",
 * "Prioridad", "Importancia". Los valores típicos son
 * Low/Medium/High/Urgent o Baja/Media/Alta/Urgente o variantes en
 * inglés (P1/P2/P3/P4). Esta función hace un match flexible.
 *
 * Si no encuentra nada, devuelve MEDIUM (default actual del importer).
 */

import type { AsanaCustomField } from "./client";
import { TaskPriority } from "@prisma/client";

const PRIORITY_FIELD_NAMES = ["priority", "prioridad", "importancia", "importance"];

export function detectPriorityFromCustomFields(
  fields: AsanaCustomField[] | undefined
): TaskPriority {
  if (!fields || fields.length === 0) return TaskPriority.MEDIUM;
  const field = fields.find((f) => {
    const n = (f.name ?? "").toLowerCase().trim();
    return PRIORITY_FIELD_NAMES.includes(n);
  });
  if (!field) return TaskPriority.MEDIUM;

  // El valor puede venir como enum_value.name, display_value, o text_value.
  const raw = (
    field.enum_value?.name ??
    field.display_value ??
    field.text_value ??
    ""
  )
    .toLowerCase()
    .trim();

  if (!raw) return TaskPriority.MEDIUM;
  if (/(urgent|urgenc|critic|p1|p0|🚨|⚠️)/.test(raw)) return TaskPriority.URGENT;
  if (/(alta|high|hi|p2)/.test(raw)) return TaskPriority.HIGH;
  if (/(baja|low|lo|p4)/.test(raw)) return TaskPriority.LOW;
  // "media", "medium", "normal", "p3" o cualquier otra cosa
  return TaskPriority.MEDIUM;
}
