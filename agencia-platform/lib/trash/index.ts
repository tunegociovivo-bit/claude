/**
 * Soft-delete unificado para los modelos críticos: Task, Project,
 * Document, Client, EditorialPost.
 *
 * Cada uno tiene un par de columnas (deletedAt, deletedById). Las
 * queries de UI filtran por `deletedAt: null`. Para recuperar algo
 * desde la papelera se pone deletedAt a null. Para purgar
 * definitivamente se usa el cron /api/cron/trash-purge una vez al día
 * que borra todo lo que está en papelera desde hace > RETENTION_DAYS.
 *
 * EditorialPost no se ha tocado todavía — los borrados hard siguen
 * porque el flujo de aprobación cliente espera que el post exista
 * cuando se consulta; si se borra, la decisión queda en vacío. Se
 * puede añadir más tarde si lo necesitas.
 */

export const RETENTION_DAYS = 30;

export type TrashableModel = "task" | "project" | "document" | "client";

export type TrashItem = {
  id: string;
  model: TrashableModel;
  title: string;
  deletedAt: string;
  deletedById: string | null;
  deletedByName: string | null;
  // info contextual para que el admin sepa qué está restaurando
  context?: string | null;
};
