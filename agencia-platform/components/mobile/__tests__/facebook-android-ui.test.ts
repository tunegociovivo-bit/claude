import { describe, expect, it, vi } from "vitest";
import {
  clearFocusedFacebookSearchInput,
  extractFacebookMembershipQuestions,
  findFacebookGroupJoinTarget,
  findFacebookMembershipState,
  findFacebookSearchEntryTarget,
  findFacebookSearchImeTarget,
  findFacebookSearchSuggestionTarget,
  findFacebookPostsTab,
  hasVisibleFacebookUi,
  submitFacebookSearchFromKeyboard
} from "@/components/mobile/facebook-android-ui";

const visibleFacebookSearchGboard = [
  "mCurMethodId=com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME",
  "mInputShown=true",
  "mCurrentTextBoxAttribute:",
  "  inputType=0x1 imeOptions=0x3 privateImeOptions=null",
  "  actionLabel=null actionId=0",
  "  initialSelStart=12 initialSelEnd=12",
  "  packageName=com.facebook.katana autofillId=null fieldId=0 fieldName=null"
].join("\n");

describe("Facebook Android UI", () => {
  it("selects the exact posts tab instead of a result mentioning publications", () => {
    const xml = `<hierarchy>
      <node text="Publicaciones de Franquicias baratas" package="com.facebook.katana" bounds="[0,90][500,130]" />
      <node content-desc="Publicaciones, 2 de 7" package="com.facebook.katana" bounds="[110,150][310,210]" />
    </hierarchy>`;
    expect(findFacebookPostsTab(xml)).toEqual({ x: 210, y: 180 });
    expect(findFacebookPostsTab(`<node text="Publicaciones" package="com.facebook.katana" bounds="[0,800][300,850]" />`)).toBeNull();
  });
  it("recognizes the empty native Facebook search field by its placeholder", () => {
    expect(findFacebookSearchEntryTarget(`<hierarchy>
      <node text="Buscar en Facebook" package="com.facebook.katana" class="android.widget.EditText" bounds="[90,45][960,145]" />
    </hierarchy>`)).toEqual({ kind: "input", point: { x: 525, y: 95 } });
  });

  it("pairs the join control with the requested group instead of the first result", () => {
    const hierarchy = `<hierarchy>
      <node text="Franquicias y Negocios rentables en España para emprender" class="android.view.View" bounds="[120,120][790,160]" />
      <node text="Unirte" class="android.view.View" clickable="true" bounds="[800,120][930,165]" />
      <node text="Franquicias baratas en México" class="android.view.View" bounds="[120,250][650,290]" />
      <node text="Unirte" class="android.view.View" clickable="true" bounds="[800,250][930,295]" />
    </hierarchy>`;

    expect(findFacebookGroupJoinTarget(hierarchy, "Franquicias baratas en México"))
      .toEqual({ x: 865, y: 273 });
  });

  it("allows an exact short group name without matching it as a fragment", () => {
    const hierarchy = `<hierarchy>
      <node text="IA" class="android.view.View" bounds="[120,120][300,160]" />
      <node text="Unirte" class="android.view.View" bounds="[800,120][930,165]" />
    </hierarchy>`;

    expect(findFacebookGroupJoinTarget(hierarchy, "IA")).toEqual({ x: 865, y: 143 });
  });

  it("extracts visible free-text membership questions with their input coordinates", () => {
    const hierarchy = `<hierarchy>
      <node text="¿Por qué quieres unirte al grupo?" class="android.view.View" bounds="[80,80][800,120]" />
      <node text="" class="android.widget.EditText" focused="false" bounds="[80,130][900,210]" />
      <node text="¿A qué te dedicas?" class="android.view.View" bounds="[80,230][800,270]" />
      <node text="" class="android.widget.EditText" focused="false" bounds="[80,280][900,360]" />
    </hierarchy>`;

    expect(extractFacebookMembershipQuestions(hierarchy)).toEqual([
      { question: "¿Por qué quieres unirte al grupo?", point: { x: 490, y: 170 } },
      { question: "¿A qué te dedicas?", point: { x: 490, y: 320 } }
    ]);
  });

  it("recognizes both a sent request and an existing membership", () => {
    expect(findFacebookMembershipState('<node text="Solicitud enviada" bounds="[0,0][100,40]" />')).toBe("requested");
    expect(findFacebookMembershipState('<node text="Miembro" bounds="[0,0][100,40]" />')).toBe("joined");
  });

  it("does not confuse group metadata with the account membership state", () => {
    const hierarchy = `<hierarchy>
      <node text="554 miembros" bounds="[0,0][200,40]" />
      <node text="Publicaciones pendientes" bounds="[0,50][260,90]" />
    </hierarchy>`;

    expect(findFacebookMembershipState(hierarchy)).toBeNull();
  });

  it("selects the keyboard search action instead of Facebook's header search control", () => {
    const hierarchy = `<hierarchy>
      <node text="" content-desc="Buscar" package="com.facebook.katana" class="android.view.View" bounds="[1000,40][1080,120]" />
      <node text="Franquicias en España" package="com.facebook.katana" class="android.widget.EditText" focused="true" bounds="[80,40][990,120]" />
      <node text="" content-desc="Buscar" package="com.google.android.inputmethod.latin" class="android.inputmethodservice.Keyboard$Key" bounds="[960,2150][1080,2280]" />
    </hierarchy>`;

    expect(findFacebookSearchImeTarget(hierarchy)).toEqual({ x: 1020, y: 2215 });
  });

  it("reuses Facebook's restored search field instead of requiring the home search button", () => {
    const hierarchy = `<hierarchy>
      <node text="Franquicias, Negocios y más" package="com.facebook.katana" class="android.widget.EditText" focused="false" bounds="[90,45][960,145]" />
      <node text="¿Qué estás pensando?" package="com.facebook.katana" class="android.widget.EditText" focused="false" bounds="[70,520][980,680]" />
    </hierarchy>`;

    expect(findFacebookSearchEntryTarget(hierarchy, ["Franquicias, Negocios y más"])).toEqual({
      kind: "input",
      point: { x: 525, y: 95 }
    });
  });

  it("does not treat an upper Facebook post composer as a restored search", () => {
    const hierarchy = `<hierarchy>
      <node text="¿Qué estás pensando?" package="com.facebook.katana" class="android.widget.EditText" focused="false" bounds="[70,90][980,190]" />
    </hierarchy>`;

    expect(findFacebookSearchEntryTarget(hierarchy, ["Franquicias, Negocios y más"]))
      .toBeNull();
  });

  it("falls back to Facebook's header search control from the home screen", () => {
    const hierarchy = `<hierarchy>
      <node text="" content-desc="Buscar" package="com.facebook.katana" class="android.view.View" clickable="true" bounds="[940,40][1060,160]" />
    </hierarchy>`;

    expect(findFacebookSearchEntryTarget(hierarchy)).toEqual({
      kind: "button",
      point: { x: 1000, y: 100 }
    });
  });

  it("uses the unlabeled top bar search icon when Facebook hides accessibility labels", () => {
    const hierarchy = `<hierarchy>
      <node text="" content-desc="" package="com.facebook.katana" class="android.view.View" clickable="true" bounds="[755,42][835,122]" />
      <node text="" content-desc="" package="com.facebook.katana" class="android.view.View" clickable="true" bounds="[850,42][930,122]" />
      <node text="" content-desc="" package="com.facebook.katana" class="android.view.View" clickable="true" bounds="[945,42][1025,122]" />
    </hierarchy>`;

    expect(findFacebookSearchEntryTarget(hierarchy)).toEqual({
      kind: "button",
      point: { x: 890, y: 82 }
    });
  });

  it("distinguishes visible Facebook UI from an empty launch transition", () => {
    expect(hasVisibleFacebookUi(`<hierarchy>
      <node text="" content-desc="" package="com.facebook.katana" class="android.view.View" clickable="true" bounds="[850,42][930,122]" />
    </hierarchy>`)).toBe(true);

    expect(hasVisibleFacebookUi(`<hierarchy>
      <node text="" content-desc="" package="android" class="android.widget.FrameLayout" clickable="false" bounds="[0,0][1080,2340]" />
    </hierarchy>`)).toBe(false);
  });

  it("clears a restored query before pasting the next approved group name", async () => {
    const runCommand = vi.fn(async (command: readonly string[]) => (
      command.join(" ") === "dumpsys input_method"
        ? visibleFacebookSearchGboard
        : ""
    ));

    await clearFocusedFacebookSearchInput(runCommand);

    expect(runCommand.mock.calls).toEqual([
      [["dumpsys", "input_method"]],
      [["input", "keycombination", "KEYCODE_CTRL_LEFT", "KEYCODE_A"]],
      [["input", "keyevent", "KEYCODE_DEL"]]
    ]);
  });

  it("accepts Android 13 InputMethodService's multiline editor block", async () => {
    const runCommand = vi.fn(async (command: readonly string[]) => (
      command.join(" ") === "dumpsys input_method"
        ? [
          "mCurId=com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME",
          "mWindowVisible=true",
          "mInputEditorInfo:",
          "  inputType=0x1 imeOptions=0x12000003 privateImeOptions=null",
          "  packageName=com.facebook.lite autofillId=null fieldId=0"
        ].join("\n")
        : ""
    ));

    await clearFocusedFacebookSearchInput(runCommand);

    expect(runCommand).toHaveBeenLastCalledWith(["input", "keyevent", "KEYCODE_DEL"]);
  });

  it("does not send clearing shortcuts unless Facebook has a visible Gboard input", async () => {
    const runCommand = vi.fn(async () => (
      "mCurMethodId=com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME\n"
      + "mInputShown=false\n"
      + "mCurrentTextBoxAttribute:\n"
      + "  inputType=0x1 imeOptions=0x3 privateImeOptions=null\n"
      + "  packageName=com.facebook.katana autofillId=null"
    ));

    await expect(clearFocusedFacebookSearchInput(runCommand))
      .rejects.toThrow("teclado visible");
    expect(runCommand.mock.calls).toEqual([[["dumpsys", "input_method"]]]);
  });

  it("does not clear or submit when Gboard exposes Send instead of the Search action", async () => {
    const runCommand = vi.fn(async () => (
      "mCurMethodId=com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME\n"
      + "mInputShown=true\n"
      + "mInputEditorInfo:\n"
      + "  inputType=0x1 imeOptions=0x4 privateImeOptions=null\n"
      + "  packageName=com.facebook.katana autofillId=null"
    ));

    await expect(clearFocusedFacebookSearchInput(runCommand))
      .rejects.toThrow("acción Buscar");
    expect(runCommand.mock.calls).toEqual([[["dumpsys", "input_method"]]]);
  });

  it("does not clear a search field focused by another Android application", async () => {
    const runCommand = vi.fn(async () => (
      "mCurMethodId=com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME\n"
      + "mInputShown=true\n"
      + "mCurrentTextBoxAttribute:\n"
      + "  inputType=0x1 imeOptions=0x3 privateImeOptions=null\n"
      + "  packageName=com.google.android.apps.messaging autofillId=null"
    ));

    await expect(clearFocusedFacebookSearchInput(runCommand))
      .rejects.toThrow("campo de búsqueda de Facebook");
    expect(runCommand.mock.calls).toEqual([[["dumpsys", "input_method"]]]);
  });

  it("refuses a lower-page search control that does not belong to an input method", () => {
    const hierarchy = `<hierarchy>
      <node text="Franquicias" package="com.facebook.katana" class="android.widget.EditText" focused="true" bounds="[80,40][990,120]" />
      <node text="Buscar" package="com.facebook.katana" class="android.view.View" bounds="[900,1900][1080,2000]" />
    </hierarchy>`;

    expect(findFacebookSearchImeTarget(hierarchy)).toBeNull();
  });

  it("selects the exact Facebook query suggestion instead of the focused input or group shortcut", () => {
    const hierarchy = `<hierarchy>
      <node text="franquicias" package="com.facebook.katana" class="android.widget.EditText" focused="true" bounds="[80,40][990,120]" />
      <node text="franquicias" package="com.facebook.katana" class="android.view.View" bounds="[140,140][800,190]" />
      <node text="Tu grupo" package="com.facebook.katana" class="android.view.View" bounds="[140,190][400,225]" />
      <node text="franquicias" package="com.facebook.katana" class="android.view.View" clickable="true" bounds="[140,260][800,310]" />
      <node text="franquicias" package="com.google.android.inputmethod.latin" class="android.view.View" bounds="[500,2100][700,2160]" />
    </hierarchy>`;

    expect(findFacebookSearchSuggestionTarget(hierarchy, "franquicias"))
      .toEqual({ x: 470, y: 285 });
  });

  it("submits only the verified Facebook search editor without screen coordinates", async () => {
    const runCommand = vi.fn(async () => visibleFacebookSearchGboard);
    await submitFacebookSearchFromKeyboard(runCommand);
    expect(runCommand.mock.calls).toEqual([
      [["dumpsys", "input_method"]],
      [["input", "keyevent", "KEYCODE_ENTER"]]
    ]);
  });

  it("does not tap Facebook content when the Android keyboard is hidden", async () => {
    const runCommand = vi.fn(async () => (
      "mCurMethodId=com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME\n"
      + "mInputShown=false\nmWindowVisible=false\n"
      + "mCurrentTextBoxAttribute:\n"
      + "  inputType=0x1 imeOptions=0x3 privateImeOptions=null\n"
      + "  packageName=com.facebook.katana autofillId=null\n"
    ));

    await expect(submitFacebookSearchFromKeyboard(runCommand))
      .rejects.toThrow("teclado visible");
    expect(runCommand.mock.calls).toEqual([[["dumpsys", "input_method"]]]);
  });

  it("fails closed for an uncalibrated Android keyboard", async () => {
    const runCommand = vi.fn(async () => (
      "mCurMethodId=com.touchtype.swiftkey/com.touchtype.KeyboardService\nmInputShown=true\n"
    ));

    await expect(submitFacebookSearchFromKeyboard(runCommand))
      .rejects.toThrow("Gboard");
    expect(runCommand.mock.calls).toEqual([[["dumpsys", "input_method"]]]);
  });

  it("recognizes Ir only for the exact group result", () => {
    const result = '<node text="Franquicias Más Rentables · Ir" package="com.facebook.katana" bounds="[200,300][950,350]" />';
    expect(findFacebookMembershipState(result, "Franquicias Más Rentables")).toBe("joined");
    expect(findFacebookMembershipState(result, "Franquicias")).toBeNull();
    expect(findFacebookMembershipState(result, "Otro grupo")).toBeNull();
  });
  it("does not attribute another row's Ir button to the searched group", () => {
    const result = '<node text="Franquicias" package="com.facebook.katana" bounds="[200,300][700,350]" /><node text="Ir" package="com.facebook.katana" bounds="[720,400][800,440]" />';
    expect(findFacebookMembershipState(result, "Franquicias")).toBeNull();
  });
  it("never borrows a neighboring result's join button", () => {
    const result = '<node text="Franquicias" bounds="[120,120][700,160]" /><node text="Otro grupo" bounds="[120,200][700,240]" /><node text="Unirte" bounds="[800,200][930,240]" />';
    expect(findFacebookGroupJoinTarget(result, "Franquicias")).toBeNull();
    expect(findFacebookGroupJoinTarget(result, "Otro grupo")).toEqual({ x: 865, y: 220 });
  });
  it("recognizes the nonbreaking spaces emitted by the real Facebook app", () => {
    const result = '<node text="franquicia IA\u00a0· Ir" content-desc="franquicia IA  \u00a0·  Ir" package="com.facebook.katana" bounds="[231,407][522,462]" /><node text="Ir" package="com.facebook.katana" bounds="[495,410][522,458]" />';
    expect(findFacebookMembershipState(result, "franquicia IA")).toBe("joined");
    expect(findFacebookMembershipState(result, "Otro grupo")).toBeNull();
  });
});
