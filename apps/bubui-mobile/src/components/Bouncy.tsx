/**
 * Pressable con micro-rebote: escala ligeramente al pulsar y vuelve con
 * muelle al soltar. Da feedback inmediato (el botón "escucha" al usuario).
 * Sustituto directo de TouchableOpacity para elementos destacados.
 */
import { useRef } from "react";
import { Animated, Pressable, type StyleProp, type ViewStyle } from "react-native";

type Props = {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;
  disabled?: boolean;
  hitSlop?: number;
};

export function Bouncy({ children, onPress, style, scaleTo = 0.96, disabled, hitSlop }: Props) {
  const s = useRef(new Animated.Value(1)).current;
  const spring = (toValue: number) =>
    Animated.spring(s, { toValue, useNativeDriver: true, speed: 50, bounciness: 7 }).start();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={hitSlop}
      onPressIn={() => spring(scaleTo)}
      onPressOut={() => spring(1)}
    >
      <Animated.View style={[style, { transform: [{ scale: s }] }]}>{children}</Animated.View>
    </Pressable>
  );
}
