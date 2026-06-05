import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import {
  analyticsFunnel,
  scoreDistribution,
  urgencyBreakdown,
  messagesLast30Days,
  responsesLast30Days,
  topProvinces,
  conversionByNiche,
  conversionByProvince
} from "@/lib/leads/analytics";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const [funnel, scores, urgency, messages, responses, provinces, convNiche, convProvince] =
    await Promise.all([
      analyticsFunnel(api.workspaceId),
      scoreDistribution(api.workspaceId),
      urgencyBreakdown(api.workspaceId),
      messagesLast30Days(api.workspaceId),
      responsesLast30Days(api.workspaceId),
      topProvinces(api.workspaceId, 10),
      conversionByNiche(api.workspaceId, 20),
      conversionByProvince(api.workspaceId, 20)
    ]);
  return NextResponse.json({
    funnel,
    scores,
    urgency,
    messages,
    responses,
    provinces,
    convNiche,
    convProvince
  });
});
