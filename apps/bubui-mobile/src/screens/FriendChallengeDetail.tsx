import { useState } from "react";
import { Image, Linking, Modal, Platform, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import * as IntentLauncher from "expo-intent-launcher";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "../lib/api";
import { CheckSession } from "../lib/session";
import { challengeActionCopy, challengePriceBreakdown, formatEuro } from "../lib/challenge-details";
import { WHATSAPP_PACKAGES, whatsappAppUrl, whatsappChatUrl, type WhatsAppTarget } from "../lib/whatsapp-target";
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
  const [showWhatsAppChooser, setShowWhatsAppChooser] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const action = challengeActionCopy({
    mode: challenge.mode,
    businessName: challenge.business.name,
    address: challenge.business.address,
    inviterName: challenge.inviterName,
  });
  const price = challengePriceBreakdown(challenge.price, challenge.discountPct);
  const daysLeft = challenge.daysLeft ?? Math.max(1, Math.ceil(challenge.hoursLeft / 24));

  async function recordContact(channel: "qr" | "whatsapp") {
    const customer = await CheckSession().catch(() => null);
    if (customer?.customerId) await api.challengeContact(customer.customerId, challenge.offerId, channel).catch(() => {});
  }

  async function openWhatsApp(target: WhatsAppTarget) {
    const url = Platform.OS === "android"
      ? whatsappAppUrl(challenge.business.phone || "", action)
      : whatsappChatUrl(challenge.business.phone || "", action);
    setActionError(null);
    try {
      if (Platform.OS === "android") {
        await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
          data: url,
          packageName: WHATSAPP_PACKAGES[target],
        });
      } else {
        await Linking.openURL(url);
      }
      await recordContact("whatsapp");
      setShowWhatsAppChooser(false);
    } catch {
      setActionError(`No se pudo abrir ${target === "business" ? "WhatsApp Business" : "WhatsApp"}. Elige otra opción.`);
    }
  }

  async function shareWithAnotherApp() {
    await Share.share({ message: action });
    setShowWhatsAppChooser(false);
  }

  async function acceptChallenge() {
    if (challenge.mode === "online") {
      if (!challenge.business.phone) {
        setActionError("El negocio todavía no ha indicado un teléfono de WhatsApp.");
        return;
      }
      setShowWhatsAppChooser(true);
      return;
    }
    await recordContact("qr");
    nav.navigate("Scan", { businessId: challenge.business.id });
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <TouchableOpacity style={styles.back} onPress={() => nav.goBack()} accessibilityRole="button">
          <Text style={styles.backText}>‹ Volver</Text>
        </TouchableOpacity>
        <View style={styles.hero}>
          <Image
            source={challenge.business.challengeImageUrl ? { uri: challenge.business.challengeImageUrl } : require("../../assets/challenge-default.png")}
            style={styles.image}
            resizeMode="cover"
          />
          <View style={styles.discountBadge}><Text style={styles.discountBadgeText}>−{challenge.discountPct}%</Text></View>
        </View>
        <Text style={styles.eyebrow}>UN AMIGO TE HA ENVIADO ESTE RETO</Text>
        <Text style={styles.title}>{challenge.rewardLabel || "Un descuento especial para ti"}</Text>
        <Text style={styles.business}>{challenge.business.name}</Text>
        <Text style={styles.meta}>{challenge.business.category}{challenge.business.city ? ` · ${challenge.business.city}` : ""}</Text>

        <View style={styles.infoBox}>
          <Text style={styles.description}>{challenge.description || "Disfruta de este servicio con un descuento especial enviado por tu amigo/a."}</Text>
          {!!price && (
            <View style={styles.priceCard}>
              <View style={styles.priceColumn}>
                <Text style={styles.priceLabel}>PRECIO ORIGINAL</Text>
                <Text style={styles.originalPrice}>{formatEuro(price.original)}</Text>
              </View>
              <View style={styles.priceColumn}>
                <Text style={styles.priceLabel}>TE AHORRAS</Text>
                <Text style={styles.savingsPrice}>−{formatEuro(price.savings)}</Text>
              </View>
              <View style={[styles.priceColumn, styles.finalColumn]}>
                <Text style={styles.finalLabel}>PRECIO FINAL</Text>
                <Text style={styles.finalPrice}>{formatEuro(price.final)}</Text>
              </View>
            </View>
          )}
          <Text style={styles.actionCopy}>{action}</Text>
          <View style={styles.expiryPill}><Text style={styles.expiry}>⏰ Te quedan {daysLeft} {daysLeft === 1 ? "día" : "días"}</Text></View>
        </View>

        <Text style={styles.hint}>Cuando lo completes, tu amigo avanzará en su reto y ambos disfrutaréis del descuento.</Text>
      </ScrollView>

      <View style={[styles.stickyFooter, { paddingBottom: Math.max(12, insets.bottom) }]}>
        {!!actionError && <Text style={styles.error} numberOfLines={2}>{actionError}</Text>}
        <TouchableOpacity style={styles.cta} onPress={acceptChallenge} accessibilityRole="button" accessibilityLabel={challenge.mode === "online" ? "Elegir WhatsApp para aceptar el reto" : "Escanear el QR para aceptar el reto"}>
          <Text style={styles.ctaText}>{challenge.mode === "online" ? "Elegir WhatsApp y aceptar" : "Escanear QR y aceptar el reto"}</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={showWhatsAppChooser} transparent animationType="slide" onRequestClose={() => setShowWhatsAppChooser(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.chooser, { paddingBottom: Math.max(18, insets.bottom + 10) }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.chooserTitle}>¿Qué WhatsApp quieres usar?</Text>
            <Text style={styles.chooserText}>Abriremos el chat del negocio con el mensaje preparado.</Text>
            <TouchableOpacity style={styles.whatsappButton} onPress={() => void openWhatsApp("business")}>
              <Text style={styles.whatsappButtonText}>WhatsApp Business</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.whatsappOutline} onPress={() => void openWhatsApp("consumer")}>
              <Text style={styles.whatsappOutlineText}>WhatsApp normal</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.otherButton} onPress={() => void shareWithAnotherApp()}>
              <Text style={styles.otherButtonText}>Compartir con otra aplicación</Text>
            </TouchableOpacity>
            {!!actionError && <Text style={styles.error}>{actionError}</Text>}
            <TouchableOpacity style={styles.cancelButton} onPress={() => setShowWhatsAppChooser(false)}>
              <Text style={styles.cancelText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 18, paddingBottom: 36 },
  back: { alignSelf: "flex-start", paddingVertical: 8, paddingRight: 16 },
  backText: { color: c.pink, fontSize: 15, fontWeight: "800" },
  hero: { position: "relative", marginTop: 8 },
  image: { width: "100%", height: 230, borderRadius: radius.lg, backgroundColor: c.pinkSoft },
  discountBadge: { position: "absolute", top: 14, right: 14, borderRadius: radius.pill, paddingHorizontal: 18, paddingVertical: 10, backgroundColor: c.pink, ...shadow.btn },
  discountBadgeText: { color: c.onAccent, fontSize: 22, fontWeight: "900" },
  eyebrow: { marginTop: 20, color: c.pink, fontWeight: "900", fontSize: 13, textAlign: "center", letterSpacing: 0.4 },
  title: { marginTop: 8, color: c.black, fontWeight: "900", fontSize: 25, textAlign: "center" },
  business: { marginTop: 14, color: c.black, fontWeight: "900", fontSize: 19, textAlign: "center" },
  meta: { marginTop: 3, color: c.gray, fontSize: 13, textAlign: "center" },
  infoBox: { marginTop: 18, padding: 18, borderRadius: radius.lg, backgroundColor: c.white, borderWidth: 1, borderColor: c.border, ...shadow.card },
  description: { color: c.ink, fontSize: 16, lineHeight: 23, fontWeight: "700" },
  priceCard: { marginTop: 18, gap: 10 },
  priceColumn: { borderRadius: radius.md, backgroundColor: c.pinkWash, paddingHorizontal: 14, paddingVertical: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  priceLabel: { color: c.gray, fontSize: 11, fontWeight: "900", letterSpacing: 0.4 },
  originalPrice: { color: c.gray, fontSize: 18, fontWeight: "800", textDecorationLine: "line-through" },
  savingsPrice: { color: "#15946B", fontSize: 19, fontWeight: "900" },
  finalColumn: { backgroundColor: c.pink, paddingVertical: 17 },
  finalLabel: { color: c.onAccent, fontSize: 12, fontWeight: "900", letterSpacing: 0.5 },
  finalPrice: { color: c.onAccent, fontSize: 29, fontWeight: "900", letterSpacing: -0.8 },
  actionCopy: { marginTop: 18, color: c.ink, fontSize: 14, lineHeight: 21 },
  expiryPill: { marginTop: 14, alignSelf: "flex-start", backgroundColor: c.pinkSoft, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill },
  expiry: { color: c.pinkDeep, fontSize: 12, fontWeight: "900" },
  stickyFooter: { backgroundColor: c.white, borderTopWidth: 1, borderTopColor: c.border, paddingHorizontal: 18, paddingTop: 12, ...shadow.card },
  cta: { backgroundColor: c.pink, borderRadius: radius.pill, paddingVertical: 18, paddingHorizontal: 18, alignItems: "center", ...shadow.btn },
  ctaText: { color: c.onAccent, fontWeight: "900", fontSize: 16, textAlign: "center" },
  hint: { marginTop: 12, color: c.gray, textAlign: "center", fontSize: 12, lineHeight: 18 },
  error: { marginTop: 12, color: "#B42318", backgroundColor: "#FEF3F2", borderRadius: radius.md, padding: 10, textAlign: "center", fontWeight: "700" },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(20,10,20,0.52)" },
  chooser: { backgroundColor: c.white, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20 },
  modalHandle: { width: 44, height: 5, borderRadius: 3, backgroundColor: c.border, alignSelf: "center", marginBottom: 18 },
  chooserTitle: { color: c.black, fontSize: 22, fontWeight: "900", textAlign: "center" },
  chooserText: { color: c.gray, fontSize: 14, lineHeight: 20, textAlign: "center", marginTop: 7, marginBottom: 18 },
  whatsappButton: { backgroundColor: "#20B65A", borderRadius: radius.pill, paddingVertical: 16, alignItems: "center" },
  whatsappButtonText: { color: "#fff", fontSize: 16, fontWeight: "900" },
  whatsappOutline: { marginTop: 10, borderColor: "#20B65A", borderWidth: 2, borderRadius: radius.pill, paddingVertical: 14, alignItems: "center" },
  whatsappOutlineText: { color: "#14823F", fontSize: 15, fontWeight: "900" },
  otherButton: { marginTop: 10, paddingVertical: 12, alignItems: "center" },
  otherButtonText: { color: c.pinkDeep, fontWeight: "800" },
  cancelButton: { marginTop: 4, paddingVertical: 10, alignItems: "center" },
  cancelText: { color: c.gray, fontWeight: "700" },
});
