import { describe, expect, it } from "vitest";
import {
  extractFacebookMembershipQuestions,
  findFacebookGroupJoinTarget,
  findFacebookMembershipState
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
});
