/**
 * Catálogo de tipos de negocio (nichos) para el desplegable de "Nueva
 * búsqueda" de NV Leads Pro. El valor seleccionado alimenta el `keyword`
 * de la búsqueda (string libre), así que se puede ampliar sin tocar backend.
 *
 * Agrupados por categoría para poder pintarlos con <optgroup> en el <select>.
 * Pensados para negocio local español susceptible de captación por WhatsApp.
 */

export type BusinessTypeGroup = {
  group: string;
  types: string[];
};

export const BUSINESS_TYPE_GROUPS: BusinessTypeGroup[] = [
  {
    group: "Salud y bienestar",
    types: [
      "Clínica dental",
      "Clínica de fisioterapia",
      "Clínica de estética",
      "Centro de podología",
      "Clínica veterinaria",
      "Óptica",
      "Centro auditivo",
      "Psicólogo",
      "Nutricionista",
      "Clínica de medicina estética",
      "Centro de depilación láser",
      "Clínica de logopedia",
      "Centro médico privado",
      "Farmacia",
      "Ortopedia"
    ]
  },
  {
    group: "Belleza y peluquería",
    types: [
      "Peluquería",
      "Barbería",
      "Centro de estética",
      "Salón de uñas",
      "Centro de manicura y pedicura",
      "Spa y centro de masajes",
      "Centro de bronceado",
      "Micropigmentación",
      "Peluquería canina"
    ]
  },
  {
    group: "Hogar, reformas y oficios",
    types: [
      "Cerrajero",
      "Fontanero",
      "Electricista",
      "Empresa de reformas",
      "Pintor",
      "Carpintero",
      "Empresa de mudanzas",
      "Empresa de limpieza",
      "Cristalero",
      "Instalador de aire acondicionado",
      "Empresa de pladur",
      "Albañil",
      "Instalador de placas solares",
      "Antenista",
      "Empresa de toldos",
      "Empresa de fontanería y calefacción",
      "Tapicero",
      "Empresa de control de plagas",
      "Empresa de jardinería",
      "Piscinas y mantenimiento"
    ]
  },
  {
    group: "Automoción",
    types: [
      "Taller mecánico",
      "Taller de chapa y pintura",
      "Concesionario de coches",
      "Compraventa de coches",
      "Taller de neumáticos",
      "Lavado de coches",
      "Autoescuela",
      "Taller de motos",
      "Grúa y asistencia en carretera",
      "Alquiler de coches",
      "Cristalería del automóvil"
    ]
  },
  {
    group: "Hostelería y alimentación",
    types: [
      "Restaurante",
      "Bar y cafetería",
      "Pizzería",
      "Hamburguesería",
      "Cervecería",
      "Heladería",
      "Panadería y pastelería",
      "Catering",
      "Food truck",
      "Bar de tapas",
      "Restaurante japonés",
      "Restaurante chino",
      "Marisquería",
      "Cafetería de especialidad"
    ]
  },
  {
    group: "Comercio y tiendas",
    types: [
      "Tienda de ropa",
      "Zapatería",
      "Joyería",
      "Floristería",
      "Tienda de muebles",
      "Ferretería",
      "Tienda de electrónica",
      "Tienda de telefonía y reparación de móviles",
      "Tienda de mascotas",
      "Estanco",
      "Tienda de bicicletas",
      "Tienda de informática",
      "Perfumería",
      "Tienda de decoración",
      "Vinoteca",
      "Tienda de deporte"
    ]
  },
  {
    group: "Servicios profesionales",
    types: [
      "Asesoría y gestoría",
      "Abogado",
      "Despacho de abogados",
      "Agencia inmobiliaria",
      "Arquitecto",
      "Aparejador",
      "Agencia de seguros",
      "Notaría",
      "Procurador",
      "Consultoría",
      "Agencia de marketing",
      "Estudio de diseño gráfico",
      "Imprenta",
      "Traductor jurado",
      "Detective privado"
    ]
  },
  {
    group: "Formación y ocio",
    types: [
      "Academia de idiomas",
      "Academia de refuerzo",
      "Autoescuela",
      "Escuela infantil y guardería",
      "Gimnasio",
      "Centro de yoga y pilates",
      "Centro de artes marciales",
      "Escuela de música",
      "Escuela de baile",
      "Centro deportivo",
      "Ludoteca"
    ]
  },
  {
    group: "Eventos y otros servicios",
    types: [
      "Fotógrafo",
      "Empresa de eventos",
      "Wedding planner",
      "Salón de celebraciones",
      "Funeraria",
      "Agencia de viajes",
      "Empresa de seguridad",
      "Lavandería y tintorería",
      "Costura y arreglos de ropa",
      "Cerrajería de urgencias",
      "Empresa de informática y soporte",
      "Servicio técnico de electrodomésticos"
    ]
  }
];

/** Lista plana de todos los tipos de negocio (para validación/búsqueda). */
export const ALL_BUSINESS_TYPES: string[] = BUSINESS_TYPE_GROUPS.flatMap((g) => g.types);
