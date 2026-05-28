import { useCallback, useState } from "react";
import { View, Text, FlatList, RefreshControl, TouchableOpacity, StyleSheet } from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import * as Location from "expo-location";
import { CheckSession, clearSession, type Customer } from "../lib/session";
import { api } from "../lib/api";
import { Wordmark } from "../components/Wordmark";
import { colors, radius, shadow } from "../lib/theme";

type Offer = {
  offerId: string;
  business: { id: string; name: string; category: string; brandColor?: string | null };
  discountPct: number;
  hoursLeft: number;
  distanceM: number | null;
};

export function Feed() {
  const nav = useNavigation<any>();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const c = await CheckSession();
      if (!c) {
        nav.reset({ index: 0, routes: [{ name: "Onboarding" }] });
        return;
      }
      setCustomer(c);
      let lat: number | undefined;
      let lng: number | undefined;
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status === "granted") {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          lat = loc.coords.latitude;
          lng = loc.coords.longitude;
        }
      } catch {}
      const r = await api.offers(c.customerId, lat, lng);
      setOffers(r.items ?? []);
    } finally {
      setRefreshing(false);
    }
  }, [nav]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function logout() {
    await clearSession();
    nav.reset({ index: 0, routes: [{ name: "Onboarding" }] });
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Wordmark size={28} />
        <TouchableOpacity onPress={logout}>
          <Text style={styles.logout}>Salir</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.savedBlock}>
        <Text style={styles.savedLabel}>HAS AHORRADO</Text>
        <Text style={styles.savedAmount}>{(customer?.totalSaved ?? 0).toFixed(2)} €</Text>
      </View>

      <TouchableOpacity style={styles.cta} onPress={() => nav.navigate("Scan", { businessId: "" })}>
        <Text style={styles.ctaText}>Escanear QR de un negocio</Text>
      </TouchableOpacity>

      <Text style={styles.section}>Tus cupones activos ({offers.length})</Text>

      <FlatList
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={colors.pink} />}
        data={offers}
        keyExtractor={(o) => o.offerId}
        contentContainerStyle={{ paddingBottom: 40 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={{ fontSize: 40, textAlign: "center" }}>🎟</Text>
            <Text style={styles.emptyText}>
              Aún no tienes cupones. Escanea el QR de un negocio Bipi para empezar a desbloquear.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={[styles.photo, item.business.brandColor ? { backgroundColor: item.business.brandColor } : null]}>
              <View style={styles.tag}>
                <Text style={styles.tagText}>-{item.discountPct}%</Text>
              </View>
            </View>
            <View style={styles.cardBody}>
              <View style={{ flex: 1 }}>
                <Text style={styles.bizName} numberOfLines={1}>{item.business.name}</Text>
                <Text style={styles.bizCat} numberOfLines={1}>
                  {item.business.category}
                  {item.distanceM != null &&
                    ` · ${item.distanceM > 1000 ? `${(item.distanceM / 1000).toFixed(1)} km` : `${item.distanceM} m`}`}
                </Text>
              </View>
              <Text style={[styles.exp, item.hoursLeft < 24 && styles.expUrgent]}>⏰ {item.hoursLeft}h</Text>
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white, paddingTop: 56, paddingHorizontal: 16 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  logout: { fontSize: 13, color: colors.gray, fontWeight: "600" },
  savedBlock: { marginBottom: 16 },
  savedLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 1, color: colors.grayLight },
  savedAmount: { fontSize: 36, fontWeight: "900", color: colors.pink, letterSpacing: -1 },
  cta: { backgroundColor: colors.pink, borderRadius: radius.pill, paddingVertical: 15, alignItems: "center", marginBottom: 20, ...shadow.btn },
  ctaText: { color: colors.white, fontSize: 16, fontWeight: "800" },
  section: { fontSize: 12, fontWeight: "800", color: colors.gray, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 },
  card: { backgroundColor: colors.white, borderRadius: radius.lg, marginBottom: 12, overflow: "hidden", borderWidth: 1, borderColor: colors.border, ...shadow.card },
  photo: { height: 130, backgroundColor: colors.pinkSoft, justifyContent: "flex-start", alignItems: "flex-end" },
  tag: { margin: 12, backgroundColor: colors.pink, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
  tagText: { color: colors.white, fontWeight: "900", fontSize: 13 },
  cardBody: { flexDirection: "row", alignItems: "center", padding: 14, gap: 8 },
  bizName: { fontWeight: "800", color: colors.black, fontSize: 15 },
  bizCat: { color: colors.gray, fontSize: 12, marginTop: 2 },
  exp: { fontSize: 12, color: colors.gray, fontWeight: "700" },
  expUrgent: { color: colors.pink },
  empty: { padding: 28, backgroundColor: colors.white, borderRadius: radius.lg, borderColor: colors.border, borderWidth: 1, gap: 10 },
  emptyText: { textAlign: "center", color: colors.gray, fontSize: 14, lineHeight: 20 }
});
