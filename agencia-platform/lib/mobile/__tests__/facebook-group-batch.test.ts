import { describe, expect, it } from "vitest";
import {
  createInitialFacebookGroupBatch,
  normalizeFacebookGroupCandidates,
  parseFacebookGroupBatch,
  serializeFacebookGroupBatch,
  toggleFacebookGroupCandidate,
  updateFacebookGroupMembershipAnswers
} from "@/lib/mobile/facebook-group-batch";

describe("Facebook group batches", () => {
  it("normalizes, deduplicates and selects only the best recommended groups", () => {
    const candidates = normalizeFacebookGroupCandidates([
      {
        name: "Franquicias y Negocios rentables en España para emprender",
        details: "Público · 2.927 miembros · 2 publicaciones al día",
        relevanceScore: 94,
        reason: "Está centrado en franquicias activas en España.",
        recommended: true
      },
      {
        name: "  FRANQUICIAS Y NEGOCIOS RENTABLES EN ESPAÑA PARA EMPRENDER ",
        details: "duplicado",
        relevanceScore: 70,
        reason: "duplicado",
        recommended: true
      },
      {
        name: "Franquicias baratas en México",
        details: "Público",
        relevanceScore: 42,
        reason: "No coincide con España.",
        recommended: false
      }
    ], 10);

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({ relevanceScore: 94, selected: true, outcome: "pending" });
    expect(candidates[1]).toMatchObject({ selected: false });
  });

  it("removes the Facebook join button label from names returned by vision", () => {
    const candidates = normalizeFacebookGroupCandidates([{
      name: "Franquicias en España · Únirte",
      details: "Público · 554 miembros",
      relevanceScore: 95,
      reason: "Coincide con los criterios.",
      recommended: true
    }], 5);

    expect(candidates[0]).toMatchObject({
      id: "franquicias-en-espana",
      name: "Franquicias en España"
    });
  });

  it("repairs an already approved batch before the phone searches its first group", () => {
    const batch = parseFacebookGroupBatch(JSON.stringify({
      version: 1,
      query: "franquicias",
      criteria: "Grupos de España",
      membershipAnswers: "",
      maxGroups: 5,
      candidates: [{
        id: "franquicias-en-espana-unirte",
        name: "Franquicias en España · Únirte",
        details: "Público · 554 miembros",
        relevanceScore: 95,
        reason: "Coincide con los criterios.",
        selected: true,
        outcome: "pending",
        resultDetail: null
      }]
    }));

    expect(batch.candidates[0]).toMatchObject({
      id: "franquicias-en-espana",
      name: "Franquicias en España"
    });
  });

  it("round-trips a batch and lets the user exclude a recommendation before approval", () => {
    const initial = createInitialFacebookGroupBatch({
      query: "franquicias",
      criteria: "Solo grupos activos de España con conversaciones profesionales.",
      answerFacts: "Soy David y dirijo una agencia de marketing en Málaga.",
      maxGroups: 8
    });
    const withCandidate = {
      ...initial,
      candidates: normalizeFacebookGroupCandidates([{
        name: "Franquicias en España",
        details: "554 miembros",
        relevanceScore: 88,
        reason: "Coincide con el país y el sector.",
        recommended: true
      }], 8)
    };
    const toggled = toggleFacebookGroupCandidate(withCandidate, withCandidate.candidates[0]!.id, false);

    expect(parseFacebookGroupBatch(serializeFacebookGroupBatch(toggled))).toEqual(toggled);
    expect(toggled.candidates[0]!.selected).toBe(false);
  });

  it("rejects arbitrary JSON instead of executing it as a batch", () => {
    expect(() => parseFacebookGroupBatch('{"command":"input tap 1 1"}')).toThrow(/lote/i);
  });

  it("lets the user add missing factual answers before retrying a partial batch", () => {
    const batch = createInitialFacebookGroupBatch({
      query: "franquicias",
      criteria: "Grupos profesionales de España",
      maxGroups: 5
    });

    expect(updateFacebookGroupMembershipAnswers(batch, "Dirijo una agencia de marketing en Málaga."))
      .toMatchObject({ membershipAnswers: "Dirijo una agencia de marketing en Málaga." });
  });
});
