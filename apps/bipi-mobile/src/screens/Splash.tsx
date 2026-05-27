import { View, Text, StyleSheet } from "react-native";

export function Splash() {
  return (
    <View style={styles.root}>
      <Text style={styles.brand}>
        <Text style={styles.accent}>bi</Text>pi
      </Text>
      <Text style={styles.tag}>Cargando…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#FDF2E1" },
  brand: { fontSize: 64, fontWeight: "900", color: "#3D2A1B" },
  accent: { color: "#C8612C" },
  tag: { marginTop: 12, color: "#7A5C3E" }
});
