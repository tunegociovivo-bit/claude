import { parseAndroidUiNodes, type AndroidUiPoint } from "@/components/mobile/android-ui-hierarchy";

type AndroidUiCommandRunner = (command: readonly string[]) => Promise<unknown>;

type AndroidUiRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

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
}

export function findFacebookSearchEntryTarget(hierarchy: string): FacebookSearchEntryTarget | null {
  const nodes = parseAndroidUiNodes(hierarchy);
  const belongsToFacebook = (packageName: string) => /^com\.facebook\.(?:katana|lite)$/i.test(packageName);
  const restoredInput = nodes
    .filter((node) => (
      belongsToFacebook(node.packageName)
      && node.className === "android.widget.EditText"
      && node.bounds.top <= 350
    ))
    .sort((left, right) => left.bounds.top - right.bounds.top)[0];
  if (restoredInput) return { kind: "input", point: restoredInput.center };

  const headerSearch = nodes
    .filter((node) => (
      belongsToFacebook(node.packageName)
      && node.bounds.top <= 350
      && matchesExactly(nodeLabel(node), ["Buscar", "Search"])
    ))
    .sort((left, right) => left.bounds.top - right.bounds.top)[0];
  return headerSearch ? { kind: "button", point: headerSearch.center } : null;
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

  const inputOutput = String(await runCommand(["dumpsys", "input"]));
  const orientations = Array.from(
    inputOutput.matchAll(/SurfaceOrientation\s*:\s*(\d+)/gi),
    (match) => Number(match[1])
  );
  if (!orientations.length || orientations.some((orientation) => orientation !== 0)) {
    throw new Error(
      "La búsqueda automática requiere el móvil en orientación vertical."
    );
  }

  const sizeOutput = String(await runCommand(["wm", "size"]));
  const reportedSizes = Array.from(
    sizeOutput.matchAll(/(?:Physical|Override) size:\s*(\d+)x(\d+)/gi)
  );
  const activeSize = reportedSizes.at(-1);
  const width = Number(activeSize?.[1]);
  const height = Number(activeSize?.[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 200 || height < 200) {
    throw new Error("Android no ha informado de un tamaño de pantalla válido para pulsar Buscar.");
  }
  if (width >= height) {
    throw new Error(
      "La búsqueda automática requiere el móvil en orientación vertical."
    );
  }

  const windowOutput = String(await runCommand(["dumpsys", "window", "displays"]));
  const imeFrame = windowOutput
    .split(/\r?\n/)
    .filter((line) => (
      /(?:type|mType)\s*=\s*(?:ITYPE_)?IME\b/i.test(line)
      && /(?:visible|mVisible)\s*=\s*true\b/i.test(line)
    ))
    .map((line): AndroidUiRect | null => {
      const frame = /(?:frame|mFrame)\s*=\s*\[(-?\d+),(-?\d+)]\[(-?\d+),(-?\d+)]/i.exec(line);
      if (!frame) return null;
      return {
        left: Number(frame[1]),
        top: Number(frame[2]),
        right: Number(frame[3]),
        bottom: Number(frame[4])
      };
    })
    .find((frame): frame is AndroidUiRect => frame !== null);

  const target = {
    x: Math.round(width * 0.92),
    y: Math.round(height * 0.9)
  };
  const dockedKeyboard = imeFrame
    && imeFrame.left <= width * 0.05
    && imeFrame.right >= width * 0.95
    && imeFrame.top >= height * 0.45
    && imeFrame.bottom >= height * 0.95
    && imeFrame.bottom - imeFrame.top >= height * 0.15
    && target.x >= imeFrame.left
    && target.x <= imeFrame.right
    && target.y >= imeFrame.top
    && target.y <= imeFrame.bottom;
  if (!dockedKeyboard) {
    throw new Error(
      "Android no ha confirmado un teclado acoplado en la parte inferior; se ha detenido la pulsación para no tocar contenido de Facebook."
    );
  }

  await runCommand([
    "input",
    "tap",
    String(target.x),
    String(target.y)
  ]);
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
