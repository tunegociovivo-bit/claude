import GanarView from "./GanarView";

export const dynamic = "force-dynamic";

/** Pantalla "gana descuento por una acción" tras una compra. El push del cron
 *  enlaza aquí. La verificación y la creación del cupón van por la API. */
export default async function GanarPage(props: { params: Promise<{ purchaseId: string }> }) {
 const params = await props.params;
 return <GanarView purchaseId={params.purchaseId} />;
}
