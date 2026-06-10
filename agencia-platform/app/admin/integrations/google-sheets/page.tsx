import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, getSessionWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import PageHeader from "@/components/PageHeader";
import GoogleSheetsSettingsClient from "@/components/admin/GoogleSheetsSettingsClient";

export const dynamic = "force-dynamic";

export default async function GoogleSheetsIntegrationPage() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  const workspaceId = await getSessionWorkspaceId();
  if (!userId || !workspaceId) redirect("/login");

  const me = await prisma.membership.findFirst({ where: { userId, workspaceId } });
  if (!me || me.role !== "ADMIN") redirect("/");

  return (
    <div className="max-w-2xl mx-auto pb-24">
      <PageHeader
        title="Google Sheets (gspread)"
        description="Pega el service_account.json para que Sonia pueda leer y escribir en hojas de cálculo de Google. Comparte cada hoja con el email del service account (Editor). Solo administradores."
      />
      <GoogleSheetsSettingsClient />
    </div>
  );
}
