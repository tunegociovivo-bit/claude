import { Alert, Image, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "../lib/api";
import { CheckSession } from "../lib/session";
import { challengeActionCopy, challengePriceCopy } from "../lib/challenge-details";
import { useTheme, type Palette, radius, shadow } from "../lib/theme";
import type { RootStackParamList } from "../../App";

export type FriendChallengeSnapshot = {
  offerId: string;
  discountPct: number;
  rewardLabel?: string | null;
  hoursLeft: number;
  daysLeft?: number;
  description?: string | null;
  price?: number | null;
  mode?: "local" | "online" | null;
  inviterName?: string | null;
  business: {
    id: string;
    name: string;
    category: string;
    city?: string | null;
    address?: string | null;
    phone?: string | null;
    challengeImageUrl?: string | null;
  };
};

export type FriendChallengeDetailParam = { challenge: FriendChallengeSnapshot };
type DetailRoute = RouteProp<RootStackParamList, "FriendChallengeDetail">;

export function FriendChallengeDetail() {
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const c = useTheme();
  const styles = makeStyles(c);
  const { challenge } = useRoute<DetailRoute>().params;
  const action = challengeActionCopy({
    mode: challenge.mode,
    businessName: challenge.business.name,
    address: challenge.business.address,
    inviterName: challenge.inviterName,
  });
  const price = challengePriceCopy(challenge.price, challenge.discountPct);
  const daysLeft = challenge.daysLeft ?? Math.max(1, Math.ceil(challenge.hoursLeft / 24));

  async function recordContact(channel: "qr" | "whatsapp") {
    const customer = await CheckSession().catch(() => null);
    if (customer?.customerId) await api.challengeContact(customer.customerId, challenge.offerId, channel).catch(() => {});
  }

  async function acceptChallenge() {
    if (challenge.mode === "online") {
      const phone = (challenge.business.phone || "").replace(/\D/g, "");
      if (!phone) {
        Alert.alert("Falta el WhatsApp", "El negocio todavía no ha indicado un teléfono público.");
        return;
      }
      await recordContact("whatsapp");
      await Linking.openURL(`https://wa.me/${phone}?text=${encodeURIComponent(action)}`);
      return;
    }
    await recordContact("qr");
    nav.navigate("Scan", { businessId: challenge.business.id });
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity style={styles.back} onPress={() => nav.goBack()} accessibilityRole="button">
          <Text style={styles.backText}>‹ Volver</Text>
        </TouchableOpacity>
        <Image
          source={challenge.business.challengeImageUrl ? { uri: challenge.business.challengeImageUrl } : require("../../assets/challenge-default.png")}
          style={styles.image}
          resizeMode="cover"
        />
        <Text style={styles.eyebrow}>UN AMIGO TE HA ENVIADO ESTE RETO</Text>
        <Text style={styles.title}>{challenge.rewardLabel || `${challenge.discountPct}% de descuento`}</Text>
        <Text style={styles.business}>{challenge.business.name}</Text>
        <Text style={styles.meta}>{challenge.business.category}{challenge.business.city ? ` · ${challenge.business.city}` : ""}</Text>

        <View style={styles.infoBox}>
          <Text style={styles.description}>{challenge.description || "Disfruta de este servicio con un descuento especial enviado por tu amigo/a."}</Text>
          {!!price && <Text style={styles.price}>{price}</Text>}
          <Text style={styles.actionCopy}>{action}</Text>
          <Text style={styles.expiry}>Disponible durante {daysLeft} {daysLeft === 1 ? "día" : "días"}</Text>
        </View>

        <TouchableOpacity style={styles.cta} onPress={acceptChallenge} accessibilityRole="button" accessibilityLabel={challenge.mode === "online" ? "Contactar por WhatsApp para aceptar el reto" : "Escanear el QR para aceptar el reto"}>
          <Text style={styles.ctaText}>{challenge.mode === "online" ? "Contactar por WhatsApp y aceptar" : "Escanear QR y aceptar el reto"}</Text>
        </TouchableOpacity>
        <Text style={styles.hint}>Cuando lo completes, tu amigo avanzará en su reto y ambos disfrutaréis del descuento.</Text>
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  content: { paddingHorizontal: 18, paddingBottom: 36 },
  back: { alignSelf: "flex-start", paddingVertical: 8, paddingRight: 16 },
  backText: { color: c.pink, fontSize: 15, fontWeight: "800" },
  image: { width: "100%", height: 230, borderRadius: radius.lg, backgroundColor: c.pinkSoft, marginTop: 8 },
  eyebrow: { marginTop: 20, color: c.pink, fontWeight: "900", fontSize: 13, textAlign: "center", letterSpacing: 0.4 },
  title: { marginTop: 8, color: c.black, fontWeight: "900", fontSize: 24, textAlign: "center" },
  business: { marginTop: 14, color: c.black, fontWeight: "900", fontSize: 19, textAlign: "center" },
  meta: { marginTop: 3, color: c.gray, fontSize: 13, textAlign: "center" },
  infoBox: { marginTop: 18, padding: 18, borderRadius: radius.lg, backgroundColor: c.white, borderWidth: 1, borderColor: c.border, ...shadow.card },
  description: { color: c.ink, fontSize: 15, lineHeight: 22, fontWeight: "700" },
  price: { marginTop: 14, color: c.pinkDeep, fontSize: 16, lineHeight: 23, fontWeight: "900" },
  actionCopy: { marginTop: 14, color: c.ink, fontSize: 14, lineHeight: 21 },
  expiry: { marginTop: 12, color: c.gray, fontSize: 12, fontWeight: "700" },
  cta: { marginTop: 20, backgroundColor: c.pink, borderRadius: radius.pill, paddingVertical: 17, paddingHorizontal: 18, alignItems: "center", ...shadow.btn },
  ctaText: { color: c.onAccent, fontWeight: "900", fontSize: 16, textAlign: "center" },
  hint: { marginTop: 12, color: c.gray, textAlign: "center", fontSize: 12, lineHeight: 18 },
});
