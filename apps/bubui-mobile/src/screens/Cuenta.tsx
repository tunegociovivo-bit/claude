import { useCallback, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Linking } from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { CheckSession, clearSession, type Customer } from "../lib/session";
import { Wordmark } from "../components/Wordmark";
import { BottomNav } from "../components/BottomNav";
import { API_BASE } from "../lib/api";
import { useTheme, type Palette, radius, shadow } from "../lib/theme";

export function Cuenta() {
  const nav = useNavigation<any>();
  const c = useTheme();
  const styles = makeStyles(c);
  const [customer, setCustomer] = useState<Customer | null>(null);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const s = await CheckSession();
        if (!s) { nav.reset({ index: 0, routes: [{ name: "Onboarding" }] }); return; }
        setCustomer(s);
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
            <Text style={styles.avatarText}>{(customer?.name ?? customer?.email ?? "?").charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={styles.name}>{customer?.name ?? "Cliente Bubui"}</Text>
          {!!customer?.email && <Text style={styles.sub}>{customer.email}</Text>}
        </View>

        <View style={styles.statRow}>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>HAS AHORRADO</Text>
            <Text style={styles.statValue}>{(customer?.totalSaved ?? 0).toFixed(2)} €</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>COMPRAS</Text>
            <Text style={styles.statValue}>{customer?.totalPurchases ?? 0}</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.link} onPress={() => Linking.openURL(`${API_BASE}/bubui/registro`)}>
          <Text style={styles.linkIcon}>🏪</Text>
          <Text style={styles.linkText}>¿Tienes un negocio? Únete a Bubui</Text>
          <Text style={styles.chev}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.link} onPress={() => Linking.openURL(`${API_BASE}/bubui`)}>
          <Text style={styles.linkIcon}>ℹ️</Text>
          <Text style={styles.linkText}>Cómo funciona Bubui</Text>
          <Text style={styles.chev}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.logout} onPress={logout}>
          <Text style={styles.logoutText}>Cerrar sesión</Text>
        </TouchableOpacity>

        <Text style={styles.legal}>Bubui · Piloto en Benalmádena · Una app de Negocio Vivo</Text>
      </ScrollView>
      <BottomNav active="Cuenta" />
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    profile: { alignItems: "center", marginBottom: 18 },
    avatar: { height: 72, width: 72, borderRadius: 36, backgroundColor: c.pink, alignItems: "center", justifyContent: "center", marginBottom: 10, ...shadow.btn },
    avatarText: { color: c.onAccent, fontSize: 30, fontWeight: "900" },
    name: { fontSize: 20, fontWeight: "900", color: c.black },
    sub: { fontSize: 13, color: c.gray, marginTop: 2 },
    statRow: { flexDirection: "row", gap: 10, marginBottom: 18 },
    stat: { flex: 1, backgroundColor: c.white, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, padding: 16, ...shadow.card },
    statLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5, color: c.grayLight },
    statValue: { fontSize: 24, fontWeight: "900", color: c.pink, marginTop: 2 },
    link: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: c.white, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, padding: 16, marginBottom: 10 },
    linkIcon: { fontSize: 18 },
    linkText: { flex: 1, fontSize: 14, fontWeight: "700", color: c.black },
    chev: { fontSize: 22, color: c.grayLight },
    logout: { marginTop: 8, paddingVertical: 14, alignItems: "center", borderRadius: radius.pill, borderWidth: 2, borderColor: c.border },
    logoutText: { fontSize: 15, fontWeight: "800", color: c.gray },
    legal: { fontSize: 11, color: c.grayLight, textAlign: "center", marginTop: 22 }
  });
