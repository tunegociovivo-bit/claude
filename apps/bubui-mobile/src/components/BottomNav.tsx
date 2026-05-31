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
// `gate` indica de qué flag de sección depende la pestaña (Descubre/Mapa).
type SectionGate = "discover" | "mapa";
const TABS: { route: string; label: string; icon: IconName; iconOn: IconName; gate?: SectionGate }[] = [
  { route: "Feed", label: "Inicio", icon: "home-outline", iconOn: "home" },
  { route: "Descubre", label: "Descubre", icon: "compass-outline", iconOn: "compass", gate: "discover" },
  { route: "Afiliados", label: "Amigos", icon: "gift-outline", iconOn: "gift" },
  { route: "Mapa", label: "Mapa", icon: "map-outline", iconOn: "map", gate: "mapa" },
  { route: "Cuenta", label: "Cuenta", icon: "person-outline", iconOn: "person" }
];

// Mínimo de comercios para mostrar Descubre/Mapa (fallback si el servidor no
// devuelve los flags `sections`, p. ej. versión antigua del backend).
const MIN_BUSINESSES = 10;
type Sections = { discover: boolean; mapa: boolean };
let cachedSections: Sections | null = null;

export function BottomNav({ active }: { active: string }) {
  const nav = useNavigation<any>();
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(c);
  const [sections, setSections] = useState<Sections>(cachedSections ?? { discover: false, mapa: false });

  useEffect(() => {
    if (cachedSections !== null) return;
    api
      .stats()
      .then((s) => {
        // Backend nuevo: usa los flags resueltos (umbral u override admin).
        // Backend antiguo: cae al umbral de comercios.
        const fallback = (s?.businesses ?? 0) >= MIN_BUSINESSES;
        cachedSections = s?.sections ?? { discover: fallback, mapa: fallback };
        setSections(cachedSections);
      })
      .catch(() => {});
  }, []);

  const tabs = TABS.filter((t) => !t.gate || sections[t.gate]);

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
