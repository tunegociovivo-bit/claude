import { z } from "zod";
import { PORTAL_KEYS } from "@/lib/inmobiliaria/portals";

export const SEARCH_OPERATIONS = ["rent", "sale", "both"] as const;
export type SearchOperation = (typeof SEARCH_OPERATIONS)[number];

export const REQUIRED_SPACES = [
  "reception_waiting",
  "cabins",
  "staff_area",
  "laundry_storage",
  "toilets"
] as const;
export type RequiredSpace = (typeof REQUIRED_SPACES)[number];

export const REQUIRED_SPACE_LABELS: Record<RequiredSpace, string> = {
  reception_waiting: "Recepción / espera",
  cabins: "Cabinas",
  staff_area: "Zona de personal",
  laundry_storage: "Lavandería / almacén",
  toilets: "Baños"
};

const optionalPositiveInt = (max: number) => z.number().int().positive().max(max).optional();
const optionalMoney = z.number().finite().nonnegative().max(100_000_000).optional();
const portalEnum = z.enum(PORTAL_KEYS as [string, ...string[]]);

export const businessPremisesSearchSchema = z
  .object({
    location: z.string().trim().min(2).max(160),
    operation: z.enum(SEARCH_OPERATIONS).default("rent"),
    businessDescription: z.string().trim().max(2_000).optional(),
    minSurface: optionalPositiveInt(100_000),
    maxSurface: optionalPositiveInt(100_000),
    minCabins: z.number().int().min(0).max(100).default(0),
    allowOpenPlan: z.boolean().default(true),
    preferStreetLevel: z.boolean().default(true),
    preferSingleFloor: z.boolean().default(true),
    basementPolicy: z.enum(["allow_penalize", "exclude"]).default("allow_penalize"),
    requiredSpaces: z.array(z.enum(REQUIRED_SPACES)).max(REQUIRED_SPACES.length).default([]),
    distributionNotes: z.string().trim().max(1_000).optional(),
    maxMonthlyRent: optionalMoney,
    maxPurchasePrice: optionalMoney,
    maxFitOutBudget: optionalMoney,
    maxInitialInvestment: optionalMoney,
    preferReadyToEnter: z.boolean().default(true),
    portals: z.array(portalEnum).max(20).default([]),
    maxResults: z.number().int().min(1).max(100).default(80),
    onlyMatches: z.boolean().default(true)
  })
  .superRefine((value, ctx) => {
    if (
      value.minSurface !== undefined &&
      value.maxSurface !== undefined &&
      value.minSurface > value.maxSurface
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxSurface"],
        message: "La superficie máxima debe ser igual o mayor que la mínima"
      });
    }
    if (value.operation === "sale" && value.maxMonthlyRent !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxMonthlyRent"],
        message: "La renta máxima solo se puede usar en alquiler o ambas operaciones"
      });
    }
    if (value.operation === "rent" && value.maxPurchasePrice !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxPurchasePrice"],
        message: "El precio de compra solo se puede usar en venta o ambas operaciones"
      });
    }
  });

export type BusinessPremisesSearch = z.output<typeof businessPremisesSearchSchema>;

export type EvidenceStatus = "confirmed" | "inferred" | "conflicting" | "unknown";
export const EVIDENCE_FIELDS = [
  "operation",
  "property_type",
  "location",
  "surface",
  "monthly_rent",
  "sale_price",
  "transfer_price",
  "floor",
  "single_floor",
  "has_basement",
  "existing_cabins",
  "cabin_capacity",
  "layout",
  "spaces",
  "condition",
  "fit_out_estimate"
] as const;
export type EvidenceField = (typeof EVIDENCE_FIELDS)[number];
export type MatchStatus = "match" | "partial" | "mismatch" | "unknown" | "not_applicable";

export type FitCriterion = {
  key: string;
  label: string;
  status: MatchStatus;
  points: number;
  maxPoints: number;
  reason: string;
};

export type OpportunitySource = {
  portal: string;
  label: string;
  url: string;
  reference: string | null;
};

export type Opportunity = {
  id: string;
  portal: string;
  portal_label: string;
  bank: string;
  title: string;
  property_type: string;
  location: string;
  url: string;
  url_verified: boolean;
  price: number;
  surface: number | null;
  price_m2: number | null;
  estimated_market_price: number | null;
  discount_pct: number | null;
  estimated_rent: number | null;
  gross_yield: number | null;
  score: number;
  verdict: "OPORTUNIDAD" | "INTERESANTE" | "DESCARTAR";
  occupied: boolean;
  pros: string[];
  cons: string[];
  reasoning: string;
  phone?: string;
  searchUrl?: string;
  operation: "rent" | "sale" | "both" | "transfer" | "unknown";
  monthly_rent: number | null;
  sale_price: number | null;
  transfer_price: number | null;
  existing_cabins: number | null;
  cabin_capacity: number | null;
  layout: "open_plan" | "partitioned" | "mixed" | "unknown";
  floor: "street" | "basement" | "mezzanine" | "upper" | "mixed" | "unknown";
  single_floor: boolean | null;
  has_basement: boolean | null;
  spaces: Record<RequiredSpace, boolean | null>;
  condition: "ready" | "minor_works" | "major_works" | "unknown";
  fit_out_estimate: { min: number; max: number } | null;
  initial_investment: {
    confirmedLowerBound: number;
    estimatedMin: number | null;
    estimatedMax: number | null;
    complete: boolean;
  };
  evidence: Array<{ field: EvidenceField; status: EvidenceStatus; text: string }>;
  unknown_fields: string[];
  fit_breakdown: FitCriterion[];
  fit_confidence: number;
  sources: OpportunitySource[];
};

export type PortalCoverage = {
  key: string;
  label: string;
  status: "searched" | "partial" | "failed";
  candidates: number;
  note?: string;
};

export type SearchStats = {
  candidatesFound: number;
  duplicatesMerged: number;
  hardFiltered: number;
  returned: number;
};

export type SearchResult = {
  opportunities: Opportunity[];
  summary: string;
  searchedPortals: { key: string; label: string; bank: string }[];
  portalCoverage: PortalCoverage[];
  stats: SearchStats;
  notes?: string;
};

const nullableNumber = { anyOf: [{ type: "number" }, { type: "null" }] };
const nullableBoolean = { anyOf: [{ type: "boolean" }, { type: "null" }] };

export const OPPORTUNITY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    notes: { type: "string" },
    opportunities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          portal: { type: "string" },
          portal_label: { type: "string" },
          bank: { type: "string" },
          title: { type: "string" },
          property_type: { type: "string" },
          location: { type: "string" },
          url: { type: "string" },
          price: { type: "number" },
          surface: nullableNumber,
          price_m2: nullableNumber,
          estimated_market_price: nullableNumber,
          discount_pct: nullableNumber,
          estimated_rent: nullableNumber,
          gross_yield: nullableNumber,
          score: { type: "number" },
          verdict: { type: "string", enum: ["OPORTUNIDAD", "INTERESANTE", "DESCARTAR"] },
          occupied: { type: "boolean" },
          pros: { type: "array", items: { type: "string" } },
          cons: { type: "array", items: { type: "string" } },
          reasoning: { type: "string" },
          operation: { type: "string", enum: ["rent", "sale", "both", "transfer", "unknown"] },
          monthly_rent: nullableNumber,
          sale_price: nullableNumber,
          transfer_price: nullableNumber,
          existing_cabins: nullableNumber,
          cabin_capacity: nullableNumber,
          layout: { type: "string", enum: ["open_plan", "partitioned", "mixed", "unknown"] },
          floor: { type: "string", enum: ["street", "basement", "mezzanine", "upper", "mixed", "unknown"] },
          single_floor: nullableBoolean,
          has_basement: nullableBoolean,
          spaces: {
            type: "object",
            additionalProperties: false,
            properties: Object.fromEntries(REQUIRED_SPACES.map((key) => [key, nullableBoolean])),
            required: [...REQUIRED_SPACES]
          },
          condition: { type: "string", enum: ["ready", "minor_works", "major_works", "unknown"] },
          fit_out_estimate: {
            anyOf: [
              {
                type: "object",
                additionalProperties: false,
                properties: { min: { type: "number" }, max: { type: "number" } },
                required: ["min", "max"]
              },
              { type: "null" }
            ]
          },
          evidence: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                field: { type: "string", enum: [...EVIDENCE_FIELDS] },
                status: { type: "string", enum: ["confirmed", "inferred", "conflicting", "unknown"] },
                text: { type: "string" }
              },
              required: ["field", "status", "text"]
            }
          },
          unknown_fields: { type: "array", items: { type: "string" } }
        },
        required: [
          "id", "portal", "portal_label", "bank", "title", "property_type", "location", "url",
          "price", "surface", "price_m2", "estimated_market_price", "discount_pct", "estimated_rent",
          "gross_yield", "score", "verdict", "occupied", "pros", "cons", "reasoning", "operation",
          "monthly_rent", "sale_price", "transfer_price", "existing_cabins", "cabin_capacity", "layout",
          "floor", "single_floor", "has_basement", "spaces", "condition", "fit_out_estimate", "evidence",
          "unknown_fields"
        ]
      }
    }
  },
  required: ["summary", "notes", "opportunities"]
};
