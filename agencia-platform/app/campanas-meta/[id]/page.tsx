import CampaignDetailClient from "@/components/campanas-meta/CampaignDetailClient";

export const dynamic = "force-dynamic";

export default async function CampaignDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return <CampaignDetailClient campaignId={params.id} />;
}
