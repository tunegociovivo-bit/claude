import { z } from "zod";

export const MAX_FACEBOOK_GROUP_CANDIDATES = 20;
export const MAX_FACEBOOK_GROUPS_PER_BATCH = 15;
export const MAX_FACEBOOK_GROUP_BATCH_TEXT = 24_000;

export const facebookGroupCandidateOutcomeSchema = z.enum([
  "pending",
  "joined",
  "requested",
  "needs_answers",
  "failed",
  "skipped"
]);

export const facebookGroupCandidateSchema = z.object({
  id: z.string().trim().min(1).max(180),
  name: z.string().trim().min(2).max(180),
  details: z.string().trim().max(500),
  relevanceScore: z.number().int().min(0).max(100),
  reason: z.string().trim().min(1).max(400),
  selected: z.boolean(),
  outcome: facebookGroupCandidateOutcomeSchema,
  resultDetail: z.string().trim().max(800).nullable()
}).strict();

export const facebookGroupBatchSchema = z.object({
  version: z.literal(1),
  query: z.string().trim().min(2).max(200),
  criteria: z.string().trim().min(3).max(4000),
  membershipAnswers: z.string().trim().max(2000),
  maxGroups: z.number().int().min(1).max(MAX_FACEBOOK_GROUPS_PER_BATCH),
  candidates: z.array(facebookGroupCandidateSchema).max(MAX_FACEBOOK_GROUP_CANDIDATES)
}).strict();

export type FacebookGroupCandidate = z.infer<typeof facebookGroupCandidateSchema>;
export type FacebookGroupBatch = z.infer<typeof facebookGroupBatchSchema>;

const rawCandidateSchema = z.object({
  name: z.string().trim().min(2).max(180),
  details: z.string().trim().max(500).default(""),
  relevanceScore: z.number().int().min(0).max(100),
  reason: z.string().trim().min(1).max(400),
  recommended: z.boolean()
}).strict();

function fingerprint(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function candidateId(name: string): string {
  return fingerprint(name).replace(/\s+/g, "-").slice(0, 180);
}

export function cleanFacebookGroupName(value: string): string {
  return value
    .trim()
    .replace(
      /(?:\s*[·•|:]\s*|\s+[–—-]\s+)(?:unirte|únirte|unirse|join(?:\s+group)?)\s*$/iu,
      ""
    )
    .trim();
}

function repairFacebookGroupBatch(batch: FacebookGroupBatch): FacebookGroupBatch {
  return {
    ...batch,
    candidates: batch.candidates.map((candidate) => {
      const cleanedName = cleanFacebookGroupName(candidate.name);
      const name = cleanedName.length >= 2 ? cleanedName : candidate.name.trim();
      return {
        ...candidate,
        id: candidateId(name),
        name
      };
    })
  };
}

export function createInitialFacebookGroupBatch(input: {
  query: string;
  criteria: string;
  answerFacts?: string;
  membershipAnswers?: string;
  maxGroups: number;
}): FacebookGroupBatch {
  return facebookGroupBatchSchema.parse({
    version: 1,
    query: input.query,
    criteria: input.criteria,
    membershipAnswers: input.membershipAnswers ?? input.answerFacts ?? "",
    maxGroups: input.maxGroups,
    candidates: []
  });
}

export function normalizeFacebookGroupCandidates(
  input: unknown,
  maxGroups: number
): FacebookGroupCandidate[] {
  if (!Array.isArray(input)) return [];
  const unique = new Map<string, z.infer<typeof rawCandidateSchema>>();
  for (const raw of input) {
    const parsed = rawCandidateSchema.safeParse(raw);
    if (!parsed.success) continue;
    const name = cleanFacebookGroupName(parsed.data.name);
    if (name.length < 2) continue;
    const candidate = { ...parsed.data, name };
    const key = fingerprint(name);
    if (!key) continue;
    const previous = unique.get(key);
    if (!previous || candidate.relevanceScore > previous.relevanceScore) {
      unique.set(key, candidate);
    }
  }

  let selectedCount = 0;
  return Array.from(unique.values())
    .sort((left, right) => right.relevanceScore - left.relevanceScore)
    .slice(0, MAX_FACEBOOK_GROUP_CANDIDATES)
    .map((candidate) => {
      const selected = candidate.recommended && selectedCount < maxGroups;
      if (selected) selectedCount += 1;
      return {
        id: candidateId(candidate.name),
        name: candidate.name,
        details: candidate.details,
        relevanceScore: candidate.relevanceScore,
        reason: candidate.reason,
        selected,
        outcome: "pending" as const,
        resultDetail: null
      };
    });
}

export function parseFacebookGroupBatch(value: string): FacebookGroupBatch {
  try {
    const parsed = facebookGroupBatchSchema.safeParse(JSON.parse(value));
    if (parsed.success) return repairFacebookGroupBatch(parsed.data);
  } catch {
    // The public error below intentionally excludes the supplied JSON.
  }
  throw new Error("El lote de grupos no es válido.");
}

export function serializeFacebookGroupBatch(batch: FacebookGroupBatch): string {
  const serialized = JSON.stringify(repairFacebookGroupBatch(facebookGroupBatchSchema.parse(batch)));
  if (serialized.length > MAX_FACEBOOK_GROUP_BATCH_TEXT) {
    throw new Error("El lote de grupos supera el tamaño permitido.");
  }
  return serialized;
}

export function toggleFacebookGroupCandidate(
  batch: FacebookGroupBatch,
  candidateIdValue: string,
  selected: boolean
): FacebookGroupBatch {
  const alreadySelected = batch.candidates.filter((candidate) => candidate.selected).length;
  if (selected && alreadySelected >= batch.maxGroups) {
    throw new Error(`Puedes aprobar un máximo de ${batch.maxGroups} grupos en este lote.`);
  }
  return {
    ...batch,
    candidates: batch.candidates.map((candidate) => candidate.id === candidateIdValue
      ? { ...candidate, selected }
      : candidate)
  };
}

export function updateFacebookGroupMembershipAnswers(
  batch: FacebookGroupBatch,
  membershipAnswers: string
): FacebookGroupBatch {
  return facebookGroupBatchSchema.parse({
    ...batch,
    membershipAnswers
  });
}

export function selectedFacebookGroupCount(batch: FacebookGroupBatch): number {
  return batch.candidates.filter((candidate) => candidate.selected && candidate.outcome === "pending").length;
}
