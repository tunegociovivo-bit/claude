import type { FacebookGroupCandidate } from "@/lib/mobile/facebook-group-batch";
import { FacebookNavigationError } from "@/components/mobile/facebook-android-launch";

export async function runFacebookGroupCandidates(
  candidates: FacebookGroupCandidate[],
  join: (candidate: FacebookGroupCandidate) => Promise<FacebookGroupCandidate>,
  wait: () => Promise<void>
): Promise<FacebookGroupCandidate[]> {
  const results: FacebookGroupCandidate[] = [];
  let navigationFailed = false;
  for (const candidate of candidates) {
    if (!candidate.selected || ["joined", "requested"].includes(candidate.outcome)) {
      results.push(candidate);
      continue;
    }
    if (navigationFailed) {
      results.push({ ...candidate, outcome: "failed", resultDetail: "Lote detenido por un problema al abrir o buscar en Facebook. Corrige el error indicado y reintenta." });
      continue;
    }
    try {
      results.push(await join(candidate));
    } catch (error) {
      navigationFailed = error instanceof FacebookNavigationError;
      results.push({ ...candidate, outcome: "failed", resultDetail: (error instanceof Error ? error.message : "No se ha podido procesar este grupo.").slice(0, 800) });
    }
    if (!navigationFailed) await wait();
  }
  return results;
}

export async function finishFacebookGroupSearch(dependencies: {
  selectSuggestion: () => Promise<boolean>;
  submitKeyboard: () => Promise<void>;
  selectGroups: () => Promise<boolean>;
}): Promise<void> {
  if (!await dependencies.selectSuggestion()) await dependencies.submitKeyboard();
  if (!await dependencies.selectGroups()) {
    throw new FacebookNavigationError("Facebook ha buscado la temática, pero no muestra la pestaña Grupos. Revisa la pantalla y vuelve a intentarlo.");
  }
}
