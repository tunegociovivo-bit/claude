import { parseConversationBatch, type FacebookConversationBatch } from "@/lib/mobile/facebook-conversations";
import type { MobileAutomationAction } from "@/lib/mobile/automation-policy";
import { parsePageFollowBatch, type PageFollowBatch } from "@/lib/mobile/page-follow-batch";
import { parseCommentThreadMessage, type CommentThreadMessage } from "@/lib/mobile/comment-thread";
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
  id?: string;
  executorSessionId?: string;
  action: MobileAutomationAction;
  targetUrl: string | null;
  text: string | null;
  sourceRef?: string | null;
  phoneKey?: string;
  deviceSerial?: string;
  facts?: string | null;
};

export type MobileAutomationExecutorDependencies = {
  discoverFacebookConversations?: (batch: FacebookConversationBatch) => Promise<MobileAutomationExecutionResult>;
  replyFacebookConversations?: (batch: FacebookConversationBatch) => Promise<MobileAutomationExecutionResult>;
  openUrl: (url: string) => Promise<unknown>;
  copyText: (text: string) => Promise<unknown>;
  searchFacebookGroups?: (query: string) => Promise<unknown>;
  discoverFacebookGroups?: (batch: FacebookGroupBatch) => Promise<MobileAutomationExecutionResult>;
  joinFacebookGroupBatch?: (batch: FacebookGroupBatch) => Promise<MobileAutomationExecutionResult>;
  followPages?: (batch: PageFollowBatch) => Promise<MobileAutomationExecutionResult>;
  postThreadMessage?: (message: CommentThreadMessage) => Promise<MobileAutomationExecutionResult>;
};

export async function executeMobileAutomationJob(
  job: MobileAutomationExecutableJob,
  dependencies: MobileAutomationExecutorDependencies
): Promise<MobileAutomationExecutionResult> {
  switch (job.action) {
    case "DISCOVER_FACEBOOK_CONVERSATIONS":
    case "REPLY_FACEBOOK_CONVERSATIONS": {
      const runner = job.action === "DISCOVER_FACEBOOK_CONVERSATIONS" ? dependencies.discoverFacebookConversations : dependencies.replyFacebookConversations;
      if (!runner || !job.text) throw new Error("Este móvil no tiene disponible el lote de conversaciones.");
      return runner(parseConversationBatch(job.text));
    }
    case "OPEN_URL": {
      if (!job.targetUrl) throw new Error("El trabajo aprobado no contiene una URL.");
      const navigation = await dependencies.openUrl(job.targetUrl);
      const summary = navigation && typeof navigation === "object" && "summary" in navigation && typeof navigation.summary === "string" ? navigation.summary : undefined;
      return { outcome: "PREPARED", ...(summary ? { summary } : {}) };
    }
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
    case "POST_THREAD_MESSAGE":
      if (!job.text) throw new Error("El trabajo no contiene el mensaje aprobado.");
      if (!dependencies.postThreadMessage) throw new Error("Este móvil no puede publicar mensajes de conversación.");
      return dependencies.postThreadMessage(parseCommentThreadMessage(job.text));
    case "FOLLOW_PAGES":
      if (!job.text) throw new Error("El trabajo no contiene la lista de páginas.");
      if (!dependencies.followPages) throw new Error("Este móvil no puede seguir páginas automáticamente.");
      return dependencies.followPages(parsePageFollowBatch(job.text));
    default:
      throw new Error("Acción móvil no permitida.");
  }
}
