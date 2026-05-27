/**
 * 52 provincias + Ceuta y Melilla. Coordenadas de la capital para
 * `locationBias` en Google Places Text Search.
 */

export type Province = {
  name: string;
  capital: string;
  lat: number;
  lng: number;
  ccaa: string;
};

export const SPAIN_PROVINCES: Province[] = [
  { name: "A Coruña", capital: "A Coruña", lat: 43.3623, lng: -8.4115, ccaa: "Galicia" },
  { name: "Álava", capital: "Vitoria-Gasteiz", lat: 42.8467, lng: -2.6716, ccaa: "País Vasco" },
  { name: "Albacete", capital: "Albacete", lat: 38.9943, lng: -1.8585, ccaa: "Castilla-La Mancha" },
  { name: "Alicante", capital: "Alicante", lat: 38.3452, lng: -0.481, ccaa: "C. Valenciana" },
  { name: "Almería", capital: "Almería", lat: 36.834, lng: -2.4637, ccaa: "Andalucía" },
  { name: "Asturias", capital: "Oviedo", lat: 43.3614, lng: -5.8593, ccaa: "Asturias" },
  { name: "Ávila", capital: "Ávila", lat: 40.6566, lng: -4.7011, ccaa: "Castilla y León" },
  { name: "Badajoz", capital: "Badajoz", lat: 38.8786, lng: -6.9706, ccaa: "Extremadura" },
  { name: "Barcelona", capital: "Barcelona", lat: 41.3851, lng: 2.1734, ccaa: "Cataluña" },
  { name: "Burgos", capital: "Burgos", lat: 42.3439, lng: -3.6969, ccaa: "Castilla y León" },
  { name: "Cáceres", capital: "Cáceres", lat: 39.4762, lng: -6.3722, ccaa: "Extremadura" },
  { name: "Cádiz", capital: "Cádiz", lat: 36.5298, lng: -6.2924, ccaa: "Andalucía" },
  { name: "Cantabria", capital: "Santander", lat: 43.4623, lng: -3.8099, ccaa: "Cantabria" },
  { name: "Castellón", capital: "Castelló de la Plana", lat: 39.9864, lng: -0.0513, ccaa: "C. Valenciana" },
  { name: "Ceuta", capital: "Ceuta", lat: 35.8894, lng: -5.3213, ccaa: "Ceuta" },
  { name: "Ciudad Real", capital: "Ciudad Real", lat: 38.9848, lng: -3.9272, ccaa: "Castilla-La Mancha" },
  { name: "Córdoba", capital: "Córdoba", lat: 37.8882, lng: -4.7794, ccaa: "Andalucía" },
  { name: "Cuenca", capital: "Cuenca", lat: 40.0703, lng: -2.1374, ccaa: "Castilla-La Mancha" },
  { name: "Girona", capital: "Girona", lat: 41.9831, lng: 2.8249, ccaa: "Cataluña" },
  { name: "Granada", capital: "Granada", lat: 37.1773, lng: -3.5986, ccaa: "Andalucía" },
  { name: "Guadalajara", capital: "Guadalajara", lat: 40.6286, lng: -3.1656, ccaa: "Castilla-La Mancha" },
  { name: "Guipúzcoa", capital: "Donostia-San Sebastián", lat: 43.3183, lng: -1.9812, ccaa: "País Vasco" },
  { name: "Huelva", capital: "Huelva", lat: 37.2614, lng: -6.9447, ccaa: "Andalucía" },
  { name: "Huesca", capital: "Huesca", lat: 42.1401, lng: -0.4087, ccaa: "Aragón" },
  { name: "Islas Baleares", capital: "Palma", lat: 39.5696, lng: 2.6502, ccaa: "Baleares" },
  { name: "Jaén", capital: "Jaén", lat: 37.7796, lng: -3.7849, ccaa: "Andalucía" },
  { name: "La Rioja", capital: "Logroño", lat: 42.4627, lng: -2.4449, ccaa: "La Rioja" },
  { name: "Las Palmas", capital: "Las Palmas de Gran Canaria", lat: 28.1235, lng: -15.4363, ccaa: "Canarias" },
  { name: "León", capital: "León", lat: 42.5987, lng: -5.5671, ccaa: "Castilla y León" },
  { name: "Lleida", capital: "Lleida", lat: 41.6176, lng: 0.62, ccaa: "Cataluña" },
  { name: "Lugo", capital: "Lugo", lat: 43.0097, lng: -7.5567, ccaa: "Galicia" },
  { name: "Madrid", capital: "Madrid", lat: 40.4168, lng: -3.7038, ccaa: "Madrid" },
  { name: "Málaga", capital: "Málaga", lat: 36.7213, lng: -4.4214, ccaa: "Andalucía" },
  { name: "Melilla", capital: "Melilla", lat: 35.2923, lng: -2.9381, ccaa: "Melilla" },
  { name: "Murcia", capital: "Murcia", lat: 37.9922, lng: -1.1307, ccaa: "Murcia" },
  { name: "Navarra", capital: "Pamplona", lat: 42.8125, lng: -1.6458, ccaa: "Navarra" },
  { name: "Ourense", capital: "Ourense", lat: 42.3358, lng: -7.864, ccaa: "Galicia" },
  { name: "Palencia", capital: "Palencia", lat: 42.0095, lng: -4.5288, ccaa: "Castilla y León" },
  { name: "Pontevedra", capital: "Pontevedra", lat: 42.4296, lng: -8.6446, ccaa: "Galicia" },
  { name: "Salamanca", capital: "Salamanca", lat: 40.9701, lng: -5.6635, ccaa: "Castilla y León" },
  { name: "Santa Cruz de Tenerife", capital: "Santa Cruz de Tenerife", lat: 28.4636, lng: -16.2518, ccaa: "Canarias" },
  { name: "Segovia", capital: "Segovia", lat: 40.9429, lng: -4.1088, ccaa: "Castilla y León" },
  { name: "Sevilla", capital: "Sevilla", lat: 37.3891, lng: -5.9845, ccaa: "Andalucía" },
  { name: "Soria", capital: "Soria", lat: 41.7665, lng: -2.4790, ccaa: "Castilla y León" },
  { name: "Tarragona", capital: "Tarragona", lat: 41.1189, lng: 1.2445, ccaa: "Cataluña" },
  { name: "Teruel", capital: "Teruel", lat: 40.3456, lng: -1.1065, ccaa: "Aragón" },
  { name: "Toledo", capital: "Toledo", lat: 39.8628, lng: -4.0273, ccaa: "Castilla-La Mancha" },
  { name: "Valencia", capital: "València", lat: 39.4699, lng: -0.3763, ccaa: "C. Valenciana" },
  { name: "Valladolid", capital: "Valladolid", lat: 41.6521, lng: -4.7245, ccaa: "Castilla y León" },
  { name: "Vizcaya", capital: "Bilbao", lat: 43.263, lng: -2.935, ccaa: "País Vasco" },
  { name: "Zamora", capital: "Zamora", lat: 41.5036, lng: -5.7449, ccaa: "Castilla y León" },
  { name: "Zaragoza", capital: "Zaragoza", lat: 41.6488, lng: -0.8891, ccaa: "Aragón" }
];

export function findProvince(name: string): Province | undefined {
  const target = name.trim().toLowerCase();
  return SPAIN_PROVINCES.find(
    (p) => p.name.toLowerCase() === target || p.capital.toLowerCase() === target
  );
}

export const PROVINCE_NAMES = SPAIN_PROVINCES.map((p) => p.name);
