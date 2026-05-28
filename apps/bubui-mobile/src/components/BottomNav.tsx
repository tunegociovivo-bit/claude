import { View, Text, TouchableOpacity, StyleSheet, Image, ImageSourcePropType } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { colors } from "../lib/theme";

const TABS: { route: string; label: string; icon: ImageSourcePropType }[] = [
  { route: "Feed", label: "Inicio", icon: require("../../assets/nav-inicio.png") },
  { route: "Descubre", label: "Descubre", icon: require("../../assets/nav-descubre.png") },
  { route: "Afiliados", label: "Amigos", icon: require("../../assets/nav-amigos.png") },
  { route: "Mapa", label: "Mapa", icon: require("../../assets/nav-mapa.png") },
  { route: "Cuenta", label: "Cuenta", icon: require("../../assets/nav-cuenta.png") }
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
            <Image source={t.icon} style={[styles.icon, { opacity: on ? 1 : 0.45 }]} resizeMode="contain" />
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
  item: { flex: 1, alignItems: "center", gap: 3 },
  icon: { width: 26, height: 26 },
  label: { fontSize: 10, color: colors.gray, fontWeight: "600" },
  labelOn: { color: colors.pink, fontWeight: "800" }
});
