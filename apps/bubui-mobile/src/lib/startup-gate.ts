export type FontGateState = {
  loaded: boolean;
  error: unknown;
  timedOut: boolean;
};

/**
 * Espera a las fuentes durante el arranque, pero nunca bloquea la aplicación.
 * Si la carga falla o agota el margen, React Native usa las fuentes disponibles
 * y vuelve a renderizar automáticamente si Ionicons termina cargando después.
 */
export function fontsReadyForUi(state: FontGateState): boolean {
  return state.loaded || state.error != null || state.timedOut;
}
