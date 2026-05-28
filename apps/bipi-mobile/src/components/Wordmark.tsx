import { View, Text } from "react-native";
import { colors } from "../lib/theme";

/** Wordmark "bipi" con punto rosa, equivalente al de la web. */
export function Wordmark({ size = 48, color = colors.black }: { size?: number; color?: string }) {
  const dot = Math.max(6, size * 0.14);
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end" }}>
      <Text style={{ fontSize: size, fontWeight: "900", letterSpacing: -size * 0.05, color, lineHeight: size * 1.0 }}>
        bipi
      </Text>
      <View
        style={{
          width: dot,
          height: dot,
          borderRadius: dot / 2,
          backgroundColor: colors.pink,
          marginLeft: size * 0.04,
          marginBottom: size * 0.12
        }}
      />
    </View>
  );
}
