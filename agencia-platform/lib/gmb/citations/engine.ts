/**
 * Citation Engine — lógica PURA (estados, transiciones, clasificación de lo observado y generación
 * del "paquete de alta"). Sin red ni Prisma. Nunca simula publicación externa: si no hay integración
 * real, produce un paquete accionable y trazable para dar de alta a mano.
 *
 * Workflow: detectar → validar → preparar → (aprobar si aplica) → enviada → publicada → revalidar.
 */
import { compareNap, hasNapInconsistency, type Nap, type NapDiff } from "../nap";
import type { Directory } from "./directories";

export type CitationStatus = "not_found" | "pending" | "prepared" | "submitted" | "published" | "inconsistent" | "duplicate" | "error";
export const CITATION_STATUSES: CitationStatus[] = ["not_found", "pending", "prepared", "submitted", "published", "inconsistent", "duplicate", "error"];

export type CitationCommand = "detect" | "prepare" | "submit" | "publish" | "flag_inconsistent" | "flag_duplicate" | "retry" | "reset" | "mark_error";

const TRANSITIONS: Record<CitationCommand, { from: CitationStatus[]; to: CitationStatus }> = {
  detect: { from: ["not_found"], to: "pending" },
  prepare: { from: ["not_found", "pending", "inconsistent"], to: "prepared" },
  submit: { from: ["prepared", "inconsistent"], to: "submitted" },
  publish: { from: ["submitted"], to: "published" },
  flag_inconsistent: { from: ["submitted", "published", "pending"], to: "inconsistent" },
  flag_duplicate: { from: ["pending", "submitted", "published", "inconsistent"], to: "duplicate" },
  retry: { from: ["error"], to: "pending" },
  reset: { from: ["not_found", "pending", "prepared", "submitted", "published", "inconsistent", "duplicate", "error"], to: "not_found" },
  mark_error: { from: ["not_found", "pending", "prepared", "submitted", "published", "inconsistent", "duplicate"], to: "error" }
};

export type CitationTransition = { ok: boolean; next?: CitationStatus; error?: string };

export function computeCitationTransition(current: CitationStatus, command: CitationCommand): CitationTransition {
  const rule = TRANSITIONS[command];
  if (!rule) return { ok: false, error: `comando desconocido: ${command}` };
  if (!rule.from.includes(current)) return { ok: false, error: `transición inválida ${current} → ${command}` };
  return { ok: true, next: rule.to };
}

/**
 * Clasifica el estado a partir de lo OBSERVADO en el directorio al revalidar:
 *  - sin datos observados → "not_found" (o el estado previo si ya estaba en workflow),
 *  - con datos y algún campo que difiere del NAP canónico → "inconsistent",
 *  - con datos y todo coincide → "published".
 * Devuelve también el diff para guardarlo.
 */
export function classifyObservation(canonical: Nap, observed: Nap | null, prev: CitationStatus): { status: CitationStatus; diff: NapDiff | null } {
  const hasObserved = !!observed && (!!observed.name || !!observed.address || !!observed.phone || !!observed.website);
  if (!hasObserved) return { status: prev === "not_found" ? "not_found" : prev, diff: null };
  const diff = compareNap(canonical, observed!);
  return { status: hasNapInconsistency(diff) ? "inconsistent" : "published", diff };
}

/** Un estado que exige acción del gestor (para contadores/priorización). */
export function isActionableStatus(s: CitationStatus): boolean {
  return s === "not_found" || s === "pending" || s === "prepared" || s === "inconsistent" || s === "duplicate" || s === "error";
}

export type SubmissionPacket = {
  directory: string;
  directoryName: string;
  submitUrl: string;
  fields: { name: string; address: string; phone: string; website: string };
  checklist: string[];
  note: string;
};

/**
 * Construye el "paquete de alta" accionable: los datos canónicos a introducir + la URL real de alta
 * del directorio + un checklist. NO envía nada; es lo que el gestor copia/pega para dar de alta.
 */
export function buildSubmissionPacket(directory: Directory, canonical: Nap): SubmissionPacket {
  return {
    directory: directory.slug,
    directoryName: directory.name,
    submitUrl: directory.submitUrl,
    fields: {
      name: (canonical.name ?? "").trim(),
      address: (canonical.address ?? "").trim(),
      phone: (canonical.phone ?? "").trim(),
      website: (canonical.website ?? "").trim()
    },
    checklist: [
      "Usar EXACTAMENTE el NAP canónico (nombre, dirección, teléfono, web).",
      "Elegir la categoría principal correcta del directorio.",
      "Añadir descripción y horarios coherentes con la ficha de Google.",
      "Guardar la URL pública del listado para revalidar la consistencia."
    ],
    note: "Alta manual: este paquete no publica nada automáticamente. Tras darla de alta, pega la URL para marcar «enviada» y revalidar el NAP."
  };
}
