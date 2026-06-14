import { NavigationContainer, DefaultTheme, DarkTheme, getStateFromPath, type Theme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Splash } from "./src/screens/Splash";
import { Onboarding } from "./src/screens/Onboarding";
import { Feed } from "./src/screens/Feed";
import { Descubre } from "./src/screens/Descubre";
import { Mapa } from "./src/screens/Mapa";
import { Cuenta } from "./src/screens/Cuenta";
import { Afiliados } from "./src/screens/Afiliados";
import { Scan } from "./src/screens/Scan";
import { Plus } from "./src/screens/Plus";
import { Negocio, type NegocioParam } from "./src/screens/Negocio"
import { CheckSession } from "./src/lib/session";
import { setupNotificationTapHandler } from "./src/lib/push";
import { ErrorBoundary } from "./src/components/ErrorBoundary";
import { useAppFonts, applyPoppinsToTextDefaults } from "./src/lib/fonts";
import { ThemeProvider, useThemeMeta } from "./src/lib/theme";
// Registra la task de geofencing en background (debe importarse pronto).
import "./src/lib/geofence";
// Define la background task de notificaciones con imagen (Notifee). Debe
// importarse pronto para que quede registrada en el arranque en frío.
import "./src/lib/rich-notifications";

// applyPoppinsToTextDefaults(); // disabled for simulator compatibility

export type RootStackParamList = {
    Splash: undefined;
    Onboarding: undefined;
    Feed: undefined;
    Descubre: undefined;
    Mapa: undefined;
    Cuenta: undefined;
    Afiliados: undefined;
    Scan: { businessId: string };
    Plus: undefined;
    Negocio: NegocioParam;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const linking = {
    // Dominio canónico bubui.app (ruta limpia /scan/:id) + esquema propio.
    // Mantenemos hub.negociovivo.app por compatibilidad con QR impresos antiguos.
    prefixes: [
          "bubui://",
          "https://bubui.app",
          "https://www.bubui.app",
          "https://hub.negociovivo.app"
    ],
    config: {
          screens: {
                  Scan: "scan/:businessId",
                  // bubui://offers — los pushes de ofertas (reto desbloqueado,
                  // recordatorios) aterrizan en el Feed, donde están los cupones.
                  Feed: "offers"
          }
    },
    // Normaliza la ruta antigua/hub `/bubui/scan/:id` a la canónica `/scan/:id`
    // para que tanto los QR de bubui.app como los de hub abran la pantalla Scan.
    getStateFromPath: (path: string, options: Parameters<typeof getStateFromPath>[1]) => {
          const normalized = path.replace(/^\/?bubui\//, "/");
          return getStateFromPath(normalized, options);
    }
};

function AppInner() {
    const [initial, setInitial] = useState<keyof RootStackParamList | null>(null);
    const [fontsLoaded] = useAppFonts();
    const { colors, dark } = useThemeMeta();

  useEffect(() => {
        (async () => {
                const session = await CheckSession();
                setInitial(session ? "Feed" : "Onboarding");
        })();
  }, []);

  // Al tocar una notificación push (o su imagen) se abre el enlace de la oferta.
  useEffect(() => setupNotificationTapHandler(), []);

  if (!initial) return <Splash />; // fontsLoaded check removed for simulator build

  const navTheme: Theme = {
        ...(dark ? DarkTheme : DefaultTheme),
        colors: {
                ...(dark ? DarkTheme : DefaultTheme).colors,
                background: colors.bg,
                card: colors.white,
                text: colors.black,
                border: colors.border,
                primary: colors.pink
        }
  };

  return (
        <ErrorBoundary>
              <NavigationContainer linking={linking} theme={navTheme}>
                      <StatusBar style={dark ? "light" : "dark"} />
                      <Stack.Navigator initialRouteName={initial} screenOptions={{ headerShown: false, animation: "fade" }}>
                                <Stack.Screen name="Splash" component={Splash} />
                                <Stack.Screen name="Onboarding" component={Onboarding} />
                                <Stack.Screen name="Feed" component={Feed} />
                                <Stack.Screen name="Descubre" component={Descubre} />
                                <Stack.Screen name="Mapa" component={Mapa} />
                                <Stack.Screen name="Cuenta" component={Cuenta} />
                                <Stack.Screen name="Afiliados" component={Afiliados} options={{ animation: "slide_from_right" }} />
                                <Stack.Screen name="Scan" component={Scan} options={{ animation: "slide_from_bottom" }} />
                                <Stack.Screen name="Plus" component={Plus} options={{ animation: "slide_from_bottom" }} />
                                <Stack.Screen name="Negocio" component={Negocio} options={{ animation: "slide_from_right" }} />
                      </Stack.Navigator>
              </NavigationContainer>
        </ErrorBoundary>
      );
}

export default function App() {
    return (
          <SafeAreaProvider>
                <ThemeProvider>
                        <AppInner />
                </ThemeProvider>
          </SafeAreaProvider>
        );
}
