import { describe, expect, it } from "vitest";
import {
  canTransitionMobileAutomation,
  mobileAutomationDraftSchema,
  validateAutomationTargetUrl
} from "@/lib/mobile/automation-policy";

const realReview = {
  platform: "google_maps",
  sourceKind: "REAL_REVIEW",
  phoneKey: "phone-main",
  deviceSerial: "usb-123",
  targetUrl: "https://www.google.com/maps/place/Restaurante+Ejemplo",
  facts: "Cenamos allí en agosto. El arroz estaba muy bueno y el servicio fue atento.",
  experienceConfirmed: true
};

describe("mobile automation policy", () => {
  it("accepts a supervised review based on a confirmed real experience", () => {
    expect(mobileAutomationDraftSchema.parse(realReview)).toMatchObject(realReview);
  });

  it("rejects a review when the real experience is not confirmed", () => {
    expect(() =>
      mobileAutomationDraftSchema.parse({ ...realReview, experienceConfirmed: false })
    ).toThrow(/experiencia real/i);
  });

  it("rejects fields that could manipulate device location", () => {
    expect(() =>
      mobileAutomationDraftSchema.parse({ ...realReview, latitude: 37.3891, longitude: -5.9845 })
    ).toThrow();
  });

  it("rejects Google Maps work aimed at an unrelated domain", () => {
    expect(() =>
      mobileAutomationDraftSchema.parse({ ...realReview, targetUrl: "https://example.com/review" })
    ).toThrow(/Google Maps/i);
  });

  it("accepts official Instagram targets", () => {
    expect(
      validateAutomationTargetUrl("instagram", "https://www.instagram.com/p/example/")
    ).toBe("https://www.instagram.com/p/example/");
  });

  it("rejects local and non-HTTPS targets", () => {
    expect(() => validateAutomationTargetUrl("generic", "http://localhost:3000/admin")).toThrow(
      /HTTPS/i
    );
    expect(() => validateAutomationTargetUrl("generic", "https://127.0.0.1/admin")).toThrow(
      /privado/i
    );
  });

  it("only permits the documented state transitions", () => {
    expect(canTransitionMobileAutomation("PENDING_APPROVAL", "APPROVE")).toBe(true);
    expect(canTransitionMobileAutomation("QUEUED", "CLAIM")).toBe(true);
    expect(canTransitionMobileAutomation("RUNNING", "PREPARED")).toBe(true);
    expect(canTransitionMobileAutomation("WAITING_USER", "COMPLETE")).toBe(true);
    expect(canTransitionMobileAutomation("PENDING_APPROVAL", "CLAIM")).toBe(false);
    expect(canTransitionMobileAutomation("COMPLETED", "RETRY")).toBe(false);
  });
});
