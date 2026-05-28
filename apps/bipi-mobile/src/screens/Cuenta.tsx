import { useCallback, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Linking } from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { CheckSession, clearSession, type Customer } from "../lib/session";
import { Wordmark } from "../components/Wordmark";
import { BottomNav } from "../components/BottomNav";
import { API_BASE } from "../lib/api";
import { colors, radius, shadow } from "../lib/theme";

export function Cuenta() {
  const nav = useNavigation<any>();
  const [c, setC] = useState<Customer | null>(null);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const s = await CheckSession();
        if (!s) { nav.reset({ index: 0, routes: [{ name: "Onboarding" }] }); return; }
        setC(s);
      })();
    }, [nav])
  );

  async function logout() {
    await clearSession();
    nav.reset({ index: 0, routes: [{ name: "Onboarding" }] });
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 56, paddingBottom: 30 }}>
        <View style={{ alignItems: "center", marginBottom: 18 }}>
          <Wordmark size={28} />
        </View>

        <View style={styles.profile}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{(c?.name ?? c?.email ?? "?").charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={styles.name}>{c?.name ?? "Cliente Bipi"}</Text>
          {!!c?.email && <Text style={styles.sub}>{c.email}</Text>}
        </View>

        <View style={styles.statRow}>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>HAS AHORRADO</Text>
            <Text style={styles.statValue}>{(c?.totalSaved ?? 0).toFixed(2)} €</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>COMPRAS</Text>
            <Text style={styles.statValue}>{c?.totalPurchases ?? 0}</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.link} onPress={() => Linking.openURL(`${API_BASE}/bipi/registro`)}>
          <Text style={styles.linkIcon}>🏪</Text>
          <Text style={styles.linkText}>¿Tienes un negocio? Únete a Bipi</Text>
          <Text style={styles.chev}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.link} onPress={() => Linking.openURL(`${API_BASE}/bipi`)}>
          <Text style={styles.linkIcon}>ℹ️</Text>
          <Text style={styles.linkText}>Cómo funciona Bipi</Text>
          <Text style={styles.chev}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.logout} onPress={logout}>
          <Text style={styles.logoutText}>Cerrar sesión</Text>
        </TouchableOpacity>

        <Text style={styles.legal}>Bipi · Piloto en Benalmádena · Una app de Negocio Vivo</Text>
      </ScrollView>
      <BottomNav active="Cuenta" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  profile: { alignItems: "center", marginBottom: 18 },
  avatar: { height: 72, width: 72, borderRadius: 36, backgroundColor: colors.pink, alignItems: "center", justifyContent: "center", marginBottom: 10, ...shadow.btn },
  avatarText: { color: colors.white, fontSize: 30, fontWeight: "900" },
  name: { fontSize: 20, fontWeight: "900", color: colors.black },
  sub: { fontSize: 13, color: colors.gray, marginTop: 2 },
  statRow: { flexDirection: "row", gap: 10, marginBottom: 18 },
  stat: { flex: 1, backgroundColor: colors.white, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 16, ...shadow.card },
  statLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5, color: colors.grayLight },
  statValue: { fontSize: 24, fontWeight: "900", color: colors.pink, marginTop: 2 },
  link: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.white, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 10 },
  linkIcon: { fontSize: 18 },
  linkText: { flex: 1, fontSize: 14, fontWeight: "700", color: colors.black },
  chev: { fontSize: 22, color: colors.grayLight },
  logout: { marginTop: 8, paddingVertical: 14, alignItems: "center", borderRadius: radius.pill, borderWidth: 2, borderColor: "#E5E7EB" },
  logoutText: { fontSize: 15, fontWeight: "800", color: colors.gray },
  legal: { fontSize: 11, color: colors.grayLight, textAlign: "center", marginTop: 22 }
});
