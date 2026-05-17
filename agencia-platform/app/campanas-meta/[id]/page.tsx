import CampaignDetailClient from "@/components/campanas-meta/CampaignDetailClient";

export const dynamic = "force-dynamic";

export default function CampaignDetailPage({ params }: { params: { id: string } }) {
  return <CampaignDetailClient campaignId={params.id} />;
}
