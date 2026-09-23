import { query } from '../db/client.js';

export interface RecoveryAlternative {
  inventoryId: string;
  code: string;
  name: string;
  departureTime: string;
  arrivalTime: string;
  availableSeats: number;
  price: number;
  currency: string;
}

export interface RecoveryResponse {
  message: string;
  disclaimer: string;
  language: string;
  alternatives: RecoveryAlternative[];
}

const RECOVERY_COPY: Record<string, { message: string; disclaimer: string }> = {
  en: {
    message: 'Your booking could not be confirmed. Your seat was released, not charged.',
    disclaimer: 'Nearest options we can book right now based on live seat inventory:'
  },
  hi: {
    message: 'आपकी बुकिंग की पुष्टि नहीं हो सकी। आपकी सीट जारी कर दी गई थी, कोई शुल्क नहीं लिया गया।',
    disclaimer: 'लाइव सीट इन्वेंटरी के आधार पर हम अभी बुक कर सकने वाले निकटतम विकल्प:'
  },
  kn: {
    message: 'ನಿಮ್ಮ ಬುಕಿಂಗ್ ಅನ್ನು ದೃಢೀಕರಿಸಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ. ನಿಮ್ಮ ಸೀಟನ್ನು ಬಿಡುಗಡೆ ಮಾಡಲಾಗಿದೆ, ಯಾವುದೇ ಶುಲ್ಕ ವಿಧಿಸಲಾಗಿಲ್ಲ.',
    disclaimer: 'ಲೈವ್ ಸೀಟ್ ಲಭ್ಯತೆಯ ಆಧಾರದ ಮೇಲೆ ನಾವು ಈಗಲೇ ಬುಕ್ ಮಾಡಬಹುದಾದ ಸಮೀಪದ ಆಯ್ಕೆಗಳು:'
  }
};

export async function getRecoveryAlternatives(
  origin: string = 'BLR',
  destination: string = 'GOI',
  excludeInventoryId?: string,
  language: string = 'en'
): Promise<RecoveryResponse> {
  const langKey = ['en', 'hi', 'kn'].includes(language) ? language : 'en';
  const copy = RECOVERY_COPY[langKey];

  // Fetch real available alternatives directly from authoritative PostgreSQL database
  const res = await query<{
    id: string;
    code: string;
    name: string;
    departure_time: string;
    arrival_time: string;
    available_quantity: number;
    price: number | string;
  }>(
    `SELECT id, code, name, departure_time, arrival_time, available_quantity, price
     FROM inventory
     WHERE origin = $1 
       AND destination = $2 
       AND resource_type = 'flight'
       AND available_quantity > 0
       ${excludeInventoryId ? 'AND id != $3' : ''}
     ORDER BY departure_time ASC
     LIMIT 3`,
    excludeInventoryId ? [origin, destination, excludeInventoryId] : [origin, destination]
  );

  const alternatives: RecoveryAlternative[] = res.rows.map(row => ({
    inventoryId: row.id,
    code: row.code,
    name: row.name,
    departureTime: row.departure_time,
    arrivalTime: row.arrival_time,
    availableSeats: row.available_quantity,
    price: Number(row.price),
    currency: 'INR'
  }));

  return {
    message: copy.message,
    disclaimer: copy.disclaimer,
    language: langKey,
    alternatives
  };
}
