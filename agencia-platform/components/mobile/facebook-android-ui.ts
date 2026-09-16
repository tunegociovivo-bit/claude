import { parseAndroidUiNodes, type AndroidUiPoint } from "@/components/mobile/android-ui-hierarchy";

type AndroidUiCommandRunner = (command: readonly string[]) => Promise<unknown>;

export type FacebookSearchEntryTarget = {
  kind: "input" | "button";
  point: AndroidUiPoint;
};

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

export function hasVisibleFacebookUi(hierarchy: string): boolean {
  return parseAndroidUiNodes(hierarchy).some((node) => (
    /^com\.facebook\.(?:katana|lite)$/i.test(node.packageName)
    && node.bounds.top <= 500
    && (
      Boolean(nodeLabel(node))
      || node.clickable
      || node.className === "android.widget.EditText"
    )
  ));
}

function currentEditorInfoBlocks(inputMethodOutput: string): string[] {
  const lines = inputMethodOutput.split(/\r?\n/);
  const blocks: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const heading = /^(\s*)(?:mCurrentTextBoxAttribute|mInputEditorInfo):\s*(.*)$/i.exec(lines[index]);
    if (!heading) continue;
    const headingIndent = heading[1].length;
    const blockLines = heading[2] ? [heading[2]] : [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (!line.trim()) continue;
      const indent = /^\s*/.exec(line)?.[0].length ?? 0;
      if (indent <= headingIndent) break;
      blockLines.push(line.trim());
    }
    blocks.push(blockLines.join("\n"));
  }
  return blocks;
}

async function assertVisibleGboard(runCommand: AndroidUiCommandRunner): Promise<void> {
  const inputMethodOutput = String(await runCommand(["dumpsys", "input_method"]));
  const currentImePattern = /(?:mCurMethodId|mCurId|mSelectedMethodId|mCurMethod)\s*[:=]\s*[^\r\n]*com\.google\.android\.inputmethod\.latin/i;
  if (!currentImePattern.test(inputMethodOutput)) {
    throw new Error(
      "La búsqueda automática está calibrada para Gboard. Activa Gboard y vuelve a intentarlo."
    );
  }
  const keyboardVisible = /(?:mInputShown|mWindowVisible)\s*=\s*true/i.test(inputMethodOutput)
    || /mImeWindowVis\s*=\s*0x[1-9a-f]/i.test(inputMethodOutput);
  if (!keyboardVisible) {
    throw new Error(
      "Android no ha confirmado un teclado visible; se ha detenido la acción para no tocar contenido de Facebook."
    );
  }

  const editorInfoBlocks = currentEditorInfoBlocks(inputMethodOutput);
  if (
    !editorInfoBlocks.length
    || editorInfoBlocks.some((block) => (
      !/packageName\s*=\s*com\.facebook\.(?:katana|lite)\b/i.test(block)
    ))
  ) {
    throw new Error(
      "Android no ha confirmado que el campo de búsqueda de Facebook tenga el foco."
    );
  }
  const hasOnlySearchActions = editorInfoBlocks.every((block) => {
    const imeOptionsMatch = /imeOptions\s*=\s*(?:0x([0-9a-f]+)|(\d+))/i.exec(block);
    const imeOptions = imeOptionsMatch?.[1]
      ? Number.parseInt(imeOptionsMatch[1], 16)
      : Number(imeOptionsMatch?.[2]);
    return Number.isFinite(imeOptions) && (imeOptions & 0xff) === 3;
  });
  if (!hasOnlySearchActions) {
    throw new Error(
      "Android no ha confirmado la acción Buscar en el campo enfocado de Facebook."
    );
  }
}

export function findFacebookSearchEntryTarget(
  hierarchy: string,
  knownQueries: readonly string[] = []
): FacebookSearchEntryTarget | null {
  const nodes = parseAndroidUiNodes(hierarchy);
  const belongsToFacebook = (packageName: string) => /^com\.facebook\.(?:katana|lite)$/i.test(packageName);
  const restoredInput = nodes
    .filter((node) => (
      belongsToFacebook(node.packageName)
      && node.className === "android.widget.EditText"
      && node.bounds.top <= 350
      && (
        matchesExactly(nodeLabel(node), knownQueries)
        || matchesExactly(node.text, ["Buscar", "Search", "Buscar en Facebook", "Search Facebook"])
        || matchesAny(node.contentDescription, ["Buscar", "Search"])
        || matchesAny(node.resourceId, ["search", "buscar"])
      )
    ))
    .sort((left, right) => left.bounds.top - right.bounds.top)[0];
  if (restoredInput) return { kind: "input", point: restoredInput.center };

  const headerSearch = nodes
    .filter((node) => (
      belongsToFacebook(node.packageName)
      && node.bounds.top <= 350
      && matchesExactly(nodeLabel(node), ["Buscar", "Search", "Buscar en Facebook", "Search Facebook"])
    ))
    .sort((left, right) => left.bounds.top - right.bounds.top)[0];
  if (headerSearch) return { kind: "button", point: headerSearch.center };

  const topBarIcons = nodes
    .filter((node) => {
      const width = node.bounds.right - node.bounds.left;
      const height = node.bounds.bottom - node.bounds.top;
      return belongsToFacebook(node.packageName)
        && node.clickable
        && !nodeLabel(node)
        && node.bounds.top <= 180
        && width >= 35
        && height >= 35
        && width <= 170
        && height <= 170
        && Math.abs(width - height) <= 55;
    })
    .sort((left, right) => right.center.x - left.center.x);
  const likelySearchIcon = topBarIcons[1] ?? (topBarIcons.length === 1 ? topBarIcons[0] : null);
  return likelySearchIcon ? { kind: "button", point: likelySearchIcon.center } : null;
}

export async function clearFocusedFacebookSearchInput(
  runCommand: AndroidUiCommandRunner
): Promise<void> {
  await assertVisibleGboard(runCommand);
  await runCommand(["input", "keycombination", "KEYCODE_CTRL_LEFT", "KEYCODE_A"]);
  await runCommand(["input", "keyevent", "KEYCODE_DEL"]);
}

export async function submitFacebookSearchFromKeyboard(
  runCommand: AndroidUiCommandRunner
): Promise<void> {
  await assertVisibleGboard(runCommand);
  // The focused Facebook editor explicitly declares IME_ACTION_SEARCH.
  // Dispatch Enter to that editor; display rotation and keyboard placement
  // must not turn a search action into a tap on unrelated screen content.
  await runCommand(["input", "keyevent", "KEYCODE_ENTER"]);
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
