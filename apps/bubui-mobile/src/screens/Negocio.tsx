import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, Linking, Share, Platform } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { API_BASE } from "../lib/api";
import { colors, radius, shadow } from "../lib/theme";
import type { RootStackParamList } from "../../App";

/** Negocio mostrado en el detalle. Reúne los campos que devuelven los
 *  endpoints de offers (cupón activo) y discover (red completa); todos
 *  salvo los básicos son opcionales según el origen. */
export type BusinessLite = {
  id: string;
  slug: string;
  name: string;
  category: string;
  city?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  logoUrl?: string | null;
  brandColor?: string | null;
  defaultDiscountPct?: number;
  discountPct?: number;
  distanceM?: number | null;
  topInCategory?: boolean;
  hoursLeft?: number;
  rewardLabel?: string | null;
};

export type NegocioParam = { business: BusinessLite };

type NegocioRoute = RouteProp<RootStackParamList, "Negocio">;

function fmtDistance(m: number | null | undefined): string | null {
  if (m == null) return null;
  return m > 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
}

export function Negocio() {
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { business: b } = useRoute<NegocioRoute>().params;

  const discount = b.discountPct ?? b.defaultDiscountPct;
  const distance = fmtDistance(b.distanceM);
  const webUrl = `${API_BASE}/bubui/n/${b.slug}`;

  // Abre la app de mapas con coordenadas si las hay, o con la dirección.
  function howToGet() {
    let url: string;
    if (b.latitude != null && b.longitude != null) {
      const ll = `${b.latitude},${b.longitude}`;
      url = Platform.OS === "ios" ? `http://maps.apple.com/?daddr=${ll}` : `geo:${ll}?q=${ll}(${encodeURIComponent(b.name)})`;
    } else {
      const q = encodeURIComponent([b.address, b.city, b.name].filter(Boolean).join(", "));
      url = `https://maps.google.com/?q=${q}`;
    }
    Linking.openURL(url).catch(() => Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(b.name)}`).catch(() => {}));
  }

  async function share() {
    const pct = discount ? ` Tienen hasta -${discount}% con Bubui.` : "";
    try {
      await Share.share({
        message: `Mira ${b.name} en Bubui.${pct} ${webUrl}`,
        url: webUrl // iOS usa este campo aparte
      });
    } catch {}
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        {/* Hero con color de marca o logo */}
        <View style={[styles.hero, { backgroundColor: b.brandColor || colors.pinkSoft, paddingTop: insets.top + 8 }]}>
          <TouchableOpacity style={styles.closeBtn} onPress={() => (nav.canGoBack() ? nav.goBack() : nav.navigate("Feed"))} hitSlop={8}>
            <Text style={styles.closeText}>‹</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.shareBtn} onPress={share} hitSlop={8}>
            <Text style={styles.shareIcon}>↗</Text>
          </TouchableOpacity>

          {b.logoUrl ? (
            <Image source={{ uri: b.logoUrl }} style={styles.logo} resizeMode="cover" />
          ) : (
            <View style={[styles.logo, styles.logoFallback]}>
              <Text style={styles.logoInitial}>{b.name.charAt(0).toUpperCase()}</Text>
            </View>
          )}
          {discount != null && (
            <View style={styles.tag}><Text style={styles.tagText}>-{discount}%</Text></View>
          )}
        </View>

        <View style={styles.body}>
          <Text style={styles.name}>{b.name}</Text>
          <Text style={styles.meta}>
            {b.category}
            {b.city ? ` · ${b.city}` : ""}
            {distance ? ` · ${distance}` : ""}
          </Text>

          {b.topInCategory && (
            <View style={styles.badge}><Text style={styles.badgeText}>🏆 Top en su categoría</Text></View>
          )}

          {!!b.rewardLabel && <Text style={styles.reward}>🎁 {b.rewardLabel}</Text>}

          {!!b.address && (
            <View style={styles.infoRow}>
              <Text style={styles.infoIcon}>📍</Text>
              <Text style={styles.infoText}>{b.address}</Text>
            </View>
          )}

          {b.hoursLeft != null && (
            <View style={styles.infoRow}>
              <Text style={styles.infoIcon}>⏰</Text>
              <Text style={[styles.infoText, b.hoursLeft < 24 && { color: colors.pink, fontWeight: "800" }]}>
                Tu cupón caduca en {b.hoursLeft}h
              </Text>
            </View>
          )}

          {/* Acciones */}
          <TouchableOpacity style={styles.cta} onPress={() => nav.navigate("Scan", { businessId: "" })} activeOpacity={0.9}>
            <Text style={styles.ctaText}>⛶  Escanear QR aquí</Text>
          </TouchableOpacity>

          <View style={styles.secRow}>
            <TouchableOpacity style={styles.secBtn} onPress={howToGet}>
              <Text style={styles.secText}>🧭 Cómo llegar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secBtn} onPress={() => Linking.openURL(webUrl).catch(() => {})}>
              <Text style={styles.secText}>ℹ️ Ficha completa</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  hero: { height: 240, alignItems: "center", justifyContent: "flex-end", paddingBottom: 0 },
  closeBtn: { position: "absolute", left: 14, height: 40, width: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.92)", alignItems: "center", justifyContent: "center" },
  closeText: { fontSize: 26, fontWeight: "900", color: colors.black, marginTop: -2 },
  shareBtn: { position: "absolute", right: 14, height: 40, width: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.92)", alignItems: "center", justifyContent: "center" },
  shareIcon: { fontSize: 20, fontWeight: "900", color: colors.black },
  logo: { height: 110, width: 110, borderRadius: 24, marginBottom: -34, borderWidth: 4, borderColor: colors.white, backgroundColor: colors.white, ...shadow.card },
  logoFallback: { alignItems: "center", justifyContent: "center", backgroundColor: colors.pink },
  logoInitial: { color: colors.white, fontSize: 46, fontWeight: "900" },
  tag: { position: "absolute", right: 16, bottom: 14, backgroundColor: colors.pink, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 7, ...shadow.btn },
  tagText: { color: colors.white, fontWeight: "900", fontSize: 15 },
  body: { paddingHorizontal: 20, paddingTop: 46, alignItems: "center" },
  name: { fontSize: 24, fontWeight: "900", color: colors.black, textAlign: "center", letterSpacing: -0.5 },
  meta: { fontSize: 14, color: colors.gray, marginTop: 4, textAlign: "center" },
  badge: { marginTop: 12, backgroundColor: colors.pinkWash, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1, borderColor: colors.pinkSoft },
  badgeText: { color: colors.pinkDeep, fontWeight: "800", fontSize: 13 },
  reward: { marginTop: 12, fontSize: 15, fontWeight: "700", color: colors.ink, textAlign: "center" },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "stretch", marginTop: 14, paddingHorizontal: 4 },
  infoIcon: { fontSize: 16 },
  infoText: { flex: 1, fontSize: 14, color: colors.ink, lineHeight: 20 },
  cta: { alignSelf: "stretch", marginTop: 26, backgroundColor: colors.pink, borderRadius: radius.pill, paddingVertical: 16, alignItems: "center", ...shadow.btn },
  ctaText: { color: colors.white, fontSize: 16, fontWeight: "800" },
  secRow: { flexDirection: "row", gap: 10, alignSelf: "stretch", marginTop: 12 },
  secBtn: { flex: 1, paddingVertical: 14, alignItems: "center", borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  secText: { fontSize: 14, fontWeight: "800", color: colors.black }
});
