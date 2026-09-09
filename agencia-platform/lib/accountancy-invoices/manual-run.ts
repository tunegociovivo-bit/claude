export type InvoiceRunProcessor = (runId: string) => Promise<unknown>;

/**
 * Una ejecución solicitada desde el panel debe permanecer dentro del ciclo de
 * vida de la petición. Los callbacks desacoplados pueden desaparecer cuando el
 * servidor termina la respuesta y dejan los elementos en PENDING para siempre.
 */
export async function runManualInvoiceProcessors(runId: string, processors: InvoiceRunProcessor[]): Promise<void> {
  await Promise.allSettled(processors.map((processor) => processor(runId)));
}
