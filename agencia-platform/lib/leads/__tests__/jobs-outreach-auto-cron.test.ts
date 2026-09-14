import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  workspaceFindMany: vi.fn(),
  workspaceFindUnique: vi.fn(),
  searchFindFirst: vi.fn(),
  generateEmailDrafts: vi.fn(),
  syncLinkedInDrafts: vi.fn(),
  processQueue: vi.fn(),
  processSequences: vi.fn(),
  processBroadcast: vi.fn(),
  processAutoFollowup: vi.fn(),
  processExecOutreach: vi.fn(),
  runProspecting: vi.fn(),
  processEmailEnrichment: vi.fn(),
  processGmbCadence: vi.fn()
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    workspace: {
      findMany: mocks.workspaceFindMany,
      findUnique: mocks.workspaceFindUnique
    },
    leadSearch: { findFirst: mocks.searchFindFirst }
  }
}));
vi.mock("@/lib/monitoring/error-log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/leads/search-manager", () => ({ processSearchBatch: vi.fn(), ingestJobsInbox: vi.fn() }));
vi.mock("@/lib/leads/send-queue", () => ({ processQueueTick: mocks.processQueue, prioritizeQueue: vi.fn() }));
vi.mock("@/lib/leads/sequences", () => ({ processSequencesTick: mocks.processSequences }));
vi.mock("@/lib/leads/broadcast", () => ({ processBroadcastTick: mocks.processBroadcast }));
vi.mock("@/lib/leads/auto-followup", () => ({ processAutoFollowupTick: mocks.processAutoFollowup }));
vi.mock("@/lib/leads/exec-outreach", () => ({
  processExecOutreachTick: mocks.processExecOutreach,
  generateJobsReviewDrafts: mocks.generateEmailDrafts
}));
vi.mock("@/lib/leads/job-prospecting-bridge", () => ({ syncJobLeadsToProspecting: mocks.syncLinkedInDrafts }));
vi.mock("@/lib/leads/prospecting-engine", () => ({ runProspectingEngine: mocks.runProspecting }));
vi.mock("@/lib/leads/email-enrichment-worker", () => ({ processEmailEnrichmentTick: mocks.processEmailEnrichment }));
vi.mock("@/lib/leads/lead-cadence", () => ({ processGmbCadenceTick: mocks.processGmbCadence }));
vi.mock("@/lib/leads/franchise-owner-queue", () => ({ processFranchiseOwnerQueue: vi.fn().mockResolvedValue({ picked: 0, processed: 0, errored: 0 }) }));
vi.mock("@/lib/leads/franchise-contact-queue", () => ({ processFranchiseContactQueue: vi.fn().mockResolvedValue({ picked: 0, processed: 0, errored: 0 }) }));
vi.mock("@/lib/leads/proxy", () => ({ checkAllProxiesForWorkspace: vi.fn() }));

import { runLeadsCronAllWorkspaces } from "../cron";

describe("automatización de borradores de Empleos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.workspaceFindMany.mockResolvedValue([{ id: "workspace-1" }]);
    mocks.workspaceFindUnique.mockResolvedValue({ settings: { leads: { jobsInboxEnabled: false } } });
    mocks.searchFindFirst.mockResolvedValue(null);
    mocks.generateEmailDrafts.mockResolvedValue({ drafted: 3, candidates: 5, alreadyHandled: 2 });
    mocks.syncLinkedInDrafts.mockResolvedValue({ candidates: 8, drafted: 6, alreadyLinked: 2, unresolvedProfiles: 1 });
    mocks.processQueue.mockResolvedValue({ sent: 0 });
    mocks.processSequences.mockResolvedValue({ processed: 0 });
    mocks.processBroadcast.mockResolvedValue({ processed: 0 });
    mocks.processAutoFollowup.mockResolvedValue({ processed: 0 });
    mocks.processExecOutreach.mockResolvedValue({ processed: 0 });
    mocks.runProspecting.mockResolvedValue({ processed: 0 });
    mocks.processEmailEnrichment.mockResolvedValue({ processed: 0 });
    mocks.processGmbCadence.mockResolvedValue({ processed: 0 });
  });

  it("genera automáticamente los emails y mensajes de LinkedIn que hayan quedado pendientes", async () => {
    const report = await runLeadsCronAllWorkspaces();

    expect(mocks.generateEmailDrafts).toHaveBeenCalledWith("workspace-1");
    expect(mocks.syncLinkedInDrafts).toHaveBeenCalledWith({ workspaceId: "workspace-1" });
    expect(report[0].jobsOutreach).toMatchObject({
      email: { drafted: 3 },
      linkedin: { drafted: 6 }
    });
  });
});
