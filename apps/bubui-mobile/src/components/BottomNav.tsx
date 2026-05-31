import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme, type Palette } from "../lib/theme";
import { api } from "../lib/api";

// Iconos vectoriales (Ionicons): nítidos y coherentes con la marca. Cada tab
// define su variante "outline" (inactivo) y rellena (activo).
type IconName = keyof typeof Ionicons.glyphMap;
const TABS: { route: string; label: string; icon: IconName; iconOn: IconName; gated?: boolean }[] = [
  { route: "Feed", label: "Inicio", icon: "home-outline", iconOn: "home" },
  { route: "Descubre", label: "Descubre", icon: "compass-outline", iconOn: "compass", gated: true },
  { route: "Afiliados", label: "Amigos", icon: "gift-outline", iconOn: "gift" },
  { route: "Mapa", label: "Mapa", icon: "map-outline", iconOn: "map", gated: true },
  { route: "Cuenta", label: "Cuenta", icon: "person-outline", iconOn: "person" }
];

// Mínimo de comercios para mostrar Descubre/Mapa. Se cachea entre pantallas.
const MIN_BUSINESSES = 10;
let cachedUnlocked: boolean | null = null;

export function BottomNav({ active }: { active: string }) {
  const nav = useNavigation<any>();
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(c);
  const [unlocked, setUnlocked] = useState<boolean>(cachedUnlocked ?? false);

  useEffect(() => {
    if (cachedUnlocked !== null) return;
    api
      .stats()
      .then((s) => {
        cachedUnlocked = (s?.businesses ?? 0) >= MIN_BUSINESSES;
        setUnlocked(cachedUnlocked);
      })
      .catch(() => {});
  }, []);

  const tabs = TABS.filter((t) => unlocked || !t.gated);

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      {tabs.map((t) => {
        const on = t.route === active;
        return (
          <TouchableOpacity
            key={t.route}
            style={styles.item}
            onPress={() => { if (!on) nav.navigate(t.route); }}
            activeOpacity={0.7}
          >
            <Ionicons name={on ? t.iconOn : t.icon} size={24} color={on ? c.pink : c.grayLight} />
            <Text style={[styles.label, on && styles.labelOn]}>{t.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    bar: {
      flexDirection: "row",
      backgroundColor: c.white,
      borderTopWidth: 1,
      borderTopColor: c.border,
      paddingTop: 10,
      paddingHorizontal: 8
    },
    item: { flex: 1, alignItems: "center", gap: 4 },
    label: { fontSize: 10, color: c.gray, fontWeight: "600" },
    labelOn: { color: c.pink, fontWeight: "800" }
  });
