import SubvencionesAdmin from "@/components/admin/SubvencionesAdmin";
import BubuiSubvencionesReview from "@/components/admin/BubuiSubvencionesReview";

export const dynamic = "force-dynamic";

export default function SubvencionesAdminPage() {
  return (
    <>
      <SubvencionesAdmin />
      <BubuiSubvencionesReview />
    </>
  );
}
