// Curated list of major cities for quick weather-source selection.
//
// Coordinates from public city data; timezones are IANA names. The list is
// intentionally short — heavy enough to cover the climate diversity a US-
// focused BAS tech would test against, with international anchors for
// global users. Anything not here can still be typed into the search box,
// which hits the Open-Meteo geocoder.

import type { GeocodedLocation } from '@bas/core';

export interface CityGroup {
  readonly label: string;
  readonly cities: readonly GeocodedLocation[];
}

export const CITY_GROUPS: readonly CityGroup[] = [
  {
    label: 'US — Northeast',
    cities: [
      { name: 'Boston',       country: 'United States', admin1: 'Massachusetts',  latitude: 42.3601, longitude: -71.0589,  timezone: 'America/New_York' },
      { name: 'New York',     country: 'United States', admin1: 'New York',       latitude: 40.7128, longitude: -74.0060,  timezone: 'America/New_York' },
      { name: 'Philadelphia', country: 'United States', admin1: 'Pennsylvania',   latitude: 39.9526, longitude: -75.1652,  timezone: 'America/New_York' },
      { name: 'Washington',   country: 'United States', admin1: 'DC',             latitude: 38.9072, longitude: -77.0369,  timezone: 'America/New_York' },
      { name: 'Pittsburgh',   country: 'United States', admin1: 'Pennsylvania',   latitude: 40.4406, longitude: -79.9959,  timezone: 'America/New_York' },
    ],
  },
  {
    label: 'US — Midwest',
    cities: [
      { name: 'Chicago',      country: 'United States', admin1: 'Illinois',  latitude: 41.8781, longitude: -87.6298, timezone: 'America/Chicago' },
      { name: 'Detroit',      country: 'United States', admin1: 'Michigan',  latitude: 42.3314, longitude: -83.0458, timezone: 'America/Detroit' },
      { name: 'Indianapolis', country: 'United States', admin1: 'Indiana',   latitude: 39.7684, longitude: -86.1581, timezone: 'America/Indiana/Indianapolis' },
      { name: 'Minneapolis',  country: 'United States', admin1: 'Minnesota', latitude: 44.9778, longitude: -93.2650, timezone: 'America/Chicago' },
      { name: 'St. Louis',    country: 'United States', admin1: 'Missouri',  latitude: 38.6270, longitude: -90.1994, timezone: 'America/Chicago' },
      { name: 'Kansas City',  country: 'United States', admin1: 'Missouri',  latitude: 39.0997, longitude: -94.5786, timezone: 'America/Chicago' },
      { name: 'Cleveland',    country: 'United States', admin1: 'Ohio',      latitude: 41.4993, longitude: -81.6944, timezone: 'America/New_York' },
      { name: 'Pekin',        country: 'United States', admin1: 'Illinois',  latitude: 40.5675, longitude: -89.6406, timezone: 'America/Chicago' },
    ],
  },
  {
    label: 'US — South',
    cities: [
      { name: 'Atlanta',    country: 'United States', admin1: 'Georgia',        latitude: 33.7490, longitude: -84.3880,  timezone: 'America/New_York' },
      { name: 'Miami',      country: 'United States', admin1: 'Florida',        latitude: 25.7617, longitude: -80.1918,  timezone: 'America/New_York' },
      { name: 'Orlando',    country: 'United States', admin1: 'Florida',        latitude: 28.5383, longitude: -81.3792,  timezone: 'America/New_York' },
      { name: 'Houston',    country: 'United States', admin1: 'Texas',          latitude: 29.7604, longitude: -95.3698,  timezone: 'America/Chicago' },
      { name: 'Dallas',     country: 'United States', admin1: 'Texas',          latitude: 32.7767, longitude: -96.7970,  timezone: 'America/Chicago' },
      { name: 'Austin',     country: 'United States', admin1: 'Texas',          latitude: 30.2672, longitude: -97.7431,  timezone: 'America/Chicago' },
      { name: 'New Orleans',country: 'United States', admin1: 'Louisiana',      latitude: 29.9511, longitude: -90.0715,  timezone: 'America/Chicago' },
      { name: 'Nashville',  country: 'United States', admin1: 'Tennessee',      latitude: 36.1627, longitude: -86.7816,  timezone: 'America/Chicago' },
      { name: 'Charlotte',  country: 'United States', admin1: 'North Carolina', latitude: 35.2271, longitude: -80.8431,  timezone: 'America/New_York' },
    ],
  },
  {
    label: 'US — West',
    cities: [
      { name: 'Los Angeles',   country: 'United States', admin1: 'California', latitude: 34.0522, longitude: -118.2437, timezone: 'America/Los_Angeles' },
      { name: 'San Francisco', country: 'United States', admin1: 'California', latitude: 37.7749, longitude: -122.4194, timezone: 'America/Los_Angeles' },
      { name: 'San Diego',     country: 'United States', admin1: 'California', latitude: 32.7157, longitude: -117.1611, timezone: 'America/Los_Angeles' },
      { name: 'Sacramento',    country: 'United States', admin1: 'California', latitude: 38.5816, longitude: -121.4944, timezone: 'America/Los_Angeles' },
      { name: 'Seattle',       country: 'United States', admin1: 'Washington', latitude: 47.6062, longitude: -122.3321, timezone: 'America/Los_Angeles' },
      { name: 'Portland',      country: 'United States', admin1: 'Oregon',     latitude: 45.5152, longitude: -122.6784, timezone: 'America/Los_Angeles' },
      { name: 'Denver',        country: 'United States', admin1: 'Colorado',   latitude: 39.7392, longitude: -104.9903, timezone: 'America/Denver' },
      { name: 'Salt Lake City',country: 'United States', admin1: 'Utah',       latitude: 40.7608, longitude: -111.8910, timezone: 'America/Denver' },
      { name: 'Phoenix',       country: 'United States', admin1: 'Arizona',    latitude: 33.4484, longitude: -112.0740, timezone: 'America/Phoenix' },
      { name: 'Las Vegas',     country: 'United States', admin1: 'Nevada',     latitude: 36.1699, longitude: -115.1398, timezone: 'America/Los_Angeles' },
      { name: 'Anchorage',     country: 'United States', admin1: 'Alaska',     latitude: 61.2181, longitude: -149.9003, timezone: 'America/Anchorage' },
      { name: 'Honolulu',      country: 'United States', admin1: 'Hawaii',     latitude: 21.3099, longitude: -157.8581, timezone: 'Pacific/Honolulu' },
    ],
  },
  {
    label: 'Canada',
    cities: [
      { name: 'Toronto',   country: 'Canada', admin1: 'Ontario',          latitude: 43.6532, longitude: -79.3832,  timezone: 'America/Toronto' },
      { name: 'Montreal',  country: 'Canada', admin1: 'Quebec',           latitude: 45.5017, longitude: -73.5673,  timezone: 'America/Toronto' },
      { name: 'Vancouver', country: 'Canada', admin1: 'British Columbia', latitude: 49.2827, longitude: -123.1207, timezone: 'America/Vancouver' },
      { name: 'Calgary',   country: 'Canada', admin1: 'Alberta',          latitude: 51.0447, longitude: -114.0719, timezone: 'America/Edmonton' },
    ],
  },
  {
    label: 'Europe',
    cities: [
      { name: 'London',     country: 'United Kingdom', latitude: 51.5074, longitude: -0.1278,   timezone: 'Europe/London' },
      { name: 'Paris',      country: 'France',         latitude: 48.8566, longitude: 2.3522,    timezone: 'Europe/Paris' },
      { name: 'Berlin',     country: 'Germany',        latitude: 52.5200, longitude: 13.4050,   timezone: 'Europe/Berlin' },
      { name: 'Madrid',     country: 'Spain',          latitude: 40.4168, longitude: -3.7038,   timezone: 'Europe/Madrid' },
      { name: 'Rome',       country: 'Italy',          latitude: 41.9028, longitude: 12.4964,   timezone: 'Europe/Rome' },
      { name: 'Amsterdam',  country: 'Netherlands',    latitude: 52.3676, longitude: 4.9041,    timezone: 'Europe/Amsterdam' },
      { name: 'Stockholm',  country: 'Sweden',         latitude: 59.3293, longitude: 18.0686,   timezone: 'Europe/Stockholm' },
      { name: 'Reykjavik',  country: 'Iceland',        latitude: 64.1466, longitude: -21.9426,  timezone: 'Atlantic/Reykjavik' },
    ],
  },
  {
    label: 'Asia / Pacific',
    cities: [
      { name: 'Tokyo',     country: 'Japan',         latitude: 35.6762, longitude: 139.6503,  timezone: 'Asia/Tokyo' },
      { name: 'Seoul',     country: 'South Korea',   latitude: 37.5665, longitude: 126.9780,  timezone: 'Asia/Seoul' },
      { name: 'Singapore', country: 'Singapore',     latitude: 1.3521,  longitude: 103.8198,  timezone: 'Asia/Singapore' },
      { name: 'Hong Kong', country: 'Hong Kong',     latitude: 22.3193, longitude: 114.1694,  timezone: 'Asia/Hong_Kong' },
      { name: 'Dubai',     country: 'UAE',           latitude: 25.2048, longitude: 55.2708,   timezone: 'Asia/Dubai' },
      { name: 'Mumbai',    country: 'India',         latitude: 19.0760, longitude: 72.8777,   timezone: 'Asia/Kolkata' },
      { name: 'Sydney',    country: 'Australia',     latitude: -33.8688, longitude: 151.2093, timezone: 'Australia/Sydney' },
      { name: 'Auckland',  country: 'New Zealand',   latitude: -36.8485, longitude: 174.7633, timezone: 'Pacific/Auckland' },
    ],
  },
  {
    label: 'Latin America',
    cities: [
      { name: 'Mexico City',     country: 'Mexico',    latitude: 19.4326, longitude: -99.1332,  timezone: 'America/Mexico_City' },
      { name: 'São Paulo',       country: 'Brazil',    latitude: -23.5505, longitude: -46.6333, timezone: 'America/Sao_Paulo' },
      { name: 'Buenos Aires',    country: 'Argentina', latitude: -34.6037, longitude: -58.3816, timezone: 'America/Argentina/Buenos_Aires' },
    ],
  },
];

/** Flat array — useful for `<datalist>` or search filtering. */
export const ALL_CITIES: readonly GeocodedLocation[] = CITY_GROUPS.flatMap((g) => g.cities);

/** Stable id for a city based on its label — used as <option> value. */
export function cityId(loc: GeocodedLocation): string {
  return `${loc.name}|${loc.admin1 ?? ''}|${loc.country}`;
}
