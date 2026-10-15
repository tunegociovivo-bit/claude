// Opciones para los desplegables del editor de búsquedas (combustible, cambio,
// países y días). Compartido entre servidor y cliente.
import { FUELS, FUEL_LABELS, GEARBOXES, GEARBOX_LABELS } from "./normalize";

export const PORTAL_FIELD_OPTIONS = {
  fuels: FUELS.map((id) => ({ id, label: FUEL_LABELS[id] })),
  gearboxes: GEARBOXES.map((id) => ({ id, label: GEARBOX_LABELS[id] })),
  countries: [
    { id: "ES", label: "España" },
    { id: "FR", label: "Francia" },
    { id: "DE", label: "Alemania" },
    { id: "IT", label: "Italia" },
    { id: "PT", label: "Portugal" },
    { id: "BE", label: "Bélgica" },
    { id: "NL", label: "Países Bajos" },
    { id: "AT", label: "Austria" },
    { id: "PL", label: "Polonia" },
    { id: "LU", label: "Luxemburgo" },
    { id: "CH", label: "Suiza" },
  ],
  days: [
    { id: 1, label: "L" },
    { id: 2, label: "M" },
    { id: 3, label: "X" },
    { id: 4, label: "J" },
    { id: 5, label: "V" },
    { id: 6, label: "S" },
    { id: 7, label: "D" },
  ],
} as const;
