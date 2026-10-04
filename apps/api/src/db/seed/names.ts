/**
 * The datasets identify outlets only by id. People recognise stores by town, so each outlet gets a
 * stable display name from its district's towns. Purely cosmetic: ids remain the keys everywhere.
 */
export const TOWNS: Record<string, string[]> = {
  Colombo: ['Kollupitiya', 'Bambalapitiya', 'Wellawatte', 'Borella', 'Nugegoda', 'Dehiwala', 'Kotahena', 'Rajagiriya', 'Battaramulla', 'Maharagama', 'Kirulapone', 'Havelock Town', 'Narahenpita', 'Thimbirigasyaya', 'Kotte', 'Boralesgamuwa', 'Mount Lavinia', 'Pettah', 'Maradana', 'Grandpass', 'Wattala', 'Kolonnawa', 'Homagama', 'Piliyandala', 'Kesbewa'],
  Gampaha: ['Gampaha Town', 'Negombo', 'Ja-Ela', 'Kadawatha', 'Kiribathgoda', 'Ragama', 'Minuwangoda', 'Veyangoda', 'Kelaniya', 'Nittambuwa', 'Divulapitiya', 'Kandana', 'Seeduwa', 'Ekala', 'Mirigama'],
  Kalutara: ['Kalutara Town', 'Panadura', 'Horana', 'Beruwala', 'Aluthgama', 'Matugama', 'Wadduwa', 'Bandaragama'],
  Galle: ['Galle Fort', 'Hikkaduwa', 'Ambalangoda', 'Karapitiya', 'Unawatuna', 'Baddegama', 'Elpitiya'],
  Matara: ['Matara Town', 'Weligama', 'Dikwella', 'Akuressa', 'Kamburupitiya', 'Hakmana'],
  Kurunegala: ['Kurunegala Town', 'Kuliyapitiya', 'Pannala', 'Narammala', 'Wariyapola', 'Polgahawela', 'Mawathagama'],
  Puttalam: ['Puttalam Town', 'Chilaw', 'Wennappuwa', 'Marawila', 'Nattandiya', 'Dankotuwa'],
  Kandy: ['Peradeniya', 'Kandy City', 'Katugastota', 'Gampola', 'Kundasale', 'Pilimathalawa', 'Digana', 'Tennekumbura', 'Ampitiya', 'Gelioya', 'Nawalapitiya', 'Akurana', 'Wattegama', 'Kadugannawa'],
  Matale: ['Matale Town', 'Dambulla', 'Galewela', 'Ukuwela', 'Rattota', 'Naula'],
  'Nuwara Eliya': ['Nuwara Eliya Town', 'Hatton', 'Talawakele', 'Nanu Oya', 'Ragala', 'Kotagala'],
  Badulla: ['Badulla Town', 'Bandarawela', 'Ella', 'Haputale', 'Welimada', 'Mahiyanganaya'],
  Kegalle: ['Kegalle Town', 'Mawanella', 'Warakapola', 'Rambukkana', 'Ruwanwella', 'Dehiowita'],
};

export const BRAND_PREFIX: Record<string, string> = {
  Fresh: 'Waypoint Fresh',
  Style: 'Waypoint Style',
  Tech: 'Waypoint Tech',
};

/** Hero outlet from the Day 5 design: Waypoint Fresh Peradeniya, Kandy depot. */
export const HERO_OUTLET_TOWN = 'Peradeniya';
export const HERO_ORDER_NO = 'WF-30921';

export function accessNote(dock: string, parking: string, mall: string | null): string {
  const parts: string[] = [];
  if (parking === 'van_only') parts.push('Narrow lane: vans only, trucks cannot turn');
  if (parking === 'mall_dock') parts.push(`Shared mall loading bay, access ${mall ?? 'per mall window'} only`);
  if (dock === 'rear_dock') parts.push('Rear loading dock, ring bell at the side gate');
  if (dock === 'street') parts.push('Kerbside unloading; keep hazard lights on');
  if (dock === 'mall_bay') parts.push('Book bay with mall security on arrival');
  return parts.join('. ') + '.';
}

const FIRST = ['Nimal', 'Kasun', 'Suresh', 'Fathima', 'Chamara', 'Dilani', 'Ruwan', 'Ishara', 'Mohamed', 'Tharindu', 'Sanjeewa', 'Priyanka', 'Lahiru', 'Nadeesha', 'Asanka', 'Kumari', 'Roshan', 'Shanika', 'Gayan', 'Thilini', 'Rizwan', 'Pradeep', 'Malini', 'Dinesh', 'Anura', 'Hasini', 'Janaka', 'Sithara', 'Kavinda', 'Ramesh'];
const LAST = ['Perera', 'Bandara', 'Kumar', 'Rizwan', 'Silva', 'Fernando', 'Jayasinghe', 'Wickramasinghe', 'Dissanayake', 'Herath', 'Rajapaksha', 'Gunawardena', 'Senanayake', 'Ratnayake', 'Nazeer', 'Pathirana', 'Karunaratne', 'Mendis', 'Liyanage', 'Weerasinghe'];

export function personName(i: number): string {
  return `${FIRST[i % FIRST.length]} ${LAST[(i * 7 + 3) % LAST.length]}`;
}
