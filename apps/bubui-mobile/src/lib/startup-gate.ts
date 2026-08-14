export type FontGateState = {
  loaded: boolean;
  error: unknown;
  timedOut: boolean;
};

/** No renderiza glifos antes de que Ionicons esté registrada realmente. */
export function fontsReadyForUi(state: FontGateState): boolean {
  return state.loaded;
}
