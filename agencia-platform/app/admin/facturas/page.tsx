import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// La facturación vive ahora en su propia sección /facturacion (con
// selector de empresa). Mantenemos esta ruta como redirección.
export default function FacturasPage() {
  redirect("/facturacion");
}
