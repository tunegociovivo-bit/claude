import { redirect } from "next/navigation";
import { requireOperator } from "@/lib/auth";
import AdminDashboard from "./AdminDashboard";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  try { await requireOperator(); } catch { redirect("/pipeline"); }
  return <AdminDashboard />;
}
