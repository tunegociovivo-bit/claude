import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, ActivityIndicator, Share, Linking, Alert, Clipboard } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { CheckSession } from "../lib/session";
import { api, API_BASE } from "../lib/api";
import { Wordmark } from "../components/Wordmark";
import { BottomNav } from "../components/BottomNav";
import { useTheme, type Palette, radius, shadow } from "../lib/theme";

type Referral = Awaited<ReturnType<typeof api.referral>>;

export function Afiliados() {
  const nav = useNavigation<any>();
  const c = useTheme();
  const styles = makeStyles(c);
  const [data, setData] = useState<Referral | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await CheckSession();
      if (!s) { nav.reset({ index: 0, routes: [{ name: "Onboarding" }] }); return; }
      try {
        const r = await api.referral(s.customerId);
        setData(r);
      } catch {
        setData(null);
      }
    } finally {
      setLoading(false);
    }
  }, [nav]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const link = data ? `${API_BASE}/bubui/r/${data.code}` : "";
  const shareText = `¡Únete a Bubui y llévate descuentos en negocios del barrio! 🎁 ${link}`;

  async function share() {
    if (!link) return;
    try { await Share.share({ message: shareText, url: link }); } catch {}
  }
  function shareWhatsApp() {
    if (!link) return;
    Linking.openURL(`https://wa.me/?text=${encodeURIComponent(shareText)}`).catch(() => {});
  }
  async function copy() {
    if (!link) return;
    try { Clipboard.setString(link); Alert.alert("Enlace copiado", "Ya puedes pegarlo donde quieras."); } catch {}
  }

  const count = data?.verifiedReferrals ?? 0;
  const goal = data?.nextMilestone ?? (data?.milestones?.[data.milestones.length - 1]?.n ?? 5);
  const slots = Array.from({ length: goal }, (_, i) => i < count);

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 52, paddingBottom: 30 }}>
        <View style={{ alignItems: "center", marginBottom: 10 }}>
          <Wordmark size={24} />
        </View>

        <Image source={require("../../assets/ill-amigos.png")} style={styles.hero} resizeMode="contain" />

        {loading ? (
          <ActivityIndicator color={c.pink} size="large" style={{ marginTop: 24 }} />
        ) : (
          <>
            {/* Progreso: huecos de amigos verificados */}
            <View style={styles.progressCard}>
              <Text style={styles.progressTitle}>
                {count >= goal
                  ? "¡Megadescuento desbloqueado! 🎉"
                  : `${count} de ${goal} amigos`}
              </Text>
              <View style={styles.slots}>
                {slots.map((filled, i) => (
                  <View key={i} style={[styles.slot, filled && styles.slotOn]}>
                    <Text style={[styles.slotText, filled && styles.slotTextOn]}>{filled ? "✓" : i + 1}</Text>
                  </View>
                ))}
              </View>
              {data?.nextMilestone != null && (
                <Text style={styles.progressSub}>
                  Te faltan {goal - count} para tu próxima recompensa.
                </Text>
              )}
            </View>

            {/* Hitos y recompensas */}
            {!!data?.milestones?.length && (
              <View style={styles.milestones}>
                {data.milestones.map((m) => (
                  <View key={m.n} style={styles.milestoneRow}>
                    <View style={[styles.milestoneBadge, m.unlocked && styles.milestoneBadgeOn]}>
                      <Text style={[styles.milestoneN, m.unlocked && { color: c.onAccent }]}>{m.n}</Text>
                    </View>
                    <Text style={styles.milestoneText}>{m.reward}</Text>
                    {m.unlocked && <Text style={styles.milestoneCheck}>✓</Text>}
                  </View>
                ))}
              </View>
            )}

            {/* Compartir */}
            <TouchableOpacity style={styles.waBtn} onPress={shareWhatsApp} activeOpacity={0.9}>
              <Text style={styles.waBtnText}>Compartir por WhatsApp</Text>
            </TouchableOpacity>
            <View style={styles.secRow}>
              <TouchableOpacity style={styles.secBtn} onPress={share}>
                <Text style={styles.secText}>↗ Compartir</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secBtn} onPress={copy}>
                <Text style={styles.secText}>⧉ Copiar enlace</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.legal}>
              Cuando un amigo se une con tu enlace y verifica su teléfono, cuenta para tu megadescuento.
            </Text>
          </>
        )}
      </ScrollView>
      <BottomNav active="Afiliados" />
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    hero: { width: "100%", height: 230, marginBottom: 6 },
    progressCard: { backgroundColor: c.white, borderRadius: radius.xl, borderWidth: 1, borderColor: c.border, padding: 18, alignItems: "center", ...shadow.card },
    progressTitle: { fontSize: 17, fontWeight: "900", color: c.black, marginBottom: 14, textAlign: "center" },
    slots: { flexDirection: "row", gap: 8, flexWrap: "wrap", justifyContent: "center" },
    slot: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: c.border, alignItems: "center", justifyContent: "center", backgroundColor: c.bg },
    slotOn: { backgroundColor: c.pink, borderColor: c.pink },
    slotText: { fontSize: 15, fontWeight: "800", color: c.grayLight },
    slotTextOn: { color: c.onAccent },
    progressSub: { fontSize: 13, color: c.gray, marginTop: 12, textAlign: "center" },
    milestones: { marginTop: 14, gap: 8 },
    milestoneRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: c.white, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, padding: 12 },
    milestoneBadge: { width: 30, height: 30, borderRadius: 15, backgroundColor: c.pinkSoft, alignItems: "center", justifyContent: "center" },
    milestoneBadgeOn: { backgroundColor: c.pink },
    milestoneN: { fontSize: 14, fontWeight: "900", color: c.pinkDeep },
    milestoneText: { flex: 1, fontSize: 14, fontWeight: "700", color: c.black },
    milestoneCheck: { fontSize: 16, color: c.green, fontWeight: "900" },
    waBtn: { marginTop: 18, backgroundColor: c.pink, borderRadius: radius.pill, paddingVertical: 16, alignItems: "center", ...shadow.btn },
    waBtnText: { color: c.onAccent, fontSize: 16, fontWeight: "800" },
    secRow: { flexDirection: "row", gap: 10, marginTop: 12 },
    secBtn: { flex: 1, paddingVertical: 14, alignItems: "center", borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.white },
    secText: { fontSize: 14, fontWeight: "800", color: c.black },
    legal: { fontSize: 12, color: c.grayLight, textAlign: "center", marginTop: 18, lineHeight: 17 }
  });
