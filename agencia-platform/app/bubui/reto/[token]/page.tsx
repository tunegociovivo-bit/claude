import RetoClient from "./RetoClient";

export const dynamic = "force-dynamic";

export default function RetoPage({ params }: { params: { token: string } }) {
  return <RetoClient token={params.token} />;
}
