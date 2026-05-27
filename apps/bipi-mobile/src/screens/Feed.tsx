import { useCallback, useEffect, useState } from "react";
import { View, Text, FlatList, RefreshControl, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import * as Location from "expo-location";
import { CheckSession, clearSession, type Customer } from "../lib/session";
import { api } from "../lib/api";

type Offer = {
  offerId: string;
  business: { id: string; name: string; category: string };
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

  async function openScanner() {
    nav.navigate("Scan", { businessId: "" });
  }

  async function logout() {
    await clearSession();
    nav.reset({ index: 0, routes: [{ name: "Onboarding" }] });
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Hola{customer?.name ? `, ${customer.name}` : ""}</Text>
          <Text style={styles.saved}>
            Has ahorrado{" "}
            <Text style={styles.savedAmount}>{(customer?.totalSaved ?? 0).toFixed(2)} €</Text>
          </Text>
        </View>
        <TouchableOpacity onPress={logout}>
          <Text style={styles.logout}>Salir</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.cta} onPress={openScanner}>
        <Text style={styles.ctaText}>📷 Escanear QR de un negocio</Text>
      </TouchableOpacity>

      <Text style={styles.section}>Tus cupones ({offers.length})</Text>

      <FlatList
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        data={offers}
        keyExtractor={(o) => o.offerId}
        contentContainerStyle={{ paddingBottom: 40 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={{ textAlign: "center", color: "#7A5C3E", fontSize: 14 }}>
              Aún no tienes cupones. Escanea el QR de un negocio Bipi y empieza a desbloquear.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.bizName}>{item.business.name}</Text>
              <Text style={styles.bizCat}>
                {item.business.category}
                {item.distanceM != null &&
                  ` · a ${item.distanceM > 1000 ? `${(item.distanceM / 1000).toFixed(1)} km` : `${item.distanceM} m`}`}
              </Text>
              <Text style={[styles.exp, item.hoursLeft < 24 && styles.expUrgent]}>
                ⏰ caduca en {item.hoursLeft}h
              </Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={styles.disc}>{item.discountPct}%</Text>
              <Text style={styles.discLbl}>descuento</Text>
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#FDF2E1", paddingTop: 50, paddingHorizontal: 16 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  greeting: { color: "#7A5C3E", fontSize: 13 },
  saved: { fontSize: 18, fontWeight: "700", color: "#3D2A1B" },
  savedAmount: { color: "#108A4A" },
  logout: { fontSize: 13, color: "#7A5C3E" },
  cta: { backgroundColor: "#C8612C", borderRadius: 999, paddingVertical: 14, alignItems: "center", marginBottom: 16 },
  ctaText: { color: "#FFF", fontSize: 16, fontWeight: "700" },
  section: { fontSize: 13, fontWeight: "600", color: "#3D2A1B", marginBottom: 8 },
  row: { backgroundColor: "#FFF", padding: 14, borderRadius: 14, marginBottom: 8, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#E5D3B7" },
  bizName: { fontWeight: "700", color: "#3D2A1B", fontSize: 15 },
  bizCat: { color: "#9B7B5C", fontSize: 12, marginTop: 2 },
  exp: { marginTop: 4, fontSize: 12, color: "#7A5C3E" },
  expUrgent: { color: "#B23A48", fontWeight: "600" },
  disc: { fontSize: 26, fontWeight: "900", color: "#C8612C" },
  discLbl: { fontSize: 10, color: "#9B7B5C", textTransform: "uppercase" },
  empty: { padding: 24, backgroundColor: "#FFF", borderRadius: 14, borderColor: "#E5D3B7", borderWidth: 1 }
});
