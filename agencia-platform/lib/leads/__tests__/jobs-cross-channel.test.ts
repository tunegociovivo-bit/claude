import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prospectFind: vi.fn(),
  prospectUpdate: vi.fn(),
  activityUpdate: vi.fn(),
  leadUpdate: vi.fn(),
  outreachUpdate: vi.fn()
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: {
  prospectingProspect: { findFirst: mocks.prospectFind, updateMany: mocks.prospectUpdate },
  prospectingActivity: { updateMany: mocks.activityUpdate },
  lead: { updateMany: mocks.leadUpdate },
  leadExecOutreach: { updateMany: mocks.outreachUpdate }
} }));
vi.mock("@/lib/integrations/email", () => ({ LEADS_FROM: "leads@example.com", sendEmail: vi.fn() }));
vi.mock("@/lib/ai/anthropic", () => ({ complete: vi.fn() }));

import { nextExecOutreachStep } from "../exec-outreach";
import { markProspectingProspectReplied } from "../prospecting-engine";

describe("coordinación de canales de las ofertas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prospectFind.mockResolvedValue({ id: "prospect-1", leadId: "lead-1" });
    mocks.prospectUpdate.mockResolvedValue({ count: 1 });
    mocks.activityUpdate.mockResolvedValue({ count: 1 });
    mocks.leadUpdate.mockResolvedValue({ count: 1 });
    mocks.outreachUpdate.mockResolvedValue({ count: 1 });
  });

  it("omite el recordatorio LinkedIn antiguo porque NV Prospección ya gestiona ese canal", () => {
    expect(nextExecOutreachStep(0, { source: "jobs" })).toBe(2);
    expect(nextExecOutreachStep(0, { source: "franchises" })).toBe(1);
    expect(nextExecOutreachStep(2, { source: "jobs" })).toBe(3);
  });

  it("una respuesta en LinkedIn marca el lead respondido y detiene sus emails", async () => {
    await markProspectingProspectReplied("workspace-1", "prospect-1");

    expect(mocks.leadUpdate).toHaveBeenCalledWith({
      where: { id: "lead-1", workspaceId: "workspace-1", contactStatus: { in: ["pending", "contacted"] } },
      data: { contactStatus: "responded" }
    });
    expect(mocks.outreachUpdate).toHaveBeenCalledWith({
      where: { leadId: "lead-1", workspaceId: "workspace-1", status: { in: ["active", "pending_review"] } },
      data: { status: "stopped", draftSubject: null, draftBody: null }
    });
  });
});
