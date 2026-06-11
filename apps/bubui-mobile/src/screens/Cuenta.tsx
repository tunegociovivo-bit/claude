import { useCallback, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Linking } from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CheckSession, type Customer } from "../lib/session";
import { Wordmark } from "../components/Wordmark";
import { BottomNav } from "../components/BottomNav";
import { FadeIn } from "../components/FadeIn";
import { Bouncy } from "../components/Bouncy";
import { CountUp } from "../components/CountUp";
import { stagger } from "../lib/anim";
import { API_BASE } from "../lib/api";
import { useTheme, type Palette, radius, shadow } from "../lib/theme";

export function Cuenta() {
  const nav = useNavigation<any>();
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(c);
  const [customer, setCustomer] = useState<Customer | null>(null);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const s = await CheckSession();
        // Invitado (sin sesión): llevar directamente a la pantalla de registro.
        if (!s) { nav.reset({ index: 0, routes: [{ name: "Onboarding", params: { start: "register" } }] }); return; }
        setCustomer(s);
      })();
    }, [nav])
  );

  const initial = (customer?.name ?? customer?.email ?? "?").charAt(0).toUpperCase();

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
        {/* Cabecera hero rosa con avatar + nombre */}
        <FadeIn replayOnFocus dy={0} style={[styles.hero, { paddingTop: insets.top + 18 }]}>
          <Wordmark size={24} />
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <Text style={styles.name}>{customer?.name ?? "Cliente Bubui"}</Text>
          {!!customer?.email && <Text style={styles.sub}>{customer.email}</Text>}
        </FadeIn>

        <View style={styles.body}>
          {/* Stats — superpuestas sobre el hero */}
          <FadeIn replayOnFocus delay={stagger(1)} style={styles.statRow}>
            <View style={styles.stat}>
              <Text style={styles.statEmoji}>💸</Text>
              <CountUp value={customer?.totalSaved ?? 0} decimals={2} suffix=" €" style={styles.statValue} />
              <Text style={styles.statLabel}>HAS AHORRADO</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statEmoji}>🛍️</Text>
              <CountUp value={customer?.totalPurchases ?? 0} decimals={0} style={styles.statValue} />
              <Text style={styles.statLabel}>COMPRAS</Text>
            </View>
          </FadeIn>

          {/* Invita a amigos — acceso destacado al programa de referidos */}
          <FadeIn replayOnFocus delay={stagger(2)}>
            <Bouncy style={styles.invite} onPress={() => nav.navigate("Afiliados")}>
              <Text style={styles.inviteEmoji}>🎁</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.inviteTitle}>Invita a tus amigos</Text>
                <Text style={styles.inviteSub}>Comparte Bubui y gana un megadescuento.</Text>
              </View>
              <Text style={styles.inviteChev}>›</Text>
            </Bouncy>
          </FadeIn>

          {/* Enlaces agrupados */}
          <FadeIn replayOnFocus delay={stagger(3)} style={styles.menu}>
            <TouchableOpacity style={styles.link} activeOpacity={0.7} onPress={() => Linking.openURL(`${API_BASE}/bubui/registro`)}>
              <Text style={styles.linkIcon}>🏪</Text>
              <Text style={styles.linkText}>¿Tienes un negocio? Únete a Bubui</Text>
              <Text style={styles.chev}>›</Text>
            </TouchableOpacity>
            <View style={styles.divider} />
            <TouchableOpacity style={styles.link} activeOpacity={0.7} onPress={() => Linking.openURL(`${API_BASE}/bubui`)}>
              <Text style={styles.linkIcon}>ℹ️</Text>
              <Text style={styles.linkText}>Cómo funciona Bubui</Text>
              <Text style={styles.chev}>›</Text>
            </TouchableOpacity>
          </FadeIn>

          <FadeIn replayOnFocus delay={stagger(4)}>
            <Text style={styles.legal}>Bubui · Piloto en Benalmádena · Una app de Negocio Vivo</Text>
          </FadeIn>
        </View>
      </ScrollView>
      <BottomNav active="Cuenta" />
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    hero: {
      backgroundColor: c.pink,
      alignItems: "center",
      paddingBottom: 56,
      borderBottomLeftRadius: 28,
      borderBottomRightRadius: 28
    },
    avatar: {
      height: 84,
      width: 84,
      borderRadius: 42,
      backgroundColor: c.white,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 18,
      borderWidth: 4,
      borderColor: "rgba(255,255,255,0.55)"
    },
    avatarText: { color: c.pink, fontSize: 36, fontWeight: "900" },
    name: { fontSize: 22, fontWeight: "900", color: c.onAccent, marginTop: 12 },
    sub: { fontSize: 13, color: "rgba(255,255,255,0.9)", marginTop: 3 },
    body: { paddingHorizontal: 16, marginTop: -36 },
    statRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
    stat: { flex: 1, backgroundColor: c.white, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, paddingVertical: 16, paddingHorizontal: 14, alignItems: "center", ...shadow.card },
    statEmoji: { fontSize: 22, marginBottom: 6 },
    statValue: { fontSize: 22, fontWeight: "900", color: c.pink, letterSpacing: -0.5 },
    statLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5, color: c.grayLight, marginTop: 3 },
    invite: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: c.pinkWash, borderRadius: radius.lg, borderWidth: 1, borderColor: c.pinkSoft, padding: 16, marginBottom: 16 },
    inviteEmoji: { fontSize: 26 },
    inviteTitle: { fontSize: 15, fontWeight: "900", color: c.black },
    inviteSub: { fontSize: 12, color: c.gray, marginTop: 2 },
    inviteChev: { fontSize: 24, color: c.pink, fontWeight: "900" },
    menu: { backgroundColor: c.white, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, overflow: "hidden", ...shadow.card },
    link: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
    linkIcon: { fontSize: 18 },
    linkText: { flex: 1, fontSize: 14, fontWeight: "700", color: c.black },
    chev: { fontSize: 22, color: c.grayLight },
    divider: { height: 1, backgroundColor: c.border, marginLeft: 46 },
    legal: { fontSize: 11, color: c.grayLight, textAlign: "center", marginTop: 22 }
  });
