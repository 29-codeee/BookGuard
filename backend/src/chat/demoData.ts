/**
 * Demo travel data for the chatbot.
 *
 * Luxury hotels and most transport come from BookGuard's real `inventory` table
 * (see catalog.ts), so booking them goes through the booking engine. This file adds
 * what the seed does not have: destination metadata, tourist places, budget /
 * mid-range demo hotels, and demo transport for routes without inventory (e.g. Manali).
 * All prices are approximate demo values in INR.
 */
import type { BudgetTier, HotelOption, PlaceOption, TransportOption } from './types.js';

export interface Destination {
  id: string;
  name: string;
  code: string; // inventory city code
  state: string;
  aliases: string[];
  summary: string;
  idealDays: number;
  places: PlaceOption[];
  demoHotels: HotelOption[];
}

export interface City {
  code: string;
  name: string;
  aliases: string[];
}

export const ORIGIN_CITIES: City[] = [
  { code: 'BLR', name: 'Bengaluru', aliases: ['bengaluru', 'bangalore', 'blr'] },
  { code: 'DEL', name: 'Delhi', aliases: ['delhi', 'new delhi', 'del', 'ncr', 'gurgaon', 'gurugram', 'noida'] },
  { code: 'BOM', name: 'Mumbai', aliases: ['mumbai', 'bombay', 'bom'] },
  { code: 'HYD', name: 'Hyderabad', aliases: ['hyderabad', 'hyd', 'secunderabad'] },
  { code: 'MAA', name: 'Chennai', aliases: ['chennai', 'madras', 'maa'] },
  { code: 'COK', name: 'Kochi', aliases: ['kochi', 'cochin', 'cok'] },
  { code: 'JAI', name: 'Jaipur', aliases: ['jaipur', 'jai'] },
  { code: 'GOI', name: 'Goa', aliases: ['goa', 'panaji', 'panjim'] }
];

/** Local food, cabs and entry fees per person per day, by budget tier. */
export const LOCAL_COST_PER_PERSON_DAY: Record<BudgetTier, number> = {
  budget: 1200,
  medium: 2200,
  luxury: 4000
};

const place = (
  id: string,
  name: string,
  area: string,
  tags: string[],
  entryFeeInr: number,
  durationHrs: number,
  description: string
): PlaceOption => ({ id, name, area, tags, entryFeeInr, durationHrs, description });

const demoHotel = (
  id: string,
  name: string,
  tier: BudgetTier,
  pricePerNight: number,
  rating: number,
  area: string,
  amenities: string[]
): HotelOption => ({ id, name, tier, pricePerNight, rating, area, amenities, inventoryId: null, source: 'demo' });

export const DESTINATIONS: Destination[] = [
  {
    id: 'goa',
    name: 'Goa',
    code: 'GOI',
    state: 'Goa',
    aliases: ['goa', 'north goa', 'south goa', 'panaji', 'panjim', 'calangute', 'baga'],
    summary: 'Beaches, Portuguese heritage, seafood and nightlife.',
    idealDays: 3,
    places: [
      place('goa-baga', 'Baga Beach', 'North Goa', ['beach', 'nightlife'], 0, 3, 'Lively beach with shacks and water sports.'),
      place('goa-calangute', 'Calangute Beach', 'North Goa', ['beach'], 0, 2, 'The "Queen of Beaches", great at sunset.'),
      place('goa-aguada', 'Fort Aguada', 'North Goa', ['heritage', 'views'], 0, 2, '17th-century Portuguese fort and lighthouse.'),
      place('goa-anjuna', 'Anjuna Flea Market', 'North Goa', ['shopping', 'culture'], 0, 2, 'Wednesday market with crafts and cafes.'),
      place('goa-oldgoa', 'Basilica of Bom Jesus (Old Goa)', 'Central Goa', ['heritage', 'culture'], 0, 2, 'UNESCO World Heritage church.'),
      place('goa-fontainhas', 'Fontainhas Latin Quarter', 'Panaji', ['heritage', 'food'], 0, 2, 'Colourful Portuguese-era streets.'),
      place('goa-palolem', 'Palolem Beach', 'South Goa', ['beach', 'nature'], 0, 3, 'Calm crescent beach in South Goa.'),
      place('goa-dudhsagar', 'Dudhsagar Falls', 'South Goa', ['nature', 'adventure'], 400, 5, 'Four-tiered waterfall (jeep safari).')
    ],
    demoHotels: [
      demoHotel('demo-goa-budget-01', 'Zostel Goa Calangute (Demo)', 'budget', 1800, 4.2, 'Calangute', ['Wi-Fi', 'Breakfast', 'Common lounge']),
      demoHotel('demo-goa-budget-02', 'Anjuna Beach Homestay (Demo)', 'budget', 2200, 4.0, 'Anjuna', ['Wi-Fi', 'Garden']),
      demoHotel('demo-goa-mid-01', 'Baga Palms Resort (Demo)', 'medium', 4200, 4.3, 'Baga', ['Pool', 'Breakfast', 'Beach 300m']),
      demoHotel('demo-goa-mid-02', 'Panjim Heritage Inn (Demo)', 'medium', 3600, 4.4, 'Panaji', ['Breakfast', 'Heritage building'])
    ]
  },
  {
    id: 'manali',
    name: 'Manali',
    code: 'KUU',
    state: 'Himachal Pradesh',
    aliases: ['manali', 'kullu', 'solang', 'rohtang', 'himachal'],
    summary: 'Snow peaks, pine forests, adventure sports and cafes.',
    idealDays: 4,
    places: [
      place('manali-mall', 'Mall Road & Old Manali', 'Manali', ['shopping', 'food'], 0, 3, 'Cafes, markets and riverside walks.'),
      place('manali-hadimba', 'Hadimba Devi Temple', 'Manali', ['heritage', 'culture'], 0, 1, 'Wooden temple in a cedar forest.'),
      place('manali-solang', 'Solang Valley', 'Solang', ['adventure', 'nature'], 1500, 5, 'Paragliding, ropeway and snow activities.'),
      place('manali-rohtang', 'Rohtang Pass / Atal Tunnel', 'Rohtang', ['nature', 'adventure', 'views'], 550, 7, 'High mountain pass (permit required).'),
      place('manali-vashisht', 'Vashisht Hot Springs', 'Vashisht', ['nature', 'culture'], 0, 2, 'Natural hot water springs and temple.'),
      place('manali-jogini', 'Jogini Waterfall Trek', 'Vashisht', ['adventure', 'nature'], 0, 3, 'Easy trek to a waterfall.'),
      place('manali-naggar', 'Naggar Castle', 'Naggar', ['heritage', 'views'], 100, 2, '15th-century castle overlooking the valley.')
    ],
    demoHotels: [
      demoHotel('demo-manali-budget-01', 'Old Manali Backpackers (Demo)', 'budget', 1400, 4.1, 'Old Manali', ['Wi-Fi', 'Cafe', 'Heater']),
      demoHotel('demo-manali-budget-02', 'Pine View Cottage (Demo)', 'budget', 2000, 4.0, 'Manali', ['Mountain view', 'Heater']),
      demoHotel('demo-manali-mid-01', 'Snow Valley Resorts (Demo)', 'medium', 4500, 4.3, 'Log Huts Area', ['Breakfast', 'Mountain view', 'Parking']),
      demoHotel('demo-manali-mid-02', 'Apple Orchard Retreat (Demo)', 'medium', 3800, 4.4, 'Naggar Road', ['Breakfast', 'Orchard']),
      demoHotel('demo-manali-lux-01', 'Span Resort & Spa (Demo)', 'luxury', 11000, 4.6, 'Kullu-Manali Highway', ['Spa', 'Riverside', 'All meals'])
    ]
  },
  {
    id: 'hyderabad',
    name: 'Hyderabad',
    code: 'HYD',
    state: 'Telangana',
    aliases: ['hyderabad', 'hyd', 'secunderabad'],
    summary: 'Nizami heritage, biryani, Ramoji Film City.',
    idealDays: 3,
    places: [
      place('hyd-charminar', 'Charminar & Laad Bazaar', 'Old City', ['heritage', 'shopping'], 25, 2, 'Iconic 1591 monument and bangle market.'),
      place('hyd-golconda', 'Golconda Fort', 'Golconda', ['heritage', 'views'], 25, 3, 'Fort with light-and-sound show.'),
      place('hyd-chowmahalla', 'Chowmahalla Palace', 'Old City', ['heritage', 'culture'], 80, 2, 'Seat of the Asaf Jahi dynasty.'),
      place('hyd-ramoji', 'Ramoji Film City', 'Outskirts', ['entertainment'], 1350, 7, 'One of the largest film studio complexes.'),
      place('hyd-hussainsagar', 'Hussain Sagar & Lumbini Park', 'Central', ['nature', 'views'], 50, 2, 'Lake with Buddha statue and boat rides.'),
      place('hyd-salarjung', 'Salar Jung Museum', 'Old City', ['culture', 'heritage'], 50, 2, 'Vast private art collection.'),
      place('hyd-biryani', 'Biryani trail (Paradise / Shah Ghouse)', 'Various', ['food'], 0, 2, 'Hyderabadi biryani and haleem.')
    ],
    demoHotels: [
      demoHotel('demo-hyd-budget-01', 'Banjara Stay Inn (Demo)', 'budget', 1700, 4.0, 'Banjara Hills', ['Wi-Fi', 'Breakfast']),
      demoHotel('demo-hyd-mid-01', 'Lemon Tree Hitec City (Demo)', 'medium', 4200, 4.3, 'HITEC City', ['Pool', 'Breakfast', 'Gym'])
    ]
  },
  {
    id: 'jaipur',
    name: 'Jaipur',
    code: 'JAI',
    state: 'Rajasthan',
    aliases: ['jaipur', 'pink city', 'rajasthan'],
    summary: 'Forts, palaces, bazaars and Rajasthani food.',
    idealDays: 3,
    places: [
      place('jai-amber', 'Amber Fort', 'Amer', ['heritage', 'views'], 200, 3, 'Hilltop fort-palace of red sandstone and marble.'),
      place('jai-hawamahal', 'Hawa Mahal', 'Old City', ['heritage'], 50, 1, 'The Palace of Winds.'),
      place('jai-citypalace', 'City Palace', 'Old City', ['heritage', 'culture'], 300, 2, 'Royal residence and museum.'),
      place('jai-jantarmantar', 'Jantar Mantar', 'Old City', ['heritage', 'science'], 50, 1, 'UNESCO astronomical instruments.'),
      place('jai-nahargarh', 'Nahargarh Fort (sunset)', 'Aravalli Hills', ['views', 'heritage'], 50, 2, 'Sunset views over the Pink City.'),
      place('jai-johari', 'Johari & Bapu Bazaar', 'Old City', ['shopping', 'food'], 0, 2, 'Jewellery, textiles and street food.'),
      place('jai-chokhi', 'Chokhi Dhani', 'Tonk Road', ['culture', 'food'], 900, 3, 'Rajasthani village dinner experience.')
    ],
    demoHotels: [
      demoHotel('demo-jai-budget-01', 'Pink City Haveli Hostel (Demo)', 'budget', 1500, 4.2, 'Old City', ['Rooftop cafe', 'Wi-Fi']),
      demoHotel('demo-jai-mid-01', 'Umaid Mahal Heritage (Demo)', 'medium', 4000, 4.4, 'Bani Park', ['Pool', 'Breakfast', 'Heritage decor'])
    ]
  },
  {
    id: 'kerala',
    name: 'Kerala (Kochi)',
    code: 'COK',
    state: 'Kerala',
    aliases: ['kerala', 'kochi', 'cochin', 'munnar', 'alleppey', 'alappuzha', 'backwaters'],
    summary: 'Backwaters, tea hills, beaches and Kerala cuisine.',
    idealDays: 4,
    places: [
      place('ker-fortkochi', 'Fort Kochi & Chinese Fishing Nets', 'Kochi', ['heritage', 'food'], 0, 3, 'Colonial streets and seafood.'),
      place('ker-mattancherry', 'Mattancherry Palace & Jew Town', 'Kochi', ['heritage', 'shopping'], 5, 2, 'Dutch palace murals and spice markets.'),
      place('ker-alleppey', 'Alleppey Houseboat Cruise', 'Alappuzha', ['nature', 'backwaters'], 2500, 6, 'Day cruise through the backwaters.'),
      place('ker-munnar', 'Munnar Tea Gardens', 'Munnar', ['nature', 'views'], 200, 6, 'Rolling tea estates and viewpoints.'),
      place('ker-kathakali', 'Kathakali Performance', 'Kochi', ['culture'], 400, 2, 'Classical dance-drama show.'),
      place('ker-marari', 'Marari Beach', 'Alappuzha', ['beach', 'nature'], 0, 3, 'Quiet palm-fringed beach.')
    ],
    demoHotels: [
      demoHotel('demo-ker-budget-01', 'Fort Kochi Homestay (Demo)', 'budget', 1600, 4.3, 'Fort Kochi', ['Breakfast', 'Wi-Fi']),
      demoHotel('demo-ker-mid-01', 'Backwater Ripples Resort (Demo)', 'medium', 4800, 4.4, 'Kumarakom', ['Pool', 'Lake view', 'Ayurveda'])
    ]
  }
];

/**
 * Demo transport for routes that have no rows in BookGuard inventory.
 * These are clearly labelled estimates and are queued (not held) when booked.
 */
export function demoTransportOptions(fromCode: string, toCode: string): TransportOption[] {
  const opt = (
    suffix: string,
    mode: TransportOption['mode'],
    operator: string,
    code: string,
    departure: string,
    arrival: string,
    pricePerPerson: number
  ): TransportOption => ({
    id: `demo-tr-${fromCode}-${toCode}-${suffix}`.toLowerCase(),
    mode,
    operator,
    code,
    fromCode,
    toCode,
    departure,
    arrival,
    pricePerPerson,
    seatsAvailable: null,
    inventoryId: null,
    source: 'demo'
  });

  if (toCode === 'KUU') {
    if (fromCode === 'DEL') {
      return [
        opt('bus', 'bus', 'HRTC Himsuta Volvo (Demo)', 'HRTC-DEL-MNL', '19:30', '07:30', 1650),
        opt('train', 'train', 'Kalka Shatabdi + cab via Chandigarh (Demo)', 'SHTB-12011', '07:40', '17:30', 2400),
        opt('flight', 'flight', 'Alliance Air to Kullu-Bhuntar (Demo)', '9I-821', '06:05', '07:35', 7800)
      ];
    }
    return [
      opt('flight', 'flight', 'Flight via Delhi to Kullu-Bhuntar (Demo)', 'VIA-DEL-KUU', '06:00', '13:30', 11500),
      opt('bus', 'bus', 'Flight to Delhi + HRTC Volvo (Demo)', 'VIA-DEL-BUS', '10:00', '07:30', 7200)
    ];
  }
  // Any other pair without inventory: a single estimated flight
  return [opt('flight', 'flight', 'Estimated direct / 1-stop flight (Demo)', `EST-${fromCode}-${toCode}`, '09:00', '12:00', 6500)];
}
