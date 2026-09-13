import { describe, expect, it } from "vitest";
import { findAndroidUiNodeCenter } from "@/components/mobile/android-ui-hierarchy";

const hierarchy = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node text="" resource-id="" class="android.view.View" content-desc="Buscar" clickable="true" bounds="[630,60][710,140]" />
  <node text="Buscar en Facebook" class="android.widget.EditText" content-desc="" focused="true" bounds="[70,60][610,140]" />
  <node text="Grupos" class="android.view.View" content-desc="" clickable="true" bounds="[250,160][430,230]" />
</hierarchy>`;

describe("jerarquía accesible de Android", () => {
  it("localiza controles por texto o descripción y calcula el centro", () => {
    expect(findAndroidUiNodeCenter(hierarchy, { labels: ["Buscar", "Search"] })).toEqual({ x: 670, y: 100 });
    expect(findAndroidUiNodeCenter(hierarchy, { labels: ["Grupos", "Groups"] })).toEqual({ x: 340, y: 195 });
  });

  it("localiza el campo enfocado por clase", () => {
    expect(findAndroidUiNodeCenter(hierarchy, {
      className: "android.widget.EditText",
      focused: true
    })).toEqual({ x: 340, y: 100 });
  });

  it("devuelve null cuando Facebook no expone el control", () => {
    expect(findAndroidUiNodeCenter(hierarchy, { labels: ["Unirme"] })).toBeNull();
  });
});
