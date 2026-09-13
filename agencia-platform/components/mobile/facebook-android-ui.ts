import { parseAndroidUiNodes, type AndroidUiPoint } from "@/components/mobile/android-ui-hierarchy";

function comparable(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("es");
}

function nodeLabel(node: ReturnType<typeof parseAndroidUiNodes>[number]): string {
  return node.text.trim() || node.contentDescription.trim();
}

function matchesAny(value: string, labels: readonly string[]): boolean {
  const normalized = comparable(value);
  return labels.some((label) => {
    const expected = comparable(label);
    return normalized === expected || normalized.includes(expected);
  });
}

function matchesExactly(value: string, labels: readonly string[]): boolean {
  const normalized = comparable(value);
  return labels.some((label) => normalized === comparable(label));
}

export function findFacebookSearchImeTarget(hierarchy: string): AndroidUiPoint | null {
  const nodes = parseAndroidUiNodes(hierarchy);
  const focusedInput = nodes.find((node) => (
    node.className === "android.widget.EditText" && node.focused
  ));
  if (!focusedInput) return null;

  return nodes
    .filter((node) => (
      node.bounds.top >= focusedInput.bounds.bottom
      && /inputmethod|keyboard|swiftkey|honeyboard/i.test(node.packageName)
      && matchesExactly(nodeLabel(node), ["Buscar", "Search", "Ir", "Go"])
    ))
    .sort((left, right) => right.center.y - left.center.y)[0]?.center ?? null;
}

export function findFacebookSearchSuggestionTarget(
  hierarchy: string,
  query: string
): AndroidUiPoint | null {
  const nodes = parseAndroidUiNodes(hierarchy);
  const focusedInput = nodes.find((node) => (
    node.className === "android.widget.EditText" && node.focused
  ));
  if (!focusedInput?.packageName || !query.trim()) return null;

  const candidates = nodes.filter((node) => (
    node.packageName === focusedInput.packageName
    && node.bounds.top >= focusedInput.bounds.bottom
    && matchesExactly(nodeLabel(node), [query])
  ));
  const clickableCandidates = candidates.filter((node) => node.clickable);
  return (clickableCandidates.length ? clickableCandidates : candidates)
    .sort((left, right) => right.center.y - left.center.y)[0]?.center ?? null;
}

export function findFacebookGroupJoinTarget(
  hierarchy: string,
  groupName: string
): AndroidUiPoint | null {
  const nodes = parseAndroidUiNodes(hierarchy);
  const expected = comparable(groupName);
  const titleNodes = nodes.filter((node) => {
    const label = comparable(nodeLabel(node));
    if (label === expected) return true;
    if (label.length < 6 || expected.length < 6) return false;
    return label.includes(expected) || expected.includes(label);
  });
  const joinNodes = nodes.filter((node) => matchesExactly(nodeLabel(node), [
    "Unirte",
    "Unirse",
    "Join group",
    "Join"
  ]));
  if (!titleNodes.length || !joinNodes.length) return null;

  let best: { point: AndroidUiPoint; distance: number } | null = null;
  for (const title of titleNodes) {
    for (const join of joinNodes) {
      const verticalDistance = Math.abs(title.center.y - join.center.y);
      const horizontalPenalty = join.center.x < title.center.x ? 200 : 0;
      const distance = verticalDistance + horizontalPenalty;
      if (!best || distance < best.distance) best = { point: join.center, distance };
    }
  }
  return best && best.distance <= 220 ? best.point : null;
}

export type FacebookMembershipQuestion = {
  question: string;
  point: AndroidUiPoint;
};

export function extractFacebookMembershipQuestions(hierarchy: string): FacebookMembershipQuestion[] {
  const nodes = parseAndroidUiNodes(hierarchy);
  const inputs = nodes.filter((node) => node.className === "android.widget.EditText")
    .sort((left, right) => left.center.y - right.center.y);
  return inputs.flatMap((input) => {
    const questionNode = nodes
      .filter((node) => {
        const label = nodeLabel(node);
        return Boolean(label)
          && node.center.y < input.bounds.top
          && input.bounds.top - node.center.y <= 180
          && !matchesAny(label, ["Facebook", "Cancelar", "Enviar", "Submit"]);
      })
      .sort((left, right) => right.center.y - left.center.y)[0];
    return questionNode
      ? [{ question: nodeLabel(questionNode), point: input.center }]
      : [];
  });
}

export function findFacebookMembershipState(hierarchy: string): "joined" | "requested" | null {
  const labels = parseAndroidUiNodes(hierarchy).map(nodeLabel);
  if (labels.some((label) => matchesAny(label, [
    "Solicitud enviada",
    "Solicitud pendiente",
    "Cancelar solicitud",
    "Request sent"
  ]))) return "requested";
  if (labels.some((label) => {
    const normalized = comparable(label);
    return ["miembro", "ya eres miembro", "joined", "member"].includes(normalized);
  })) return "joined";
  return null;
}

export function findFacebookMembershipSubmitTarget(hierarchy: string): AndroidUiPoint | null {
  const nodes = parseAndroidUiNodes(hierarchy);
  return nodes.find((node) => matchesExactly(nodeLabel(node), [
    "Enviar solicitud",
    "Enviar",
    "Submit",
    "Continuar",
    "Continue"
  ]))?.center ?? null;
}
