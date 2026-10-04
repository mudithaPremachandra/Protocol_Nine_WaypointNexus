/*
 * Geography for the live map (D5). The datasets name districts and depots but carry no coordinates,
 * so this uses the real locations of the two depots and each district's main town. Outlets are placed
 * at a stable, approximate position near their district town (seeded by outlet id). The map is for
 * orientation, not navigation: drivers hand off to Google Maps.
 */
export type LatLng = [number, number];

export const DEPOTS: Record<string, LatLng> = {
  Peliyagoda: [6.9606, 79.8826],
  Kandy: [7.2955, 80.6356],
};

export const DISTRICTS: Record<string, LatLng> = {
  Colombo: [6.9271, 79.8612],
  Gampaha: [7.0873, 79.999],
  Kalutara: [6.5854, 79.9607],
  Galle: [6.0535, 80.221],
  Matara: [5.9549, 80.555],
  Kurunegala: [7.4863, 80.3647],
  Puttalam: [8.0362, 79.8283],
  Kandy: [7.2906, 80.6337],
  Matale: [7.4675, 80.6234],
  'Nuwara Eliya': [6.9497, 80.7891],
  Badulla: [6.9934, 81.055],
  Kegalle: [7.2513, 80.3464],
};

/**
 * Real coordinates for every town an outlet is named after (outlet names come from the seed, which
 * names each outlet after a town in its district). Accurate to roughly a kilometre: enough to put
 * each store in the right place on the map.
 */
const TOWN: Record<string, LatLng> = {
  // Colombo
  Kollupitiya: [6.9115, 79.851], Bambalapitiya: [6.8925, 79.856], Wellawatte: [6.874, 79.86], Borella: [6.9147, 79.877],
  Nugegoda: [6.87, 79.889], Dehiwala: [6.851, 79.865], Kotahena: [6.948, 79.86], Rajagiriya: [6.909, 79.896],
  Battaramulla: [6.9, 79.918], Maharagama: [6.848, 79.926], Kirulapone: [6.879, 79.877], 'Havelock Town': [6.883, 79.865],
  Narahenpita: [6.899, 79.877], Thimbirigasyaya: [6.896, 79.869], Kotte: [6.888, 79.907], Boralesgamuwa: [6.841, 79.902],
  'Mount Lavinia': [6.839, 79.866], Pettah: [6.937, 79.852], Maradana: [6.929, 79.865], Grandpass: [6.946, 79.872],
  Wattala: [6.989, 79.892], Kolonnawa: [6.933, 79.888], Homagama: [6.844, 80.003], Piliyandala: [6.801, 79.922],
  // Gampaha
  'Gampaha Town': [7.0917, 79.999], Negombo: [7.2083, 79.8395], 'Ja-Ela': [7.075, 79.892], Kadawatha: [7.001, 79.953],
  Kiribathgoda: [6.981, 79.929], Ragama: [7.03, 79.92], Minuwangoda: [7.166, 79.953], Veyangoda: [7.153, 80.056],
  Kelaniya: [6.955, 79.922], Nittambuwa: [7.144, 80.095], Divulapitiya: [7.224, 80.014], Kandana: [7.048, 79.897],
  Seeduwa: [7.127, 79.88], Ekala: [7.104, 79.908], Mirigama: [7.241, 80.13],
  // Kalutara
  'Kalutara Town': [6.59, 79.965], Panadura: [6.713, 79.907], Horana: [6.716, 80.063], Beruwala: [6.479, 79.986],
  Aluthgama: [6.434, 80.003], Matugama: [6.522, 80.114], Wadduwa: [6.667, 79.933], Bandaragama: [6.714, 79.988],
  // Galle
  'Galle Fort': [6.0265, 80.2175], Hikkaduwa: [6.139, 80.108], Ambalangoda: [6.235, 80.057], Karapitiya: [6.064, 80.227],
  Unawatuna: [6.012, 80.25], Baddegama: [6.165, 80.179], Elpitiya: [6.29, 80.159],
  // Matara
  'Matara Town': [5.95, 80.546], Weligama: [5.975, 80.43], Dikwella: [5.97, 80.692], Akuressa: [6.1, 80.48],
  Kamburupitiya: [6.075, 80.565], Hakmana: [6.079, 80.656],
  // Puttalam
  'Puttalam Town': [8.036, 79.84], Chilaw: [7.576, 79.8], Wennappuwa: [7.349, 79.846],
  // Kurunegala
  'Kurunegala Town': [7.4863, 80.3647], Kuliyapitiya: [7.469, 80.042], Pannala: [7.329, 80.023], Narammala: [7.432, 80.214],
  Wariyapola: [7.628, 80.24], Polgahawela: [7.333, 80.3], Mawathagama: [7.431, 80.444],
  // Kandy
  'Kandy City': [7.2936, 80.635], Katugastota: [7.324, 80.623], Gampola: [7.164, 80.577], Kundasale: [7.281, 80.69],
  Pilimathalawa: [7.266, 80.548], Digana: [7.299, 80.737], Tennekumbura: [7.281, 80.672], Ampitiya: [7.283, 80.653],
  Peradeniya: [7.2697, 80.5953], Gelioya: [7.216, 80.601], Nawalapitiya: [7.056, 80.533], Akurana: [7.366, 80.617],
  Wattegama: [7.35, 80.682], Kadugannawa: [7.254, 80.524],
  // Kegalle
  'Kegalle Town': [7.2513, 80.3464], Mawanella: [7.253, 80.444], Warakapola: [7.226, 80.199], Rambukkana: [7.324, 80.392],
  Ruwanwella: [7.045, 80.256],
  // Matale
  'Matale Town': [7.4675, 80.6234], Dambulla: [7.86, 80.651], Galewela: [7.759, 80.567], Ukuwela: [7.426, 80.629],
  Rattota: [7.518, 80.676], Naula: [7.708, 80.652],
  // Nuwara Eliya
  'Nuwara Eliya Town': [6.9497, 80.7891], Hatton: [6.892, 80.596], Talawakele: [6.937, 80.658], 'Nanu Oya': [6.944, 80.747],
  Ragala: [6.993, 80.817], Kotagala: [6.917, 80.638],
  // Badulla
  'Badulla Town': [6.9934, 81.055], Bandarawela: [6.829, 80.987], Ella: [6.8667, 81.0466], Haputale: [6.768, 80.958],
  Welimada: [6.904, 80.913], Mahiyanganaya: [7.32, 80.99],
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

/**
 * Where an outlet is on the map: its town's real location, from the outlet's name
 * ("Waypoint Fresh Pilimathalawa"). A second outlet in the same town ("Kandy City 2") sits about a
 * kilometre inland of the first. Unknown names fall back to near the district's main town.
 */
/** The real location of the town an outlet is named after, if known. */
export function townPosition(name: string): LatLng | undefined {
  const m = /^Waypoint \w+ (.+?)(?: (\d+))?$/.exec(name);
  const town = m ? TOWN[m[1]!] : undefined;
  if (!town) return undefined;
  const n = m![2] ? Number(m![2]) - 1 : 0;
  return n ? [town[0] + 0.006 * n, town[1] + 0.008 * n] : town;
}

export function outletPosition(outletId: string, district: string, name = ''): LatLng {
  const known = townPosition(name);
  if (known) return known;
  const [lat, lng] = DISTRICTS[district] ?? DEPOTS.Peliyagoda!;
  const angle = hash(outletId) * Math.PI * 2;
  return [lat + Math.sin(angle) * 0.02, lng + Math.abs(Math.cos(angle)) * 0.02];
}

/** Waypoint's service area. Phone fixes outside it (e.g. a demo laptop abroad) are ignored on the map. */
export function inServiceArea(lat: number, lng: number) {
  return lat >= 5.85 && lat <= 9.9 && lng >= 79.5 && lng <= 81.95;
}
