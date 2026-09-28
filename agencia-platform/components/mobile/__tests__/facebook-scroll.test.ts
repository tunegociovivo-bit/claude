import { describe, expect, it } from "vitest";
import { facebookScrollCommand } from "../facebook-scroll";

// Geometry captured from the phone's comment drawer; no account data is retained.
const screen = `<hierarchy>
 <node package="com.facebook.katana" class="android.widget.FrameLayout" bounds="[0,0][480,888]" />
 <node package="com.facebook.katana" class="androidx.recyclerview.widget.RecyclerView" scrollable="true" bounds="[0,109][480,811]" />
 <node package="com.facebook.katana" class="android.widget.EditText" bounds="[18,821][462,879]" />
 <node package="com.android.inputmethod" bounds="[0,812][480,1600]" />
</hierarchy>`;

describe("Facebook comment list scrolling", () => {
  it("keeps both endpoints inside the list, ignoring the composer and keyboard", () => {
    expect(facebookScrollCommand(screen, "down")).toEqual(["input", "touchscreen", "swipe", "29", "685", "29", "235", "200"]);
  });
  it("reverses the gesture to read earlier comments", () => {
    expect(facebookScrollCommand(screen, "up")).toEqual(["input", "touchscreen", "swipe", "29", "235", "29", "685", "200"]);
  });
  it("uses overlapping slow steps when searching an exact threaded reply", () => {
    expect(facebookScrollCommand(screen, "down", true)).toEqual(["input", "touchscreen", "swipe", "29", "565", "29", "355", "350"]);
    expect(facebookScrollCommand(screen, "up", true)).toEqual(["input", "touchscreen", "swipe", "29", "355", "29", "565", "350"]);
  });
  it("fails closed when Facebook exposes no usable bounds", () => {
    expect(() => facebookScrollCommand("<hierarchy />", "down")).toThrow("zona de desplazamiento");
  });
});
