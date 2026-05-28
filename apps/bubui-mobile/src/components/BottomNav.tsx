import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { colors } from "../lib/theme";

const TABS: { route: string; label: string; icon: string }[] = [
  { route: "Feed", label: "Inicio", icon: "🏠" },
  { route: "Descubre", label: "Descubre", icon: "🧭" },
  { route: "Afiliados", label: "Amigos", icon: "🎁" },
  { route: "Mapa", label: "Mapa", icon: "🗺" },
  { route: "Cuenta", label: "Cuenta", icon: "👤" }
];

export function BottomNav({ active }: { active: string }) {
  const nav = useNavigation<any>();
  return (
    <View style={styles.bar}>
      {TABS.map((t) => {
        const on = t.route === active;
        return (
          <TouchableOpacity
            key={t.route}
            style={styles.item}
            onPress={() => { if (!on) nav.navigate(t.route); }}
            activeOpacity={0.7}
          >
            <Text style={{ fontSize: 19, opacity: on ? 1 : 0.55 }}>{t.icon}</Text>
            <Text style={[styles.label, on && styles.labelOn]}>{t.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: "rgba(0,0,0,0.06)",
    paddingTop: 8,
    paddingBottom: 22,
    paddingHorizontal: 8
  },
  item: { flex: 1, alignItems: "center", gap: 2 },
  label: { fontSize: 10, color: colors.gray, fontWeight: "600" },
  labelOn: { color: colors.pink, fontWeight: "800" }
});
