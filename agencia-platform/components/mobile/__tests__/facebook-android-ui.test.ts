import { describe, expect, it, vi } from "vitest";
import {
  clearFocusedFacebookSearchInput,
  extractFacebookMembershipQuestions,
  findFacebookGroupJoinTarget,
  findFacebookMembershipState,
  findFacebookSearchEntryTarget,
  findFacebookSearchImeTarget,
  findFacebookSearchSuggestionTarget,
  submitFacebookSearchFromKeyboard
} from "@/components/mobile/facebook-android-ui";

describe("Facebook Android UI", () => {
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

    expect(findFacebookSearchEntryTarget(hierarchy)).toEqual({
      kind: "input",
      point: { x: 525, y: 95 }
    });
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

  it("clears a restored query before pasting the next approved group name", async () => {
    const runCommand = vi.fn(async () => "");

    await clearFocusedFacebookSearchInput(runCommand);

    expect(runCommand.mock.calls).toEqual([
      [["input", "keycombination", "KEYCODE_CTRL_LEFT", "KEYCODE_A"]],
      [["input", "keyevent", "KEYCODE_DEL"]]
    ]);
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

  it("submits the visible Gboard search action without waiting for an accessibility dump", async () => {
    const runCommand = vi.fn(async (command: readonly string[]) => {
      switch (command.join(" ")) {
        case "dumpsys input_method":
          return "mCurMethodId=com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME\nmInputShown=true\n";
        case "dumpsys input":
          return "SurfaceOrientation: 0\n";
        case "wm size":
          return "Physical size: 1080x2340\n";
        case "dumpsys window displays":
          return "InsetsSource id=0x13 type=ITYPE_IME frame=[0,1480][1080,2340] visible=true flags=[]\n";
        default:
          return "";
      }
    });

    await submitFacebookSearchFromKeyboard(runCommand);

    expect(runCommand.mock.calls).toEqual([
      [["dumpsys", "input_method"]],
      [["dumpsys", "input"]],
      [["wm", "size"]],
      [["dumpsys", "window", "displays"]],
      [["input", "tap", "994", "2106"]]
    ]);
  });

  it("uses Android's active override size for the keyboard action point", async () => {
    const runCommand = vi.fn(async (command: readonly string[]) => {
      switch (command.join(" ")) {
        case "dumpsys input_method":
          return "mCurMethodId=com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME\nmWindowVisible=true\n";
        case "dumpsys input":
          return "SurfaceOrientation: 0\n";
        case "wm size":
          return "Physical size: 1080x2340\nOverride size: 720x1560\n";
        case "dumpsys window displays":
          return "InsetsSource type=ime frame=[0,986][720,1560] visible=true\n";
        default:
          return "";
      }
    });

    await submitFacebookSearchFromKeyboard(runCommand);

    expect(runCommand).toHaveBeenLastCalledWith(["input", "tap", "662", "1404"]);
  });

  it("fails quickly when Android does not report a usable display size", async () => {
    const runCommand = vi.fn(async (command: readonly string[]) => {
      switch (command.join(" ")) {
        case "dumpsys input_method":
          return "mCurMethodId=com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME\nmInputShown=true\n";
        case "dumpsys input":
          return "SurfaceOrientation: 0\n";
        default:
          return "unknown";
      }
    });

    await expect(submitFacebookSearchFromKeyboard(runCommand))
      .rejects.toThrow("tamaño de pantalla");
    expect(runCommand).toHaveBeenCalledTimes(3);
  });

  it("does not tap Facebook content when the Android keyboard is hidden", async () => {
    const runCommand = vi.fn(async () => (
      "mCurMethodId=com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME\n"
      + "mInputShown=false\nmWindowVisible=false\n"
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

  it("does not tap a rotated display with portrait-calibrated coordinates", async () => {
    const runCommand = vi.fn(async (command: readonly string[]) => (
      command.join(" ") === "dumpsys input_method"
        ? "mCurMethodId=com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME\nmInputShown=true\n"
        : "SurfaceOrientation: 1\n"
    ));

    await expect(submitFacebookSearchFromKeyboard(runCommand))
      .rejects.toThrow("orientación vertical");
    expect(runCommand.mock.calls).toEqual([
      [["dumpsys", "input_method"]],
      [["dumpsys", "input"]]
    ]);
  });

  it("does not tap when Gboard is floating instead of docked at the bottom", async () => {
    const runCommand = vi.fn(async (command: readonly string[]) => {
      switch (command.join(" ")) {
        case "dumpsys input_method":
          return "mCurMethodId=com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME\nmInputShown=true\n";
        case "dumpsys input":
          return "SurfaceOrientation: 0\n";
        case "wm size":
          return "Physical size: 1080x2340\n";
        case "dumpsys window displays":
          return "InsetsSource type=ime frame=[220,900][860,1600] visible=true\n";
        default:
          return "";
      }
    });

    await expect(submitFacebookSearchFromKeyboard(runCommand))
      .rejects.toThrow("teclado acoplado");
    expect(runCommand).not.toHaveBeenCalledWith(expect.arrayContaining(["tap"]));
  });
});
