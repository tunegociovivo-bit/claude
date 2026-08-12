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
import { Scan } from "./src/screens/Scan";
import { Mesa } from "./src/screens/Mesa";
import { Plus } from "./src/screens/Plus";
import { Negocio, type NegocioParam } from "./src/screens/Negocio"
import { CheckSession, clearSession } from "./src/lib/session";
import { setOnAuthExpired } from "./src/lib/api";
import { setupNotificationTapHandler } from "./src/lib/push";
import { initReferralCapture, waitForReferrerCapture } from "./src/lib/referral-pending";
import { initDealCapture, claimPendingDeal, traceLifecycle, waitForDealCapture, getPendingDeal } from "./src/lib/deal-pending";
import { retoTokenFromPath } from "./src/lib/links";
import Ionicons from "@expo/vector-icons/Ionicons";
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
    Scan: { businessId: string };
    Mesa: { businessId?: string; code?: string; businessName?: string };
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
                  // QR de grupo de la Mesa Colectiva: /bubui/app/mesa?code=XXXX
                  // (getStateFromPath normaliza el prefijo /bubui/ → /).
                  Mesa: "app/mesa",
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
    const [fontsLoaded, fontsError] = useAppFonts();
    // Salvaguarda: si la carga de fuentes tarda o falla (p. ej. simulador),
    // arrancamos igualmente pasado un margen para no quedarnos en el Splash.
    const [fontsTimedOut, setFontsTimedOut] = useState(false);
    useEffect(() => {
        const t = setTimeout(() => setFontsTimedOut(true), 4000);
        return () => clearTimeout(t);
    }, []);
    const fontsReady = fontsLoaded || !!fontsError || fontsTimedOut;
    const { colors, dark } = useThemeMeta();

  useEffect(() => {
        (async () => {
                initDealCapture(); // asegura que la captura del referrer ha arrancado
                initReferralCapture();
                const session = await CheckSession();
                await waitForDealCapture(); // espera (acotada) al resultado del referrer
                await waitForReferrerCapture();
                const pending = await getPendingDeal();
                if (session) {
                        setInitial("Feed");
                        if (pending) void claimPendingDeal(session.customerId); // el reto aparece en Feed
                } else {
                        // Sin sesión: Onboarding. Con reto pendiente, el onboarding
                        // fuerza el registro y muestra el reto (nunca invitado).
                        setInitial("Onboarding");
                }
        })();
  }, []);

  // Al tocar una notificación push (o su imagen) se abre el enlace de la oferta.
  useEffect(() => setupNotificationTapHandler(), []);

  // Captura el código de referido (deep link + Install Referrer de Android).
  useEffect(() => initReferralCapture(), []);

  // Captura el token del RETO (deep link + Install Referrer de Android).
  useEffect(() => initDealCapture(), []);

  // Token caducado (401): cerramos sesión para que la app pida re-login en vez
  // de mostrar un genérico "servidor no responde".
  useEffect(() => setOnAuthExpired(() => { void clearSession(); }), []);

  // Esperamos a sesión Y fuentes (Poppins + Ionicons) para que el menú inferior
  // pinte sus iconos desde el primer render. `fontsReady` incluye timeout/errores
  // para no bloquear el arranque si la carga de fuentes fallara.
  if (!initial || !fontsReady) return <Splash />;

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
                                <Stack.Screen name="Scan" component={Scan} options={{ animation: "slide_from_bottom" }} />
                                <Stack.Screen name="Mesa" component={Mesa} options={{ animation: "slide_from_bottom" }} />
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
