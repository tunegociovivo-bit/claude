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
  it("keeps a short non-scrollable reel drawer isolated from the video behind it", () => {
    const drawer = screen.replace('scrollable="true"', 'scrollable="false"').replace('[0,109][480,811]', '[0,464][480,811]');
    expect(facebookScrollCommand(drawer, "down", true)).toEqual(["input", "touchscreen", "swipe", "240", "690", "240", "585", "350"]);
  });
  it("uses the actual top of a modal when no list is exposed", () => {
    const modal = '<hierarchy><node package="com.facebook.katana" class="android.widget.FrameLayout" bounds="[0,427][480,888]" /></hierarchy>';
    expect(facebookScrollCommand(modal, "down", true)).toEqual(["input", "touchscreen", "swipe", "240", "727", "240", "588", "350"]);
  });
  it("keeps both endpoints inside the list, ignoring the composer and keyboard", () => {
    expect(facebookScrollCommand(screen, "down")).toEqual(["input", "touchscreen", "swipe", "29", "685", "29", "235", "200"]);
  });
  it("reverses the gesture to read earlier comments", () => {
    expect(facebookScrollCommand(screen, "up")).toEqual(["input", "touchscreen", "swipe", "29", "235", "29", "685", "200"]);
  });
  it("uses overlapping slow steps when searching an exact threaded reply", () => {
    expect(facebookScrollCommand(screen, "down", true)).toEqual(["input", "touchscreen", "swipe", "240", "565", "240", "355", "350"]);
    expect(facebookScrollCommand(screen, "up", true)).toEqual(["input", "touchscreen", "swipe", "240", "355", "240", "565", "350"]);
  });
  it("fails closed when Facebook exposes no usable bounds", () => {
    expect(() => facebookScrollCommand("<hierarchy />", "down")).toThrow("zona de desplazamiento");
  });
});
