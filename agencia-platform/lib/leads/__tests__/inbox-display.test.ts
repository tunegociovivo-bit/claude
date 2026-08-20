import { describe, expect, it } from "vitest";

import { conversationHeader, managedChannelLabel } from "../inbox-display";

describe("lead inbox display", () => {
  it("uses the real phone instead of a WhatsApp LID when the contact has no name", () => {
    expect(
      conversationHeader({
        selectedPhone: "154619544125676",
        realPhone: "34624187418",
        isLid: true,
      }),
    ).toEqual({ title: "34624187418", titleIsPhone: true });
  });

  it("keeps a saved contact name as the conversation title", () => {
    expect(
      conversationHeader({
        selectedPhone: "154619544125676",
        realPhone: "34624187418",
        isLid: true,
        displayName: "DRpools Mantenimiento",
      }),
    ).toEqual({ title: "DRpools Mantenimiento", titleIsPhone: false });
  });

  it("shows the account name together with its phone label", () => {
    expect(
      managedChannelLabel(
        [{ name: "Sonia4centromalaga", label: "ZTE 644063050" }],
        "Sonia4centromalaga",
      ),
    ).toBe("Sonia4centromalaga - ZTE 644063050");
  });

  it("does not repeat the channel when its name and label are identical", () => {
    expect(
      managedChannelLabel([{ name: "Sonia4", label: "Sonia4" }], "Sonia4"),
    ).toBe("Sonia4");
  });
});
