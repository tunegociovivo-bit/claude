/**
 * Conciliación de los ABONOS DE REMESA SEPA de Santander ("Remesa SEPA <nº> ·
 * Contabilizada" / "Emision Remesa Sepa Sdd Referencia: …").
 *
 * Por qué hace falta: Santander abona cada remesa como un único movimiento sin
 * deudor ni IBAN. El agente intenta leer el detalle de recibos para identificar
 * al deudor, pero esa lectura llega desplazada (el recibo de una remesa se
 * etiqueta con el número de la remesa vecina) y, al no cuadrar importes, el
 * abono real se queda sin conciliar aunque la factura esté cobrada.
 *
 * Evidencia que sí es fiable y usamos aquí:
 *  - El HUB prepara UNA remesa por factura (SepaRemittanceRequest + agente),
 *    con importe exacto y fecha de preparación conocidos.
 *  - Santander abona esa remesa en su fecha de vencimiento, pocos días después.
 *
 * Reglas (conservadoras):
 *  1. Mismo importe exacto y vencimiento entre el día de preparación y N días
 *     después (primero 7 días; lo que quede, 12 días).
 *  2. Se agrupan abonos y remesas del mismo importe que compiten entre sí
 *     (componentes conexos). SOLO se concilia un grupo si tiene tantos abonos
 *     como remesas: entonces todas esas facturas están cobradas. Dentro del
 *     grupo se empareja por orden cronológico (mismo importe, así que el
 *     resultado contable es idéntico).
 *  3. Si sobran o faltan abonos en un grupo, NO se toca nada: queda en revisión.
 *  4. Remesas manuales (sin solicitud en el HUB): solo si el importe es único
 *     en ambos sentidos (un abono ↔ una factura abierta emitida ≤10 días antes).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export function madridDay(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function dayNumber(date: Date): number {
  return Math.round(new Date(`${madridDay(date)}T00:00:00Z`).getTime() / DAY_MS);
}

/** Número de remesa normalizado (mayúsculas, sin espacios) o null. */
export function remittanceCode(reference: string | null | undefined): string | null {
  const text = reference ?? "";
  const list = text.match(/Remesa SEPA(?:\s+verificada)?\s+([0-9A-Z]{10,30})\b/i)?.[1];
  if (list) return list.toUpperCase();
  // "Referencia: 0049 6611 753 000066s 09/09/2026 1.391,50 EUR …": se corta
  // antes de la fecha o del importe para no pegar sus dígitos al número.
  const summary = text.match(/Referencia:\s*((?:[0-9A-Z]+\s?)+?)(?=\s+\d{2}\/\d{2}\/\d{4}|\s+[\d.]+,\d{2}\s*EUR|\s*$)/i)?.[1];
  const compact = summary?.replace(/\s+/g, "").toUpperCase();
  return compact && compact.length >= 10 ? compact : null;
}

/** ¿Es el abono AGREGADO de una remesa (no un recibo ni una transferencia)? */
export function isRemittanceAggregate(reference: string | null | undefined): boolean {
  const text = reference ?? "";
  if (/·\s*Recibo\s|Factura\s+FAC-/i.test(text)) return false;
  return /Remesa SEPA\s+[0-9A-Z]{10,}\s*·\s*Contabilizada/i.test(text) || /Emision Remesa Sepa/i.test(text);
}

export type BankRow = {
  id: string;
  status: string;
  amountCents: number;
  reference: string | null;
  createdAt: Date;
};

/**
 * La misma remesa puede entrar dos veces: desde el listado de remesas y desde
 * los movimientos de la cuenta ("Emision Remesa Sepa …"). Devuelve los ids
 * UNMATCHED que son duplicados y deben ignorarse (se conserva el conciliado o,
 * si no hay, la fila del listado de remesas).
 */
export function duplicateRemittanceRowIds(rows: BankRow[]): string[] {
  const groups = new Map<string, BankRow[]>();
  for (const row of rows) {
    if (row.amountCents <= 0 || !isRemittanceAggregate(row.reference)) continue;
    const code = remittanceCode(row.reference);
    if (!code) continue;
    const key = `${code}|${row.amountCents}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const ignore: string[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const matched = group.find((row) => row.status === "MATCHED");
    const keep = matched ?? [...group].sort((a, b) => {
      const listA = /^Remesa SEPA/i.test(a.reference ?? "") ? 0 : 1;
      const listB = /^Remesa SEPA/i.test(b.reference ?? "") ? 0 : 1;
      return listA - listB || a.createdAt.getTime() - b.createdAt.getTime();
    })[0];
    for (const row of group) if (row.id !== keep.id && row.status === "UNMATCHED") ignore.push(row.id);
  }
  return ignore;
}

export type AggregateCandidate = { id: string; amountCents: number; bookedAt: Date; code: string | null };
export type RemittanceRequestCandidate = { id: string; amountCents: number; preparedAt: Date };
export type RemittanceAssignment = { aggregateId: string; requestId: string; windowDays: number };

function linked(aggregate: AggregateCandidate, request: RemittanceRequestCandidate, windowDays: number): boolean {
  if (aggregate.amountCents !== request.amountCents) return false;
  const gap = dayNumber(aggregate.bookedAt) - dayNumber(request.preparedAt);
  return gap >= 0 && gap <= windowDays;
}

/** Emparejamiento máximo (Kuhn) respetando el orden cronológico de preferencia. */
function perfectMatching(requests: RemittanceRequestCandidate[], adjacency: Map<string, AggregateCandidate[]>): Map<string, string> | null {
  const ownerOf = new Map<string, string>(); // aggregateId → requestId
  const tryAssign = (requestId: string, seen: Set<string>): boolean => {
    for (const aggregate of adjacency.get(requestId) ?? []) {
      if (seen.has(aggregate.id)) continue;
      seen.add(aggregate.id);
      const owner = ownerOf.get(aggregate.id);
      if (!owner || tryAssign(owner, seen)) {
        ownerOf.set(aggregate.id, requestId);
        return true;
      }
    }
    return false;
  };
  for (const request of requests) if (!tryAssign(request.id, new Set())) return null;
  return ownerOf;
}

export function assignRemittanceGroups(
  aggregates: AggregateCandidate[],
  requests: RemittanceRequestCandidate[],
  windows: number[] = [7, 12]
): { assignments: RemittanceAssignment[]; contested: Set<string> } {
  const assignments: RemittanceAssignment[] = [];
  const contested = new Set<string>(); // abonos con alguna remesa candidata del HUB
  let aggregatesLeft = [...aggregates];
  let requestsLeft = [...requests];

  for (const windowDays of windows) {
    const edgesByAggregate = new Map<string, RemittanceRequestCandidate[]>();
    const edgesByRequest = new Map<string, AggregateCandidate[]>();
    for (const aggregate of aggregatesLeft) {
      for (const request of requestsLeft) {
        if (!linked(aggregate, request, windowDays)) continue;
        edgesByAggregate.set(aggregate.id, [...(edgesByAggregate.get(aggregate.id) ?? []), request]);
        edgesByRequest.set(request.id, [...(edgesByRequest.get(request.id) ?? []), aggregate]);
        contested.add(aggregate.id);
      }
    }

    const visited = new Set<string>();
    const assignedAggregates = new Set<string>();
    const assignedRequests = new Set<string>();
    for (const start of aggregatesLeft) {
      if (visited.has(start.id) || !edgesByAggregate.has(start.id)) continue;
      // Componente conexo: abonos y remesas del mismo importe que compiten.
      const componentAggregates = new Map<string, AggregateCandidate>();
      const componentRequests = new Map<string, RemittanceRequestCandidate>();
      const stack: Array<["A", AggregateCandidate] | ["R", RemittanceRequestCandidate]> = [["A", start]];
      while (stack.length) {
        const [kind, node] = stack.pop()!;
        if (kind === "A") {
          if (componentAggregates.has(node.id)) continue;
          componentAggregates.set(node.id, node as AggregateCandidate);
          visited.add(node.id);
          for (const request of edgesByAggregate.get(node.id) ?? []) stack.push(["R", request]);
        } else {
          if (componentRequests.has(node.id)) continue;
          componentRequests.set(node.id, node as RemittanceRequestCandidate);
          for (const aggregate of edgesByRequest.get(node.id) ?? []) stack.push(["A", aggregate]);
        }
      }
      if (componentAggregates.size !== componentRequests.size) continue; // ambiguo → revisión

      const orderedRequests = [...componentRequests.values()].sort((a, b) => a.preparedAt.getTime() - b.preparedAt.getTime() || a.id.localeCompare(b.id));
      const adjacency = new Map(orderedRequests.map((request) => [
        request.id,
        (edgesByRequest.get(request.id) ?? []).slice().sort((a, b) => a.bookedAt.getTime() - b.bookedAt.getTime() || (a.code ?? a.id).localeCompare(b.code ?? b.id))
      ]));
      const matching = perfectMatching(orderedRequests, adjacency);
      if (!matching) continue;
      for (const [aggregateId, requestId] of matching) {
        assignments.push({ aggregateId, requestId, windowDays });
        assignedAggregates.add(aggregateId);
        assignedRequests.add(requestId);
      }
    }
    aggregatesLeft = aggregatesLeft.filter((aggregate) => !assignedAggregates.has(aggregate.id));
    requestsLeft = requestsLeft.filter((request) => !assignedRequests.has(request.id));
  }
  return { assignments, contested };
}

export type OpenInvoiceCandidate = { id: string; totalCents: number; issueDate: Date };

/**
 * Remesas preparadas a mano en Santander (sin solicitud en el HUB): solo se
 * concilian si el importe identifica una única factura abierta y esa factura
 * solo puede corresponder a ese abono.
 */
export function assignManualRemittances(
  aggregates: AggregateCandidate[],
  invoices: OpenInvoiceCandidate[],
  // Las remesas manuales se cobran a los pocos días de emitir la factura. Una
  // ventana corta evita confundir la cuota de un mes con la del siguiente.
  windowDays = 10
): Array<{ aggregateId: string; invoiceId: string }> {
  const fits = (aggregate: AggregateCandidate, invoice: OpenInvoiceCandidate) => {
    if (aggregate.amountCents !== invoice.totalCents) return false;
    const gap = dayNumber(aggregate.bookedAt) - dayNumber(invoice.issueDate);
    return gap >= -1 && gap <= windowDays;
  };
  const out: Array<{ aggregateId: string; invoiceId: string }> = [];
  for (const aggregate of aggregates) {
    const forAggregate = invoices.filter((invoice) => fits(aggregate, invoice));
    if (forAggregate.length !== 1) continue;
    const forInvoice = aggregates.filter((other) => fits(other, forAggregate[0]));
    if (forInvoice.length === 1) out.push({ aggregateId: aggregate.id, invoiceId: forAggregate[0].id });
  }
  return out;
}

/** Facturas abiertas sugeridas para conciliar a mano un abono (mismo importe, por cercanía). */
export function suggestInvoicesForMovement<T extends OpenInvoiceCandidate>(movement: { amountCents: number; bookedAt: Date }, invoices: T[], limit = 6): T[] {
  return invoices
    .filter((invoice) => invoice.totalCents === movement.amountCents && invoice.issueDate.getTime() <= movement.bookedAt.getTime() + 2 * DAY_MS)
    .sort((a, b) => Math.abs(movement.bookedAt.getTime() - a.issueDate.getTime()) - Math.abs(movement.bookedAt.getTime() - b.issueDate.getTime()))
    .slice(0, limit);
}

/** Confianzas que pueden deshacerse desde la pantalla (inferidas o manuales). */
export const UNDOABLE_CONFIDENCES = new Set(["SEPA_REMESA_HUB", "SEPA_REMESA_IMPORTE_UNICO", "MANUAL"]);
