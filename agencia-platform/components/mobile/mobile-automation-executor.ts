import type { MobileAutomationAction } from "@/lib/mobile/automation-policy";
import {
  parseFacebookGroupBatch,
  type FacebookGroupBatch
} from "@/lib/mobile/facebook-group-batch";

export type MobileAutomationExecutionResult = {
  outcome: "PREPARED" | "DISCOVERED" | "COMPLETED" | "PARTIAL";
  resultText?: string;
  summary?: string;
};

export type MobileAutomationExecutableJob = {
  action: MobileAutomationAction;
  targetUrl: string | null;
  text: string | null;
  sourceRef?: string | null;
  phoneKey?: string;
  deviceSerial?: string;
  facts?: string | null;
};

export type MobileAutomationExecutorDependencies = {
  openUrl: (url: string) => Promise<unknown>;
  copyText: (text: string) => Promise<unknown>;
  searchFacebookGroups?: (query: string) => Promise<unknown>;
  discoverFacebookGroups?: (batch: FacebookGroupBatch) => Promise<MobileAutomationExecutionResult>;
  joinFacebookGroupBatch?: (batch: FacebookGroupBatch) => Promise<MobileAutomationExecutionResult>;
};

export async function executeMobileAutomationJob(
  job: MobileAutomationExecutableJob,
  dependencies: MobileAutomationExecutorDependencies
): Promise<MobileAutomationExecutionResult> {
  switch (job.action) {
    case "OPEN_URL":
      if (!job.targetUrl) throw new Error("El trabajo aprobado no contiene una URL.");
      await dependencies.openUrl(job.targetUrl);
      return { outcome: "PREPARED" };
    case "COPY_TEXT":
      if (!job.text) throw new Error("El trabajo aprobado no contiene texto.");
      await dependencies.copyText(job.text);
      return { outcome: "PREPARED" };
    case "OPEN_URL_AND_COPY_TEXT":
      if (!job.targetUrl) throw new Error("El trabajo aprobado no contiene una URL.");
      if (!job.text) throw new Error("El trabajo aprobado no contiene texto.");
      await dependencies.openUrl(job.targetUrl);
      await dependencies.copyText(job.text);
      return { outcome: "PREPARED" };
    case "SEARCH_FACEBOOK_GROUPS":
      if (!job.sourceRef?.trim()) throw new Error("La búsqueda no contiene sector o temática.");
      if (!dependencies.searchFacebookGroups) throw new Error("Este móvil no tiene disponible la búsqueda nativa de Facebook.");
      await dependencies.searchFacebookGroups(job.sourceRef.trim());
      return { outcome: "PREPARED" };
    case "DISCOVER_FACEBOOK_GROUPS":
      if (!job.text) throw new Error("El trabajo no contiene la configuración del análisis de grupos.");
      if (!dependencies.discoverFacebookGroups) throw new Error("Este móvil no puede analizar resultados de Facebook.");
      return dependencies.discoverFacebookGroups(parseFacebookGroupBatch(job.text));
    case "JOIN_FACEBOOK_GROUP_BATCH":
      if (!job.text) throw new Error("El trabajo no contiene el lote de grupos aprobado.");
      if (!dependencies.joinFacebookGroupBatch) throw new Error("Este móvil no puede ejecutar solicitudes de grupos.");
      return dependencies.joinFacebookGroupBatch(parseFacebookGroupBatch(job.text));
    default:
      throw new Error("Acción móvil no permitida.");
  }
}
